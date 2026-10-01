package stockimages

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestUnsplashCreditsAndRecordsEachUse(t *testing.T) {
	var authorization string
	var calls []string
	var server *httptest.Server
	photoJSON := func() string {
		return fmt.Sprintf(`{"id": "Ab_1", "width": 4000, "height": 2500, "alt_description": "battery racks",
			"urls": {"raw": "%[1]s/photo.png?ixid=x", "small": "%[1]s/small.png"},
			"links": {"html": "https://unsplash.com/photos/Ab_1", "download_location": "%[1]s/photos/Ab_1/download?ixid=x"},
			"user": {"name": "Ada", "links": {"html": "https://unsplash.com/@ada"}}}`, server.URL)
	}
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls = append(calls, request.URL.Path)
		switch request.URL.Path {
		case "/search/photos":
			authorization = request.Header.Get("Authorization")
			fmt.Fprintf(writer, `{"results": [%s]}`, photoJSON())
		case "/photos/Ab_1":
			fmt.Fprint(writer, photoJSON())
		case "/photos/Ab_1/download":
			fmt.Fprint(writer, `{"url": "ignored"}`)
		case "/photo.png":
			if request.URL.Query().Get("w") != "2400" || request.URL.Query().Get("ixid") != "x" {
				http.Error(writer, "unexpected size", http.StatusBadRequest)
				return
			}
			_, _ = writer.Write(photoPNG(t))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	unsplash := NewUnsplash("access-key", server.URL, []string{host.Host})
	ctx := context.Background()

	photos, err := unsplash.Search(ctx, "batteries", 8)
	if err != nil || len(photos) != 1 {
		t.Fatalf("photos = %+v, err = %v", photos, err)
	}
	if authorization != "Client-ID access-key" {
		t.Fatalf("authorization = %q", authorization)
	}
	photo := photos[0]
	if photo.Provider != "unsplash" || photo.ID != "Ab_1" || photo.Alt != "battery racks" || photo.License != "Unsplash License" {
		t.Fatalf("photo = %+v", photo)
	}
	if photo.PhotographerURL != "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral" {
		t.Fatalf("photographer link = %q", photo.PhotographerURL)
	}

	calls = nil
	if data, err := unsplash.Download(ctx, photo); err != nil || len(data) == 0 {
		t.Fatalf("download = %d bytes, err = %v", len(data), err)
	}
	if len(calls) != 2 || calls[0] != "/photos/Ab_1/download" {
		t.Fatalf("calls = %v, want the download endpoint before the file", calls)
	}

	if found, err := unsplash.Photo(ctx, "Ab_1"); err != nil || found.ID != "Ab_1" {
		t.Fatalf("lookup = %+v, err = %v", found, err)
	}
	if _, err := unsplash.Photo(ctx, "../users/me"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path in an ID error = %v", err)
	}
}

func TestUnsplashPhotoIsNotUsedWhenItsUseCannotBeRecorded(t *testing.T) {
	var fetched bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/photo.png" {
			fetched = true
		}
		writer.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	unsplash := NewUnsplash("key", server.URL, []string{host.Host})
	photo := Photo{download: server.URL + "/photo.png", track: server.URL + "/photos/a/download"}
	if _, err := unsplash.Download(context.Background(), photo); !errors.Is(err, ErrUnavailable) || fetched {
		t.Fatalf("error = %v, fetched = %v", err, fetched)
	}
}
