package presentation

import (
	"encoding/json"
	"testing"
)

func TestPresentationSummaryMarksDecksWithoutCardDocumentUnavailable(t *testing.T) {
	cases := []struct {
		name        string
		slidesData  string
		hasDocument bool
		want        string
	}{
		{"card deck", `{"status":"ready","totalSlides":6}`, true, "ready"},
		{"pptx deck", `{"title":"Old deck","totalSlides":8}`, false, "unavailable"},
		{"generating", `{"status":"generating"}`, false, "generating"},
		{"failed", `{"status":"failed"}`, false, "failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			summary := presentationSummary(Presentation{
				ID:              "pres_1",
				SlidesData:      json.RawMessage(tc.slidesData),
				HasCardDocument: tc.hasDocument,
			})
			if summary.Status != tc.want {
				t.Fatalf("status = %q, want %q", summary.Status, tc.want)
			}
		})
	}
}
