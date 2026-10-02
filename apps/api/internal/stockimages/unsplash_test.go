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

	hotlink, _ := url.Parse(photo.Hotlink)
	if hotlink.Path != "/photo.png" || hotlink.Query().Get("w") != "2400" || hotlink.Query().Get("ixid") != "x" {
		t.Fatalf("hotlink = %q", photo.Hotlink)
	}

	calls = nil
	if data, err := unsplash.Use(ctx, photo); err != nil || data != nil {
		t.Fatalf("use = %d bytes, err = %v; a hotlinked photo is not downloaded", len(data), err)
	}
	if len(calls) != 1 || calls[0] != "/photos/Ab_1/download" {
		t.Fatalf("calls = %v, want only the download endpoint", calls)
	}

	if found, err := unsplash.Photo(ctx, "Ab_1"); err != nil || found.ID != "Ab_1" {
		t.Fatalf("lookup = %+v, err = %v", found, err)
	}
	if _, err := unsplash.Photo(ctx, "../users/me"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path in an ID error = %v", err)
	}
}

func TestUnsplashPhotoIsNotUsedWhenItsUseCannotBeRecorded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	unsplash := NewUnsplash("key", server.URL, []string{host.Host})
	photo := Photo{Hotlink: "https://images.unsplash.com/photo-1", track: server.URL + "/photos/a/download"}
	if _, err := unsplash.Use(context.Background(), photo); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v", err)
	}
}

func TestFetchHotlinkStaysOnUnsplashImageHosts(t *testing.T) {
	for _, link := range []string{"https://evil.test/a.jpg", "http://images.unsplash.com/a.jpg", "https://images.pexels.com/a.jpg"} {
		if _, err := FetchHotlink(context.Background(), link); err == nil {
			t.Fatalf("%s was allowed", link)
		}
	}
}

func TestFromEnvUsesOnlyUnsplash(t *testing.T) {
	t.Setenv("PEXELS_API_KEY", "retired-key")
	t.Setenv("UNSPLASH_ACCESS_KEY", "")
	if sources := FromEnv(); len(sources) != 0 {
		t.Fatalf("sources without an Unsplash key = %v", sources)
	}
	t.Setenv("UNSPLASH_ACCESS_KEY", "access-key")
	sources := FromEnv()
	if len(sources) != 1 || sources[0].Name() != "unsplash" {
		t.Fatalf("sources = %v, want only Unsplash", sources)
	}
}
