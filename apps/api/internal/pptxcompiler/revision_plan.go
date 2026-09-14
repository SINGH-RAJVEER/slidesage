package pptxcompiler

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

// RevisionPlan describes the complete final slide order. Omitted originals are deleted.
type RevisionPlan struct {
	Slides []RevisionSlide `json:"slides"`
}

// RevisionSlide names a donor in the original Index, never an earlier plan entry.
// An original may be retained once and cloned any number of times.
type RevisionSlide struct {
	SourcePart string          `json:"sourcePart"`
	Clone      bool            `json:"clone,omitempty"`
	Operations []TextOperation `json:"operations,omitempty"`
}

// ApplyRevisionPlan applies structural and text edits atomically. ExpectedText is
// checked against the original donor; TextOperation.Position is ignored. Cloning
// supports plain shapes, shared design resources, hyperlinks and private notes.
// Unsupported rich donors and deletions leaving dangling references are rejected.
// Structural changes to presentations with custom shows or sections are rejected.
func ApplyRevisionPlan(source []byte, plan RevisionPlan, expectedCount int) ([]byte, error) {
	if len(plan.Slides) < 1 || len(plan.Slides) > 40 || len(plan.Slides) != expectedCount {
		return nil, fmt.Errorf("revision requires 1 to 40 slides and exactly %d slides", expectedCount)
	}
	index, err := Index(source)
	if err != nil {
		return nil, err
	}
	p, err := openPackage(source)
	if err != nil {
		return nil, err
	}
	original := make(map[string][]byte, len(p.parts))
	for name, body := range p.parts {
		original[name] = body
	}
	presentation := original[presentationPart]
	root, err := parseXML(presentation)
	if err != nil {
		return nil, err
	}
	rels, err := parseRelationships(original[presentationRelsPart])
	if err != nil {
		return nil, err
	}
	relIDs := map[string]bool{}
	for _, rel := range rels {
		if rel.ID == "" || relIDs[rel.ID] || rel.Type == slideRelationshipType && rel.isExternal() {
			return nil, fmt.Errorf("invalid presentation relationship %q", rel.ID)
		}
		relIDs[rel.ID] = true
	}
	entries, err := slideEntries(presentation, rels)
	if err != nil {
		return nil, err
	}
	structural := len(entries) != len(plan.Slides)
	for i, slide := range plan.Slides {
		if slide.Clone || i >= len(entries) || slide.SourcePart != entries[i].part {
			structural = true
		}
	}
	if structural {
		var checkReferences func(*xmlNode) error
		checkReferences = func(node *xmlNode) error {
			if node.name.Local == "custShowLst" || node.name.Local == "sectionLst" {
				return fmt.Errorf("structural revision does not support presentation %s", node.name.Local)
			}
			for _, child := range node.children {
				if err := checkReferences(child); err != nil {
					return err
				}
			}
			return nil
		}
		if err := checkReferences(root); err != nil {
			return nil, err
		}
	}
	types, err := parseContentTypes(original[contentTypesPart])
	if err != nil {
		return nil, err
	}
	byPart := map[string]int{}
	maxID := uint64(firstSlideID - 1)
	usedIDs := map[uint64]bool{}
	list := root.find(presentationNamespace, "sldIdLst")
	for i, entry := range entries {
		if _, duplicate := byPart[entry.part]; duplicate {
			return nil, fmt.Errorf("original slide %s appears more than once", entry.part)
		}
		byPart[entry.part] = i
		id, err := strconv.ParseUint(attr(list.children[i], "id"), 10, 32)
		if err != nil || id < firstSlideID || id >= 1<<31 || usedIDs[id] {
			return nil, fmt.Errorf("invalid or duplicate original slide ID")
		}
		usedIDs[id] = true
		if id > maxID {
			maxID = id
		}
	}
	retained := map[string]bool{}
	finalIDs := map[string]bool{}
	var slideList strings.Builder
	// Keep list-scoped namespace declarations for the retained raw entries.
	slideList.Write(presentation[list.start:list.openEnd])
	operationCount := 0
	for position, revision := range plan.Slides {
		i, ok := byPart[revision.SourcePart]
		if !ok {
			return nil, fmt.Errorf("revision slide %d: unknown original source %q", position+1, revision.SourcePart)
		}
		donor := index.Slides[i]
		part := donor.Part
		body := original[part]
		if !revision.Clone {
			if retained[part] {
				return nil, fmt.Errorf("original slide %s retained more than once", part)
			}
			retained[part] = true
			node := list.children[i]
			slideList.Write(presentation[node.start:node.end])
			finalIDs[entries[i].relationshipID] = true
		} else {
			if err := validateRevisionDonor(p, donor.Part); err != nil {
				return nil, err
			}
			for number := 1; ; number++ {
				part = fmt.Sprintf("ppt/slides/revision%d.xml", number)
				_, occupied := p.parts[part]
				_, hasRels := p.parts[relsPartFor(part)]
				_, declared := types.overrideFor(part)
				if !occupied && !hasRels && !declared {
					break
				}
			}
			clonedRels, err := cloneOwnedParts(p, original, donor.Part, part, position+1, types)
			if err != nil {
				return nil, err
			}
			if len(clonedRels) > 0 {
				p.setPart(relsPartFor(part), clonedRels)
			}
			contentType, ok := types.overrideFor(donor.Part)
			if !ok {
				contentType = slideContentType
			}
			types.setOverride(part, contentType)
			id := nextRelationshipID(rels)
			rels = append(rels, relationship{ID: id, Type: slideRelationshipType, Target: "/" + part})
			finalIDs[id] = true
			maxID++
			if maxID >= 1<<31 {
				return nil, fmt.Errorf("no slide IDs available for clone")
			}
			fmt.Fprintf(&slideList, `<p:sldId xmlns:p="%s" xmlns:r="%s" id="%d" r:id="%s"/>`, presentationNamespace, relationshipNamespace, maxID, escapeAttribute(id))
		}
		seen := map[int]bool{}
		for _, op := range revision.Operations {
			operationCount++
			if operationCount > 2000 || op.ShapeID < 1 || seen[op.ShapeID] || len([]rune(op.Text)) > 10000 {
				return nil, fmt.Errorf("invalid or duplicate revision text operation")
			}
			seen[op.ShapeID] = true
			matches, shapes := 0, 0
			for _, object := range donor.Objects {
				if object.ShapeID == op.ShapeID {
					shapes++
					if object.Kind == "sp" && object.Text == op.ExpectedText {
						matches++
					}
				}
			}
			if matches != 1 || shapes != 1 {
				return nil, fmt.Errorf("revision conflict: source %s shape %d changed", donor.Part, op.ShapeID)
			}
			body, err = writeText(body, templatepublish.Slot{ShapeID: op.ShapeID}, strings.Split(op.Text, "\n"))
			if err != nil {
				return nil, err
			}
		}
		p.setPart(part, body)
	}
	slideList.Write(presentation[list.closeStart:list.end])
	start, end, err := slideListBounds(presentation)
	if err != nil {
		return nil, err
	}
	rewritten := append([]byte{}, presentation[:start]...)
	rewritten = append(rewritten, slideList.String()...)
	rewritten = append(rewritten, presentation[end:]...)
	p.setPart(presentationPart, rewritten)
	keptRels := make([]relationship, 0, len(rels))
	for _, rel := range rels {
		if rel.Type != slideRelationshipType || finalIDs[rel.ID] {
			keptRels = append(keptRels, rel)
		}
	}
	p.setPart(presentationRelsPart, marshalRelationships(keptRels))
	removed := map[string]bool{}
	candidates := map[string]bool{}
	for _, entry := range entries {
		if retained[entry.part] {
			continue
		}
		owned, err := ownedDescendants(p, entry.part)
		if err != nil {
			return nil, err
		}
		for name := range owned {
			candidates[name] = true
		}
		removed[entry.part] = true
	}
	// Keep owned graphs reachable from surviving parts, including cycles. Notes
	// pointing back to deleted slides must not keep those slides alive.
	var keep func(string) error
	keep = func(part string) error {
		relName := relsPartFor(part)
		if part == "" {
			relName = rootRelsPart
		}
		data, ok := p.part(relName)
		if !ok {
			return nil
		}
		items, err := parseRelationships(data)
		if err != nil {
			return err
		}
		for _, rel := range items {
			if rel.isExternal() {
				continue
			}
			target, err := resolveTarget(part, rel.Target)
			if err != nil {
				return err
			}
			if removed[target] {
				return fmt.Errorf("deletion leaves relationship from %s to removed slide %s", part, target)
			}
			if candidates[target] {
				delete(candidates, target)
				if err := keep(target); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, name := range p.partNames() {
		if !strings.HasSuffix(name, ".rels") {
			continue
		}
		part := sourcePartFor(name)
		if !removed[part] && !candidates[part] {
			if err := keep(part); err != nil {
				return nil, err
			}
		}
	}
	for name := range candidates {
		removed[name] = true
	}
	for name := range removed {
		p.removePart(name)
		p.removePart(relsPartFor(name))
		types.removeOverride(name)
	}
	p.setPart(contentTypesPart, types.marshal())
	if len(p.parts) > maxPackageParts {
		return nil, fmt.Errorf("revision exceeds the %d package part limit", maxPackageParts)
	}
	return p.bytes()
}

// Limit cloning to relationships whose ownership and XML references we can
// preserve. Charts, diagrams, embedded objects and extension payloads need more
// than copying their relationship graph, so they are not revision donors yet.
func validateRevisionDonor(p *pkg, donor string) error {
	var validate func(string, bool) error
	validate = func(part string, notes bool) error {
		body, err := p.mustPart(part)
		if err != nil {
			return err
		}
		root, err := parseXML(body)
		if err != nil {
			return err
		}
		var visit func(*xmlNode) error
		visit = func(node *xmlNode) error {
			switch node.name.Local {
			case "pic", "graphicFrame", "grpSp", "cxnSp", "oleObj", "control", "contentPart", "extLst", "AlternateContent":
				return fmt.Errorf("unsupported clone donor %s: %s", donor, node.name.Local)
			}
			for _, child := range node.children {
				if err := visit(child); err != nil {
					return err
				}
			}
			return nil
		}
		if err := visit(root); err != nil {
			return err
		}
		data, ok := p.part(relsPartFor(part))
		if !ok {
			return nil
		}
		rels, err := parseRelationships(data)
		if err != nil {
			return err
		}
		for _, rel := range rels {
			if rel.isExternal() {
				if rel.Type == relationshipNamespace+"/hyperlink" {
					continue
				}
				return fmt.Errorf("unsupported external clone relationship in %s", part)
			}
			target, err := resolveTarget(part, rel.Target)
			if err != nil {
				return err
			}
			if _, err := p.mustPart(target); err != nil {
				return err
			}
			switch rel.Type {
			case relationshipNamespace + "/slideLayout", relationshipNamespace + "/notesMaster", relationshipNamespace + "/image":
				if isOwnedPart(target) {
					return fmt.Errorf("unsupported shared clone target %s", target)
				}
			case relationshipNamespace + "/notesSlide":
				if notes || !strings.HasPrefix(target, "ppt/notesSlides/") {
					return fmt.Errorf("unsupported notes relationship in %s", part)
				}
				if err := validate(target, true); err != nil {
					return err
				}
			case slideRelationshipType:
				if !notes || target != donor {
					return fmt.Errorf("unsupported slide relationship in %s", part)
				}
			default:
				return fmt.Errorf("unsupported clone relationship %s in %s", rel.Type, part)
			}
		}
		return nil
	}
	return validate(donor, false)
}
