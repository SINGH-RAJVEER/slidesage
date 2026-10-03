package generation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

type submitInput struct {
	Topic           string
	ParentID        string
	RetryID         string
	SlideCount      int
	DetailLevel     string
	Tonality        string
	Research        any
	ResearchPayload *presentation.ResearchPayload
	AI              *ai.Selection
	// Theme styles a new deck; empty means the default theme.
	Theme string `json:",omitempty"`
	// Plan is an outline the user approved; it fixes the card count.
	Plan *cardPlan `json:",omitempty"`
	// BaseRevision is the card revision an AI revision was asked against.
	BaseRevision int `json:",omitempty"`
	// CardIDs are the cards an AI revision rewrites; empty means every card.
	CardIDs []string `json:",omitempty"`
}

type persistedPresentation struct {
	ID       string
	Title    string
	Prompt   string
	Data     json.RawMessage
	Revision int
}

// duplicateSubmit reports that a submission already exists for the supplied
// job ID, carrying its committed identity.
type duplicateSubmit struct {
	jobID, presentationID string
}

func (duplicateSubmit) Error() string { return "duplicate submission" }

type writeStatusError struct {
	Status  int
	Message string
}

func (e writeStatusError) Error() string { return e.Message }

// submit creates a durable presentation job and returns its identity as JSON.
// The client supplies the job ID, which doubles as the idempotency key:
// resubmitting the same job ID with the same body attaches to the existing
// job, and with a different body conflicts. Progress is consumed separately
// through GET /generation-jobs/{id}/events.
func (h *handler) submit(writer http.ResponseWriter, request *http.Request) {
	userID, body, ok := h.body(writer, request, maxBodyBytes)
	if !ok {
		return
	}
	input, err := parseSubmitInput(body)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	jobID := text(body["job_id"], "")
	if jobID == "" {
		jobID, err = uuid()
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "Unable to start generation")
			return
		}
	} else if _, idempotencyErr := validateIdempotencyKey(jobID); idempotencyErr != nil {
		writeError(writer, http.StatusBadRequest, "job_id "+idempotencyErr.Error())
		return
	}
	requestHashValue := requestHash(input)

	// Preview mode runs research synchronously and stops before any planning
	// or drafting work, so clients can show sources before committing points.
	if preview, _ := body["preview"].(bool); preview {
		if input.ParentID != "" || input.RetryID != "" {
			writeError(writer, http.StatusBadRequest, "preview cannot target an existing presentation")
			return
		}
		options, ok := input.Research.(presentation.ResearchOptions)
		if !ok || !options.Enabled {
			writeError(writer, http.StatusBadRequest, "preview requires enabled research")
			return
		}
		if h.research == nil {
			writeError(writer, http.StatusServiceUnavailable, "Research is unavailable")
			return
		}
		result, err := presentation.RunResearchPreview(request.Context(), h.database, h.research, userID, jobID, requestHashValue, input.Topic, options, input.SlideCount, input.DetailLevel, input.Tonality)
		if err != nil {
			var previewErr *presentation.ResearchPreviewError
			if errors.As(err, &previewErr) {
				if previewErr.Insufficient {
					writeJSON(writer, previewErr.Status, map[string]any{"error": map[string]string{"message": previewErr.Message, "code": "INSUFFICIENT_TOKENS"}, "slide_tokens_remaining": previewErr.RemainingPoints, "slide_tokens_required": previewErr.RequiredPoints})
					return
				}
				writeError(writer, previewErr.Status, previewErr.Message)
				return
			}
			writeError(writer, http.StatusInternalServerError, "Unable to start generation")
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"sources": result.Sources, "estimated_tokens": result.EstimatedTokens, "slide_tokens_remaining": result.RemainingPoints})
		return
	}

	// Only the worker drafts, so the API decides from the configuration both
	// processes share rather than from a drafter it never holds.
	if !h.draftingEnabled {
		writeError(writer, http.StatusServiceUnavailable, "Presentation generation is not available yet")
		return
	}
	if input.Theme != "" && h.planner != nil {
		known, err := h.planner.knowsTheme(request.Context(), input.Theme)
		if err != nil {
			writeError(writer, http.StatusServiceUnavailable, "Presentation generation is not available right now")
			return
		}
		if !known {
			writeError(writer, http.StatusBadRequest, "theme is not known")
			return
		}
	}
	if input.Plan != nil {
		if h.planner == nil {
			writeError(writer, http.StatusServiceUnavailable, "Presentation generation is not available yet")
			return
		}
		d, err := h.planner.start(request.Context(), streamJob{slideCount: input.SlideCount, researchPayload: input.ResearchPayload})
		if err != nil {
			writeError(writer, http.StatusServiceUnavailable, "Presentation generation is not available right now")
			return
		}
		if err := d.checkPlan(input.Plan); err != nil {
			writeError(writer, http.StatusBadRequest, "The outline cannot be drafted: "+err.Error())
			return
		}
	}

	var job streamJob
	var placeholder []byte
	create := false
	if input.ParentID != "" {
		job, err = h.iterationJob(request.Context(), userID, input, jobID)
	} else {
		job, placeholder, err = h.generationJob(request.Context(), userID, input, jobID, requestHashValue)
		create = input.RetryID == ""
	}
	if err != nil {
		var duplicate duplicateSubmit
		if errors.As(err, &duplicate) {
			h.wakeCommitted(request.Context())
			writeJSON(writer, http.StatusOK, map[string]any{"job_id": duplicate.jobID, "presentation_id": duplicate.presentationID, "status": "existing"})
			return
		}
		var status writeStatusError
		if errors.As(err, &status) {
			writeError(writer, status.Status, status.Message)
			return
		}
		h.reservationError(writer, err)
		return
	}
	balance, _, err := h.enqueue(request.Context(), job, requestHashValue, create, input.Topic, placeholder)
	if err != nil {
		var duplicate duplicateOperation
		if errors.As(err, &duplicate) && duplicate.jobID != "" {
			h.wakeCommitted(request.Context())
			writeJSON(writer, http.StatusOK, map[string]any{"job_id": duplicate.jobID, "presentation_id": duplicate.presentationID, "status": "existing"})
			return
		}
		h.reservationError(writer, err)
		return
	}
	_ = balance
	writeJSON(writer, http.StatusAccepted, map[string]any{"job_id": job.jobID, "presentation_id": job.presentationID, "status": "queued"})
}

// parseSubmitInput validates the unified submission body. A parent_presentation_id
// marks an iteration of an existing deck; retry_presentation_id resubmits a
// failed generation; neither means a fresh generation.
func parseSubmitInput(body map[string]any) (submitInput, error) {
	topic, err := required(body["topic"], "topic")
	if err != nil {
		return submitInput{}, err
	}
	input := submitInput{Topic: topic}
	input.ParentID = text(body["parent_presentation_id"], "")
	input.RetryID = text(body["retry_presentation_id"], "")
	if len(input.ParentID) > 200 || len(input.RetryID) > 200 {
		return submitInput{}, errors.New("presentation id must contain at most 200 characters")
	}
	if input.ParentID != "" && input.RetryID != "" {
		return submitInput{}, errors.New("parent_presentation_id and retry_presentation_id are mutually exclusive")
	}
	if input.ParentID != "" {
		if err := parseRevisionTarget(body, &input); err != nil {
			return submitInput{}, err
		}
	}
	if value, found := body["plan"]; found && value != nil {
		if input.ParentID != "" {
			return submitInput{}, errors.New("an outline can only start a new presentation")
		}
		plan, err := parsePlan(value)
		if err != nil {
			return submitInput{}, err
		}
		input.Plan = plan
		input.SlideCount = len(plan.Cards)
	} else {
		slides, err := slideCount(body, input.ParentID == "")
		if err != nil {
			return submitInput{}, err
		}
		input.SlideCount = slides
	}
	research, err := parseResearch(body["research"])
	if err != nil {
		return submitInput{}, err
	}
	input.Research = research
	if value, found := body["theme"]; found && value != nil {
		if input.ParentID != "" {
			return submitInput{}, errors.New("a theme can only style a new presentation")
		}
		theme, ok := value.(string)
		if !ok || theme == "" || len(theme) > 40 {
			return submitInput{}, errors.New("theme must be a theme name")
		}
		input.Theme = theme
	}
	input.DetailLevel = choice(body["detail_level"], "balanced")
	input.Tonality = choice(body["tonality"], "professional")
	if !validDetail(input.DetailLevel) || !validTonality(input.Tonality) {
		return submitInput{}, errors.New("Invalid generation options")
	}
	if value := body["research_payload"]; value != nil {
		payload, err := presentation.ParseResearchPayload(value)
		if err != nil {
			return submitInput{}, err
		}
		input.ResearchPayload = &payload
	}
	selection, err := parseAISelection(body["ai"])
	if err != nil {
		return submitInput{}, err
	}
	input.AI = selection
	return input, nil
}

func (h *handler) generationJob(ctx context.Context, userID string, input submitInput, jobID, hash string) (streamJob, []byte, error) {
	presentationID := input.RetryID
	if presentationID != "" {
		existing, err := h.ownedPresentation(ctx, presentationID, userID)
		if err != nil {
			return streamJob{}, nil, writeStatusError{http.StatusNotFound, "Presentation not found"}
		}
		var document map[string]any
		_ = json.Unmarshal(existing.Data, &document)
		if document["status"] != "failed" {
			duplicate, err := h.existingSubmission(ctx, userID, jobID, hash)
			if err == nil && duplicate.jobID != "" {
				return streamJob{}, nil, duplicateSubmit{jobID: duplicate.jobID, presentationID: duplicate.presentationID}
			}
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return streamJob{}, nil, err
			}
			return streamJob{}, nil, writeStatusError{http.StatusConflict, "Only failed presentations can be retried"}
		}
	}
	quote := cardAuthorizationMillis(input.SlideCount, input.Topic, input.Research, input.ResearchPayload)
	operationID, err := uuid()
	if err != nil {
		return streamJob{}, nil, err
	}
	if presentationID == "" {
		presentationID, err = uuid()
		if err != nil {
			return streamJob{}, nil, err
		}
	}
	selection, _, err := h.connections.CredentialForGeneration(ctx, userID, input.AI)
	if err != nil {
		return streamJob{}, nil, writeStatusError{http.StatusConflict, err.Error()}
	}
	if selection != nil {
		quote = 0
	}
	initial := generationPlaceholder(input)
	placeholder, _ := json.Marshal(initial)
	job := streamJob{jobID: jobID, userID: userID, operationID: operationID, presentationID: presentationID, quote: quote, prompt: input.Topic, slideCount: input.SlideCount, detailLevel: input.DetailLevel, tonality: input.Tonality, research: input.Research, researchPayload: input.ResearchPayload, selection: selection, plan: input.Plan, theme: input.Theme, kind: "generation"}
	return job, placeholder, nil
}

func generationPlaceholder(input submitInput) map[string]any {
	retry := map[string]any{"prompt": input.Topic, "slide_count": input.SlideCount, "detail_level": input.DetailLevel, "tonality": input.Tonality, "research_enabled": input.Research != nil || input.ResearchPayload != nil, "research_payload": input.ResearchPayload, "ai": input.AI}
	if input.Theme != "" {
		retry["theme"] = input.Theme
	}
	return map[string]any{"title": "Generating...", "slides": []any{}, "status": "generating", "failure": map[string]any{"retry": retry}}
}

func (h *handler) iterationJob(ctx context.Context, userID string, input submitInput, jobID string) (streamJob, error) {
	duplicate, err := h.existingSubmission(ctx, userID, jobID, requestHash(input))
	if err == nil {
		return streamJob{}, duplicateSubmit{jobID: duplicate.jobID, presentationID: duplicate.presentationID}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return streamJob{}, err
	}
	base, err := h.ownedPresentation(ctx, input.ParentID, userID)
	if err != nil {
		return streamJob{}, writeStatusError{http.StatusNotFound, "Presentation not found"}
	}
	var current struct {
		Status      string `json:"status"`
		TotalSlides int    `json:"totalSlides"`
	}
	if json.Unmarshal(base.Data, &current) != nil || current.Status != "ready" {
		return streamJob{}, writeStatusError{http.StatusConflict, "This presentation has no completed document to revise yet"}
	}
	revision, err := carddocument.CurrentRevision(ctx, h.database, base.ID, userID)
	if errors.Is(err, carddocument.ErrNoRevision) {
		return streamJob{}, writeStatusError{http.StatusConflict, "This presentation has no completed document to revise yet"}
	}
	if err != nil {
		return streamJob{}, err
	}
	// Checked here as well as at commit, so a stale request is refused before
	// any points are reserved or tokens spent.
	if revision.Number != input.BaseRevision {
		return streamJob{}, writeStatusError{http.StatusConflict, "This presentation changed since it was opened. Reload it and try again."}
	}
	targets := len(input.CardIDs)
	if targets == 0 {
		targets = revision.CardCount
	}
	if targets > revision.CardCount {
		return streamJob{}, writeStatusError{http.StatusBadRequest, "card_ids names more cards than the presentation has"}
	}

	operationID, err := uuid()
	if err != nil {
		return streamJob{}, err
	}
	var summary struct {
		Sources json.RawMessage `json:"sources"`
	}
	_ = json.Unmarshal(base.Data, &summary)
	quote := revisionAuthorizationMillis(targets, input.Topic, revision.ByteSize, len(summary.Sources))
	selection, _, err := h.connections.CredentialForGeneration(ctx, userID, input.AI)
	if err != nil {
		return streamJob{}, writeStatusError{http.StatusConflict, err.Error()}
	}
	if selection != nil {
		quote = 0
	}
	return streamJob{jobID: jobID, userID: userID, operationID: operationID, presentationID: base.ID, expectedRevision: base.Revision, baseRevision: revision.Number, cardIDs: input.CardIDs, quote: quote, prompt: input.Topic, slideCount: revision.CardCount, detailLevel: input.DetailLevel, tonality: input.Tonality, selection: selection, current: base.Data, kind: "iteration"}, nil
}

// parseRevisionTarget reads what an AI revision applies to: the card revision
// the user was looking at and, optionally, the cards to rewrite.
func parseRevisionTarget(body map[string]any, input *submitInput) error {
	number, ok := body["base_revision"].(json.Number)
	base, err := number.Int64()
	if !ok || err != nil || base < 1 {
		return errors.New("base_revision must be the positive card revision being revised")
	}
	input.BaseRevision = int(base)
	if value := body["card_ids"]; value != nil {
		list, ok := value.([]any)
		if !ok || len(list) > 40 {
			return errors.New("card_ids must be a list of at most 40 card IDs")
		}
		seen := map[string]bool{}
		for _, item := range list {
			id, ok := item.(string)
			if !ok || id == "" || len(id) > 64 || seen[id] {
				return errors.New("card_ids must hold distinct card IDs")
			}
			seen[id] = true
			input.CardIDs = append(input.CardIDs, id)
		}
	}
	return nil
}

// revisionAuthorizationMillis prices an AI revision: every targeted card at
// its drafting bound, repair headroom, and the document and sources each
// batch call resends.
func revisionAuthorizationMillis(targets int, instruction string, documentBytes int64, sourceBytes int) int64 {
	batches := (targets + cardBatchSize - 1) / cardBatchSize
	perCall := (draftingPromptAllowanceBytes + len(instruction) + int(documentBytes) + sourceBytes + 3) / 4
	headroom := repairHeadroomTokens(targets)
	output := targets*draftTokensPerCard + headroom
	return int64(output + ((batches*perCall+headroom)*12+9)/10)
}

type streamJob struct {
	jobID, userID, operationID, presentationID string
	expectedRevision                           int
	// baseRevision is the card revision an AI revision rewrites, and cardIDs
	// the cards it rewrites; empty means every card.
	baseRevision                int
	cardIDs                     []string
	quote                       int64
	prompt                      string
	slideCount                  int
	detailLevel, tonality, kind string
	research                    any
	researchPayload             *presentation.ResearchPayload
	selection                   *ai.Selection
	credential                  string
	current                     json.RawMessage
	requestHash                 string
	// plan is an outline the user approved; drafting then skips planning.
	plan *cardPlan
	// theme styles the assembled deck; empty means the default theme.
	theme string
	// report sends a progress event for the job. It is set by the worker.
	report func(eventType string, payload any)
}

// existingSubmission resolves a reused job ID against the committed job row:
// resubmitting the same body attaches to the existing job, a different body
// conflicts. The job row carries its own request hash.
func (h *handler) existingSubmission(ctx context.Context, userID, jobID, requestHash string) (duplicateOperation, error) {
	var existingHash string
	var duplicate duplicateOperation
	err := h.database.QueryRowContext(ctx, `SELECT COALESCE(payload->>'request_hash', ''), presentation_id FROM generation_jobs WHERE id = $1 AND user_id = $2`, jobID, userID).Scan(&existingHash, &duplicate.presentationID)
	if err != nil {
		return duplicateOperation{}, err
	}
	duplicate.jobID = jobID
	if existingHash != requestHash {
		return duplicateOperation{}, idempotencyConflict{}
	}
	return duplicate, nil
}

func validateIdempotencyKey(value string) (string, error) {
	key := strings.TrimSpace(value)
	if len(key) < 16 || len(key) > 128 {
		return "", errors.New("Idempotency-Key must contain 16-128 characters")
	}
	for _, character := range key {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' || character == '.') {
			return "", errors.New("Idempotency-Key contains invalid characters")
		}
	}
	return key, nil
}

func requestHash(value any) string {
	encoded, _ := json.Marshal(value)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func parseAISelection(value any) (*ai.Selection, error) {
	if value == nil {
		return nil, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("ai must be an object")
	}
	provider, providerOK := object["provider"].(string)
	selectedModel, modelOK := object["model"].(string)
	selection := &ai.Selection{Provider: ai.Provider(strings.TrimSpace(provider)), Model: strings.TrimSpace(selectedModel)}
	if !providerOK || !modelOK || selection.Model == "" || selection.Provider != ai.OpenAI && selection.Provider != ai.Google && selection.Provider != ai.Anthropic {
		return nil, errors.New("Invalid AI model selection")
	}
	return selection, nil
}
