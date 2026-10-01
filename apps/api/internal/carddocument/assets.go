package carddocument

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"sort"
	"strings"

	// Registered for image.Decode.
	_ "image/gif"

	_ "golang.org/x/image/webp"
	"golang.org/x/sync/semaphore"
)

const (
	// MaxSourceImageBytes bounds an image before it is decoded.
	MaxSourceImageBytes = 15 << 20
	// maxSourcePixels bounds the decoded size, since a small file can declare
	// enormous dimensions.
	maxSourcePixels = 50_000_000
	maxSourceSide   = 12_000
	// maxStoredWidth is wide enough for a full-bleed card on a 2x display.
	maxStoredWidth = 2400
	jpegQuality    = 85
	// decodeBudgetBytes is the memory every image decode in one process may
	// hold at once. The API serves many requests from 512 MiB, so decodes
	// wait for each other here instead of exhausting the instance, and an
	// image that alone would need more is refused.
	decodeBudgetBytes = 192 << 20
)

var decodeBudget = semaphore.NewWeighted(decodeBudgetBytes)

var (
	ErrUnsupportedImage = errors.New("unsupported or oversized image")
	ErrUnknownAsset     = errors.New("document shows an image this presentation does not have")
)

// Asset is an image one presentation shows. Most are stored objects; a
// hotlinked photo has a URL on its library's servers instead.
type Asset struct {
	PresentationID string          `json:"-"`
	SHA256         string          `json:"-"`
	ObjectKey      string          `json:"-"`
	MIMEType       string          `json:"mimeType"`
	ByteSize       int64           `json:"byteSize"`
	Width          int             `json:"width"`
	Height         int             `json:"height"`
	Source         json.RawMessage `json:"source"`
	// URL is set for a hotlinked photo, which browsers load directly.
	URL string `json:"url,omitempty"`
}

// hotlinkPrefix is the only place a hotlinked photo may be shown from.
const hotlinkPrefix = "https://images.unsplash.com/"

// AssetSource records where an image came from.
type AssetSource struct {
	Type            string `json:"type"`
	Provider        string `json:"provider,omitempty"`
	ProviderID      string `json:"providerId,omitempty"`
	Photographer    string `json:"photographer,omitempty"`
	PhotographerURL string `json:"photographerUrl,omitempty"`
	PageURL         string `json:"pageUrl,omitempty"`
	License         string `json:"license,omitempty"`
	Query           string `json:"query,omitempty"`
}

// normalizeImage decodes an image within fixed bounds, shrinks it to the
// stored width, and re-encodes it. Re-encoding drops every byte the source
// carried besides pixels: EXIF, location, color profiles, and anything hidden.
// It waits for its share of the decode budget, or for ctx to end.
func normalizeImage(ctx context.Context, data []byte) ([]byte, string, int, int, error) {
	if len(data) == 0 || len(data) > MaxSourceImageBytes {
		return nil, "", 0, 0, fmt.Errorf("%w: %d bytes", ErrUnsupportedImage, len(data))
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("%w: %v", ErrUnsupportedImage, err)
	}
	if config.Width < 1 || config.Height < 1 || config.Width > maxSourceSide || config.Height > maxSourceSide ||
		config.Width*config.Height > maxSourcePixels {
		return nil, "", 0, 0, fmt.Errorf("%w: %dx%d", ErrUnsupportedImage, config.Width, config.Height)
	}
	width, height := storedSize(config.Width, config.Height)
	cost := decodeCost(data, format, config) + int64(width)*int64(height)*4
	if cost > decodeBudgetBytes {
		return nil, "", 0, 0, fmt.Errorf("%w: %dx%d %s needs %d MB to decode", ErrUnsupportedImage, config.Width, config.Height, format, cost>>20)
	}
	if err := decodeBudget.Acquire(ctx, cost); err != nil {
		return nil, "", 0, 0, err
	}
	defer decodeBudget.Release(cost)
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("%w: %v", ErrUnsupportedImage, err)
	}
	// A GIF's first frame may be smaller than its screen, never larger.
	width, height = storedSize(decoded.Bounds().Dx(), decoded.Bounds().Dy())
	opaque := isOpaque(decoded)
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	shrink(canvas, decoded)

	var out bytes.Buffer
	mimeType := "image/jpeg"
	if opaque {
		err = jpeg.Encode(&out, canvas, &jpeg.Options{Quality: jpegQuality})
	} else {
		mimeType = "image/png"
		err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, canvas)
	}
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("encode image: %w", err)
	}
	return out.Bytes(), mimeType, width, height, nil
}

// storedSize scales an image's size down to the stored width.
func storedSize(width, height int) (int, int) {
	if width > maxStoredWidth {
		return maxStoredWidth, max(1, height*maxStoredWidth/width)
	}
	return width, height
}

// decodeCost estimates the bytes decoding an image allocates: its pixels in
// the layout the decoder produces and, for a progressive JPEG, the
// coefficients it keeps until the last scan.
func decodeCost(data []byte, format string, config image.Config) int64 {
	pixels := float64(config.Width) * float64(config.Height)
	perPixel := 8.0
	switch format {
	case "jpeg":
		planes, progressive := jpegLayout(data)
		perPixel = planes
		if progressive {
			perPixel += planes * 4
		}
		if planes > 3 {
			// Four-component JPEGs are converted to a separate CMYK image.
			perPixel += 4
		}
	case "png":
		perPixel = 4
		if _, paletted := config.ColorModel.(color.Palette); paletted {
			perPixel = 1
			break
		}
		switch config.ColorModel {
		case color.GrayModel:
			perPixel = 1
		case color.Gray16Model:
			perPixel = 2
		case color.RGBA64Model, color.NRGBA64Model:
			perPixel = 8
		}
		// An interlaced PNG holds each pass beside the merged image; the
		// largest pass is half of it.
		if len(data) > 28 && data[28] == 1 {
			perPixel *= 1.5
		}
	case "gif":
		perPixel = 1
	case "webp":
		// Lossy WebP decodes to subsampled planes and an alpha plane. Lossless
		// decodes to packed pixels and then copies them to NRGBA.
		perPixel = 8
		if len(data) >= 16 && string(data[12:16]) == "VP8 " {
			perPixel = 3
		}
	}
	// Block and row padding, and the band shrink converts through.
	return int64(pixels*perPixel*1.1) + int64(config.Width)*shrinkBand*4
}

// jpegLayout reads a JPEG's frame header: the bytes per pixel its component
// planes take after chroma subsampling, and whether it is progressive. A
// header it cannot read is assumed the costliest kind.
func jpegLayout(data []byte) (float64, bool) {
	for at := 2; at+4 <= len(data) && data[at] == 0xFF; {
		marker := data[at+1]
		if marker == 0xFF {
			at++
			continue
		}
		length := int(data[at+2])<<8 | int(data[at+3])
		end := at + 2 + length
		if length < 2 || end > len(data) {
			break
		}
		// SOF0 to SOF2 are the frames the standard decoder reads.
		if marker >= 0xC0 && marker <= 0xC2 {
			frame := data[at+4 : end]
			if len(frame) < 6 {
				break
			}
			count := int(frame[5])
			if count < 1 || len(frame) < 6+3*count {
				break
			}
			widest, tallest := 1, 1
			for component := range count {
				sampling := frame[7+3*component]
				widest, tallest = max(widest, int(sampling>>4)), max(tallest, int(sampling&15))
			}
			planes := 0.0
			for component := range count {
				sampling := frame[7+3*component]
				planes += float64(int(sampling>>4)*int(sampling&15)) / float64(widest*tallest)
			}
			return planes, marker == 0xC2
		}
		at = end
	}
	return 4, true
}

func isOpaque(img image.Image) bool {
	if opaque, ok := img.(interface{ Opaque() bool }); ok {
		return opaque.Opaque()
	}
	return false
}

func assetObjectKey(presentationID, digest, mimeType string) string {
	extension := ".jpg"
	if mimeType == "image/png" {
		extension = ".png"
	}
	return "presentations/" + presentationID + "/assets/" + digest + extension
}

// PrepareAsset normalizes an image and uploads it as an immutable object. The
// asset still has to be recorded, with RecordAssetsTx, before a document may
// show it.
func PrepareAsset(ctx context.Context, store ObjectStore, presentationID string, data []byte, source AssetSource) (Asset, error) {
	if store == nil {
		return Asset{}, errors.New("card document storage is not configured")
	}
	normalized, mimeType, width, height, err := normalizeImage(ctx, data)
	if err != nil {
		return Asset{}, err
	}
	sum := sha256.Sum256(normalized)
	digest := hex.EncodeToString(sum[:])
	encodedSource, err := json.Marshal(source)
	if err != nil {
		return Asset{}, err
	}
	asset := Asset{
		PresentationID: presentationID,
		SHA256:         digest,
		ObjectKey:      assetObjectKey(presentationID, digest, mimeType),
		MIMEType:       mimeType,
		ByteSize:       int64(len(normalized)),
		Width:          width,
		Height:         height,
		Source:         encodedSource,
	}
	if err := store.PutImmutable(ctx, asset.ObjectKey, bytes.NewReader(normalized), asset.ByteSize, mimeType, digest); err != nil {
		return Asset{}, fmt.Errorf("store image: %w", err)
	}
	return asset, nil
}

// RemoteAsset describes a hotlinked photo. Its ID is a digest of the library
// and photo ID, so choosing the same photo again finds the same asset. The
// link asks for the photo at most maxStoredWidth wide, so the recorded size
// is scaled the same way.
func RemoteAsset(presentationID, link string, width, height int, source AssetSource) (Asset, error) {
	if !strings.HasPrefix(link, hotlinkPrefix) || source.Provider == "" || source.ProviderID == "" || width < 1 || height < 1 {
		return Asset{}, fmt.Errorf("%w: hotlinked photo %q", ErrUnsupportedImage, link)
	}
	if width > maxStoredWidth {
		height = max(1, height*maxStoredWidth/width)
		width = maxStoredWidth
	}
	encodedSource, err := json.Marshal(source)
	if err != nil {
		return Asset{}, err
	}
	sum := sha256.Sum256([]byte(source.Provider + ":" + source.ProviderID))
	return Asset{
		PresentationID: presentationID,
		SHA256:         hex.EncodeToString(sum[:]),
		MIMEType:       "image/jpeg",
		Width:          width,
		Height:         height,
		Source:         encodedSource,
		URL:            link,
	}, nil
}

// RecordAssetsTx records prepared assets. Recording the same image twice for a
// presentation is a no-op.
func RecordAssetsTx(ctx context.Context, tx *sql.Tx, assets []Asset) error {
	for _, asset := range assets {
		if _, err := tx.ExecContext(ctx, `INSERT INTO card_assets (presentation_id, sha256, object_key, mime_type, byte_size, width, height, source, remote_url)
			VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, 0), $6, $7, $8::jsonb, NULLIF($9, '')) ON CONFLICT (presentation_id, sha256) DO NOTHING`,
			asset.PresentationID, asset.SHA256, asset.ObjectKey, asset.MIMEType, asset.ByteSize, asset.Width, asset.Height, []byte(asset.Source), asset.URL); err != nil {
			return fmt.Errorf("record image asset: %w", err)
		}
	}
	return nil
}

type rowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// AssetsFor returns the recorded assets of a presentation, limited to ids.
func AssetsFor(ctx context.Context, database rowsQuerier, presentationID string, ids []string) (map[string]Asset, error) {
	assets := map[string]Asset{}
	if len(ids) == 0 {
		return assets, nil
	}
	rows, err := database.QueryContext(ctx, `SELECT sha256, COALESCE(object_key, ''), mime_type, COALESCE(byte_size, 0), width, height, source, COALESCE(remote_url, '')
		FROM card_assets WHERE presentation_id = $1 AND sha256 = ANY($2)`, presentationID, ids)
	if err != nil {
		return nil, fmt.Errorf("load image assets: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		asset := Asset{PresentationID: presentationID}
		var source []byte
		if err := rows.Scan(&asset.SHA256, &asset.ObjectKey, &asset.MIMEType, &asset.ByteSize, &asset.Width, &asset.Height, &source, &asset.URL); err != nil {
			return nil, err
		}
		asset.Source = append(json.RawMessage(nil), source...)
		assets[asset.SHA256] = asset
	}
	return assets, rows.Err()
}

// AssetIDsFor lists every asset recorded for a presentation.
func AssetIDsFor(ctx context.Context, database rowsQuerier, presentationID string) ([]string, error) {
	rows, err := database.QueryContext(ctx, `SELECT sha256 FROM card_assets WHERE presentation_id = $1 ORDER BY sha256`, presentationID)
	if err != nil {
		return nil, fmt.Errorf("list image assets: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ReferencedAssets lists the asset IDs a document's image nodes show.
func ReferencedAssets(document json.RawMessage) ([]string, error) {
	var shape struct {
		Cards map[string]struct {
			Nodes []struct {
				Type    string `json:"type"`
				AssetID string `json:"assetId"`
			} `json:"nodes"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(document, &shape); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	unique := map[string]bool{}
	for _, card := range shape.Cards {
		for _, node := range card.Nodes {
			if node.Type == "image" {
				unique[node.AssetID] = true
			}
		}
	}
	ids := make([]string, 0, len(unique))
	for id := range unique {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

// checkAssetsTx fails unless every asset the revision shows is recorded for
// its presentation.
func checkAssetsTx(ctx context.Context, tx *sql.Tx, revision Revision) error {
	if len(revision.AssetIDs) == 0 {
		return nil
	}
	var found int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM card_assets WHERE presentation_id = $1 AND sha256 = ANY($2)`,
		revision.PresentationID, revision.AssetIDs).Scan(&found); err != nil {
		return fmt.Errorf("check image assets: %w", err)
	}
	if found != len(revision.AssetIDs) {
		return ErrUnknownAsset
	}
	return nil
}
