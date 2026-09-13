package pptxcompiler_test

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/pptxcompiler"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentationrevision"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatemanifest"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

type discardBlobs struct{}

func (discardBlobs) PutImmutable(context.Context, string, io.Reader, int64, string, string) error {
	return nil
}

// assertDesignMatchesTemplate holds a compiled deck to the package it was
// compiled from. Slides are rewritten, but the parts that carry the look of a
// template - its theme, masters and layouts - are cloned through, so a deck
// built from the wrong template would differ here.
func assertDesignMatchesTemplate(t *testing.T, template, compiled []byte) {
	t.Helper()
	design := func(raw []byte) map[string]string {
		reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			t.Fatal(err)
		}
		parts := map[string]string{}
		for _, file := range reader.File {
			if !strings.HasPrefix(file.Name, "ppt/theme/") && !strings.HasPrefix(file.Name, "ppt/slideMasters/") && !strings.HasPrefix(file.Name, "ppt/slideLayouts/") {
				continue
			}
			contents, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(contents)
			contents.Close()
			if err != nil {
				t.Fatal(err)
			}
			parts[file.Name] = string(body)
		}
		return parts
	}
	source, output := design(template), design(compiled)
	if len(source) == 0 {
		t.Fatal("template package has no theme, master or layout parts")
	}
	for name, body := range source {
		if output[name] != body {
			t.Fatalf("compiled deck does not carry the template's %s", name)
		}
	}
}

// Opt in with local authoring packages; this validates real generated packages
// through the same validator and indexer used before revision commit.
func TestPublishedPackagesCompile(t *testing.T) {
	directory := os.Getenv("PPTX_TEMPLATE_TEST_DIR")
	if directory == "" {
		t.Skip("set PPTX_TEMPLATE_TEST_DIR to test published packages")
	}
	ids, err := templatemanifest.IDs()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			manifest, err := templatemanifest.Lookup(id, 1)
			if err != nil {
				t.Fatal(err)
			}
			for count := 5; count <= 40; count++ {
				a, err := pptxcompiler.Assign(manifest, count)
				if err != nil {
					t.Fatal(err)
				}
				// A published template is selectable in the browser, so an
				// assignment it cannot validate is a template nobody can
				// generate with rather than a case to skip.
				if err := pptxcompiler.ValidateAssignments(a); err != nil {
					t.Fatalf("%d slides: %v", count, err)
				}
			}
			raw, err := os.ReadFile(filepath.Join(directory, id+".pptx"))
			if err != nil {
				t.Fatal(err)
			}
			source, err := templatepublish.Prepare(templatepublish.Input{TemplateID: id, Version: 1, Source: bytes.NewReader(raw)})
			if err != nil {
				t.Fatal(err)
			}
			if source.SHA256 != manifest.SHA256 {
				t.Fatal("authoring package no longer matches published manifest")
			}
			for _, count := range []int{5, 40} {
				a, _ := pptxcompiler.Assign(manifest, count)
				content := make([]pptxcompiler.SlideContent, count)
				for i, assignment := range a {
					values := map[string]any{}
					for _, slot := range assignment.Archetype.Slots {
						switch slot.Kind {
						case templatepublish.SlotText:
							values[slot.ID] = "Test copy"
						case templatepublish.SlotList:
							values[slot.ID] = []string{"Test item"}
						}
					}
					content[i] = pptxcompiler.SlideContent{Position: i + 1, Slots: values}
				}
				compiled, err := pptxcompiler.Compile(source.Package, a, content)
				if err != nil {
					t.Fatal(err)
				}
				service := presentationrevision.NewService(nil, discardBlobs{}, 0)
				prepared, err := service.Prepare(context.Background(), presentationrevision.CommitInput{PresentationID: "fixture", AuthorID: "test", Operation: presentationrevision.SourceOperation{ID: "test", Kind: presentationrevision.SourceOperationGeneration}, ExpectedSlideCount: count, PPTX: bytes.NewReader(compiled), MIMEType: presentationrevision.PPTXContentType, TemplateID: id, TemplateVersion: 1, TemplateSHA256: manifest.SHA256, CompilerVersion: pptxcompiler.Version})
				if err != nil {
					t.Fatal(err)
				}
				if prepared.SlideCount != count {
					t.Fatal("count mismatch")
				}
				assertDesignMatchesTemplate(t, source.Package, compiled)
				if id == "simple-business-proposal" && count == 5 {
					if output := os.Getenv("PPTX_SMOKE_OUTPUT"); output != "" {
						if err := os.WriteFile(output, compiled, 0600); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
		})
	}
}

// Every template in the embedded manifest set is selectable in the browser, so
// each one has to produce a valid plan at every slide count the generate page
// offers. This needs no template packages, so it runs everywhere.
func TestEveryPublishedManifestAssigns(t *testing.T) {
	ids, err := templatemanifest.IDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) == 0 {
		t.Fatal("no embedded manifests")
	}
	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			manifest, err := templatemanifest.Lookup(id, 1)
			if err != nil {
				t.Fatal(err)
			}
			for count := 5; count <= 40; count++ {
				assignments, err := pptxcompiler.Assign(manifest, count)
				if err != nil {
					t.Fatalf("%d slides: %v", count, err)
				}
				if err := pptxcompiler.ValidateAssignments(assignments); err != nil {
					t.Fatalf("%d slides: %v", count, err)
				}
			}
		})
	}
}
