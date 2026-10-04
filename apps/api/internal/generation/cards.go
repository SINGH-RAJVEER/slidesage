package generation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

// cardPromptVersion identifies the prompts below in revision provenance, so a
// document can be traced to the instructions that produced it.
const cardPromptVersion = "cards-v2"

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
Return one JSON object: {"title": string, "cards": [{"position": number, "takeaway": string, "role": string, "layout": string, "evidence": string, "sourceIds": [string], "imageQuery": string}]}. imageQuery is required for layouts marked image and omitted otherwise.
Return exactly the requested number of cards with positions 1 to N in order.
takeaway is one sentence stating the card's point, at most 200 characters.
role and layout must be values from the supplied schema. Choose the layout whose description fits the content the card needs, and vary layouts where the content allows.
evidence names the specific facts, figures, or examples the card will use.
Use the chart, table, and dashboard layouts only for figures or comparisons stated in the research sources or the topic, and list those exact figures in evidence; otherwise use text layouts.
Cite only supplied source IDs and never invent sources.
When the deck has at least three cards, open with an opening card and end with a closing card.
No styling, colors, CSS, HTML, or coordinates.`

const draftSystemPrompt = `You write presentation cards from an approved plan.
For a layout marked image, draft only its text nodes; the photo is added for you.
Return one JSON object: {"cards": [card, ...]} with exactly one card for each requested position.
Each card follows the supplied card and node shapes exactly, uses the layout from its plan entry, and satisfies that layout's node counts, its item counts, and the character limits in the schema.
Text may use **bold** and *italic*; no other markup, HTML, links, or emoji.
Write substantive, specific content that supports the card's takeaway, and do not repeat content from other cards.
Charts, meters, and tables show only figures from the plan's evidence or the sources, copied exactly; follow the widget guide in the schema to choose each chart's kind and each widget's size.
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
	// ImageQuery describes the photo an image layout should show.
	ImageQuery string `json:"imageQuery,omitempty"`
}

type cardPlan struct {
	Title string          `json:"title"`
	Cards []cardPlanEntry `json:"cards"`
}

// draftingSchema is the part of the converter's schema the planner checks.
type draftingSchema struct {
	Roles   []string `json:"roles"`
	Themes  []string `json:"themes"`
	Layouts map[string]struct {
		Image bool `json:"image"`
	} `json:"layouts"`
}

// maxImagesPerDeck keeps a deck within the stock provider's hourly quota,
// which is shared by every generation using the same key.
const maxImagesPerDeck = 6

// textFallbackLayouts replace an image layout whose image could not be found.
// Each holds the text the image layout's content rules allow.
var textFallbackLayouts = map[string]string{
	"image-left":  "statement",
	"image-right": "statement",
	"cover":       "title",
}

// placedImage is an image resolved for one card. A revised card keeps the
// framing its image already had; a new one fills its frame from the center.
type placedImage struct {
	asset carddocument.Asset
	alt   string
	fit   string
	focus json.RawMessage
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
	// images is nil when no image source is configured; plans then use text
	// layouts only.
	images imageSource
	// recordAssets records a photo as soon as it is stored, so the streamed
	// preview can show it before the revision commits. Nil skips it.
	recordAssets func(ctx context.Context, assets []carddocument.Asset) error
	// loadCurrent reads the revision an AI revision starts from and the images
	// the presentation owns. Nil makes AI revisions unavailable.
	loadCurrent func(ctx context.Context, presentationID, userID string) (currentDocument, error)

	schemaMu sync.Mutex
	schema   json.RawMessage
}

func newCardDrafter(converter *carddocument.Converter, store carddocument.ObjectStore, generate generateFunc, images imageSource) *cardDrafter {
	return &cardDrafter{converter: converter, store: store, generate: generate, images: images}
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
	// images holds the resolved image of each card position that shows one.
	images map[int]placedImage
	// knownAssets, when set, are every image the document may show; an AI
	// revision starts from a document whose photos were stored earlier.
	knownAssets []string
	// revision is set while an AI revision drafts.
	revision *revisionContext
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

// start prepares one job's drafting: the schema its prompts and checks use,
// and the research sources it may cite.
func (drafter *cardDrafter) start(ctx context.Context, job streamJob) (*drafting, error) {
	schema, err := drafter.loadSchema(ctx)
	if err != nil {
		return nil, err
	}
	d := &drafting{drafter: drafter, job: job, schema: schema, sources: citedSources(job.researchPayload)}
	if err := json.Unmarshal(schema, &d.parsed); err != nil {
		return nil, fmt.Errorf("read drafting schema: %w", err)
	}
	return d, nil
}

// knowsTheme reports whether the converter can style a deck with theme.
func (drafter *cardDrafter) knowsTheme(ctx context.Context, theme string) (bool, error) {
	schema, err := drafter.loadSchema(ctx)
	if err != nil {
		return false, err
	}
	var parsed draftingSchema
	if err := json.Unmarshal(schema, &parsed); err != nil {
		return false, fmt.Errorf("read drafting schema: %w", err)
	}
	return slices.Contains(parsed.Themes, theme), nil
}

// report sends a progress event when the job has somewhere to send it.
func (d *drafting) report(eventType string, payload any) {
	if d.job.report != nil {
		d.job.report(eventType, payload)
	}
}

func (drafter *cardDrafter) Draft(ctx context.Context, job streamJob) (draftResult, error) {
	switch job.kind {
	case "iteration":
		return drafter.revise(ctx, job)
	case "generation":
	default:
		return draftResult{}, fmt.Errorf("unknown drafting kind %q", job.kind)
	}
	d, err := drafter.start(ctx, job)
	if err != nil {
		return draftResult{}, err
	}
	var plan cardPlan
	if job.plan != nil {
		// An approved outline was checked when it was submitted; it is checked
		// again because the schema may have changed while the job was queued.
		plan = *job.plan
		if err := d.checkPlan(&plan); err != nil {
			return draftResult{}, fmt.Errorf("approved outline: %w", err)
		}
	} else if plan, err = d.plan(ctx); err != nil {
		return draftResult{}, err
	}
	d.resolveImages(ctx, &plan)
	d.report("plan", planPreview(plan))
	cards, err := d.draft(ctx, plan)
	if err != nil {
		return draftResult{}, err
	}
	theme := job.theme
	if theme == "" {
		theme = defaultCardTheme
	}
	document, issue, err := drafter.converter.Assemble(ctx, plan.Title, theme, cards, d.assetIDs())
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
	revision, err := carddocument.Prepare(carddocument.PrepareInput{
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
			if err := carddocument.RecordAssetsTx(ctx, tx, d.assets()); err != nil {
				return nil, err
			}
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
	if d.revision != nil {
		return d.revisionPrompt()
	}
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
	if d.drafter.images != nil {
		fmt.Fprintf(&builder, "Layouts marked image show a stock photo. Use them for at most %d cards where a photo helps the point, and give each an imageQuery: a concrete visual search of two to six words, describing a scene or object, with no text, logos, or named people.\n", d.maxImages())
	} else {
		builder.WriteString("Photos are unavailable: never use layouts marked image.\n")
	}
	return builder.String()
}

func (d *drafting) maxImages() int {
	return min(maxImagesPerDeck, max(2, (d.job.slideCount+1)/2))
}

func (d *drafting) assets() []carddocument.Asset {
	assets := make([]carddocument.Asset, 0, len(d.images))
	for _, image := range d.images {
		assets = append(assets, image.asset)
	}
	return assets
}

func (d *drafting) assetIDs() []string {
	if d.knownAssets != nil {
		return d.knownAssets
	}
	ids := make([]string, 0, len(d.images))
	for _, image := range d.images {
		ids = append(ids, image.asset.SHA256)
	}
	return ids
}

// resolveImages finds and stores a photo for every card whose layout shows
// one, up to the deck's limit. A card whose photo cannot be found switches to a text layout before it
// is drafted, so the deck never shows a placeholder.
func (d *drafting) resolveImages(ctx context.Context, plan *cardPlan) {
	d.images = map[int]placedImage{}
	var mu sync.Mutex
	positions := []int{}
	for index, entry := range plan.Cards {
		// A plan that asks for more photos than a deck may use keeps the first
		// ones; the rest switch to text layouts below, like a failed search.
		if d.parsed.Layouts[entry.Layout].Image && len(positions) < d.maxImages() {
			positions = append(positions, index)
		}
	}
	_ = runBounded(ctx, 3, positions, func(ctx context.Context, index int) error {
		entry := plan.Cards[index]
		found, err := d.drafter.images.Find(ctx, imageRequest{Query: entry.ImageQuery})
		var asset carddocument.Asset
		if err == nil {
			asset, err = found.asset(ctx, d.drafter.store, d.job.presentationID)
		}
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			slog.WarnContext(ctx, "card image unavailable, using a text layout", "position", entry.Position, "error", err)
			return nil
		}
		d.images[entry.Position] = placedImage{asset: asset, alt: found.Alt}
		if d.drafter.recordAssets != nil {
			if err := d.drafter.recordAssets(ctx, []carddocument.Asset{asset}); err != nil {
				slog.WarnContext(ctx, "card image not recorded for preview", "position", entry.Position, "error", err)
			}
		}
		return nil
	})
	for index, entry := range plan.Cards {
		if d.parsed.Layouts[entry.Layout].Image {
			if _, ok := d.images[entry.Position]; !ok {
				plan.Cards[index].Layout = textFallbackLayouts[entry.Layout]
				plan.Cards[index].ImageQuery = ""
			}
		}
	}
}

// withImage places the card's resolved image first in its drafted nodes. The
// model never writes image nodes, so any it wrote are dropped.
func (d *drafting) withImage(position int, draft json.RawMessage) json.RawMessage {
	image, ok := d.images[position]
	if !ok || len(draft) == 0 {
		return draft
	}
	var card map[string]any
	if json.Unmarshal(draft, &card) != nil || card == nil {
		return draft
	}
	// A revision may move a photo card to a text layout, which drops the photo.
	if layout, _ := card["layout"].(string); d.revision != nil && !d.parsed.Layouts[layout].Image {
		return draft
	}
	nodes, _ := card["nodes"].([]any)
	placed := map[string]any{"type": "image", "assetId": image.asset.SHA256, "alt": image.alt, "fit": "cover"}
	if image.fit != "" {
		placed["fit"] = image.fit
	}
	if len(image.focus) > 0 {
		placed["focus"] = image.focus
	}
	kept := []any{placed}
	for _, node := range nodes {
		if object, ok := node.(map[string]any); ok && object["type"] == "image" {
			continue
		}
		kept = append(kept, node)
	}
	card["nodes"] = kept
	encoded, _ := json.Marshal(card)
	return encoded
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
		layout, ok := d.parsed.Layouts[entry.Layout]
		if !ok {
			return fmt.Errorf("card %d layout %q is not a known layout", entry.Position, entry.Layout)
		}
		if layout.Image {
			if d.drafter.images == nil {
				return fmt.Errorf("card %d uses image layout %q, but photos are unavailable", entry.Position, entry.Layout)
			}
			query := strings.TrimSpace(entry.ImageQuery)
			if query == "" || utf8.RuneCountInString(query) > 100 {
				return fmt.Errorf("card %d needs an imageQuery of 1-100 characters for layout %q", entry.Position, entry.Layout)
			}
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
			inputs[index] = carddocument.DraftInput{Position: entry.Position, Takeaway: entry.Takeaway, Role: entry.Role, Draft: d.withImage(entry.Position, drafts[entry.Position])}
		}
		results, err := d.drafter.converter.ConvertCards(ctx, d.job.operationID, d.sourceIDs(), d.assetIDs(), inputs)
		if err != nil {
			return nil, err
		}
		for index, result := range results {
			card := result.Card
			if result.Issue != nil {
				card, err = d.repair(ctx, "Approved plan: "+string(encodedPlan), inputs[index], *result.Issue)
				if err != nil {
					return nil, err
				}
			}
			converted[inputs[index].Position-1] = card
			written = append(written, fmt.Sprintf("%d: %s", inputs[index].Position, inputs[index].Takeaway))
		}
		d.reportCards(converted, batch, len(written), len(plan.Cards))
	}
	return converted, nil
}

type previewEntry struct {
	Position int    `json:"position"`
	Takeaway string `json:"takeaway"`
	Layout   string `json:"layout"`
}

// planPreview is what the viewer shows of a plan while its cards are drafted.
func planPreview(plan cardPlan) map[string]any {
	entries := make([]previewEntry, len(plan.Cards))
	for index, entry := range plan.Cards {
		entries[index] = previewEntry{Position: entry.Position, Takeaway: entry.Takeaway, Layout: entry.Layout}
	}
	return map[string]any{"title": plan.Title, "cards": entries}
}

// reportCards streams a finished batch. The cards are converter-validated,
// but they are a preview: the committed revision is the document.
func (d *drafting) reportCards(converted []json.RawMessage, batch []cardPlanEntry, completed, total int) {
	cards := map[string]json.RawMessage{}
	assets := map[string]carddocument.Asset{}
	for _, entry := range batch {
		if card := converted[entry.Position-1]; card != nil {
			cards[fmt.Sprint(entry.Position)] = card
		}
		if image, ok := d.images[entry.Position]; ok {
			assets[image.asset.SHA256] = image.asset
		}
	}
	d.report("cards", map[string]any{"cards": cards, "assets": assets, "completed": completed, "total": total})
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
func (d *drafting) repair(ctx context.Context, background string, input carddocument.DraftInput, issue carddocument.Issue) (json.RawMessage, error) {
	for attempt := 0; attempt < cardRepairAttempts; attempt++ {
		previous := string(input.Draft)
		if previous == "" {
			previous = "(the card was missing from the response)"
		}
		user := d.context() + background + fmt.Sprintf("\nCard position %d, takeaway: %s\nPrevious card: %s\nValidation problem: %s", input.Position, input.Takeaway, previous, issue)
		response, err := d.call(ctx, "card-repair", repairSystemPrompt, user, draftTokensPerCard+200)
		if err != nil {
			return nil, err
		}
		card, _ := response["card"].(map[string]any)
		delete(card, "position")
		input.Draft, _ = json.Marshal(card)
		input.Draft = d.withImage(input.Position, input.Draft)
		results, err := d.drafter.converter.ConvertCards(ctx, d.job.operationID, d.sourceIDs(), d.assetIDs(), []carddocument.DraftInput{input})
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
	base := authorizationMillis(output, prompt, research, payload, repairHeadroomTokens(slideCount))
	encodedSources, _ := json.Marshal(payload)
	batches := (slideCount + cardBatchSize - 1) / cardBatchSize
	perCall := (draftingPromptAllowanceBytes + len(prompt) + len(encodedSources) + slideCount*planBytesPerCard + 3) / 4
	return base + int64(batches*perCall*12/10)
}
