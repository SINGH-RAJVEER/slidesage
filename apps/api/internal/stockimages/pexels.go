// Package stockimages searches Pexels and downloads the photos it finds.
//
// The Pexels license permits downloading, copying, and modifying photos for
// commercial use. Pexels asks for credit to the photographer and to Pexels,
// which callers record with each stored photo and show beside it.
package stockimages

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

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/observability"
)

const (
	defaultAPIBase = "https://api.pexels.com"
	// MaxPhotoBytes bounds a download before it is decoded.
	MaxPhotoBytes = 15 << 20
)

var (
	// ErrNotFound means a search or lookup returned nothing usable.
	ErrNotFound = errors.New("no suitable photo was found")
	// ErrUnavailable means Pexels refused or failed the request, for example
	// because the hourly quota is spent.
	ErrUnavailable = errors.New("the photo service is unavailable")
)

// Photo is one Pexels photo.
type Photo struct {
	ID              int64  `json:"id"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	PageURL         string `json:"pageUrl"`
	Photographer    string `json:"photographer"`
	PhotographerURL string `json:"photographerUrl"`
	Alt             string `json:"alt"`
	// Thumbnail is a small Pexels-hosted preview for choosing a photo.
	Thumbnail string `json:"thumbnail"`
	download  string
}

// Pexels is a Pexels API client limited to allowlisted image hosts.
type Pexels struct {
	apiKey     string
	apiBase    string
	imageHosts map[string]bool
	client     *http.Client
}

// FromEnv returns nil when PEXELS_API_KEY is unset, which disables photos.
func FromEnv() *Pexels {
	key := strings.TrimSpace(os.Getenv("PEXELS_API_KEY"))
	if key == "" {
		return nil
	}
	base := strings.TrimSpace(os.Getenv("PEXELS_API_BASE"))
	if base == "" {
		base = defaultAPIBase
	}
	return New(key, base, []string{"images.pexels.com"})
}

func New(apiKey, apiBase string, imageHosts []string) *Pexels {
	hosts := map[string]bool{}
	for _, host := range imageHosts {
		hosts[host] = true
	}
	pexels := &Pexels{apiKey: apiKey, apiBase: strings.TrimRight(apiBase, "/"), imageHosts: hosts}
	pexels.client = &http.Client{
		Timeout:   20 * time.Second,
		Transport: observability.HTTPTransport(nil),
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 || !pexels.allowed(request.URL) {
				return fmt.Errorf("redirect to %s is not allowed", request.URL.Host)
			}
			return nil
		},
	}
	return pexels
}

// allowed accepts HTTPS on the image hosts and the API host. Plain HTTP is
// accepted only for a loopback API host, which is how tests stand in for Pexels.
func (pexels *Pexels) allowed(target *url.URL) bool {
	apiHost := ""
	if base, err := url.Parse(pexels.apiBase); err == nil {
		apiHost = base.Host
	}
	hostAllowed := pexels.imageHosts[target.Host] || target.Host == apiHost
	return hostAllowed && (target.Scheme == "https" || target.Scheme == "http" && target.Hostname() == "127.0.0.1")
}

type apiPhoto struct {
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

func (photo apiPhoto) photo() Photo {
	download := photo.Src.Large2x
	if download == "" {
		download = photo.Src.Large
	}
	return Photo{
		ID: photo.ID, Width: photo.Width, Height: photo.Height, PageURL: photo.URL,
		Photographer: photo.Photographer, PhotographerURL: photo.PhotographerURL,
		Alt: strings.TrimSpace(photo.Alt), Thumbnail: photo.Src.Medium, download: download,
	}
}

func (pexels *Pexels) get(ctx context.Context, path string, query url.Values, destination any) error {
	target := pexels.apiBase + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", pexels.apiKey)
	response, err := pexels.client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: Pexels returned %d", ErrUnavailable, response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(destination); err != nil {
		return fmt.Errorf("%w: unreadable Pexels response", ErrUnavailable)
	}
	return nil
}

// Search returns landscape photos for a query.
func (pexels *Pexels) Search(ctx context.Context, query string, perPage int) ([]Photo, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, ErrNotFound
	}
	var results struct {
		Photos []apiPhoto `json:"photos"`
	}
	values := url.Values{"query": {query}, "orientation": {"landscape"}, "size": {"medium"}, "per_page": {fmt.Sprint(perPage)}}
	if err := pexels.get(ctx, "/v1/search", values, &results); err != nil {
		return nil, err
	}
	photos := make([]Photo, 0, len(results.Photos))
	for _, photo := range results.Photos {
		photos = append(photos, photo.photo())
	}
	return photos, nil
}

// Photo looks up one photo by its Pexels ID, so a stored photo is always the
// one Pexels names, never a URL a client supplied.
func (pexels *Pexels) Photo(ctx context.Context, id int64) (Photo, error) {
	var photo apiPhoto
	if err := pexels.get(ctx, fmt.Sprintf("/v1/photos/%d", id), nil, &photo); err != nil {
		return Photo{}, err
	}
	if photo.ID != id {
		return Photo{}, ErrNotFound
	}
	return photo.photo(), nil
}

// Download fetches a photo's full-size file from an allowlisted host.
func (pexels *Pexels) Download(ctx context.Context, photo Photo) ([]byte, error) {
	target, err := url.Parse(photo.download)
	if err != nil || !pexels.allowed(target) {
		return nil, fmt.Errorf("photo host is not allowed: %s", photo.download)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := pexels.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("photo download returned %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxPhotoBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxPhotoBytes {
		return nil, errors.New("photo is too large")
	}
	return data, nil
}
