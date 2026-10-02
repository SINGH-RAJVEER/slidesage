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
	// Data is the image to store. A hotlinked photo has none; it has a
	// Hotlink and the photo's size instead.
	Data          []byte
	Hotlink       string
	Width, Height int
	Alt           string
	Source        carddocument.AssetSource
}

// asset stores the image, or describes where it is hotlinked from.
func (found foundImage) asset(ctx context.Context, store carddocument.ObjectStore, presentationID string) (carddocument.Asset, error) {
	if found.Hotlink != "" {
		return carddocument.RemoteAsset(presentationID, found.Hotlink, found.Width, found.Height, found.Source)
	}
	return carddocument.PrepareAsset(ctx, store, presentationID, found.Data, found.Source)
}

// imageSource finds one image for a card. Stock photo libraries are the only
// implementation today; an AI image generator fits the same interface once it
// has per-image pricing in the quote and settlement.
type imageSource interface {
	Find(ctx context.Context, request imageRequest) (foundImage, error)
}

// stockSource picks the first suitable landscape photo for a query, trying
// each configured library in turn.
type stockSource struct {
	libraries []stockimages.Source
}

func stockSourceFromEnv() imageSource {
	libraries := stockimages.FromEnv()
	if len(libraries) == 0 {
		return nil
	}
	return stockSource{libraries: libraries}
}

func (source stockSource) Find(ctx context.Context, request imageRequest) (foundImage, error) {
	for _, library := range source.libraries {
		if image, err := findStock(ctx, library, request); err == nil {
			return image, nil
		}
	}
	return foundImage{}, errNoImage
}

func findStock(ctx context.Context, library stockimages.Source, request imageRequest) (foundImage, error) {
	photos, err := library.Search(ctx, request.Query, 8)
	if err != nil {
		// A rate limit or outage leaves the card without an image rather than
		// failing the deck.
		return foundImage{}, fmt.Errorf("%w: %v", errNoImage, err)
	}
	for _, photo := range photos {
		if photo.Width < 1200 || photo.Width < photo.Height {
			continue
		}
		data, err := library.Use(ctx, photo)
		if err != nil {
			continue
		}
		alt := photo.Alt
		if alt == "" {
			alt = strings.TrimSpace(request.Query)
		}
		return foundImage{
			Data: data, Hotlink: photo.Hotlink, Width: photo.Width, Height: photo.Height,
			Alt: truncate(alt, 200), Source: carddocument.StockSource(photo, request.Query),
		}, nil
	}
	return foundImage{}, errNoImage
}
