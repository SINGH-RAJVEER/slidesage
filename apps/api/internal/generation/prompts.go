package generation

import (
	"errors"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/templatecatalog"
)

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
