package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/pptxcompiler"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentationrevision"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templateasset"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatemanifest"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatepublish"
)

const slotSystemPrompt = `Return one JSON object with title and slides. Every slide has position (one-based) and slots (values keyed by the exact manifest slot ID). Follow the supplied ordered assignments exactly. A text slot takes a string; a list slot takes an array of strings. maxCharacters applies per string and maxListItems limits array length. Required slots cannot be empty. Use null for optional images unless a supplied image asset provides verified base64 and mimeType; never invent image bytes or URLs. Omit optional slots only when the slide does not need them; omitted sample objects are cleared. No styling, coordinates, layouts, regions, CSS, or semantic slide blocks. Use research sources accurately and do not invent citations.`

const slotRepairPrompt = `Fix only what the validation error names and leave every other slot byte-identical to the previous slide. A length error means the copy is too long: rewrite that string to say the same thing in fewer words and count characters before returning it, staying at or under maxCharacters including spaces and punctuation. Do not pad short copy, do not drop required slots, and do not move content into a different slot. Return {"position":number,"slots":{...}}.`

func assignmentForJob(job streamJob) ([]pptxcompiler.Assignment, error) {
	if job.template == nil {
		return nil, fmt.Errorf("template is required")
	}
	// The worker resolves the template against the published catalog again
	// rather than trusting the reference the queue payload carries, so a job
	// can only ever compile from the package the catalog names for the ID the
	// user selected.
	resolved, err := resolveGenerationTemplate(job.template)
	if err != nil {
		return nil, err
	}
	if resolved != *job.template {
		return nil, fmt.Errorf("template %s is no longer published at the digest this job was queued with", job.template.ID)
	}
	return templateAssignments(resolved, job.slideCount)
}

// templateAssignments plans the slides for a reference the catalog has already
// resolved. Submission prices the reservation off the same plan the worker will
// draft from, so the points held and the bound sent to the provider describe one
// deck rather than two estimates of it.
func templateAssignments(reference presentation.TemplateReference, slideCount int) ([]pptxcompiler.Assignment, error) {
	m, err := templatemanifest.Lookup(reference.ID, reference.Version)
	if err != nil {
		return nil, err
	}
	if m.SHA256 != reference.SHA256 {
		return nil, fmt.Errorf("template manifest digest mismatch")
	}
	a, err := pptxcompiler.Assign(m, slideCount)
	if err != nil {
		return nil, err
	}
	return a, pptxcompiler.ValidateAssignments(a)
}

// slotBatchSize bounds how many slides one drafting call may produce. A whole
// deck in a single completion is a long stream, and the longer it runs the more
// exposure it has to an upstream stall part way through. Batching keeps each
// call short enough to finish, at the cost of repeating the system prompt. It
// is a var so tests can drive the batching path without a large deck.
var slotBatchSize = 4

// slotBatchPrompt tells the model the assignments it can see are a slice of a
// larger deck, so it returns those positions instead of renumbering from one.
const slotBatchPrompt = "\nThese assignments are one part of a larger deck. Return only the positions listed above, using their given position numbers."

// slotBytesPerToken converts a manifest character budget into a token bound.
// Slot IDs are opaque strings like "google-shape49p11-49" that tokenize close
// to three characters per token, well under the four a token of prose carries,
// so the denser figure is the safe one for a body that is largely keys.
const slotBytesPerToken = 3

// slotBudgetMarginPercent is applied to the manifest ceiling before it becomes a
// request bound. Copy over maxCharacters is rejected by ValidateSlide and
// rewritten by the repair pass, but only when the JSON carrying it arrived
// whole, so the bound sits above the ceiling rather than exactly on it.
const slotBudgetMarginPercent = 125

// slotOutputFloorTokens keeps a sparse assignment from being handed a bound too
// tight to restate the slide it is repairing.
const slotOutputFloorTokens = 512

// slotBudgetBytes is the largest JSON body the manifest permits for one slide:
// every slot filled to maxCharacters, every list run out to maxListItems, and
// the slot IDs and punctuation carrying them.
func slotBudgetBytes(archetype templatepublish.Archetype) int {
	// {"position":12,"slots":{}} and the separators around the entry.
	total := 40
	for _, slot := range archetype.Slots {
		items := slot.MaxListItems
		if items < 1 {
			items = 1
		}
		// The quoted key and colon, then the quotes and comma each value sits in.
		total += len(slot.ID) + 6 + items*(slot.MaxCharacters+4)
	}
	return total
}

// slotOutputTokens bounds a drafting or repair completion from the archetypes
// the slides are assigned to. A flat per-slide constant has to clear the densest
// template in the catalog and so overshoots a lean one several times over, and
// that bound is what a provider's affordability check refuses on and what a
// reservation holds, neither of which is refunded by the request being cheap.
func slotOutputTokens(assignments []pptxcompiler.Assignment) int {
	budget := 0
	for _, assignment := range assignments {
		budget += slotBudgetBytes(assignment.Archetype)
	}
	tokens := (budget*slotBudgetMarginPercent/100 + slotBytesPerToken - 1) / slotBytesPerToken
	if tokens < slotOutputFloorTokens {
		return slotOutputFloorTokens
	}
	if tokens > maxOutputCeilingTokens {
		return maxOutputCeilingTokens
	}
	return tokens
}

func (h *handler) generateSlots(ctx context.Context, job streamJob, assignments []pptxcompiler.Assignment) (string, []pptxcompiler.SlideContent, int, error) {
	plan, _ := json.Marshal(assignments)
	// Repair keeps the whole plan in view so a rewritten slide stays consistent
	// with its neighbours; only the drafting calls are split.
	user := generationUserPrompt(job) + "\nOrdered manifest assignments and limits: " + string(plan)

	title := ""
	tokens := 0
	byPosition := map[int]pptxcompiler.SlideContent{}
	duplicates := map[int]bool{}
	for start := 0; start < len(assignments); start += slotBatchSize {
		end := min(start+slotBatchSize, len(assignments))
		batch := assignments[start:end]
		batchUser := user
		if len(batch) != len(assignments) {
			batchPlan, _ := json.Marshal(batch)
			batchUser = generationUserPrompt(job) + "\nOrdered manifest assignments and limits: " + string(batchPlan) + slotBatchPrompt
		}
		document, used, err := h.generateJSON(ctx, job, "slot-draft", slotSystemPrompt, batchUser, slotOutputTokens(batch))
		tokens += used
		if err != nil {
			return "", nil, tokens, err
		}
		if title == "" {
			title = text(document["title"], "")
		}
		raw, _ := json.Marshal(document["slides"])
		var received []pptxcompiler.SlideContent
		_ = json.Unmarshal(raw, &received)
		for _, s := range received {
			if s.Position < 1 || s.Position > len(assignments) {
				return "", nil, tokens, fmt.Errorf("provider returned unexpected slide %d", s.Position)
			}
			if _, ok := byPosition[s.Position]; ok {
				duplicates[s.Position] = true
			}
			byPosition[s.Position] = s
		}
	}
	result := make([]pptxcompiler.SlideContent, len(assignments))
	for i, a := range assignments {
		content := byPosition[a.Position]
		issue := pptxcompiler.ValidateSlide(a, content)
		if duplicates[a.Position] {
			issue = fmt.Errorf("duplicate position")
		}
		for attempt := 0; issue != nil && attempt < 3; attempt++ {
			assignment, _ := json.Marshal(a)
			previous, _ := json.Marshal(content)
			repair, used, e := h.generateJSON(ctx, job, "slot-repair", slotSystemPrompt, user+"\nRepair only this slide: "+string(assignment)+"\nPrevious: "+string(previous)+"\nValidation error: "+issue.Error()+"\n"+slotRepairPrompt, slotOutputTokens([]pptxcompiler.Assignment{a}))
			tokens += used
			if e != nil {
				return "", nil, tokens, e
			}
			encoded, _ := json.Marshal(repair)
			content = pptxcompiler.SlideContent{}
			_ = json.Unmarshal(encoded, &content)
			issue = pptxcompiler.ValidateSlide(a, content)
		}
		if issue != nil {
			return "", nil, tokens, fmt.Errorf("slide %d: %w", i+1, issue)
		}
		result[i] = content
	}
	if title == "" {
		title = "Untitled Presentation"
	}
	return truncate(title, 255), result, tokens, nil
}

func (h *handler) compileJob(ctx context.Context, job streamJob) (presentationrevision.Revision, map[string]any, int, error) {
	var output []byte
	var title string
	var tokens int
	var err error
	input := presentationrevision.CommitInput{PresentationID: job.presentationID, AuthorID: job.userID, Operation: presentationrevision.SourceOperation{ID: job.operationID, Kind: presentationrevision.SourceOperationGeneration}, ExpectedSlideCount: job.slideCount, MIMEType: presentationrevision.PPTXContentType, CompilerVersion: pptxcompiler.Version}
	if job.kind == "iteration" {
		number := presentationrevision.RevisionNumber(job.pptxRevision)
		r, found, e := h.revisions.FindRevision(ctx, job.presentationID, number)
		if e != nil {
			return r, nil, 0, e
		}
		if !found {
			return r, nil, 0, presentationrevision.ErrRevisionConflict
		}
		object, e := h.objects.OpenObject(ctx, r.ObjectKey)
		if e != nil {
			return r, nil, 0, e
		}
		source, e := io.ReadAll(io.LimitReader(object, presentationrevision.DefaultMaxPPTXBytes+1))
		object.Close()
		if e != nil {
			return r, nil, 0, e
		}
		output, title, tokens, err = h.revisePPTX(ctx, job, source)
		input.Operation.Kind = presentationrevision.SourceOperationAIRevision
		input.ExpectedRevision = number
		input.BaseRevision = &number
	} else {
		assignments, e := assignmentForJob(job)
		if e != nil {
			return presentationrevision.Revision{}, nil, 0, e
		}
		source, e := h.templates.Fetch(ctx, templateasset.Asset{ID: job.template.ID, Version: job.template.Version, SHA256: job.template.SHA256})
		if e != nil {
			return presentationrevision.Revision{}, nil, 0, e
		}
		var content []pptxcompiler.SlideContent
		title, content, tokens, err = h.generateSlots(ctx, job, assignments)
		if err == nil {
			output, err = pptxcompiler.Compile(source, assignments, content)
		}
		input.TemplateID, input.TemplateVersion, input.TemplateSHA256 = job.template.ID, job.template.Version, job.template.SHA256
	}
	if err != nil {
		return presentationrevision.Revision{}, nil, tokens, err
	}
	if job.quote > 0 && tokens <= 0 {
		return presentationrevision.Revision{}, nil, tokens, fmt.Errorf("provider usage unavailable")
	}
	input.PPTX = bytes.NewReader(output)
	revision, err := presentationrevision.NewService(h.revisions, h.objects, 0).Prepare(ctx, input)
	document := map[string]any{"title": title, "status": "ready", "totalSlides": job.slideCount, "tokens_used": tokens}
	preserveJobTemplate(document, job)
	return revision, document, tokens, err
}

func (h *handler) configureDocuments(ctx context.Context) error {
	var err error
	h.templates, err = templateasset.NewCDNFetcherFromEnv()
	if err != nil {
		return err
	}
	h.objects, err = presentationrevision.NewGCSBlobStore(ctx, os.Getenv("PRESENTATION_GCS_BUCKET"))
	if err != nil {
		return err
	}
	h.revisions = presentationrevision.NewPostgresRepository(h.database)
	return nil
}

func (h *handler) revisePPTX(ctx context.Context, job streamJob, source []byte) ([]byte, string, int, error) {
	index, err := pptxcompiler.Index(source)
	if err != nil {
		return nil, "", 0, err
	}
	encoded, _ := json.Marshal(index)
	system := `Return one JSON object with title and operations. Each operation replaces text on the current revision: {"position":1,"shapeId":2,"expectedText":"exact indexed text","text":"replacement"}. Use only indexed text shapes, preserve all other objects and slide order. Do not return templates, slides, styling or geometry.`
	structural := job.slideCount != len(index.Slides)
	outputBudget := maxOutputTokens(job.slideCount)
	if structural {
		outputBudget *= 2
		system = `Return one JSON object with title and slides. slides is the complete final ordering, with exactly the requested target count. Each entry is {"sourcePart":"ppt/slides/slide1.xml","clone":false,"operations":[{"shapeId":2,"expectedText":"exact original indexed text","text":"replacement"}]}. sourcePart must name an original indexed slide part. Retain each original at most once with clone:false; originals omitted from the final list are deleted. clone:true copies an original donor and may repeat it. Clone only safe text-only slides, never slides with pictures, charts, tables, media, groups, or unsupported objects or relationships. Operations edit indexed text shapes on that entry using the original donor text, not earlier edits. Use empty operations for unaffected slides and preserve their content and relative order. When reducing the count, condense or merge the main points into retained slides by default rather than silently dropping content. Explicit user deletion instructions take precedence: delete the requested content instead of merging it back. When expanding, retain unaffected originals and clone suitable donors for added content. Never return templates, styling, geometry, or invented source parts.`
	}
	user := generationUserPrompt(job) + "\nUse a " + job.detailLevel + " level of detail and a " + job.tonality + " tone.\nCurrent revision index: " + string(encoded)
	var tokens int
	for attempt := 0; attempt < 2; attempt++ {
		promptName := "text-revision"
		if structural {
			promptName = "structural-revision"
		}
		response, used, e := h.generateJSON(ctx, job, promptName, system, user, outputBudget)
		tokens += used
		if e != nil {
			return nil, "", tokens, e
		}
		var output []byte
		if structural {
			raw, _ := json.Marshal(response["slides"])
			var plan pptxcompiler.RevisionPlan
			err = json.Unmarshal(raw, &plan.Slides)
			if err == nil {
				output, err = pptxcompiler.ApplyRevisionPlan(source, plan, job.slideCount)
			}
		} else {
			raw, _ := json.Marshal(response["operations"])
			var operations []pptxcompiler.TextOperation
			err = json.Unmarshal(raw, &operations)
			if err == nil {
				output, err = pptxcompiler.ApplyTextOperations(source, operations)
			}
		}
		if err == nil {
			return output, truncate(text(response["title"], "Untitled Presentation"), 255), tokens, nil
		}
		previous, _ := json.Marshal(response)
		user += "\nPrevious response: " + string(previous) + "\nRepair the response and return the complete JSON object. Validation error: " + err.Error()
	}
	return nil, "", tokens, err
}
