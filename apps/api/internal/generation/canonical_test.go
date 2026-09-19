package generation

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/pptxcompiler"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

func revisionSource(t *testing.T) []byte {
	t.Helper()
	const p = "http://schemas.openxmlformats.org/presentationml/2006/main"
	const a = "http://schemas.openxmlformats.org/drawingml/2006/main"
	const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	entries := map[string]string{
		"[Content_Types].xml":             `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
		"ppt/presentation.xml":            `<p:presentation xmlns:p="` + p + `" xmlns:r="` + r + `"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="` + r + `/slide" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml":           `<p:sld xmlns:p="` + p + `" xmlns:a="` + a + `"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Original title</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Keep this body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
	}
	var source bytes.Buffer
	archive := zip.NewWriter(&source)
	for name, data := range entries {
		file, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(file, data); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return source.Bytes()
}

// Exercise the provider response through the actual PPTX text revision writer.
func TestRevisePPTXChangesOnlyTheRequestedText(t *testing.T) {
	source := revisionSource(t)
	calls := 0
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		for _, expected := range []string{"Original title", "detailed", "casual", "Rewrite the title"} {
			if !bytes.Contains(body, []byte(expected)) {
				t.Errorf("provider request is missing %q", expected)
			}
		}
		content := `{"title":"Updated deck","operations":[{"position":1,"shapeId":2,"expectedText":"Original title","text":"Revised title"}]}`
		response, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"total_tokens": 42}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(response))}, nil
	})}
	h := &handler{client: client}
	job := streamJob{kind: "iteration", prompt: "Rewrite the title", slideCount: 1, detailLevel: "detailed", tonality: "casual", selection: &ai.Selection{Provider: ai.OpenAI, Model: "test-model"}, credential: "test-key"}
	output, title, tokens, err := h.revisePPTX(context.Background(), job, source)
	if err != nil {
		t.Fatal(err)
	}
	if title != "Updated deck" || tokens != 42 || calls != 1 {
		t.Fatalf("unexpected revision result: title=%q tokens=%d calls=%d", title, tokens, calls)
	}
	index, err := pptxcompiler.Index(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(index.Slides) != 1 {
		t.Fatal("slide count changed")
	}
	objects := index.Slides[0].Objects
	if len(objects) != 2 || strings.TrimSpace(objects[0].Text) != "Revised title" || strings.TrimSpace(objects[1].Text) != "Keep this body" {
		t.Fatalf("unexpected revised objects: %+v", objects)
	}
}

func TestRevisePPTXStructuralPlanAndRepair(t *testing.T) {
	for _, test := range []struct {
		name   string
		count  int
		repair bool
	}{{"expand", 2, false}, {"repair", 2, true}, {"reduce", 1, false}} {
		t.Run(test.name, func(t *testing.T) {
			source := revisionSource(t)
			if test.count == 1 {
				var err error
				source, err = pptxcompiler.ApplyRevisionPlan(source, pptxcompiler.RevisionPlan{Slides: []pptxcompiler.RevisionSlide{
					{SourcePart: "ppt/slides/slide1.xml"},
					{SourcePart: "ppt/slides/slide1.xml", Clone: true},
				}}, 2)
				if err != nil {
					t.Fatal(err)
				}
			}
			calls := 0
			client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				body, _ := io.ReadAll(request.Body)
				for _, expected := range []string{fmt.Sprintf("exactly %d slides", test.count), "complete final ordering", "condense or merge", "deletion instructions take precedence", "unaffected", "sourcePart", "text-only"} {
					if !bytes.Contains(body, []byte(expected)) {
						t.Errorf("missing prompt instruction %q", expected)
					}
				}
				content := `{"title":"Expanded","slides":[{"sourcePart":"ppt/slides/slide1.xml","operations":[]},{"sourcePart":"ppt/slides/slide1.xml","clone":true,"operations":[{"shapeId":2,"expectedText":"Original title","text":"Added title"}]}]}`
				if test.count == 1 {
					content = `{"title":"Condensed","slides":[{"sourcePart":"ppt/slides/slide1.xml","operations":[{"shapeId":2,"expectedText":"Original title","text":"Merged main points"}]}]}`
				}
				if test.repair && calls == 1 {
					content = `{"title":"Invalid","slides":[{"sourcePart":"missing.xml"}]}`
				}
				if calls == 2 && !bytes.Contains(body, []byte("Validation error:")) {
					t.Error("repair omitted compiler error")
				}
				response, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"total_tokens": 42}})
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(response))}, nil
			})}
			job := streamJob{kind: "iteration", prompt: "Resize", slideCount: test.count, selection: &ai.Selection{Provider: ai.OpenAI, Model: "test-model"}, credential: "test-key"}
			h := &handler{client: client}
			output, title, tokens, err := h.revisePPTX(context.Background(), job, source)
			if err != nil {
				t.Fatal(err)
			}
			wantCalls := 1
			if test.repair {
				wantCalls = 2
			}
			wantTitle := "Expanded"
			if test.count == 1 {
				wantTitle = "Condensed"
			}
			if calls != wantCalls || tokens != 42*wantCalls || title != wantTitle {
				t.Fatalf("calls=%d tokens=%d title=%q", calls, tokens, title)
			}
			index, err := pptxcompiler.Index(output)
			if err != nil || len(index.Slides) != test.count {
				t.Fatalf("unexpected plan result: %+v, %v", index, err)
			}
			if test.count == 1 {
				if index.Slides[0].Objects[0].Text != "Merged main points" {
					t.Fatal("reduction did not apply merged text")
				}
			} else if index.Slides[0].Objects[0].Text != "Original title" || index.Slides[1].Objects[0].Text != "Added title" {
				t.Fatal("expansion changed the retained slide or lost the clone edit")
			}
		})
	}
}

// A deck longer than one batch must be drafted in several shorter calls and
// reassembled by position, so one long completion is never the only path.
func TestGenerateSlotsDraftsInBatches(t *testing.T) {
	previousBatch := slotBatchSize
	slotBatchSize = 2
	defer func() { slotBatchSize = previousBatch }()

	assignments := make([]pptxcompiler.Assignment, 5)
	for i := range assignments {
		assignments[i] = pptxcompiler.Assignment{
			Position: i + 1,
			Archetype: templatepublish.Archetype{
				ID:    "content",
				Slots: []templatepublish.Slot{{ID: "body", Kind: templatepublish.SlotText, Required: true, MaxCharacters: 200}},
			},
		}
	}

	requested := [][]int{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(body, &payload)
		user := payload.Messages[len(payload.Messages)-1].Content

		positions := []int{}
		slides := []map[string]any{}
		for _, a := range assignments {
			if !strings.Contains(user, fmt.Sprintf(`"Position":%d`, a.Position)) {
				continue
			}
			positions = append(positions, a.Position)
			slides = append(slides, map[string]any{"position": a.Position, "slots": map[string]any{"body": "Slide copy"}})
		}
		requested = append(requested, positions)

		document, _ := json.Marshal(map[string]any{"title": "Batched deck", "slides": slides})
		writer.Header().Set("Content-Type", "text/event-stream")
		chunk, _ := json.Marshal(map[string]any{
			"choices": []map[string]any{{"delta": map[string]string{"content": string(document)}}},
			"usage":   map[string]int{"total_tokens": 10},
		})
		_, _ = writer.Write([]byte("data: " + string(chunk) + "\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	t.Setenv("OPEN_ROUTER_API_BASE", server.URL)
	t.Setenv("OPEN_ROUTER_MODEL", "test-model")
	t.Setenv("OPEN_ROUTER_API_KEY", "test-key")

	handler := &handler{client: server.Client()}
	title, content, tokens, err := handler.generateSlots(context.Background(), streamJob{slideCount: len(assignments), prompt: "Batching"}, assignments)
	if err != nil {
		t.Fatalf("generateSlots: %v", err)
	}
	if len(requested) != 3 {
		t.Fatalf("drafting calls = %d (%v), want 3 batches of at most 2", len(requested), requested)
	}
	for _, batch := range requested {
		if len(batch) > 2 {
			t.Fatalf("batch %v exceeds the batch size", batch)
		}
	}
	if len(content) != len(assignments) {
		t.Fatalf("slides = %d, want %d", len(content), len(assignments))
	}
	for i, slide := range content {
		if slide.Position != i+1 {
			t.Fatalf("slide %d landed at position %d", i+1, slide.Position)
		}
	}
	if title != "Batched deck" {
		t.Fatalf("title = %q", title)
	}
	if tokens != 30 {
		t.Fatalf("tokens = %d, want the sum across batches", tokens)
	}
}
