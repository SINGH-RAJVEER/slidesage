package generation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// errNoImage means a source found nothing usable. The card falls back to a
// text layout rather than showing a placeholder.
var errNoImage = errors.New("no suitable image was found")

type imageRequest struct {
	// Query is a short visual description written by the planner.
	Query string
}

type foundImage struct {
	Data   []byte
	Alt    string
	Source carddocument.AssetSource
}

// imageSource finds one image for a card. Pexels stock photos are the only
// implementation today; an AI image generator fits the same interface once it
// has per-image pricing in the quote and settlement.
type imageSource interface {
	Find(ctx context.Context, request imageRequest) (foundImage, error)
}

// pexelsSource picks the first suitable landscape photo for a query.
type pexelsSource struct {
	pexels *stockimages.Pexels
}

func pexelsSourceFromEnv() imageSource {
	pexels := stockimages.FromEnv()
	if pexels == nil {
		return nil
	}
	return pexelsSource{pexels: pexels}
}

func (source pexelsSource) Find(ctx context.Context, request imageRequest) (foundImage, error) {
	photos, err := source.pexels.Search(ctx, request.Query, 8)
	if err != nil {
		// A rate limit or outage leaves the card without an image rather than
		// failing the deck.
		return foundImage{}, fmt.Errorf("%w: %v", errNoImage, err)
	}
	for _, photo := range photos {
		if photo.Width < 1200 || photo.Width < photo.Height {
			continue
		}
		data, err := source.pexels.Download(ctx, photo)
		if err != nil {
			continue
		}
		alt := photo.Alt
		if alt == "" {
			alt = strings.TrimSpace(request.Query)
		}
		return foundImage{Data: data, Alt: truncate(alt, 200), Source: carddocument.StockSource(photo, request.Query)}, nil
	}
	return foundImage{}, errNoImage
}
