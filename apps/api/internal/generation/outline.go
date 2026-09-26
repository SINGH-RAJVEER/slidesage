package generation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// outlineSchemaAllowanceTokens covers the schema and instructions the planner
// sends besides the topic and sources.
const outlineSchemaAllowanceTokens = 2000

// outlineAuthorizationMillis prices the planning call: one plan entry per card,
// the request context, and the schema allowance.
func outlineAuthorizationMillis(input submitInput) int64 {
	output := input.SlideCount*planTokensPerCard + 300
	return authorizationMillis(output, input.Topic, nil, input.Research, input.ResearchPayload, 0) + outlineSchemaAllowanceTokens
}

type duplicateOutline struct{}

func (duplicateOutline) Error() string { return "This outline is already being prepared" }

// outline plans a deck without drafting it, so the user can review and edit
// the plan first. It is priced and settled on its own; the approved plan is
// then submitted with the generation job.
func (h *handler) outline(writer http.ResponseWriter, request *http.Request) {
	userID, body, ok := h.body(writer, request, maxBodyBytes)
	if !ok {
		return
	}
	if !h.draftingEnabled || h.planner == nil {
		writeError(writer, http.StatusServiceUnavailable, "Presentation generation is not available yet")
		return
	}
	input, err := parseSubmitInput(body)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	key, err := validateIdempotencyKey(text(body["outline_id"], ""))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "outline_id "+err.Error())
		return
	}
	ctx := request.Context()
	selection, credential, err := h.connections.CredentialForGeneration(ctx, userID, input.AI)
	if err != nil {
		writeError(writer, http.StatusConflict, err.Error())
		return
	}
	quote := outlineAuthorizationMillis(input)
	if selection != nil {
		quote = 0
	}
	operationID, err := uuid()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Unable to prepare the outline")
		return
	}
	if err := h.reserveOutline(ctx, operationID, userID, key, requestHash(input), quote); err != nil {
		var duplicate duplicateOutline
		if errors.As(err, &duplicate) {
			writeError(writer, http.StatusConflict, duplicate.Error())
			return
		}
		h.reservationError(writer, err)
		return
	}

	job := streamJob{
		userID: userID, operationID: operationID, prompt: input.Topic, slideCount: input.SlideCount,
		detailLevel: input.DetailLevel, tonality: input.Tonality, research: input.Research,
		researchPayload: input.ResearchPayload, selection: selection, credential: credential, kind: "generation",
	}
	d, err := h.planner.start(ctx, job)
	var plan cardPlan
	if err == nil {
		plan, err = d.plan(ctx)
	}
	tokens := 0
	if d != nil {
		tokens = d.tokens
	}
	if err == nil && quote > 0 && tokens <= 0 {
		err = errors.New("provider usage unavailable")
	}
	finalizeContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err != nil {
		slog.WarnContext(ctx, "outline failed", "error", err)
		if refundErr := h.refundOutline(finalizeContext, operationID, userID, err.Error()); refundErr != nil {
			slog.ErrorContext(ctx, "refund outline", "error", refundErr)
		}
		writeError(writer, http.StatusBadGateway, "The outline could not be prepared. Your points were released.")
		return
	}
	charged := actualCharge(tokens, quote)
	balance, err := h.settleOutline(finalizeContext, operationID, userID, quote, charged, tokens)
	if err != nil {
		slog.ErrorContext(ctx, "settle outline", "error", err)
		writeError(writer, http.StatusInternalServerError, "Unable to settle the outline")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"plan":                   plan,
		"photos":                 h.planner.images != nil,
		"slide_tokens_charged":   points(charged),
		"slide_tokens_remaining": points(balance),
	})
}

func (h *handler) reserveOutline(ctx context.Context, operationID, userID, key, hash string, quote int64) error {
	tx, err := h.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var balance int64
	if err := tx.QueryRowContext(ctx, `SELECT balance_millis FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return err
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT id FROM generation_point_operations WHERE user_id = $1 AND kind = 'outline' AND idempotency_key = $2`, userID, key).Scan(&existing)
	if err == nil {
		return duplicateOutline{}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if balance < quote {
		return insufficient{balance: balance, required: quote}
	}
	if err := tx.QueryRowContext(ctx, `UPDATE users SET balance_millis = balance_millis - $1, updated_at = NOW() WHERE id = $2 RETURNING balance_millis`, quote, userID).Scan(&balance); err != nil {
		return err
	}
	// The lease outlives the planning call's timeout, so a crashed API process
	// leaves a reservation that expiry recovery refunds.
	if _, err := tx.ExecContext(ctx, `INSERT INTO generation_point_operations (id, user_id, kind, idempotency_key, request_hash, pricing_version, quoted_millis, expires_at)
		VALUES ($1, $2, 'outline', $3, $4, '2026-09-outline-v1', $5, NOW() + INTERVAL '10 minutes')`, operationID, userID, key, hash, quote); err != nil {
		return err
	}
	if err := recordLedger(tx, userID, operationID, "model_reservation", -quote, balance); err != nil {
		return err
	}
	return tx.Commit()
}

func (h *handler) refundOutline(ctx context.Context, operationID, userID, reason string) error {
	tx, err := h.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := refundReservationTx(ctx, tx, operationID, userID, reason); err != nil {
		return err
	}
	return tx.Commit()
}

func (h *handler) settleOutline(ctx context.Context, operationID, userID string, quote, charged int64, tokens int) (int64, error) {
	tx, err := h.database.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var balance int64
	if err := tx.QueryRowContext(ctx, `SELECT balance_millis FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE generation_point_operations SET status = 'settled', charged_millis = $1, provider_total_tokens = $2, finalized_at = NOW(), updated_at = NOW()
		WHERE id = $3 AND user_id = $4 AND kind = 'outline' AND status = 'reserved'`, charged, tokens, operationID, userID)
	if err != nil {
		return 0, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return 0, errInactiveReservation
	}
	if refund := quote - charged; refund > 0 {
		if err := tx.QueryRowContext(ctx, `UPDATE users SET balance_millis = balance_millis + $1, updated_at = NOW() WHERE id = $2 RETURNING balance_millis`, refund, userID).Scan(&balance); err != nil {
			return 0, err
		}
		if err := recordLedger(tx, userID, operationID, "reservation_release", refund, balance); err != nil {
			return 0, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE generation_point_operations SET balance_after_millis = $1 WHERE id = $2`, balance, operationID); err != nil {
		return 0, err
	}
	return balance, tx.Commit()
}

// parsePlan reads an approved outline from a submission.
func parsePlan(value any) (*cardPlan, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var plan cardPlan
	if err := json.Unmarshal(encoded, &plan); err != nil {
		return nil, fmt.Errorf("plan is not a valid outline: %v", err)
	}
	if len(plan.Cards) < 1 || len(plan.Cards) > 40 {
		return nil, errors.New("plan must hold 1-40 cards")
	}
	for index := range plan.Cards {
		// Positions follow the order the user left the cards in.
		plan.Cards[index].Position = index + 1
	}
	return &plan, nil
}
