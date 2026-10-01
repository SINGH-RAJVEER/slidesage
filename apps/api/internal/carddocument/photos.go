package carddocument

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// StockSource describes a stock photo for asset records and attribution.
func StockSource(photo stockimages.Photo, query string) AssetSource {
	return AssetSource{
		Type:            "stock",
		Provider:        photo.Provider,
		ProviderID:      photo.ID,
		Photographer:    photo.Photographer,
		PhotographerURL: photo.PhotographerURL,
		PageURL:         photo.PageURL,
		License:         photo.License,
		Query:           query,
	}
}

// stockSource returns the photo library a request names, or the first one
// configured when it names none.
func (handler Handler) stockSource(name string) stockimages.Source {
	for _, source := range handler.Stock {
		if name == "" || source.Name() == name {
			return source
		}
	}
	return nil
}

// ownedEditable reports whether the user owns a presentation that can take
// new content, writing the refusal when it cannot.
func (handler Handler) ownedEditable(writer http.ResponseWriter, request *http.Request) (string, bool) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return "", false
	}
	if handler.Store == nil {
		writeError(writer, http.StatusServiceUnavailable, "Presentation storage is not configured")
		return "", false
	}
	presentationID := request.PathValue("id")
	var status string
	err = handler.DB.QueryRowContext(request.Context(), `SELECT COALESCE(slides_data->>'status', '') FROM presentations WHERE id = $1 AND user_id = $2`, presentationID, userID).Scan(&status)
	if err != nil {
		writeError(writer, http.StatusNotFound, "Presentation not found")
		return "", false
	}
	if status != "ready" {
		writeError(writer, http.StatusConflict, "This presentation cannot be edited while it is generating or failed")
		return "", false
	}
	return presentationID, true
}

// recordAsset stores a prepared asset against its presentation, so the next
// save may show it.
func (handler Handler) recordAsset(ctx context.Context, asset Asset) error {
	tx, err := handler.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := RecordAssetsTx(ctx, tx, []Asset{asset}); err != nil {
		return err
	}
	return tx.Commit()
}

func (handler Handler) respondAsset(writer http.ResponseWriter, request *http.Request, asset Asset, alt string) {
	if err := handler.recordAsset(request.Context(), asset); err != nil {
		handler.fail(request.Context(), writer, "record image asset", err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"assetId": asset.SHA256, "asset": asset, "alt": alt})
}

// searchPhotos proxies a stock photo search so the API keys stay on the
// server. The response names every configured library so the picker can
// offer the others.
func (handler Handler) searchPhotos(writer http.ResponseWriter, request *http.Request) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return
	}
	source := handler.stockSource(request.URL.Query().Get("provider"))
	if source == nil {
		writeError(writer, http.StatusServiceUnavailable, "Photo search is not available")
		return
	}
	query := strings.TrimSpace(request.URL.Query().Get("q"))
	if query == "" || utf8.RuneCountInString(query) > 100 {
		writeError(writer, http.StatusBadRequest, "Search for 1-100 characters")
		return
	}
	photos, err := source.Search(request.Context(), query, 24)
	if errors.Is(err, stockimages.ErrUnavailable) {
		writeError(writer, http.StatusServiceUnavailable, "Photo search is unavailable right now. Try again shortly.")
		return
	}
	if err != nil && !errors.Is(err, stockimages.ErrNotFound) {
		handler.fail(request.Context(), writer, "search photos", err)
		return
	}
	if photos == nil {
		photos = []stockimages.Photo{}
	}
	providers := make([]string, 0, len(handler.Stock))
	for _, configured := range handler.Stock {
		providers = append(providers, configured.Name())
	}
	writeJSON(writer, http.StatusOK, map[string]any{"photos": photos, "provider": source.Name(), "providers": providers})
}

// addStockPhoto stores a stock photo named by its library and ID. The server looks the
// photo up itself, so a client can never make it download an arbitrary URL.
func (handler Handler) addStockPhoto(writer http.ResponseWriter, request *http.Request) {
	presentationID, ok := handler.ownedEditable(writer, request)
	if !ok {
		return
	}
	var input struct {
		Provider string `json:"provider"`
		PhotoID  string `json:"photoId"`
		Query    string `json:"query"`
	}
	if err := json.NewDecoder(io.LimitReader(request.Body, 4096)).Decode(&input); err != nil || input.Provider == "" || input.PhotoID == "" {
		writeError(writer, http.StatusBadRequest, "Request must name a photo")
		return
	}
	source := handler.stockSource(input.Provider)
	if source == nil {
		writeError(writer, http.StatusServiceUnavailable, "Photo search is not available")
		return
	}
	ctx := request.Context()
	photo, err := source.Photo(ctx, input.PhotoID)
	if errors.Is(err, stockimages.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "Photo not found")
		return
	}
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "The photo could not be fetched. Try again shortly.")
		return
	}
	data, err := source.Download(ctx, photo)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "The photo could not be fetched. Try again shortly.")
		return
	}
	query := strings.TrimSpace(input.Query)
	if utf8.RuneCountInString(query) > 100 {
		query = ""
	}
	asset, err := PrepareAsset(ctx, handler.Store, presentationID, data, StockSource(photo, query))
	if err != nil {
		handler.fail(ctx, writer, "store stock photo", err)
		return
	}
	alt := photo.Alt
	if alt == "" {
		alt = query
	}
	handler.respondAsset(writer, request, asset, alt)
}

// uploadPhoto stores an image the user uploaded. It is decoded and re-encoded
// like every other asset, so the stored file carries pixels and nothing else.
func (handler Handler) uploadPhoto(writer http.ResponseWriter, request *http.Request) {
	presentationID, ok := handler.ownedEditable(writer, request)
	if !ok {
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, MaxSourceImageBytes+64<<10)
	file, _, err := request.FormFile("file")
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Choose an image of at most 15 MB to upload")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxSourceImageBytes+1))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "The upload could not be read")
		return
	}
	asset, err := PrepareAsset(request.Context(), handler.Store, presentationID, data, AssetSource{Type: "upload"})
	if errors.Is(err, ErrUnsupportedImage) {
		writeError(writer, http.StatusUnprocessableEntity, "Upload a PNG, JPEG, WebP, or GIF image no larger than 12000 pixels on a side")
		return
	}
	if err != nil {
		handler.fail(request.Context(), writer, "store uploaded photo", err)
		return
	}
	handler.respondAsset(writer, request, asset, "")
}
