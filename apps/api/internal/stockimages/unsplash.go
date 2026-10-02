package stockimages

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

const (
	unsplashAPIBase = "https://api.unsplash.com"
	// unsplashReferral marks links back to Unsplash, as its guidelines ask.
	unsplashReferral = "utm_source=slidesage&utm_medium=referral"
)

var unsplashID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Unsplash searches the Unsplash library. Its photos are shown hotlinked
// from Unsplash's image servers, and a photo counts as used only when its
// download endpoint is called.
type Unsplash struct {
	client *client
}

// UnsplashFromEnv returns nil when UNSPLASH_ACCESS_KEY is unset.
func UnsplashFromEnv() *Unsplash {
	key := strings.TrimSpace(os.Getenv("UNSPLASH_ACCESS_KEY"))
	if key == "" {
		return nil
	}
	base := strings.TrimSpace(os.Getenv("UNSPLASH_API_BASE"))
	if base == "" {
		base = unsplashAPIBase
	}
	return NewUnsplash(key, base, []string{"images.unsplash.com"})
}

func NewUnsplash(accessKey, apiBase string, imageHosts []string) *Unsplash {
	authorize := func(request *http.Request) {
		request.Header.Set("Authorization", "Client-ID "+accessKey)
		request.Header.Set("Accept-Version", "v1")
	}
	return &Unsplash{client: newClient("Unsplash", strings.TrimRight(apiBase, "/"), imageHosts, authorize)}
}

func (*Unsplash) Name() string { return "unsplash" }

type unsplashPhoto struct {
	ID             string `json:"id"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	Description    string `json:"description"`
	AltDescription string `json:"alt_description"`
	URLs           struct {
		Raw   string `json:"raw"`
		Small string `json:"small"`
	} `json:"urls"`
	Links struct {
		HTML             string `json:"html"`
		DownloadLocation string `json:"download_location"`
	} `json:"links"`
	User struct {
		Name  string `json:"name"`
		Links struct {
			HTML string `json:"html"`
		} `json:"links"`
	} `json:"user"`
}

// referral adds Unsplash's referral parameters to a link back to it.
func referral(link string) string {
	if link == "" {
		return ""
	}
	if strings.Contains(link, "?") {
		return link + "&" + unsplashReferral
	}
	return link + "?" + unsplashReferral
}

// sized asks Unsplash's image service for a JPEG no wider than a slide needs.
// Unsplash allows these parameters on hotlinks.
func sized(raw string) string {
	target, err := url.Parse(raw)
	if err != nil || raw == "" {
		return ""
	}
	query := target.Query()
	query.Set("w", "2400")
	query.Set("fit", "max")
	query.Set("fm", "jpg")
	query.Set("q", "80")
	target.RawQuery = query.Encode()
	return target.String()
}

func (photo unsplashPhoto) photo() Photo {
	alt := strings.TrimSpace(photo.AltDescription)
	if alt == "" {
		alt = strings.TrimSpace(photo.Description)
	}
	return Photo{
		Provider: "unsplash", ID: photo.ID, Width: photo.Width, Height: photo.Height, PageURL: referral(photo.Links.HTML),
		Photographer: photo.User.Name, PhotographerURL: referral(photo.User.Links.HTML),
		Alt: alt, Thumbnail: photo.URLs.Small, License: "Unsplash License",
		Hotlink: sized(photo.URLs.Raw), track: photo.Links.DownloadLocation,
	}
}

func (unsplash *Unsplash) Search(ctx context.Context, query string, perPage int) ([]Photo, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, ErrNotFound
	}
	var results struct {
		Results []unsplashPhoto `json:"results"`
	}
	values := url.Values{"query": {query}, "orientation": {"landscape"}, "content_filter": {"high"}, "per_page": {fmt.Sprint(perPage)}}
	if err := unsplash.client.get(ctx, unsplash.client.endpoint("/search/photos", values), &results); err != nil {
		return nil, err
	}
	photos := make([]Photo, 0, len(results.Results))
	for _, photo := range results.Results {
		photos = append(photos, photo.photo())
	}
	return photos, nil
}

func (unsplash *Unsplash) Photo(ctx context.Context, id string) (Photo, error) {
	if !unsplashID.MatchString(id) {
		return Photo{}, ErrNotFound
	}
	var photo unsplashPhoto
	if err := unsplash.client.get(ctx, unsplash.client.endpoint("/photos/"+id, nil), &photo); err != nil {
		return Photo{}, err
	}
	if photo.ID != id {
		return Photo{}, ErrNotFound
	}
	return photo.photo(), nil
}

// Use records the use with Unsplash. A photo whose use cannot be recorded
// is not used. The photo is shown from its Hotlink, so no file is returned.
func (unsplash *Unsplash) Use(ctx context.Context, photo Photo) ([]byte, error) {
	if photo.track == "" {
		return nil, fmt.Errorf("%w: photo has no download endpoint", ErrUnavailable)
	}
	if err := unsplash.client.get(ctx, photo.track, nil); err != nil {
		return nil, err
	}
	return nil, nil
}
