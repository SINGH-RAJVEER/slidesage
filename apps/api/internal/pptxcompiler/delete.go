package pptxcompiler

import (
	"errors"
	"fmt"
	"strings"
)

// ErrLastSlide is returned when the only remaining slide would be removed. A
// PPTX with an empty slide list does not open.
var ErrLastSlide = errors.New("a deck must keep at least one slide")

// slideEntry pairs a slide list entry with the part it points at.
type slideEntry struct {
	relationshipID string
	part           string
}

// slideEntries reads the deck's slide order: the slide list gives the order,
// the presentation relationships give the part behind each entry.
func slideEntries(presentation []byte, rels []relationship) ([]slideEntry, error) {
	root, err := parseXML(presentation)
	if err != nil {
		return nil, err
	}
	byID := map[string]string{}
	for _, item := range rels {
		if item.Type != slideRelationshipType {
			continue
		}
		target, err := resolveTarget(presentationPart, item.Target)
		if err != nil {
			return nil, err
		}
		byID[item.ID] = target
	}
	list := root.find(presentationNamespace, "sldIdLst")
	if list == nil {
		return nil, fmt.Errorf("presentation part declares no slide list")
	}
	entries := make([]slideEntry, 0, len(list.children))
	for _, node := range list.children {
		var id string
		for _, attribute := range node.attrs {
			if attribute.Name.Space == relationshipNamespace && attribute.Name.Local == "id" {
				id = attribute.Value
			}
		}
		part, present := byID[id]
		if !present {
			return nil, fmt.Errorf("slide list entry %q has no slide relationship", id)
		}
		entries = append(entries, slideEntry{relationshipID: id, part: part})
	}
	return entries, nil
}

// isOwnedPart reports whether a part belongs to the slide that points at it
// rather than to the deck. It is the same ownership rule cloning uses, so a
// deck this compiler built keeps one copy of these per slide.
func isOwnedPart(name string) bool {
	return strings.Contains(name, "/notesSlides/") || strings.Contains(name, "/charts/") ||
		strings.Contains(name, "/diagrams/") || strings.Contains(name, "/tags/")
}

// ownedDescendants collects the owned parts a slide reaches, directly or
// through another owned part. Shared design resources - layouts, masters,
// themes, media - are never collected: other slides still need them.
func ownedDescendants(p *pkg, part string) (map[string]bool, error) {
	found := map[string]bool{}
	var visit func(string) error
	visit = func(current string) error {
		data, present := p.part(relsPartFor(current))
		if !present {
			return nil
		}
		rels, err := parseRelationships(data)
		if err != nil {
			return err
		}
		for _, item := range rels {
			if item.isExternal() {
				continue
			}
			target, err := resolveTarget(current, item.Target)
			if err != nil {
				return err
			}
			if !isOwnedPart(target) || found[target] {
				continue
			}
			found[target] = true
			if err := visit(target); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(part); err != nil {
		return nil, err
	}
	return found, nil
}

// referencedParts lists every part the package still points at, so an owned
// part a surviving slide shares is not deleted with the slide that went.
func referencedParts(p *pkg) (map[string]bool, error) {
	referenced := map[string]bool{}
	for _, name := range p.partNames() {
		if !strings.HasSuffix(name, ".rels") {
			continue
		}
		source := sourcePartFor(name)
		data, _ := p.part(name)
		rels, err := parseRelationships(data)
		if err != nil {
			return nil, err
		}
		for _, item := range rels {
			if item.isExternal() {
				continue
			}
			target, err := resolveTarget(source, item.Target)
			if err != nil {
				continue
			}
			referenced[target] = true
		}
	}
	return referenced, nil
}

// sourcePartFor is the inverse of relsPartFor: the part a .rels file describes.
// The root relationships describe the package itself, which has no part name.
func sourcePartFor(relsPart string) string {
	if relsPart == rootRelsPart {
		return ""
	}
	directory, base, found := strings.Cut(relsPart, "/_rels/")
	if !found {
		return ""
	}
	return directory + "/" + strings.TrimSuffix(base, ".rels")
}

// RemoveSlide drops one slide from a package and returns the rebuilt bytes.
//
// The position is 1-based and follows the presentation's slide list, which is
// the order Index reports and the order the viewer shows. The slide's part, its
// relationship, and the parts only it reached - its notes, its charts - go with
// it; layouts, masters, themes and media are shared, so they stay. Surviving
// slide parts keep their names: deck order lives in the slide list, not in the
// file names, so renumbering would only churn relationships.
func RemoveSlide(contents []byte, position int) ([]byte, error) {
	p, err := openPackage(contents)
	if err != nil {
		return nil, err
	}
	presentation, err := p.mustPart(presentationPart)
	if err != nil {
		return nil, err
	}
	rawRels, err := p.mustPart(presentationRelsPart)
	if err != nil {
		return nil, err
	}
	rels, err := parseRelationships(rawRels)
	if err != nil {
		return nil, err
	}
	entries, err := slideEntries(presentation, rels)
	if err != nil {
		return nil, err
	}
	if position < 1 || position > len(entries) {
		return nil, fmt.Errorf("slide %d is outside the deck's %d slides", position, len(entries))
	}
	if len(entries) == 1 {
		return nil, ErrLastSlide
	}
	removed := entries[position-1]

	owned, err := ownedDescendants(p, removed.part)
	if err != nil {
		return nil, err
	}
	rawTypes, err := p.mustPart(contentTypesPart)
	if err != nil {
		return nil, err
	}
	types, err := parseContentTypes(rawTypes)
	if err != nil {
		return nil, err
	}
	drop := func(name string) {
		p.removePart(name)
		p.removePart(relsPartFor(name))
		types.removeOverride(name)
	}
	drop(removed.part)

	keptRels := make([]relationship, 0, len(rels)-1)
	for _, item := range rels {
		if item.ID != removed.relationshipID {
			keptRels = append(keptRels, item)
		}
	}
	keptIDs := make([]string, 0, len(entries)-1)
	for index, entry := range entries {
		if index != position-1 {
			keptIDs = append(keptIDs, entry.relationshipID)
		}
	}
	rewritten, err := rewriteSlideList(presentation, keptIDs)
	if err != nil {
		return nil, err
	}
	p.setPart(presentationPart, rewritten)
	p.setPart(presentationRelsPart, marshalRelationships(keptRels))

	// An owned part can own further parts, so dropping one may orphan another.
	// Repeat until a pass finds nothing left to remove.
	for {
		referenced, err := referencedParts(p)
		if err != nil {
			return nil, err
		}
		removedAny := false
		for name := range owned {
			if _, present := p.part(name); !present || referenced[name] {
				continue
			}
			drop(name)
			removedAny = true
		}
		if !removedAny {
			break
		}
	}
	p.setPart(contentTypesPart, types.marshal())
	return p.bytes()
}
