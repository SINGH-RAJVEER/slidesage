// Package stockimages searches free stock photo libraries, Pexels and
// Unsplash, and downloads the photos they find.
//
// Both licenses permit using photos commercially and modifying them. Both ask
// for credit to the photographer and the library, which callers record with
// each stored photo and show beside it.
package stockimages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/observability"
)

// MaxPhotoBytes bounds a download before it is decoded.
const MaxPhotoBytes = 15 << 20

var (
	// ErrNotFound means a search or lookup returned nothing usable.
	ErrNotFound = errors.New("no suitable photo was found")
	// ErrUnavailable means the library refused or failed the request, for
	// example because the hourly quota is spent.
	ErrUnavailable = errors.New("the photo service is unavailable")
)

// Photo is one photo from a stock library.
type Photo struct {
	// Provider names the library the photo came from, such as "pexels".
	Provider        string `json:"provider"`
	ID              string `json:"id"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	PageURL         string `json:"pageUrl"`
	Photographer    string `json:"photographer"`
	PhotographerURL string `json:"photographerUrl"`
	Alt             string `json:"alt"`
	// Thumbnail is a small library-hosted preview for choosing a photo.
	Thumbnail string `json:"thumbnail"`
	License   string `json:"-"`
	download  string
	// track is a library URL to call when the photo is used.
	track string
}

// Source is one stock photo library.
type Source interface {
	// Name is the provider recorded with each photo, such as "pexels".
	Name() string
	// Search returns landscape photos for a query.
	Search(ctx context.Context, query string, perPage int) ([]Photo, error)
	// Photo looks up one photo by the library's ID, so a stored photo is
	// always the one the library names, never a URL a client supplied.
	Photo(ctx context.Context, id string) (Photo, error)
	// Download fetches a photo's full-size file for use on a card.
	Download(ctx context.Context, photo Photo) ([]byte, error)
}

// FromEnv returns the libraries with API keys set, Pexels first. None set
// disables photos.
func FromEnv() []Source {
	var sources []Source
	if pexels := PexelsFromEnv(); pexels != nil {
		sources = append(sources, pexels)
	}
	if unsplash := UnsplashFromEnv(); unsplash != nil {
		sources = append(sources, unsplash)
	}
	return sources
}

// client is an HTTP client limited to a library's API host and image hosts.
type client struct {
	apiBase    string
	imageHosts map[string]bool
	authorize  func(*http.Request)
	http       *http.Client
	name       string
}

func newClient(name, apiBase string, imageHosts []string, authorize func(*http.Request)) *client {
	hosts := map[string]bool{}
	for _, host := range imageHosts {
		hosts[host] = true
	}
	limited := &client{name: name, apiBase: apiBase, imageHosts: hosts, authorize: authorize}
	limited.http = &http.Client{
		Timeout:   20 * time.Second,
		Transport: observability.HTTPTransport(nil),
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 || !limited.allowed(request.URL) {
				return fmt.Errorf("redirect to %s is not allowed", request.URL.Host)
			}
			return nil
		},
	}
	return limited
}

// allowed accepts HTTPS on the image hosts and the API host. Plain HTTP is
// accepted only for a loopback API host, which is how tests stand in for a
// library.
func (limited *client) allowed(target *url.URL) bool {
	apiHost := ""
	if base, err := url.Parse(limited.apiBase); err == nil {
		apiHost = base.Host
	}
	hostAllowed := limited.imageHosts[target.Host] || target.Host == apiHost
	return hostAllowed && (target.Scheme == "https" || target.Scheme == "http" && target.Hostname() == "127.0.0.1")
}

// get calls an API URL, which may be a full URL the library returned, and
// decodes the JSON response.
func (limited *client) get(ctx context.Context, target string, destination any) error {
	parsed, err := url.Parse(target)
	if err != nil || !limited.allowed(parsed) {
		return fmt.Errorf("%w: API host is not allowed", ErrUnavailable)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	limited.authorize(request)
	response, err := limited.http.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: %s returned %d", ErrUnavailable, limited.name, response.StatusCode)
	}
	if destination == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(destination); err != nil {
		return fmt.Errorf("%w: unreadable %s response", ErrUnavailable, limited.name)
	}
	return nil
}

// endpoint joins an API path and query onto the API base.
func (limited *client) endpoint(path string, query url.Values) string {
	target := limited.apiBase + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	return target
}

// download fetches a photo file from an allowlisted host.
func (limited *client) download(ctx context.Context, photo Photo) ([]byte, error) {
	target, err := url.Parse(photo.download)
	if err != nil || !limited.allowed(target) {
		return nil, fmt.Errorf("photo host is not allowed: %s", photo.download)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := limited.http.Do(request)
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
