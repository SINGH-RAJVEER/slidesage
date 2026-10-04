package generation

import (
	"encoding/json"
	"testing"
)

func TestCardStreamYieldsEachCardAcrossSplitChunks(t *testing.T) {
	answer := "<think>a {draft} of the plan</think>\n```json\n" +
		`{"title": "cards", "cards": [{"position": 1, "text": "braces } and \" quotes ] {"}, {"position": 2, "nested": {"cards": [{"x": 1}]}}], "after": [{"y": 2}]}` +
		"\n```"
	var cards []json.RawMessage
	stream := newCardStream(func(card json.RawMessage) { cards = append(cards, card) })
	for start := 0; start < len(answer); start += 3 {
		stream.write(answer[start:min(start+3, len(answer))])
	}
	if len(cards) != 2 {
		t.Fatalf("cards = %q", cards)
	}
	for index, card := range cards {
		var parsed struct {
			Position int `json:"position"`
		}
		if err := json.Unmarshal(card, &parsed); err != nil || parsed.Position != index+1 {
			t.Fatalf("card %d = %s (%v)", index, card, err)
		}
	}
}
