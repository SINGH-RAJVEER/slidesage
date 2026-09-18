package pptxcompiler

import (
	"errors"
	"testing"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatemanifest"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

func manifestWith(archetypes ...templatepublish.Archetype) templatepublish.Manifest {
	return templatepublish.Manifest{
		ManifestVersion: templatepublish.ManifestVersion,
		TemplateID:      "a-template",
		TemplateVersion: 1,
		Archetypes:      archetypes,
	}
}

func archetype(id string, role templatepublish.NarrativeRole, repeatable bool) templatepublish.Archetype {
	return templatepublish.Archetype{
		ID:         id,
		Role:       role,
		PartName:   "ppt/slides/slide1.xml",
		Repeatable: repeatable,
		Slots:      []templatepublish.Slot{{ID: "title", ShapeID: 2, Kind: templatepublish.SlotText, MaxCharacters: 90}},
	}
}

func TestAssignDoesNotUseClosingArchetypes(t *testing.T) {
	manifest := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("body", templatepublish.RoleContent, true),
		archetype("closing", templatepublish.RoleClosing, false),
	)
	assignments, err := Assign(manifest, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(assignments) != 5 {
		t.Fatalf("assigned %d slides, want 5", len(assignments))
	}
	if assignments[0].Archetype.ID != "cover" {
		t.Fatalf("first slide = %s, want cover", assignments[0].Archetype.ID)
	}
	for index, assignment := range assignments {
		if assignment.Position != index+1 {
			t.Fatalf("assignment %d has position %d", index, assignment.Position)
		}
		if index > 0 && assignment.Archetype.Role != templatepublish.RoleContent {
			t.Fatalf("slide %d has role %s, want content", assignment.Position, assignment.Archetype.Role)
		}
	}
}

func TestAssignRotatesThroughContentArchetypes(t *testing.T) {
	manifest := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("body-a", templatepublish.RoleContent, true),
		archetype("body-b", templatepublish.RoleContent, true),
	)
	assignments, err := Assign(manifest, 5)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"cover", "body-a", "body-b", "body-a", "body-b"}
	for index, expected := range want {
		if assignments[index].Archetype.ID != expected {
			t.Fatalf("slide %d = %s, want %s", index+1, assignments[index].Archetype.ID, expected)
		}
	}
}

func TestAssignSkipsNonRepeatableContent(t *testing.T) {
	manifest := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("one-shot", templatepublish.RoleContent, false),
		archetype("body", templatepublish.RoleContent, true),
	)
	assignments, err := Assign(manifest, 4)
	if err != nil {
		t.Fatal(err)
	}
	for _, assignment := range assignments[1:] {
		if assignment.Archetype.ID == "one-shot" {
			t.Fatal("a non-repeatable archetype was used to fill the deck")
		}
	}
}

func TestAssignIsDeterministic(t *testing.T) {
	manifest := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("body-a", templatepublish.RoleContent, true),
		archetype("body-b", templatepublish.RoleContent, true),
		archetype("closing", templatepublish.RoleClosing, false),
	)
	first, err := Assign(manifest, 9)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Assign(manifest, 9)
	if err != nil {
		t.Fatal(err)
	}
	for index := range first {
		if first[index].Archetype.ID != second[index].Archetype.ID {
			t.Fatalf("slide %d differed between runs", index+1)
		}
	}
}

func TestAssignRejectsCountsTheTemplateCannotProduce(t *testing.T) {
	withClosing := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("body", templatepublish.RoleContent, true),
		archetype("closing", templatepublish.RoleClosing, false),
	)
	if _, err := Assign(withClosing, 2); err != nil {
		t.Fatalf("Assign(2) error = %v, want the minimum deck to be allowed", err)
	}

	noCover := manifestWith(archetype("body", templatepublish.RoleContent, true))
	if _, err := Assign(noCover, 4); !errors.Is(err, ErrUnsupportedSlideCount) {
		t.Fatalf("a template with no cover was accepted: %v", err)
	}

	noContent := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		archetype("body", templatepublish.RoleContent, false),
	)
	if _, err := Assign(noContent, 4); !errors.Is(err, ErrUnsupportedSlideCount) {
		t.Fatalf("a template with no repeatable content was accepted: %v", err)
	}
}

// TestAssignAgainstPublishedManifests exercises the real manifests publication
// emitted, which is the only place the assignment meets the shapes templates
// actually have.
func TestAssignAgainstPublishedManifests(t *testing.T) {
	ids, err := templatemanifest.IDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) == 0 {
		t.Fatal("no published manifests are embedded")
	}
	for _, id := range ids {
		manifest, err := templatemanifest.Lookup(id, 1)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		counts := manifest.SupportedCounts(1, 30)
		if len(counts) == 0 {
			// The template cannot drive generation at all; Assign must agree
			// rather than producing a deck the manifest does not support.
			if _, err := Assign(manifest, 5); !errors.Is(err, ErrUnsupportedSlideCount) {
				t.Fatalf("%s reports no supported counts but assigned a deck: %v", id, err)
			}
			continue
		}
		for _, count := range counts {
			assignments, err := Assign(manifest, count)
			if err != nil {
				t.Fatalf("%s at %d slides: %v", id, count, err)
			}
			if len(assignments) != count {
				t.Fatalf("%s at %d slides produced %d assignments", id, count, len(assignments))
			}
		}
	}
}

func withTable(a templatepublish.Archetype) templatepublish.Archetype {
	a.Slots = append(append([]templatepublish.Slot{}, a.Slots...), templatepublish.Slot{ID: "figures", ShapeID: 9, Kind: templatepublish.SlotTable})
	return a
}

func TestAssignPrefersContentWithoutUnwritableSlots(t *testing.T) {
	manifest := manifestWith(
		archetype("cover", templatepublish.RoleCover, false),
		withTable(archetype("tabular", templatepublish.RoleContent, true)),
		archetype("plain", templatepublish.RoleContent, true),
	)
	assignments, err := Assign(manifest, 6)
	if err != nil {
		t.Fatal(err)
	}
	for _, assignment := range assignments[1:] {
		if assignment.Archetype.ID != "plain" {
			t.Fatalf("slide %d used %s while a writable archetype was available", assignment.Position, assignment.Archetype.ID)
		}
	}
}

// A template whose only cover carries a table is still a template the user
// picked, so it compiles with the table cloned through rather than failing.
func TestAssignKeepsArchetypesWhenNoneAreFullyWritable(t *testing.T) {
	manifest := manifestWith(
		withTable(archetype("cover", templatepublish.RoleCover, false)),
		withTable(archetype("tabular", templatepublish.RoleContent, true)),
	)
	assignments, err := Assign(manifest, 4)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateAssignments(assignments); err != nil {
		t.Fatal(err)
	}
	for _, assignment := range assignments {
		for _, slot := range assignment.Archetype.Slots {
			if slot.Kind == templatepublish.SlotTable {
				t.Fatalf("slide %d asks for content in a table slot", assignment.Position)
			}
		}
	}
}
