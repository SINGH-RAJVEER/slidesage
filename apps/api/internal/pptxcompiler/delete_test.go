package pptxcompiler

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

// notedDeckEntries builds a deck where every slide owns a notes slide, which is
// the part a deletion has to take with it.
func notedDeckEntries(slideCount int) map[string]string {
	entries := deckEntries(slideCount)
	for index := 1; index <= slideCount; index++ {
		notes := fmt.Sprintf("ppt/notesSlides/notesSlide%d.xml", index)
		entries[notes] = fmt.Sprintf(`<?xml version="1.0"?><p:notes xmlns:p="%s"><marker>notes-%d</marker></p:notes>`,
			presentationNamespace, index)
		entries[relsPartFor(notes)] = `<?xml version="1.0"?><Relationships xmlns="` + packageRelationshipsNS +
			fmt.Sprintf(`"><Relationship Id="rId1" Type="%s" Target="../slides/slide%d.xml"/></Relationships>`,
				slideRelationshipType, index)
		entries[relsPartFor(fmt.Sprintf("ppt/slides/slide%d.xml", index))] =
			`<?xml version="1.0"?><Relationships xmlns="` + packageRelationshipsNS +
				`"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
				fmt.Sprintf(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide%d.xml"/></Relationships>`, index)
		entries[contentTypesPart] = strings.Replace(entries[contentTypesPart], "</Types>",
			fmt.Sprintf(`<Override PartName="/ppt/notesSlides/notesSlide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`, index), 1)
	}
	return entries
}

func TestRemoveSlideDropsTheSlideAndItsNotes(t *testing.T) {
	reduced, err := RemoveSlide(zipEntries(t, notedDeckEntries(3)), 2)
	if err != nil {
		t.Fatal(err)
	}
	result, err := openPackage(reduced)
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{
		"ppt/slides/slide2.xml",
		"ppt/slides/_rels/slide2.xml.rels",
		"ppt/notesSlides/notesSlide2.xml",
		"ppt/notesSlides/_rels/notesSlide2.xml.rels",
	} {
		if _, present := result.part(name); present {
			t.Fatalf("%s survived the deletion", name)
		}
	}
	for _, name := range []string{
		"ppt/slides/slide1.xml",
		"ppt/slides/slide3.xml",
		"ppt/notesSlides/notesSlide1.xml",
		"ppt/notesSlides/notesSlide3.xml",
	} {
		if _, present := result.part(name); !present {
			t.Fatalf("%s was removed with the deleted slide", name)
		}
	}

	types, err := parseContentTypes(mustPartOf(t, result, contentTypesPart))
	if err != nil {
		t.Fatal(err)
	}
	if _, declared := types.overrideFor("ppt/slides/slide2.xml"); declared {
		t.Fatal("content types still declare the deleted slide")
	}
	if _, declared := types.overrideFor("ppt/notesSlides/notesSlide2.xml"); declared {
		t.Fatal("content types still declare the deleted slide's notes")
	}
}

func TestRemoveSlideLeavesTheRemainingSlidesInOrder(t *testing.T) {
	reduced, err := RemoveSlide(zipEntries(t, notedDeckEntries(3)), 1)
	if err != nil {
		t.Fatal(err)
	}
	index, err := Index(reduced)
	if err != nil {
		t.Fatal(err)
	}
	if len(index.Slides) != 2 {
		t.Fatalf("deck holds %d slides, want 2", len(index.Slides))
	}
	result, err := openPackage(reduced)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"source-2", "source-3"}
	for position, marker := range want {
		body, present := result.part(index.Slides[position].Part)
		if !present {
			t.Fatalf("slide %d names a part the package does not hold", position+1)
		}
		if !strings.Contains(string(body), marker) {
			t.Fatalf("slide %d is not %s: %s", position+1, marker, body)
		}
	}
	rels, err := parseRelationships(mustPartOf(t, result, presentationRelsPart))
	if err != nil {
		t.Fatal(err)
	}
	slides, masters := 0, 0
	for _, item := range rels {
		switch {
		case item.Type == slideRelationshipType:
			slides++
		case strings.HasSuffix(item.Type, "/slideMaster"):
			masters++
		}
	}
	if slides != 2 {
		t.Fatalf("presentation declares %d slide relationships, want 2", slides)
	}
	if masters != 1 {
		t.Fatal("the deletion dropped a non-slide relationship")
	}
}

func TestRemoveSlideKeepsNotesAnotherSlideShares(t *testing.T) {
	entries := notedDeckEntries(2)
	// Slide 1 is pointed at slide 2's notes, so deleting slide 2 must leave them.
	entries[relsPartFor("ppt/slides/slide1.xml")] = strings.Replace(
		entries[relsPartFor("ppt/slides/slide1.xml")], "notesSlide1.xml", "notesSlide2.xml", 1)

	reduced, err := RemoveSlide(zipEntries(t, entries), 2)
	if err != nil {
		t.Fatal(err)
	}
	result, err := openPackage(reduced)
	if err != nil {
		t.Fatal(err)
	}
	if _, present := result.part("ppt/notesSlides/notesSlide2.xml"); !present {
		t.Fatal("notes a surviving slide still points at were deleted")
	}
}

func TestRemoveSlideRejectsAnEmptyDeckAndBadPositions(t *testing.T) {
	single := zipEntries(t, notedDeckEntries(1))
	if _, err := RemoveSlide(single, 1); !errors.Is(err, ErrLastSlide) {
		t.Fatalf("deleting the only slide returned %v, want ErrLastSlide", err)
	}
	deck := zipEntries(t, notedDeckEntries(2))
	for _, position := range []int{0, -1, 3} {
		if _, err := RemoveSlide(deck, position); err == nil {
			t.Fatalf("position %d was accepted", position)
		}
	}
}

func mustPartOf(t *testing.T, p *pkg, name string) []byte {
	t.Helper()
	body, present := p.part(name)
	if !present {
		t.Fatalf("package is missing %s", name)
	}
	return body
}
