package generation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

const reviseSystemPrompt = `You revise presentation cards according to the user's instruction.
Return one JSON object: {"cards": [card, ...]} with exactly one card for each requested position.
Each card follows the supplied card and node shapes, with "position" as given and "takeaway": the one sentence the card states after the revision, at most 200 characters.
Change what the instruction asks for and keep everything else as it is.
Keep each card's layout unless the instruction calls for another. A layout marked image may only be used by a card that already shows a photo; the photo is kept for you, so draft only text nodes.
Each card satisfies its layout's node counts, item counts, and the character limits in the schema.
Text may use **bold** and *italic*; no other markup, HTML, links, or emoji.
Cite only supplied source IDs. No styling, colors, or coordinates.`

// errRevisionMoved stops an AI revision whose base is no longer the current
// revision, before any tokens are spent on it.
var errRevisionMoved = errors.New("the presentation changed while the revision was queued; reload it and try again")

// currentDocument is what an AI revision starts from: the revision it was
// asked against and the images the presentation owns.
type currentDocument struct {
	revision carddocument.Revision
	assets   map[string]carddocument.Asset
}

// revisionTarget is one card an AI revision rewrites.
type revisionTarget struct {
	id       string
	position int
	takeaway string
	role     string
	draft    json.RawMessage
}

// revise rewrites the requested cards of the current document and splices
// them back in place. Every other card keeps its bytes, and each rewritten
// card keeps its ID, so the revision is an edit rather than a new deck.
func (drafter *cardDrafter) revise(ctx context.Context, job streamJob) (draftResult, error) {
	if drafter.loadCurrent == nil {
		return draftResult{}, errDraftingUnavailable
	}
	d, err := drafter.start(ctx, job)
	if err != nil {
		return draftResult{}, err
	}
	current, err := drafter.loadCurrent(ctx, job.presentationID, job.userID)
	if err != nil {
		return draftResult{}, err
	}
	if current.revision.Number != job.baseRevision {
		return draftResult{}, errRevisionMoved
	}
	source, err := carddocument.Load(current.revision)
	if err != nil {
		return draftResult{}, err
	}
	d.knownAssets = make([]string, 0, len(current.assets))
	for id := range current.assets {
		d.knownAssets = append(d.knownAssets, id)
	}
	d.sources = summarySources(job.current)

	var document struct {
		Title     string                     `json:"title"`
		CardOrder []string                   `json:"cardOrder"`
		Cards     map[string]json.RawMessage `json:"cards"`
	}
	if err := json.Unmarshal(source, &document); err != nil {
		return draftResult{}, fmt.Errorf("read current document: %w", err)
	}
	drafts, err := drafter.converter.Drafts(ctx, source, d.knownAssets)
	if err != nil {
		return draftResult{}, err
	}
	targets, err := d.revisionTargets(document.CardOrder, document.Cards, drafts, current.assets)
	if err != nil {
		return draftResult{}, err
	}
	var outline strings.Builder
	for index, id := range document.CardOrder {
		var card struct {
			Takeaway string `json:"takeaway"`
		}
		_ = json.Unmarshal(document.Cards[id], &card)
		fmt.Fprintf(&outline, "%d: %s\n", index+1, card.Takeaway)
	}
	d.revision = &revisionContext{title: document.Title, outline: outline.String()}

	revised, err := d.reviseCards(ctx, targets)
	if err != nil {
		return draftResult{}, err
	}
	var whole map[string]json.RawMessage
	if err := json.Unmarshal(source, &whole); err != nil {
		return draftResult{}, err
	}
	for id, card := range revised {
		document.Cards[id] = card
	}
	whole["cards"], _ = json.Marshal(document.Cards)
	spliced, _ := json.Marshal(whole)
	validated, issue, err := drafter.converter.ValidateDocument(ctx, spliced, d.knownAssets)
	if err != nil {
		return draftResult{}, err
	}
	if issue != nil {
		return draftResult{}, fmt.Errorf("revised document is invalid: %s", issue)
	}

	provider, model := "openrouter", model()
	if job.selection != nil {
		provider, model = string(job.selection.Provider), job.selection.Model
	}
	cardIDs := make([]string, len(targets))
	for index, target := range targets {
		cardIDs[index] = target.id
	}
	revision, err := carddocument.Prepare(carddocument.PrepareInput{
		PresentationID: job.presentationID,
		AuthorID:       job.userID,
		OperationID:    job.operationID,
		OperationKind:  carddocument.OperationAIRevision,
		Document:       validated,
		Provenance: map[string]any{
			"provider":      provider,
			"model":         model,
			"promptVersion": cardPromptVersion,
			"instruction":   truncate(job.prompt, 2000),
			"cardIds":       cardIDs,
		},
	})
	if err != nil {
		return draftResult{}, err
	}
	// The summary keeps everything the presentation already records, such as
	// its research sources, which citations and shared views read.
	summary := map[string]any{}
	_ = json.Unmarshal(job.current, &summary)
	summary["title"] = truncate(document.Title, 255)
	summary["status"] = "ready"
	summary["totalSlides"] = len(document.CardOrder)
	summary["tokens_used"] = d.tokens
	return draftResult{
		document: summary,
		tokens:   d.tokens,
		commit: func(ctx context.Context, tx *sql.Tx) (map[string]any, error) {
			committed, err := carddocument.CommitTx(ctx, tx, job.baseRevision, revision)
			if err != nil {
				return nil, err
			}
			return map[string]any{"revision": committed.Revision.Number, "cardCount": committed.Revision.CardCount}, nil
		},
	}, nil
}

// revisionTargets resolves the requested card IDs, in deck order, to their
// positions and current drafts. A card showing a photo keeps it: the photo is
// placed back into whatever the model drafts for it.
func (d *drafting) revisionTargets(order []string, cards map[string]json.RawMessage, drafts map[string]json.RawMessage, assets map[string]carddocument.Asset) ([]revisionTarget, error) {
	wanted, missing := map[string]bool{}, map[string]bool{}
	for _, id := range d.job.cardIDs {
		wanted[id], missing[id] = true, true
	}
	d.images = map[int]placedImage{}
	targets := []revisionTarget{}
	for index, id := range order {
		if len(wanted) > 0 && !wanted[id] {
			continue
		}
		delete(missing, id)
		var card struct {
			Takeaway string `json:"takeaway"`
			Role     string `json:"role"`
			Nodes    []struct {
				Type    string `json:"type"`
				AssetID string `json:"assetId"`
				Alt     string `json:"alt"`
			} `json:"nodes"`
		}
		if err := json.Unmarshal(cards[id], &card); err != nil {
			return nil, fmt.Errorf("read card %s: %w", id, err)
		}
		for _, node := range card.Nodes {
			if asset, ok := assets[node.AssetID]; ok && node.Type == "image" {
				d.images[index+1] = placedImage{asset: asset, alt: node.Alt}
			}
		}
		targets = append(targets, revisionTarget{id: id, position: index + 1, takeaway: card.Takeaway, role: card.Role, draft: drafts[id]})
	}
	for id := range missing {
		return nil, fmt.Errorf("card %s is not in the presentation", id)
	}
	if len(targets) == 0 {
		return nil, errors.New("no cards to revise")
	}
	return targets, nil
}

// reviseCards drafts the targets in bounded batches, repairs any the converter
// refuses, and returns each revised card under its original ID.
func (d *drafting) reviseCards(ctx context.Context, targets []revisionTarget) (map[string]json.RawMessage, error) {
	revised := map[string]json.RawMessage{}
	for start := 0; start < len(targets); start += cardBatchSize {
		batch := targets[start:min(start+cardBatchSize, len(targets))]
		var current strings.Builder
		positions := make([]string, len(batch))
		for index, target := range batch {
			positions[index] = fmt.Sprint(target.position)
			fmt.Fprintf(&current, "Card %d: %s\n", target.position, target.draft)
		}
		user := d.context() + "Revise the cards at positions " + strings.Join(positions, ", ") + ". Their current content:\n" + current.String()
		response, err := d.call(ctx, "card-revise", reviseSystemPrompt, user, len(batch)*draftTokensPerCard+200)
		if err != nil {
			return nil, err
		}
		drafts := draftsByPosition(response)
		inputs := make([]carddocument.DraftInput, len(batch))
		for index, target := range batch {
			draft := drafts[target.position]
			takeaway := target.takeaway
			var fields map[string]any
			if json.Unmarshal(draft, &fields) == nil && fields != nil {
				if value, ok := fields["takeaway"].(string); ok {
					value = strings.TrimSpace(value)
					if value != "" && utf8.RuneCountInString(value) <= 200 {
						takeaway = value
					}
				}
				delete(fields, "takeaway")
				draft, _ = json.Marshal(fields)
			}
			inputs[index] = carddocument.DraftInput{Position: target.position, Takeaway: takeaway, Role: target.role, Draft: d.withImage(target.position, draft)}
		}
		results, err := d.drafter.converter.ConvertCards(ctx, d.job.operationID, d.sourceIDs(), d.assetIDs(), inputs)
		if err != nil {
			return nil, err
		}
		for index, result := range results {
			card := result.Card
			if result.Issue != nil {
				card, err = d.repair(ctx, "Revision instruction: "+d.job.prompt, inputs[index], *result.Issue)
				if err != nil {
					return nil, err
				}
			}
			card, err = withCardID(card, batch[index].id)
			if err != nil {
				return nil, err
			}
			revised[batch[index].id] = card
		}
		d.report("stage", map[string]any{"stage": "drafting", "message": "Revising cards", "completed": min(start+len(batch), len(targets)), "total": len(targets)})
	}
	return revised, nil
}

// withCardID gives a converted card the ID of the card it replaces. The
// converter derives IDs from the operation, which would make a revised card a
// different card to everything that refers to it.
func withCardID(card json.RawMessage, id string) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(card, &fields); err != nil {
		return nil, fmt.Errorf("read revised card: %w", err)
	}
	fields["id"], _ = json.Marshal(id)
	return json.Marshal(fields)
}

// summarySources reads the research sources a presentation records, numbered
// as the drafter cited them.
func summarySources(summary json.RawMessage) []citedSource {
	var stored struct {
		Sources []presentation.Source `json:"sources"`
	}
	if json.Unmarshal(summary, &stored) != nil || len(stored.Sources) == 0 {
		return nil
	}
	return citedSources(&presentation.ResearchPayload{Sources: stored.Sources})
}

// revisionContext is what every revision call is told about the deck.
type revisionContext struct {
	title   string
	outline string
}

func (d *drafting) revisionPrompt() string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "Presentation: %s\nInstruction: %s\n", d.revision.title, d.job.prompt)
	builder.WriteString("Schema: ")
	builder.Write(d.schema)
	builder.WriteString("\nEvery card, by position and point:\n")
	builder.WriteString(d.revision.outline)
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
