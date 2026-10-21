package cards

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

func TestHashMatchesCyrb53(t *testing.T) {
	// Values from the TypeScript converter's IDs.
	for input, want := range map[string]string{"op-1:card:1": "2aj3l1c48zd", "op-1:1:1": "t35ew3ivo3"} {
		if got := hash(input); got != want {
			t.Errorf("hash(%q) = %s, want %s", input, got, want)
		}
	}
	if len(hash("x")) < 8 {
		t.Fatal("hashes are padded to eight characters")
	}
}

func TestParseInlineMarkup(t *testing.T) {
	runs := ParseInlineMarkup("Why **batteries** matter, *now* and ****")
	want := RichText{{Text: "Why "}, {Text: "batteries", Bold: true}, {Text: " matter, "}, {Text: "now", Italic: true}, {Text: " and ****"}}
	if len(runs) != len(want) {
		t.Fatalf("runs = %#v", runs)
	}
	for index := range want {
		if runs[index] != want[index] {
			t.Fatalf("run %d = %#v, want %#v", index, runs[index], want[index])
		}
	}
}

func TestCleanTextStripsMarkupAndControls(t *testing.T) {
	got := CleanText(" <b>Bold</b>​ and a<b c\u0007 \t ")
	if got != "Bold and a<b c" {
		t.Fatalf("CleanText = %q", got)
	}
}

func TestParseDocumentReportsTheFirstIssue(t *testing.T) {
	value, _ := jsvalue.Parse(`{"schemaVersion":3,"title":"","theme":"x","cardOrder":["toString"],"cards":{}}`)
	_, err := ParseDocument(value, nil)
	var schemaErr *SchemaError
	if !errors.As(err, &schemaErr) || schemaErr.Issue.Path != "document.cardOrder[0]" || schemaErr.Issue.Message != "repeats card toString" {
		t.Fatalf("err = %v", err)
	}
	value, _ = jsvalue.Parse(`{"schemaVersion":3,"cardOrder":[{"toString":1}],"cards":{}}`)
	if _, err := ParseDocument(value, nil); !errors.Is(err, ErrType) {
		t.Fatalf("an uncoercible card ID must fail as a TypeError, got %v", err)
	}
}

func TestTemplatesValidate(t *testing.T) {
	for _, templateID := range templates.Object().Keys() {
		template, _ := Template(templateID)
		known := map[string]bool{}
		for _, assetID := range template.Get("assets").Object().Keys() {
			known[assetID] = true
		}
		document, err := ParseDocument(template.Get("document"), known)
		if err != nil {
			t.Fatalf("%s: %v", templateID, err)
		}
		if got, want := string(jsvalue.Stringify(document.JS())), string(jsvalue.Stringify(template.Get("document"))); got != want {
			t.Fatalf("%s does not round-trip", templateID)
		}
	}
}

// The embedded data is generated from libs/cards; regenerating it must
// change nothing.
func TestDataMatchesLibsCards(t *testing.T) {
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun is not installed")
	}
	directory := t.TempDir()
	if output, err := exec.Command(bun, "data/generate.ts", directory).CombinedOutput(); err != nil {
		t.Fatalf("generate data: %v\n%s", err, output)
	}
	for _, name := range []string{"templates.json", "drafting-schema.json", "themes.json"} {
		generated, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		embedded, err := os.ReadFile(filepath.Join("data", name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(generated, embedded) {
			t.Errorf("%s drifted from libs/cards; run bun apps/api/internal/cards/data/generate.ts", name)
		}
	}
}
