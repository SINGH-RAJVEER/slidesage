package presentation

import (
	"testing"
)

func TestParseResearchPayloadRejectsUnsafeURL(t *testing.T) {
	_, err := ParseResearchPayload(map[string]any{"sources": []any{map[string]any{"url": "javascript:alert(1)"}}})
	if err == nil {
		t.Fatal("unsafe URL accepted")
	}
}
