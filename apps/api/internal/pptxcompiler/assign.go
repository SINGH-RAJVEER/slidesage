// Package pptxcompiler builds a presentation by editing a published PowerPoint
// template package rather than synthesising slides from scratch.
//
// A template is opaque to the compiler except through the manifest publication
// emitted for it, which names the source slide behind each archetype and the
// shapes inside it that may be written. Everything the manifest does not name is
// copied through untouched, which is what keeps a generated deck looking like
// the template it came from.
package pptxcompiler

import (
	"errors"
	"fmt"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

// ErrUnsupportedSlideCount reports a deck size the template cannot produce.
var ErrUnsupportedSlideCount = errors.New("template cannot produce the requested slide count")

// Assignment is one position in the deck, bound to the archetype that will be
// cloned for it. Assignments are allocated before any content is requested, so
// the deck's length is settled before points are charged and a provider that
// returns too few slides is a repairable error rather than a short deck.
type Assignment struct {
	// Position is the 1-based slide number in the compiled deck.
	Position  int
	Archetype templatepublish.Archetype
}

// Assign allocates exactly count archetypes: a cover followed by repeatable
// content archetypes.
//
// Content archetypes rotate so a long deck alternates through the layouts the
// template provides instead of repeating one slide design. Rotation is by
// position, which keeps the assignment deterministic: the same template and
// count always produce the same plan.
func Assign(manifest templatepublish.Manifest, count int) ([]Assignment, error) {
	cover, err := singleArchetype(manifest, templatepublish.RoleCover)
	if err != nil {
		return nil, err
	}
	content := preferWritable(repeatableContent(manifest))
	if len(content) == 0 {
		return nil, fmt.Errorf("%w: %s has no repeatable content archetype", ErrUnsupportedSlideCount, manifest.TemplateID)
	}
	const minimum = 2 // a cover and at least one content slide
	if count < minimum {
		return nil, fmt.Errorf("%w: %s needs at least %d slides, requested %d", ErrUnsupportedSlideCount, manifest.TemplateID, minimum, count)
	}

	assignments := make([]Assignment, 0, count)
	assignments = append(assignments, Assignment{Position: 1, Archetype: writableArchetype(cover)})

	contentSlides := count - 1
	for index := 0; index < contentSlides; index++ {
		assignments = append(assignments, Assignment{
			Position:  len(assignments) + 1,
			Archetype: writableArchetype(content[index%len(content)]),
		})
	}

	if len(assignments) != count {
		return nil, fmt.Errorf("assigned %d slides for a %d-slide deck", len(assignments), count)
	}
	return assignments, nil
}

// writable reports whether the compiler can put generated content into a slot.
// Tables, charts and shapes the publication could not classify are readable in
// the manifest but not writable, so they take the same path as everything else
// the manifest does not name: they are cloned through untouched.
func writable(kind templatepublish.SlotKind) bool {
	switch kind {
	case templatepublish.SlotText, templatepublish.SlotList, templatepublish.SlotImage:
		return true
	default:
		return false
	}
}

// writableArchetype copies an archetype down to the slots content is generated
// for. The manifest is shared and cached, so the slot slice is copied rather
// than resliced.
func writableArchetype(archetype templatepublish.Archetype) templatepublish.Archetype {
	slots := make([]templatepublish.Slot, 0, len(archetype.Slots))
	for _, slot := range archetype.Slots {
		if writable(slot.Kind) {
			slots = append(slots, slot)
		}
	}
	archetype.Slots = slots
	return archetype
}

func fullyWritable(archetype templatepublish.Archetype) bool {
	for _, slot := range archetype.Slots {
		if !writable(slot.Kind) {
			return false
		}
	}
	return true
}

// preferWritable drops archetypes carrying an unwritable shape when the
// template has others to rotate through, so a deck shows the template's own
// sample table only when no alternative layout exists.
func preferWritable(archetypes []templatepublish.Archetype) []templatepublish.Archetype {
	var preferred []templatepublish.Archetype
	for _, archetype := range archetypes {
		if fullyWritable(archetype) {
			preferred = append(preferred, archetype)
		}
	}
	if len(preferred) == 0 {
		return archetypes
	}
	return preferred
}

func singleArchetype(manifest templatepublish.Manifest, role templatepublish.NarrativeRole) (templatepublish.Archetype, error) {
	var fallback *templatepublish.Archetype
	for index, archetype := range manifest.Archetypes {
		if archetype.Role != role {
			continue
		}
		if fullyWritable(archetype) {
			return archetype, nil
		}
		if fallback == nil {
			fallback = &manifest.Archetypes[index]
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	return templatepublish.Archetype{}, fmt.Errorf("%w: %s has no %s archetype", ErrUnsupportedSlideCount, manifest.TemplateID, role)
}

func repeatableContent(manifest templatepublish.Manifest) []templatepublish.Archetype {
	var content []templatepublish.Archetype
	for _, archetype := range manifest.Archetypes {
		if archetype.Role == templatepublish.RoleContent && archetype.Repeatable {
			content = append(content, archetype)
		}
	}
	return content
}
