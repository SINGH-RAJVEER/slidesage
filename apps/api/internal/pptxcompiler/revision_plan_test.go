package pptxcompiler

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func revisionEntries(count int) map[string]string {
	entries := notedDeckEntries(count)
	entries["ppt/slideLayouts/slideLayout1.xml"] = `<p:sldLayout xmlns:p="` + presentationNamespace + `"/>`
	entries["ppt/slideMasters/slideMaster1.xml"] = `<p:sldMaster xmlns:p="` + presentationNamespace + `"/>`
	entries["ppt/theme/theme1.xml"] = `<theme/>`
	entries["ppt/media/image1.png"] = "shared image"
	for i := 1; i <= count; i++ {
		entries[fmt.Sprintf("ppt/slides/slide%d.xml", i)] = fmt.Sprintf(`<p:sld xmlns:p="%s" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>Original %d</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`, presentationNamespace, i)
	}
	return entries
}

func TestApplyRevisionPlanOrdersRetainsClonesAndDeletes(t *testing.T) {
	entries := revisionEntries(3)
	entries[presentationPart] = strings.Replace(entries[presentationPart], `id="258"`, `id="900"`, 1)
	// Existing clone-like names must not be overwritten, even across revisions.
	entries["ppt/slides/revision1.xml"] = "reserved slide name"
	entries["ppt/notesSlides/clone2-notesSlide1.xml"] = "reserved notes name"
	plan := RevisionPlan{Slides: []RevisionSlide{
		{SourcePart: "ppt/slides/slide3.xml"},
		{SourcePart: "ppt/slides/slide1.xml", Clone: true, Operations: []TextOperation{{Position: 99, ShapeID: 2, ExpectedText: "Original 1", Text: "Clone A & B"}}},
		{SourcePart: "ppt/slides/slide1.xml", Clone: true},
	}}
	source := zipEntries(t, entries)
	result, err := ApplyRevisionPlan(source, plan, 3)
	if err != nil {
		t.Fatal(err)
	}
	again, err := ApplyRevisionPlan(source, plan, 3)
	if err != nil || !bytes.Equal(result, again) {
		t.Fatalf("not deterministic: %v", err)
	}
	p, err := openPackage(result)
	if err != nil {
		t.Fatal(err)
	}
	index, err := Index(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(index.Slides) != 3 || index.Slides[0].Part != "ppt/slides/slide3.xml" {
		t.Fatalf("wrong final order: %+v", index.Slides)
	}
	for i, text := range []string{"Original 3", "Clone A & B", "Original 1"} {
		if index.Slides[i].Objects[0].Text != text {
			t.Fatalf("slide %d text = %q, want %q", i+1, index.Slides[i].Objects[0].Text, text)
		}
	}
	for _, part := range []string{"ppt/slides/slide3.xml", relsPartFor("ppt/slides/slide3.xml"), "ppt/notesSlides/notesSlide3.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/theme/theme1.xml", "ppt/media/image1.png", "ppt/slides/revision1.xml", "ppt/notesSlides/clone2-notesSlide1.xml"} {
		if string(mustPartBytes(t, p, part)) != entries[part] {
			t.Fatalf("untouched part changed: %s", part)
		}
	}
	types, err := parseContentTypes(mustPartBytes(t, p, contentTypesPart))
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/notesSlides/notesSlide2.xml"} {
		if _, ok := p.part(part); ok {
			t.Fatalf("deleted part survived: %s", part)
		}
		if _, ok := p.part(relsPartFor(part)); ok {
			t.Fatalf("deleted relationships survived: %s", part)
		}
		if _, ok := types.overrideFor(part); ok {
			t.Fatalf("deleted override survived: %s", part)
		}
	}
	presentation := mustPartBytes(t, p, presentationPart)
	root, err := parseXML(presentation)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"900", "901", "902"} {
		if got := attr(root.find(presentationNamespace, "sldIdLst").children[i], "id"); got != want {
			t.Fatalf("slide %d ID = %s, want %s", i+1, got, want)
		}
	}
	notesSeen := map[string]bool{}
	for _, slide := range index.Slides[1:] {
		rels, err := parseRelationships(mustPartBytes(t, p, relsPartFor(slide.Part)))
		if err != nil {
			t.Fatal(err)
		}
		for _, rel := range rels {
			if !strings.HasSuffix(rel.Type, "/notesSlide") {
				continue
			}
			notes, err := resolveTarget(slide.Part, rel.Target)
			if err != nil || notesSeen[notes] {
				t.Fatalf("clones share notes: %s, %v", notes, err)
			}
			notesSeen[notes] = true
			if _, ok := types.overrideFor(notes); !ok {
				t.Fatalf("notes override missing: %s", notes)
			}
			back, err := parseRelationships(mustPartBytes(t, p, relsPartFor(notes)))
			if err != nil {
				t.Fatal(err)
			}
			if target, err := resolveTarget(notes, back[0].Target); err != nil || target != slide.Part {
				t.Fatalf("notes point to %s instead of %s: %v", target, slide.Part, err)
			}
		}
	}
	if len(notesSeen) != 2 {
		t.Fatalf("expected two private notes parts, got %d", len(notesSeen))
	}
	for _, name := range p.partNames() {
		if !strings.HasSuffix(name, ".rels") {
			continue
		}
		rels, err := parseRelationships(mustPartBytes(t, p, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, rel := range rels {
			target, err := resolveTarget(sourcePartFor(name), rel.Target)
			if _, ok := p.part(target); err != nil || !ok {
				t.Fatalf("dangling relationship in %s: %s, %v", name, target, err)
			}
		}
	}
}

func TestApplyRevisionPlanUsesOriginalTextForEveryDonor(t *testing.T) {
	plan := RevisionPlan{Slides: []RevisionSlide{
		{SourcePart: "ppt/slides/slide1.xml", Operations: []TextOperation{{ShapeID: 2, ExpectedText: "Original 1", Text: "Retained edit"}}},
		{SourcePart: "ppt/slides/slide1.xml", Clone: true, Operations: []TextOperation{{ShapeID: 2, ExpectedText: "Original 1", Text: "Clone edit"}}},
		{SourcePart: "ppt/slides/slide1.xml", Clone: true},
	}}
	result, err := ApplyRevisionPlan(zipEntries(t, revisionEntries(1)), plan, 3)
	if err != nil {
		t.Fatal(err)
	}
	index, err := Index(result)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"Retained edit", "Clone edit", "Original 1"} {
		if got := index.Slides[i].Objects[0].Text; got != want {
			t.Fatalf("slide %d = %q, want %q", i+1, got, want)
		}
	}
	// A revised package can itself be a donor without colliding with its notes.
	_, err = ApplyRevisionPlan(result, RevisionPlan{Slides: []RevisionSlide{
		{SourcePart: index.Slides[1].Part, Clone: true},
		{SourcePart: index.Slides[1].Part},
	}}, 2)
	if err != nil {
		t.Fatal(err)
	}
}

func TestApplyRevisionPlanPreservesSlideListNamespaces(t *testing.T) {
	for _, defaultNamespace := range []bool{false, true} {
		t.Run(fmt.Sprint(defaultNamespace), func(t *testing.T) {
			entries := revisionEntries(2)
			xml := entries[presentationPart]
			xml = strings.Replace(xml, ` xmlns:r="`+relationshipNamespace+`"`, "", 1)
			xml = strings.Replace(xml, `<p:sldIdLst>`, `<p:sldIdLst xmlns:r="`+relationshipNamespace+`">`, 1)
			if defaultNamespace {
				xml = strings.ReplaceAll(xml, "<p:", "<")
				xml = strings.ReplaceAll(xml, "</p:", "</")
				xml = strings.Replace(xml, "xmlns:p=", "xmlns=", 1)
			}
			entries[presentationPart] = xml
			result, err := ApplyRevisionPlan(zipEntries(t, entries), RevisionPlan{Slides: []RevisionSlide{
				{SourcePart: "ppt/slides/slide2.xml"},
				{SourcePart: "ppt/slides/slide1.xml", Clone: true},
			}}, 2)
			if err != nil {
				t.Fatal(err)
			}
			index, err := Index(result)
			if err != nil || len(index.Slides) != 2 || index.Slides[0].Part != "ppt/slides/slide2.xml" {
				t.Fatalf("namespace bindings lost: %+v, %v", index, err)
			}
		})
	}
}

func TestApplyRevisionPlanValidation(t *testing.T) {
	retain := RevisionSlide{SourcePart: "ppt/slides/slide1.xml"}
	clone := RevisionSlide{SourcePart: retain.SourcePart, Clone: true}
	tests := []struct {
		name     string
		slides   []RevisionSlide
		expected int
	}{
		{"empty", nil, 0},
		{"count mismatch", []RevisionSlide{retain}, 2},
		{"negative count", []RevisionSlide{retain}, -1},
		{"duplicate retention", []RevisionSlide{retain, retain}, 2},
		{"missing source", []RevisionSlide{{SourcePart: "ppt/slides/slide99.xml"}}, 1},
		{"not a slide", []RevisionSlide{{SourcePart: "ppt/theme/theme1.xml"}}, 1},
		{"new clone is not donor", []RevisionSlide{clone, {SourcePart: "ppt/slides/revision1.xml", Clone: true}}, 2},
		{"stale text", []RevisionSlide{{SourcePart: retain.SourcePart, Operations: []TextOperation{{ShapeID: 2, ExpectedText: "stale"}}}}, 1},
		{"missing shape", []RevisionSlide{{SourcePart: retain.SourcePart, Operations: []TextOperation{{ShapeID: 99}}}}, 1},
		{"duplicate operation", []RevisionSlide{{SourcePart: retain.SourcePart, Operations: []TextOperation{{ShapeID: 2, ExpectedText: "Original 1"}, {ShapeID: 2, ExpectedText: "Original 1"}}}}, 1},
		{"long text", []RevisionSlide{{SourcePart: retain.SourcePart, Operations: []TextOperation{{ShapeID: 2, ExpectedText: "Original 1", Text: strings.Repeat("x", 10001)}}}}, 1},
	}
	tooMany := make([]RevisionSlide, 41)
	for i := range tooMany {
		tooMany[i] = clone
	}
	tests = append(tests, struct {
		name     string
		slides   []RevisionSlide
		expected int
	}{"too many slides", tooMany, 41})
	source := zipEntries(t, revisionEntries(1))
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if result, err := ApplyRevisionPlan(source, RevisionPlan{Slides: test.slides}, test.expected); err == nil || result != nil {
				t.Fatalf("expected error and no package, got %v", err)
			}
		})
	}
	if _, err := ApplyRevisionPlan(source, RevisionPlan{Slides: tooMany[:40]}, 40); err != nil {
		t.Fatalf("40 slides rejected: %v", err)
	}
}

func TestApplyRevisionPlanRejectsUnsafeStructure(t *testing.T) {
	for _, kind := range []string{"pic", "graphicFrame", "extLst", "chart relationship", "shared notes", "slide link", "custom show", "sections"} {
		t.Run(kind, func(t *testing.T) {
			entries := revisionEntries(2)
			part := "ppt/slides/slide1.xml"
			plan := RevisionPlan{Slides: []RevisionSlide{{SourcePart: part, Clone: true}}}
			switch kind {
			case "chart relationship":
				entries[relsPartFor(part)] = strings.Replace(entries[relsPartFor(part)], "</Relationships>", `<Relationship Id="rId3" Type="`+relationshipNamespace+`/chart" Target="../charts/chart1.xml"/></Relationships>`, 1)
				entries["ppt/charts/chart1.xml"] = `<chart/>`
			case "shared notes":
				entries[relsPartFor(part)] = strings.ReplaceAll(entries[relsPartFor(part)], "notesSlide1.xml", "notesSlide2.xml")
				plan.Slides[0].Clone = false
			case "slide link":
				entries[relsPartFor(part)] = strings.Replace(entries[relsPartFor(part)], "</Relationships>", `<Relationship Id="rId3" Type="`+slideRelationshipType+`" Target="slide2.xml"/></Relationships>`, 1)
				plan.Slides[0].Clone = false
			case "custom show":
				entries[presentationPart] = strings.Replace(entries[presentationPart], "</p:presentation>", `<p:custShowLst/></p:presentation>`, 1)
			case "sections":
				entries[presentationPart] = strings.Replace(entries[presentationPart], "</p:presentation>", `<p:sectionLst/></p:presentation>`, 1)
			default:
				entries[part] = strings.Replace(entries[part], "</p:spTree>", "<p:"+kind+"/></p:spTree>", 1)
			}
			if _, err := ApplyRevisionPlan(zipEntries(t, entries), plan, 1); err == nil {
				t.Fatal("unsafe structure accepted")
			}
		})
	}
	// Rich content need not be understood when its original slide is retained.
	entries := revisionEntries(2)
	entries["ppt/slides/slide1.xml"] = strings.Replace(entries["ppt/slides/slide1.xml"], "</p:spTree>", "<p:pic/></p:spTree>", 1)
	if _, err := ApplyRevisionPlan(zipEntries(t, entries), RevisionPlan{Slides: []RevisionSlide{{SourcePart: "ppt/slides/slide1.xml"}}}, 1); err != nil {
		t.Fatalf("retaining rich content rejected: %v", err)
	}
}
