package carddocument

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/stockimages"
)

// maxExportImageBytes bounds the images one export embeds, so a request to
// the converter stays within what it accepts.
const maxExportImageBytes = 64 << 20

const pptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

// exportPptx sends the owner the current revision as an editable PowerPoint
// file.
func (handler Handler) exportPptx(writer http.ResponseWriter, request *http.Request) {
	presentationID, userID, ok := handler.owned(writer, request)
	if !ok {
		return
	}
	if handler.Converter == nil {
		writeError(writer, http.StatusServiceUnavailable, "Export is not available right now")
		return
	}
	ctx := request.Context()
	revision, err := CachedCurrentRevision(ctx, handler.DB, presentationID, userID, handler.Cache)
	switch {
	case errors.Is(err, ErrPresentationMissing):
		writeError(writer, http.StatusNotFound, "Presentation not found")
		return
	case errors.Is(err, ErrNoRevision):
		writeError(writer, http.StatusConflict, "This presentation has no saved document yet")
		return
	case err != nil:
		handler.fail(ctx, writer, "load card revision", err)
		return
	}
	document, err := Load(revision)
	if err != nil {
		handler.fail(ctx, writer, "load card document", err)
		return
	}
	ids, err := ReferencedAssets(document)
	if err != nil {
		handler.fail(ctx, writer, "read card document assets", err)
		return
	}
	stored, err := AssetsFor(ctx, handler.DB, presentationID, ids)
	if err != nil {
		handler.fail(ctx, writer, "load card document assets", err)
		return
	}
	assets := make(map[string]ExportAsset, len(stored))
	var total int64
	for id, asset := range stored {
		var data []byte
		if asset.URL != "" {
			data, asset.MIMEType, asset.Width, asset.Height, err = handler.readHotlink(request, asset)
			if err != nil {
				// The library is down or the photo was removed; the file
				// cannot be complete without it.
				slog.WarnContext(ctx, "fetch hotlinked photo for export", "asset", id, "error", err)
				writeError(writer, http.StatusBadGateway, "A photo in this presentation could not be fetched from its library. Try again shortly.")
				return
			}
		} else {
			data, err = handler.readAsset(request, asset)
		}
		if err != nil {
			handler.fail(ctx, writer, "read image for export", err)
			return
		}
		total += int64(len(data))
		if total > maxExportImageBytes {
			writeError(writer, http.StatusRequestEntityTooLarge, "This presentation's images are too large to export")
			return
		}
		assets[id] = ExportAsset{MIMEType: asset.MIMEType, Width: asset.Width, Height: asset.Height, Data: data, Source: asset.Source}
	}
	var encoded []byte
	if err := handler.DB.QueryRowContext(ctx, `SELECT COALESCE(slides_data->'sources', '[]'::jsonb) FROM presentations WHERE id = $1`, presentationID).Scan(&encoded); err != nil {
		handler.fail(ctx, writer, "load export sources", err)
		return
	}
	sources := []ExportSource{}
	_ = json.Unmarshal(encoded, &sources)

	file, issue, err := handler.Converter.Pptx(ctx, document, assets, sources)
	if err != nil {
		slog.ErrorContext(ctx, "export presentation", "error", err)
		writeError(writer, http.StatusBadGateway, "The presentation could not be exported. Try again.")
		return
	}
	if issue != nil {
		slog.ErrorContext(ctx, "export presentation refused", "issue", issue.String())
		writeError(writer, http.StatusUnprocessableEntity, "The presentation could not be exported")
		return
	}
	var titled struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal(document, &titled)
	writer.Header().Set("Content-Type", pptxContentType)
	writer.Header().Set("Content-Length", strconv.Itoa(len(file)))
	writer.Header().Set("Content-Disposition", contentDisposition(titled.Title))
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(file)
}

func (handler Handler) readAsset(request *http.Request, asset Asset) ([]byte, error) {
	if handler.Store == nil {
		return nil, fmt.Errorf("image storage is not configured")
	}
	reader, err := handler.Store.OpenObject(request.Context(), asset.ObjectKey)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, asset.ByteSize+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != asset.ByteSize {
		return nil, fmt.Errorf("image %s is %d bytes, expected %d", asset.SHA256, len(data), asset.ByteSize)
	}
	return data, nil
}

// readHotlink downloads a hotlinked photo into the export, normalized like a
// stored image. The download is not kept.
func (handler Handler) readHotlink(request *http.Request, asset Asset) ([]byte, string, int, int, error) {
	fetch := handler.FetchHotlink
	if fetch == nil {
		fetch = stockimages.FetchHotlink
	}
	data, err := fetch(request.Context(), asset.URL)
	if err != nil {
		return nil, "", 0, 0, err
	}
	return normalizeImage(request.Context(), data)
}

// contentDisposition names the download after the deck, with an ASCII
// fallback for clients that ignore the UTF-8 form.
func contentDisposition(title string) string {
	name := strings.Join(strings.FieldsFunc(title, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r) || strings.ContainsRune(`/\:*?"<>|`, r)
	}), " ")
	if name == "" {
		name = "Presentation"
	}
	if runes := []rune(name); len(runes) > 100 {
		name = strings.TrimSpace(string(runes[:100]))
	}
	fallback := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e {
			return '_'
		}
		return r
	}, name)
	return fmt.Sprintf(`attachment; filename="%s.pptx"; filename*=UTF-8''%s.pptx`, fallback, url.PathEscape(name))
}
