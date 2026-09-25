package generation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

// cardPromptVersion identifies the prompts below in revision provenance, so a
// document can be traced to the instructions that produced it.
const cardPromptVersion = "cards-v1"

const defaultCardTheme = "slate"

// cardBatchSize bounds how many cards one drafting call writes. Short calls
// finish before an upstream stall is likely; the plan keeps batches coherent.
var cardBatchSize = 4

// cardRepairAttempts bounds the targeted repairs of one invalid card.
const cardRepairAttempts = 2

const (
	planTokensPerCard  = 160
	draftTokensPerCard = 650
	// planBytesPerCard approximates one serialized plan entry, which every
	// drafting call resends.
	planBytesPerCard = 420
)

const planSystemPrompt = `You plan presentations as a sequence of cards. Each card makes exactly one point.
Return one JSON object: {"title": string, "cards": [{"position": number, "takeaway": string, "role": string, "layout": string, "evidence": string, "sourceIds": [string]}]}.
Return exactly the requested number of cards with positions 1 to N in order.
takeaway is one sentence stating the card's point, at most 200 characters.
role and layout must be values from the supplied schema. Choose the layout whose description fits the content the card needs, and vary layouts where the content allows.
evidence names the specific facts, figures, or examples the card will use.
Cite only supplied source IDs and never invent sources.
When the deck has at least three cards, open with an opening card and end with a closing card.
No styling, colors, CSS, HTML, or coordinates.`

const draftSystemPrompt = `You write presentation cards from an approved plan.
Return one JSON object: {"cards": [card, ...]} with exactly one card for each requested position.
Each card follows the supplied card and node shapes exactly, uses the layout from its plan entry, and satisfies that layout's node counts, its item counts, and the character limits in the schema.
Text may use **bold** and *italic*; no other markup, HTML, links, or emoji.
Write substantive, specific content that supports the card's takeaway, and do not repeat content from other cards.
Cite only supplied source IDs. No styling, colors, or coordinates.`

const repairSystemPrompt = `A presentation card failed validation.
Return one JSON object: {"card": card} that fixes exactly the reported problem and keeps everything else the same.
If text is too long, rewrite it to say the same thing within the limit, counting characters including spaces.
If the node or item counts do not fit the layout, adjust the content to fit that layout.
Follow the supplied card and node shapes exactly.`

type cardPlanEntry struct {
	Position  int      `json:"position"`
	Takeaway  string   `json:"takeaway"`
	Role      string   `json:"role"`
	Layout    string   `json:"layout"`
	Evidence  string   `json:"evidence"`
	SourceIDs []string `json:"sourceIds"`
}

type cardPlan struct {
	Title string          `json:"title"`
	Cards []cardPlanEntry `json:"cards"`
}

// draftingSchema is the part of the converter's schema the planner checks.
type draftingSchema struct {
	Roles   []string                   `json:"roles"`
	Layouts map[string]json.RawMessage `json:"layouts"`
}

type citedSource struct {
	ID      string `json:"id"`
	Title   string `json:"title,omitempty"`
	URL     string `json:"url"`
	Snippet string `json:"snippet,omitempty"`
}

type generateFunc func(ctx context.Context, job streamJob, promptName, system, user string, maxOutput int) (map[string]any, int, error)

// cardDrafter plans a deck, drafts its cards in bounded batches, has the
// converter validate them, repairs invalid cards individually, and stores the
// assembled document as an immutable revision.
type cardDrafter struct {
	converter *carddocument.Converter
	store     carddocument.ObjectStore
	generate  generateFunc

	schemaMu sync.Mutex
	schema   json.RawMessage
}

func newCardDrafter(converter *carddocument.Converter, store carddocument.ObjectStore, generate generateFunc) *cardDrafter {
	return &cardDrafter{converter: converter, store: store, generate: generate}
}

// drafting tracks one job's calls so every token is counted, including those
// spent on calls that later fail.
type drafting struct {
	drafter *cardDrafter
	job     streamJob
	schema  json.RawMessage
	parsed  draftingSchema
	sources []citedSource
	tokens  int
}

func (d *drafting) call(ctx context.Context, promptName, system, user string, maxOutput int) (map[string]any, error) {
	document, tokens, err := d.drafter.generate(ctx, d.job, promptName, system, user, min(maxOutput, maxOutputCeilingTokens))
	d.tokens += tokens
	return document, err
}

func (drafter *cardDrafter) loadSchema(ctx context.Context) (json.RawMessage, error) {
	drafter.schemaMu.Lock()
	defer drafter.schemaMu.Unlock()
	if drafter.schema != nil {
		return drafter.schema, nil
	}
	schema, err := drafter.converter.Schema(ctx)
	if err != nil {
		return nil, err
	}
	drafter.schema = schema
	return schema, nil
}

func (drafter *cardDrafter) Draft(ctx context.Context, job streamJob) (draftResult, error) {
	if job.kind != "generation" {
		return draftResult{}, errors.New("card documents cannot be revised by AI yet")
	}
	schema, err := drafter.loadSchema(ctx)
	if err != nil {
		return draftResult{}, err
	}
	d := &drafting{drafter: drafter, job: job, schema: schema, sources: citedSources(job.researchPayload)}
	if err := json.Unmarshal(schema, &d.parsed); err != nil {
		return draftResult{}, fmt.Errorf("read drafting schema: %w", err)
	}
	plan, err := d.plan(ctx)
	if err != nil {
		return draftResult{}, err
	}
	cards, err := d.draft(ctx, plan)
	if err != nil {
		return draftResult{}, err
	}
	document, issue, err := drafter.converter.Assemble(ctx, plan.Title, defaultCardTheme, cards)
	if err != nil {
		return draftResult{}, err
	}
	if issue != nil {
		return draftResult{}, fmt.Errorf("assembled document is invalid: %s", issue)
	}
	var shape struct {
		CardOrder []string `json:"cardOrder"`
	}
	if err := json.Unmarshal(document, &shape); err != nil || len(shape.CardOrder) != job.slideCount {
		return draftResult{}, fmt.Errorf("assembled document has %d cards, %d were requested", len(shape.CardOrder), job.slideCount)
	}
	provider, model := "openrouter", model()
	if job.selection != nil {
		provider, model = string(job.selection.Provider), job.selection.Model
	}
	sourceIDs := make([]string, 0, len(d.sources))
	for _, source := range d.sources {
		sourceIDs = append(sourceIDs, source.ID)
	}
	revision, err := carddocument.Prepare(ctx, drafter.store, carddocument.PrepareInput{
		PresentationID: job.presentationID,
		AuthorID:       job.userID,
		OperationID:    job.operationID,
		OperationKind:  carddocument.OperationGeneration,
		Document:       document,
		Provenance: map[string]any{
			"provider":      provider,
			"model":         model,
			"promptVersion": cardPromptVersion,
			"planVersion":   1,
			"sourceIds":     sourceIDs,
		},
	})
	if err != nil {
		return draftResult{}, err
	}
	summary := map[string]any{"title": truncate(plan.Title, 255), "status": "ready", "totalSlides": job.slideCount, "tokens_used": d.tokens}
	if job.researchPayload != nil && len(job.researchPayload.Sources) > 0 {
		summary["sources"] = job.researchPayload.Sources
	}
	return draftResult{
		document: summary,
		tokens:   d.tokens,
		commit: func(ctx context.Context, tx *sql.Tx) (map[string]any, error) {
			// A generation is the first revision of its document. A retried
			// generation belongs to a failed presentation, which has none.
			committed, err := carddocument.CommitTx(ctx, tx, 0, revision)
			if err != nil {
				return nil, err
			}
			return map[string]any{"revision": committed.Revision.Number, "cardCount": committed.Revision.CardCount}, nil
		},
	}, nil
}

func citedSources(payload *presentation.ResearchPayload) []citedSource {
	if payload == nil {
		return nil
	}
	sources := make([]citedSource, 0, len(payload.Sources))
	for index, source := range payload.Sources {
		sources = append(sources, citedSource{ID: fmt.Sprintf("s%d", index+1), Title: source.Title, URL: source.URL, Snippet: truncate(source.Snippet, 400)})
	}
	return sources
}

func (d *drafting) context() string {
	job := d.job
	var builder strings.Builder
	fmt.Fprintf(&builder, "Topic: %s\nCards: %d\nDetail level: %s\nTone: %s\n", job.prompt, job.slideCount, job.detailLevel, job.tonality)
	builder.WriteString("Schema: ")
	builder.Write(d.schema)
	builder.WriteString("\n")
	if len(d.sources) > 0 {
		encoded, _ := json.Marshal(d.sources)
		builder.WriteString("Research sources: ")
		builder.Write(encoded)
		builder.WriteString("\n")
	} else {
		builder.WriteString("No research sources were supplied; leave sourceIds empty.\n")
	}
	return builder.String()
}

func (d *drafting) plan(ctx context.Context) (cardPlan, error) {
	user := d.context()
	var problem error
	for attempt := 0; attempt <= cardRepairAttempts; attempt++ {
		response, err := d.call(ctx, "card-plan", planSystemPrompt, user, d.job.slideCount*planTokensPerCard+300)
		if err != nil {
			return cardPlan{}, err
		}
		var plan cardPlan
		encoded, _ := json.Marshal(response)
		if err := json.Unmarshal(encoded, &plan); err != nil {
			problem = err
		} else if problem = d.checkPlan(&plan); problem == nil {
			return plan, nil
		}
		user = d.context() + "\nPrevious plan: " + string(encoded) + "\nThe plan was rejected: " + problem.Error() + "\nReturn the complete corrected plan."
	}
	return cardPlan{}, fmt.Errorf("plan: %w", problem)
}

// checkPlan enforces the requested count before any card is drafted, since a
// deck of the wrong length cannot be repaired card by card.
func (d *drafting) checkPlan(plan *cardPlan) error {
	if len(plan.Cards) != d.job.slideCount {
		return fmt.Errorf("it has %d cards, exactly %d are required", len(plan.Cards), d.job.slideCount)
	}
	if strings.TrimSpace(plan.Title) == "" {
		return errors.New("title is empty")
	}
	sort.SliceStable(plan.Cards, func(i, j int) bool { return plan.Cards[i].Position < plan.Cards[j].Position })
	known := map[string]bool{}
	for _, source := range d.sources {
		known[source.ID] = true
	}
	for index, entry := range plan.Cards {
		if entry.Position != index+1 {
			return fmt.Errorf("positions must run 1 to %d without gaps or repeats", d.job.slideCount)
		}
		takeaway := strings.TrimSpace(entry.Takeaway)
		if takeaway == "" || utf8.RuneCountInString(takeaway) > 200 {
			return fmt.Errorf("card %d takeaway must be 1-200 characters", entry.Position)
		}
		if !contains(d.parsed.Roles, entry.Role) {
			return fmt.Errorf("card %d role %q is not one of %s", entry.Position, entry.Role, strings.Join(d.parsed.Roles, ", "))
		}
		if _, ok := d.parsed.Layouts[entry.Layout]; !ok {
			return fmt.Errorf("card %d layout %q is not a known layout", entry.Position, entry.Layout)
		}
		for _, id := range entry.SourceIDs {
			if !known[id] {
				return fmt.Errorf("card %d cites unknown source %q", entry.Position, id)
			}
		}
	}
	return nil
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func (d *drafting) sourceIDs() []string {
	ids := make([]string, 0, len(d.sources))
	for _, source := range d.sources {
		ids = append(ids, source.ID)
	}
	return ids
}

// draft writes every card, returning converted cards in plan order.
func (d *drafting) draft(ctx context.Context, plan cardPlan) ([]json.RawMessage, error) {
	encodedPlan, _ := json.Marshal(plan)
	converted := make([]json.RawMessage, len(plan.Cards))
	var written []string
	for start := 0; start < len(plan.Cards); start += cardBatchSize {
		batch := plan.Cards[start:min(start+cardBatchSize, len(plan.Cards))]
		positions := make([]string, len(batch))
		for index, entry := range batch {
			positions[index] = fmt.Sprint(entry.Position)
		}
		user := d.context() + "Approved plan: " + string(encodedPlan) + "\nWrite the cards at positions " + strings.Join(positions, ", ") + "."
		if len(written) > 0 {
			user += "\nCards already written, which these must not repeat: " + strings.Join(written, " | ")
		}
		response, err := d.call(ctx, "card-draft", draftSystemPrompt, user, len(batch)*draftTokensPerCard+200)
		if err != nil {
			return nil, err
		}
		drafts := draftsByPosition(response)
		inputs := make([]carddocument.DraftInput, len(batch))
		for index, entry := range batch {
			inputs[index] = carddocument.DraftInput{Position: entry.Position, Takeaway: entry.Takeaway, Role: entry.Role, Draft: drafts[entry.Position]}
		}
		results, err := d.drafter.converter.ConvertCards(ctx, d.job.operationID, d.sourceIDs(), inputs)
		if err != nil {
			return nil, err
		}
		for index, result := range results {
			card := result.Card
			if result.Issue != nil {
				card, err = d.repair(ctx, encodedPlan, inputs[index], *result.Issue)
				if err != nil {
					return nil, err
				}
			}
			converted[inputs[index].Position-1] = card
			written = append(written, fmt.Sprintf("%d: %s", inputs[index].Position, inputs[index].Takeaway))
		}
	}
	return converted, nil
}

// draftsByPosition indexes a drafting response. A card the model left out has
// no entry, and the converter reports it for repair like any other issue.
func draftsByPosition(response map[string]any) map[int]json.RawMessage {
	drafts := map[int]json.RawMessage{}
	cards, _ := response["cards"].([]any)
	for _, raw := range cards {
		card, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		position, ok := wholeNumber(card["position"])
		if !ok {
			continue
		}
		delete(card, "position")
		encoded, _ := json.Marshal(card)
		drafts[position] = encoded
	}
	return drafts
}

// wholeNumber reads a position from decoded provider JSON, which preserves
// numbers as json.Number.
func wholeNumber(value any) (int, bool) {
	switch number := value.(type) {
	case json.Number:
		parsed, err := number.Int64()
		return int(parsed), err == nil
	case float64:
		return int(number), number == float64(int(number))
	default:
		return 0, false
	}
}

// repair redrafts one card against the issue the converter reported, leaving
// the rest of the batch untouched.
func (d *drafting) repair(ctx context.Context, plan []byte, input carddocument.DraftInput, issue carddocument.Issue) (json.RawMessage, error) {
	for attempt := 0; attempt < cardRepairAttempts; attempt++ {
		previous := string(input.Draft)
		if previous == "" {
			previous = "(the card was missing from the response)"
		}
		user := d.context() + "Approved plan: " + string(plan) + fmt.Sprintf("\nCard position %d, takeaway: %s\nPrevious card: %s\nValidation problem: %s", input.Position, input.Takeaway, previous, issue)
		response, err := d.call(ctx, "card-repair", repairSystemPrompt, user, draftTokensPerCard+200)
		if err != nil {
			return nil, err
		}
		card, _ := response["card"].(map[string]any)
		delete(card, "position")
		input.Draft, _ = json.Marshal(card)
		results, err := d.drafter.converter.ConvertCards(ctx, d.job.operationID, d.sourceIDs(), []carddocument.DraftInput{input})
		if err != nil {
			return nil, err
		}
		if results[0].Issue == nil {
			return results[0].Card, nil
		}
		issue = *results[0].Issue
	}
	return nil, fmt.Errorf("card %d: %s", input.Position, issue)
}

// cardAuthorizationMillis prices a card generation: the plan, every card at
// its drafting bound, repair headroom, and the prompt context each drafting
// call resends.
func cardAuthorizationMillis(slideCount int, prompt string, research any, payload *presentation.ResearchPayload) int64 {
	output := slideCount * (planTokensPerCard + draftTokensPerCard)
	base := authorizationMillis(output, prompt, nil, research, payload, repairHeadroomTokens(slideCount))
	encodedSources, _ := json.Marshal(payload)
	batches := (slideCount + cardBatchSize - 1) / cardBatchSize
	perCall := (draftingPromptAllowanceBytes + len(prompt) + len(encodedSources) + slideCount*planBytesPerCard + 3) / 4
	return base + int64(batches*perCall*12/10)
}
