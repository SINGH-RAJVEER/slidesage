package generation

import (
	"context"
	"errors"
)

var errDraftingUnavailable = errors.New("presentation drafting is not available")

// draftingPromptAllowanceBytes stands in for the drafter's system prompt when a
// submission is priced, so the reservation covers instructions the request body
// does not carry.
const draftingPromptAllowanceBytes = 2048

// documentDrafter writes the presentation a queued job asks for and reports the
// provider tokens it spent. The card document module is the intended
// implementation. Until it exists the handler holds none, and submission is
// refused before any points are reserved.
type documentDrafter interface {
	Draft(ctx context.Context, job streamJob) (document map[string]any, tokens int, err error)
}
