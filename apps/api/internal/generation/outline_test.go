package generation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSubmitInputTakesItsCountFromAnApprovedOutline(t *testing.T) {
	input, err := parseSubmitInput(decodeSubmitBody(t, `{"topic": "Grid storage", "plan": {"title": "Grid storage", "cards": [
		{"position": 9, "takeaway": "Opening", "role": "opening", "layout": "title"},
		{"position": 4, "takeaway": "Closing", "role": "closing", "layout": "title"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if input.SlideCount != 2 || input.Plan.Cards[0].Position != 1 || input.Plan.Cards[1].Position != 2 {
		t.Fatalf("input = %+v", input)
	}
	if _, err := parseSubmitInput(decodeSubmitBody(t, `{"topic": "Revise", "parent_presentation_id": "p", "plan": {"title": "T", "cards": [{"takeaway": "x"}]}}`)); err == nil {
		t.Fatal("an iteration accepted an outline")
	}
	if _, err := parseSubmitInput(decodeSubmitBody(t, `{"topic": "Empty", "plan": {"title": "T", "cards": []}}`)); err == nil {
		t.Fatal("an empty outline was accepted")
	}
}

func TestCardDrafterDraftsAnApprovedOutlineAndStreamsProgress(t *testing.T) {
	converter := startConverter(t)
	var prompts []string
	type event struct {
		kind    string
		payload any
	}
	var events []event
	plan := &cardPlan{Title: "Approved", Cards: []cardPlanEntry{
		{Position: 1, Takeaway: "Takeaway the user wrote", Role: "evidence", Layout: "bullets"},
		{Position: 2, Takeaway: "Second point", Role: "closing", Layout: "bullets"},
	}}
	generate := func(_ context.Context, _ streamJob, promptName, _, _ string, _ int) (map[string]any, int, error) {
		prompts = append(prompts, promptName)
		first := strings.Replace(bulletsCard(1), `"sourceIds": ["s1"]`, `"sourceIds": []`, 1)
		second := strings.Replace(bulletsCard(2), `"sourceIds": ["s1"]`, `"sourceIds": []`, 1)
		return decoded(t, `{"cards": [`+first+`, `+second+`]}`), 12, nil
	}
	drafter := newCardDrafter(converter, &memoryObjects{}, generate, nil)
	draft, err := drafter.Draft(context.Background(), streamJob{
		kind: "generation", presentationID: "p", userID: "u", operationID: "o", slideCount: 2, plan: plan,
		report: func(kind string, payload any) { events = append(events, event{kind, payload}) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(prompts, ",") != "card-draft" {
		t.Fatalf("prompts = %v; an approved outline must not be planned again", prompts)
	}
	if draft.document["title"] != "Approved" {
		t.Fatalf("title = %v", draft.document["title"])
	}
	if len(events) != 2 || events[0].kind != "plan" || events[1].kind != "cards" {
		t.Fatalf("events = %+v", events)
	}
	encoded, _ := json.Marshal(events[1].payload)
	var cards struct {
		Cards     map[string]json.RawMessage `json:"cards"`
		Completed int                        `json:"completed"`
		Total     int                        `json:"total"`
	}
	_ = json.Unmarshal(encoded, &cards)
	if len(cards.Cards) != 2 || cards.Completed != 2 || cards.Total != 2 {
		t.Fatalf("cards event = %s", encoded)
	}
}
