package generation

import (
	"errors"
	"net/http"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatecatalog"
)

// The rules that decide which template a job compiles from.
//
// They live together because they answer one question from two directions: a
// generation names a template and has it resolved against the published
// catalog, an iteration inherits the one its deck was already compiled from.
// Neither ever substitutes a default, so a deck is built from the template the
// user chose or not at all.

// resolveGenerationTemplate pins a requested template to the published package
// behind it. The catalog is the only authority for a digest.
func resolveGenerationTemplate(reference *presentation.TemplateReference) (presentation.TemplateReference, error) {
	if reference == nil {
		return presentation.TemplateReference{}, errors.New("A PowerPoint template is required for generation")
	}
	entry, found := templatecatalog.Lookup(reference.ID, reference.Version)
	if !found {
		if templatecatalog.Empty() {
			return presentation.TemplateReference{}, errors.New("No PowerPoint template has been published yet")
		}
		return presentation.TemplateReference{}, errors.New("The selected PowerPoint template is not ready for generation")
	}
	// A digest arriving with a request is never trusted as the pin, but one
	// that disagrees with the published catalog means the caller is asking for
	// bytes this deployment does not serve, which is worth refusing rather than
	// silently compiling something else.
	if reference.SHA256 != "" && reference.SHA256 != entry.SHA256 {
		return presentation.TemplateReference{}, errors.New("The selected PowerPoint template does not match the published package")
	}
	return presentation.TemplateReference{ID: entry.ID, Version: entry.Version, SHA256: entry.SHA256}, nil
}

// requireRecordedTemplate refuses to revise a presentation whose stored
// document names no template.
//
// An iteration edits the deck in place and inherits the template it was
// compiled from, so a document with none recorded would have its template
// reference quietly dropped from the next revision. Refusing at submission
// keeps that from costing the user points to discover.
func requireRecordedTemplate(document []byte) error {
	if templateFromDocument(document) == nil {
		return writeStatusError{
			http.StatusConflict,
			"This presentation has no PowerPoint template recorded, so it cannot be revised",
		}
	}
	return nil
}
