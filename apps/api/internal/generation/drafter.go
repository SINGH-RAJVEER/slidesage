package generation

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
)

var errDraftingUnavailable = errors.New("presentation drafting is not available")

// draftingPromptAllowanceBytes stands in for the drafter's system prompt when a
// submission is priced, so the reservation covers instructions the request body
// does not carry.
const draftingPromptAllowanceBytes = 2048

// draftResult is a finished draft waiting for the completion transaction.
type draftResult struct {
	// document is the presentation summary stored in slides_data.
	document map[string]any
	tokens   int
	// commit records the drafted revision inside the transaction that settles
	// the job, so the revision, the charge, and the presentation state land
	// together or not at all. It returns the revision summary for the
	// completion event.
	commit func(ctx context.Context, tx *sql.Tx) (map[string]any, error)
}

// documentDrafter writes the presentation a queued job asks for.
type documentDrafter interface {
	Draft(ctx context.Context, job streamJob) (draftResult, error)
}

// configureCardDrafter returns nil when card generation is not configured, so
// a job that still reaches the worker fails with drafting_unavailable and
// releases its reservation.
func configureCardDrafter(h *handler) (documentDrafter, error) {
	if !carddocument.Configured() {
		return nil, nil
	}
	store, err := carddocument.NewGCSBlobStore(context.Background(), strings.TrimSpace(os.Getenv("PRESENTATION_GCS_BUCKET")))
	if err != nil {
		return nil, err
	}
	return newCardDrafter(carddocument.ConverterFromEnv(), store, h.generateJSON), nil
}
