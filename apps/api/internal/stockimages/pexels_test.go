package stockimages

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func photoPNG(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewRGBA(image.Rect(0, 0, 16, 9))); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestSearchAndDownloadStayOnAllowedHosts(t *testing.T) {
	var authorization, query string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/search":
			authorization = request.Header.Get("Authorization")
			query = request.URL.Query().Get("query")
			fmt.Fprintf(writer, `{"photos": [
				{"id": 2, "width": 3000, "height": 2000, "src": {"large2x": "%[1]s/redirect.png"}},
				{"id": 3, "width": 3000, "height": 2000, "url": "https://www.pexels.com/photo/3", "photographer": "Ada",
					"photographer_url": "https://www.pexels.com/@ada", "alt": "Battery racks",
					"src": {"large2x": "%[1]s/photo.png", "medium": "%[1]s/thumb.png"}}]}`, server.URL)
		case "/v1/photos/3":
			fmt.Fprintf(writer, `{"id": 3, "width": 3000, "height": 2000, "src": {"large2x": "%s/photo.png"}}`, server.URL)
		case "/redirect.png":
			http.Redirect(writer, request, "http://example.com/elsewhere.png", http.StatusFound)
		case "/photo.png":
			_, _ = writer.Write(photoPNG(t))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	host, _ := url.Parse(server.URL)
	pexels := New("test-key", server.URL, []string{host.Host})
	ctx := context.Background()

	photos, err := pexels.Search(ctx, "battery warehouse", 8)
	if err != nil || len(photos) != 2 {
		t.Fatalf("photos = %+v, err = %v", photos, err)
	}
	if authorization != "test-key" || query != "battery warehouse" {
		t.Fatalf("authorization = %q, query = %q", authorization, query)
	}
	if photos[1].Photographer != "Ada" || photos[1].PageURL != "https://www.pexels.com/photo/3" || photos[1].Thumbnail != server.URL+"/thumb.png" {
		t.Fatalf("photo = %+v", photos[1])
	}
	if _, err := pexels.Download(ctx, photos[0]); err == nil {
		t.Fatal("a redirect off the allowed hosts was followed")
	}
	if data, err := pexels.Download(ctx, photos[1]); err != nil || len(data) == 0 {
		t.Fatalf("download = %d bytes, err = %v", len(data), err)
	}
	photo, err := pexels.Photo(ctx, 3)
	if err != nil || photo.ID != 3 {
		t.Fatalf("photo lookup = %+v, err = %v", photo, err)
	}
	if _, err := pexels.Photo(ctx, 4); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing photo error = %v", err)
	}
}

func TestRefusedRequestsAreUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	if _, err := New("key", server.URL, nil).Search(context.Background(), "anything", 8); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v", err)
	}
}

func TestDownloadRefusesHostsOutsideTheAllowlist(t *testing.T) {
	pexels := New("key", "https://api.pexels.com", []string{"images.pexels.com"})
	for _, link := range []string{"https://evil.test/a.jpg", "http://images.pexels.com/a.jpg", "file:///etc/passwd"} {
		if _, err := pexels.Download(context.Background(), Photo{download: link}); err == nil {
			t.Fatalf("%s was allowed", link)
		}
	}
}
