package stockimages

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const pexelsAPIBase = "https://api.pexels.com"

// Pexels searches the Pexels library.
type Pexels struct {
	client *client
}

// PexelsFromEnv returns nil when PEXELS_API_KEY is unset.
func PexelsFromEnv() *Pexels {
	key := strings.TrimSpace(os.Getenv("PEXELS_API_KEY"))
	if key == "" {
		return nil
	}
	base := strings.TrimSpace(os.Getenv("PEXELS_API_BASE"))
	if base == "" {
		base = pexelsAPIBase
	}
	return NewPexels(key, base, []string{"images.pexels.com"})
}

func NewPexels(apiKey, apiBase string, imageHosts []string) *Pexels {
	authorize := func(request *http.Request) { request.Header.Set("Authorization", apiKey) }
	return &Pexels{client: newClient("Pexels", strings.TrimRight(apiBase, "/"), imageHosts, authorize)}
}

func (*Pexels) Name() string { return "pexels" }

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
		Medium  string `json:"medium"`
	} `json:"src"`
}

func (photo pexelsPhoto) photo() Photo {
	download := photo.Src.Large2x
	if download == "" {
		download = photo.Src.Large
	}
	return Photo{
		Provider: "pexels", ID: fmt.Sprint(photo.ID), Width: photo.Width, Height: photo.Height, PageURL: photo.URL,
		Photographer: photo.Photographer, PhotographerURL: photo.PhotographerURL,
		Alt: strings.TrimSpace(photo.Alt), Thumbnail: photo.Src.Medium, License: "Pexels License", download: download,
	}
}

func (pexels *Pexels) Search(ctx context.Context, query string, perPage int) ([]Photo, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, ErrNotFound
	}
	var results struct {
		Photos []pexelsPhoto `json:"photos"`
	}
	values := url.Values{"query": {query}, "orientation": {"landscape"}, "size": {"medium"}, "per_page": {fmt.Sprint(perPage)}}
	if err := pexels.client.get(ctx, pexels.client.endpoint("/v1/search", values), &results); err != nil {
		return nil, err
	}
	photos := make([]Photo, 0, len(results.Photos))
	for _, photo := range results.Photos {
		photos = append(photos, photo.photo())
	}
	return photos, nil
}

func (pexels *Pexels) Photo(ctx context.Context, id string) (Photo, error) {
	number, err := strconv.ParseInt(id, 10, 64)
	if err != nil || number < 1 {
		return Photo{}, ErrNotFound
	}
	var photo pexelsPhoto
	if err := pexels.client.get(ctx, pexels.client.endpoint(fmt.Sprintf("/v1/photos/%d", number), nil), &photo); err != nil {
		return Photo{}, err
	}
	if photo.ID != number {
		return Photo{}, ErrNotFound
	}
	return photo.photo(), nil
}

// Use downloads the photo; Pexels needs no other record of its use.
func (pexels *Pexels) Use(ctx context.Context, photo Photo) ([]byte, error) {
	return pexels.client.download(ctx, photo.download)
}
