package pptx

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

func TestWrappedLinesEstimatesWrapping(t *testing.T) {
	if got := wrappedLines("short", 20, 400, false); got != 1 {
		t.Fatalf("short text wraps to %v lines", got)
	}
	if got := wrappedLines(strings.Repeat("word ", 60), 20, 400, false); got <= 3 {
		t.Fatalf("long text wraps to %v lines", got)
	}
	// A word wider than the box breaks across lines on its own.
	if got := wrappedLines(strings.Repeat("w", 100), 10, 100, true); got != 6 {
		t.Fatalf("a long word wraps to %v lines", got)
	}
}

func TestWriteProducesAnOpenablePresentation(t *testing.T) {
	template, _ := cards.Template("grove-lesson")
	document, err := cards.ParseDocument(template.Get("document"), nil)
	if err != nil {
		t.Fatal(err)
	}
	pixel := []byte("\x89PNG\r\n\x1a\n")
	assets := map[string]*Asset{}
	for _, assetID := range template.Get("assets").Object().Keys() {
		assets[assetID] = &Asset{MimeType: "image/jpeg", Width: 1600, Height: 1000, Data: pixel, Source: template.Get("assets").Get(assetID).Get("source")}
	}
	file, err := write(document, assets, nil, time.Date(2026, 10, 22, 8, 30, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(file), int64(len(file)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, entry := range reader.File {
		names[entry.Name] = true
		if entry.Method != zip.Store {
			t.Fatalf("%s is compressed", entry.Name)
		}
	}
	for _, name := range []string{"[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/media/image-1-1.jpeg"} {
		if !names[name] {
			t.Errorf("missing %s", name)
		}
	}
	core, _ := reader.Open("docProps/core.xml")
	text, _ := io.ReadAll(core)
	if !strings.Contains(string(text), "2026-10-22T08:30:00Z") || !strings.Contains(string(text), "<dc:title>How a forest works</dc:title>") {
		t.Fatalf("core properties: %s", text)
	}
}

func TestUnpairedSurrogatesAreWrittenAsReplacementCharacters(t *testing.T) {
	text, _ := jsvalue.Parse(`"a\ud800b"`)
	if got := wellFormed(text.Str()); got != "a�b" {
		t.Fatalf("wellFormed = %q", got)
	}
}
