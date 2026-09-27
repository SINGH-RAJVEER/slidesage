package generation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
)

type revisableDeck struct {
	revision carddocument.Revision
	asset    carddocument.Asset
	document struct {
		CardOrder []string                   `json:"cardOrder"`
		Cards     map[string]json.RawMessage `json:"cards"`
	}
}

// baseDeck stores a three-card document the way a generation would: a title
// card, a photo card, and a cited bullets card.
func baseDeck(t *testing.T, converter *carddocument.Converter, store *memoryObjects) revisableDeck {
	t.Helper()
	ctx := context.Background()
	var deck revisableDeck
	asset, err := carddocument.PrepareAsset(ctx, store, "presentation-1", photoPNG(t, 1600, 900), carddocument.AssetSource{Type: "stock", Provider: "pexels"})
	if err != nil {
		t.Fatal(err)
	}
	deck.asset = asset
	inputs := []carddocument.DraftInput{
		{Position: 1, Takeaway: "Storage matters", Role: "opening", Draft: json.RawMessage(`{"layout": "title", "nodes": [{"type": "heading", "text": "Grid storage"}]}`)},
		{Position: 2, Takeaway: "Batteries scale", Role: "evidence", Draft: json.RawMessage(`{"layout": "image-left", "nodes": [
			{"type": "image", "assetId": "` + asset.SHA256 + `", "alt": "Battery warehouse", "fit": "cover"},
			{"type": "heading", "text": "Batteries scale"}, {"type": "paragraph", "text": "Warehouses of cells back up grids."}]}`)},
		{Position: 3, Takeaway: "Costs fell", Role: "evidence", Draft: json.RawMessage(bulletsCard(3))},
		{Position: 4, Takeaway: "What comes next", Role: "closing", Draft: json.RawMessage(`{"layout": "title", "nodes": [{"type": "heading", "text": "What comes next"}]}`)},
	}
	results, err := converter.ConvertCards(ctx, "generation-op", []string{"s1"}, []string{asset.SHA256}, inputs)
	if err != nil {
		t.Fatal(err)
	}
	cards := make([]json.RawMessage, len(results))
	for index, result := range results {
		if result.Issue != nil {
			t.Fatalf("base card %d: %s", index+1, result.Issue)
		}
		cards[index] = result.Card
	}
	document, issue, err := converter.Assemble(ctx, "Grid storage", "slate", cards, []string{asset.SHA256})
	if err != nil || issue != nil {
		t.Fatalf("assemble base: %v %v", issue, err)
	}
	if err := json.Unmarshal(document, &deck.document); err != nil {
		t.Fatal(err)
	}
	deck.revision, err = carddocument.Prepare(ctx, store, carddocument.PrepareInput{PresentationID: "presentation-1", AuthorID: "user-1", OperationID: "generation-op", OperationKind: carddocument.OperationGeneration, Document: document})
	if err != nil {
		t.Fatal(err)
	}
	deck.revision.Number = 1
	return deck
}

func TestCardDrafterRevisesOnlyTheRequestedCardsInPlace(t *testing.T) {
	converter := startConverter(t)
	store := &memoryObjects{}
	deck := baseDeck(t, converter, store)
	first, second, third, fourth := deck.document.CardOrder[0], deck.document.CardOrder[1], deck.document.CardOrder[2], deck.document.CardOrder[3]

	var revisePrompt, repairPrompt string
	generate := func(_ context.Context, _ streamJob, promptName, _, user string, _ int) (map[string]any, int, error) {
		switch promptName {
		case "card-revise":
			revisePrompt = user
			// Card 3 comes back with one bullet, which its layout refuses.
			return decoded(t, `{"cards": [
				{"position": 2, "takeaway": "Batteries now anchor city grids", "layout": "image-left", "nodes": [
					{"type": "heading", "text": "Batteries anchor grids"}, {"type": "paragraph", "text": "Cells now back up whole cities."}]},
				{"position": 3, "takeaway": "Costs fell fast", "layout": "bullets", "sourceIds": ["s1"], "nodes": [
					{"type": "heading", "text": "Costs fell"}, {"type": "bullets", "items": ["Only one"]}]}]}`), 30, nil
		case "card-repair":
			repairPrompt = user
			return decoded(t, `{"card": `+bulletsCard(3)+`}`), 5, nil
		}
		t.Fatalf("unexpected prompt %s", promptName)
		return nil, 0, nil
	}
	drafter := newCardDrafter(converter, store, generate, nil)
	current := deck.revision
	drafter.loadCurrent = func(context.Context, string, string) (currentDocument, error) {
		return currentDocument{revision: current, assets: map[string]carddocument.Asset{deck.asset.SHA256: deck.asset}}, nil
	}
	job := streamJob{
		kind: "iteration", presentationID: "presentation-1", userID: "user-1", operationID: "revision-op",
		prompt: "Make these punchier", baseRevision: 1, cardIDs: []string{third, second}, slideCount: 4,
		current: json.RawMessage(`{"title": "Grid storage", "status": "ready", "sources": [{"url": "https://example.com", "title": "Report"}]}`),
	}
	draft, err := drafter.Draft(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(revisePrompt, "Card 2: ") || !strings.Contains(revisePrompt, "Card 3: ") || strings.Contains(revisePrompt, "Card 1: ") || strings.Contains(revisePrompt, "Card 4: ") {
		t.Fatalf("revise prompt did not carry exactly the requested cards: %s", revisePrompt)
	}
	if !strings.Contains(revisePrompt, "Make these punchier") || !strings.Contains(revisePrompt, `"id":"s1"`) {
		t.Fatalf("revise prompt lacks the instruction or sources: %s", revisePrompt)
	}
	if !strings.Contains(repairPrompt, "Revision instruction: Make these punchier") {
		t.Fatalf("repair prompt = %s", repairPrompt)
	}
	sources, _ := draft.document["sources"].([]any)
	if len(sources) != 1 || draft.document["totalSlides"] != 4 || draft.tokens != 35 || draft.commit == nil {
		t.Fatalf("draft = %+v", draft)
	}

	var revised struct {
		CardOrder []string                   `json:"cardOrder"`
		Cards     map[string]json.RawMessage `json:"cards"`
	}
	for key, contents := range store.objects {
		if strings.Contains(key, "/cards/") && !strings.Contains(string(contents), `"Batteries scale"`) {
			if err := json.Unmarshal(contents, &revised); err != nil {
				t.Fatal(err)
			}
		}
	}
	if strings.Join(revised.CardOrder, ",") != strings.Join(deck.document.CardOrder, ",") {
		t.Fatalf("card order changed: %v", revised.CardOrder)
	}
	// Cards before and after the targets keep their exact bytes.
	for _, id := range []string{first, fourth} {
		if string(revised.Cards[id]) != string(deck.document.Cards[id]) {
			t.Fatalf("untouched card %s changed:\n%s\n%s", id, deck.document.Cards[id], revised.Cards[id])
		}
	}
	var photoCard struct {
		ID       string `json:"id"`
		Takeaway string `json:"takeaway"`
		Nodes    []struct {
			Type    string `json:"type"`
			AssetID string `json:"assetId"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(revised.Cards[second], &photoCard); err != nil {
		t.Fatal(err)
	}
	if photoCard.ID != second || photoCard.Takeaway != "Batteries now anchor city grids" || photoCard.Nodes[0].Type != "image" || photoCard.Nodes[0].AssetID != deck.asset.SHA256 {
		t.Fatalf("revised photo card = %+v", photoCard)
	}
	if !strings.Contains(string(revised.Cards[third]), `"id":"`+third+`"`) || string(revised.Cards[third]) == string(deck.document.Cards[third]) {
		t.Fatalf("revised bullets card = %s", revised.Cards[third])
	}

	current.Number = 2
	if _, err := drafter.Draft(context.Background(), job); !errors.Is(err, errRevisionMoved) {
		t.Fatalf("stale base error = %v", err)
	}
	job.cardIDs = []string{"c_missing"}
	current.Number = 1
	if _, err := drafter.Draft(context.Background(), job); err == nil || !strings.Contains(err.Error(), "c_missing") {
		t.Fatalf("unknown card error = %v", err)
	}
}
