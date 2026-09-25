package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/observability"
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

const pexelsAPIBase = "https://api.pexels.com"

// pexelsSource searches Pexels and downloads the chosen photo. The Pexels
// license permits downloading, copying, and modifying photos for commercial
// use; attribution to the photographer and to Pexels is recorded with each
// asset and shown beside the image.
type pexelsSource struct {
	apiKey  string
	apiBase string
	// imageHosts are the only hosts photos may be downloaded from, including
	// after redirects.
	imageHosts map[string]bool
	client     *http.Client
}

func pexelsSourceFromEnv() imageSource {
	key := strings.TrimSpace(os.Getenv("PEXELS_API_KEY"))
	if key == "" {
		return nil
	}
	base := strings.TrimSpace(os.Getenv("PEXELS_API_BASE"))
	if base == "" {
		base = pexelsAPIBase
	}
	return newPexelsSource(key, base, []string{"images.pexels.com"})
}

func newPexelsSource(apiKey, apiBase string, imageHosts []string) *pexelsSource {
	hosts := map[string]bool{}
	for _, host := range imageHosts {
		hosts[host] = true
	}
	source := &pexelsSource{apiKey: apiKey, apiBase: strings.TrimRight(apiBase, "/"), imageHosts: hosts}
	source.client = &http.Client{
		Timeout:   20 * time.Second,
		Transport: observability.HTTPTransport(nil),
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 || !source.allowed(request.URL) {
				return fmt.Errorf("redirect to %s is not allowed", request.URL.Host)
			}
			return nil
		},
	}
	return source
}

func (source *pexelsSource) allowed(target *url.URL) bool {
	apiHost := ""
	if base, err := url.Parse(source.apiBase); err == nil {
		apiHost = base.Host
	}
	return (target.Scheme == "https" || target.Scheme == "http" && target.Hostname() == "127.0.0.1") &&
		(source.imageHosts[target.Host] || target.Host == apiHost)
}

type pexelsPhoto struct {
	ID              int64  `json:"id"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	URL             string `json:"url"`
	Photographer    string `json:"photographer"`
	PhotographerURL string `json:"photographer_url"`
	Alt             string `json:"alt"`
	Src             struct {
		Large2x string `json:"large2x"`
		Large   string `json:"large"`
	} `json:"src"`
}

func (source *pexelsSource) Find(ctx context.Context, request imageRequest) (foundImage, error) {
	query := strings.TrimSpace(request.Query)
	if query == "" {
		return foundImage{}, errNoImage
	}
	search := source.apiBase + "/v1/search?" + url.Values{
		"query":       {query},
		"orientation": {"landscape"},
		"size":        {"medium"},
		"per_page":    {"8"},
	}.Encode()
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, search, nil)
	if err != nil {
		return foundImage{}, err
	}
	httpRequest.Header.Set("Authorization", source.apiKey)
	response, err := source.client.Do(httpRequest)
	if err != nil {
		return foundImage{}, fmt.Errorf("search Pexels: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		// A rate limit or outage leaves the card without an image rather than
		// failing the deck.
		return foundImage{}, fmt.Errorf("%w: Pexels search returned %d", errNoImage, response.StatusCode)
	}
	var results struct {
		Photos []pexelsPhoto `json:"photos"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&results); err != nil {
		return foundImage{}, fmt.Errorf("%w: unreadable Pexels response", errNoImage)
	}
	for _, photo := range results.Photos {
		if photo.Width < 1200 || photo.Width < photo.Height {
			continue
		}
		link := photo.Src.Large2x
		if link == "" {
			link = photo.Src.Large
		}
		data, err := source.download(ctx, link)
		if err != nil {
			continue
		}
		alt := strings.TrimSpace(photo.Alt)
		if alt == "" {
			alt = query
		}
		return foundImage{
			Data: data,
			Alt:  truncate(alt, 200),
			Source: carddocument.AssetSource{
				Type:            "stock",
				Provider:        "pexels",
				ProviderID:      fmt.Sprint(photo.ID),
				Photographer:    photo.Photographer,
				PhotographerURL: photo.PhotographerURL,
				PageURL:         photo.URL,
				License:         "Pexels License",
				Query:           query,
			},
		}, nil
	}
	return foundImage{}, errNoImage
}

func (source *pexelsSource) download(ctx context.Context, link string) ([]byte, error) {
	target, err := url.Parse(link)
	if err != nil || !source.allowed(target) {
		return nil, fmt.Errorf("image host is not allowed: %s", link)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := source.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("image download returned %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, carddocument.MaxSourceImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > carddocument.MaxSourceImageBytes {
		return nil, errors.New("image is too large")
	}
	return data, nil
}
