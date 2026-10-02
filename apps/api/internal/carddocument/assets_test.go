package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"runtime"
	"testing"
	"time"
)

func encodedPNG(t *testing.T, width, height int, alpha uint8) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 90, A: alpha})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestPrepareAssetShrinksAndReencodesPhotos(t *testing.T) {
	store := &memoryStore{}
	asset, err := PrepareAsset(context.Background(), store, "presentation-1", encodedPNG(t, 3000, 1500, 255), AssetSource{Type: "stock", Provider: "pexels"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.MIMEType != "image/jpeg" || asset.Width != 2400 || asset.Height != 1200 {
		t.Fatalf("asset = %+v", asset)
	}
	if asset.ObjectKey != "presentations/presentation-1/assets/"+asset.SHA256+".jpg" {
		t.Fatalf("object key = %s", asset.ObjectKey)
	}
	if _, err := jpeg.Decode(bytes.NewReader(store.objects[asset.ObjectKey])); err != nil {
		t.Fatalf("stored object is not a JPEG: %v", err)
	}
}

func TestPrepareAssetKeepsTransparencyAsPNG(t *testing.T) {
	asset, err := PrepareAsset(context.Background(), &memoryStore{}, "presentation-1", encodedPNG(t, 40, 30, 120), AssetSource{Type: "upload"})
	if err != nil || asset.MIMEType != "image/png" || asset.Width != 40 {
		t.Fatalf("asset = %+v, err = %v", asset, err)
	}
}

func TestPrepareAssetRefusesNonImagesAndHugeDimensions(t *testing.T) {
	for name, data := range map[string][]byte{
		"text":  []byte("<svg onload=alert(1)>"),
		"empty": nil,
		"wide":  encodedPNG(t, maxSourceSide+1, 1, 255),
	} {
		if _, err := PrepareAsset(context.Background(), &memoryStore{}, "p", data, AssetSource{}); !errors.Is(err, ErrUnsupportedImage) {
			t.Fatalf("%s: error = %v", name, err)
		}
	}
}

func TestReferencedAssetsListsImageNodes(t *testing.T) {
	a, b := string(bytes.Repeat([]byte("a"), 64)), string(bytes.Repeat([]byte("b"), 64))
	document := json.RawMessage(`{"cards": {
		"c_1": {"nodes": [{"type": "image", "assetId": "` + b + `"}, {"type": "heading"}]},
		"c_2": {"nodes": [{"type": "image", "assetId": "` + a + `"}, {"type": "image", "assetId": "` + b + `"}]}}}`)
	ids, err := ReferencedAssets(document)
	if err != nil || len(ids) != 2 || ids[0] != a || ids[1] != b {
		t.Fatalf("ids = %v, err = %v", ids, err)
	}
}

func TestCommitTxRefusesImagesThePresentationDoesNotHave(t *testing.T) {
	database := integrationDatabase(t)
	userID, presentationID := insertFixture(t, database)
	ctx := context.Background()
	store := &memoryStore{}
	asset, err := PrepareAsset(ctx, store, presentationID, encodedPNG(t, 64, 36, 255), AssetSource{Type: "stock"})
	if err != nil {
		t.Fatal(err)
	}
	document := json.RawMessage(`{"schemaVersion": 2, "title": "T", "theme": "slate", "cardOrder": ["c_aaaaaaaa"],
		"cards": {"c_aaaaaaaa": {"nodes": [{"type": "image", "assetId": "` + asset.SHA256 + `"}]}}}`)
	revision, err := Prepare(PrepareInput{PresentationID: presentationID, AuthorID: userID, OperationID: "op-" + presentationID, OperationKind: OperationGeneration, Document: document})
	if err != nil {
		t.Fatal(err)
	}
	commit := func(record bool) error {
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if record {
			if err := RecordAssetsTx(ctx, tx, []Asset{asset}); err != nil {
				return err
			}
		}
		if _, err := CommitTx(ctx, tx, 0, revision); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err := commit(false); !errors.Is(err, ErrUnknownAsset) {
		t.Fatalf("unrecorded asset error = %v", err)
	}
	if err := commit(true); err != nil {
		t.Fatalf("recorded asset error = %v", err)
	}
	assets, err := AssetsFor(ctx, database, presentationID, []string{asset.SHA256})
	if err != nil || assets[asset.SHA256].Width != 64 {
		t.Fatalf("assets = %+v, err = %v", assets, err)
	}
}

func TestShrinkAveragesTheAreaEachPixelCovers(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 9, 4))
	for y := range 4 {
		for x := range 9 {
			// Left third black, the rest white.
			value := uint8(255)
			if x < 3 {
				value = 0
			}
			src.Set(x, y, color.RGBA{R: value, G: value, B: value, A: 255})
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, 2, 3))
	shrink(dst, src)
	for y := range 3 {
		// The left pixel covers 4.5 columns, three of them black.
		if left, right := dst.RGBAAt(0, y), dst.RGBAAt(1, y); left.R != 85 || right.R != 255 || left.A != 255 || right.A != 255 {
			t.Fatalf("row %d = %v %v", y, left, right)
		}
	}
}

func TestNormalizeImageHoldsLittleBesidesTheDecodedPhoto(t *testing.T) {
	if testing.Short() {
		t.Skip("encodes a 24 megapixel photo")
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image.NewYCbCr(image.Rect(0, 0, 6000, 4000), image.YCbCrSubsampleRatio420), nil); err != nil {
		t.Fatal(err)
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_, _, width, height, err := normalizeImage(context.Background(), encoded.Bytes())
	runtime.ReadMemStats(&after)
	if err != nil || width != 2400 || height != 1600 {
		t.Fatalf("normalized = %dx%d, err = %v", width, height, err)
	}
	// 36 MB of decoded planes and a 15 MB canvas; a kernel scaler adds 300 MB.
	if allocated := (after.TotalAlloc - before.TotalAlloc) >> 20; allocated > 80 {
		t.Fatalf("normalizing allocated %d MB", allocated)
	}
}

func TestDecodeCostCountsSubsamplingAndProgressiveScans(t *testing.T) {
	var baseline bytes.Buffer
	if err := jpeg.Encode(&baseline, image.NewYCbCr(image.Rect(0, 0, 64, 32), image.YCbCrSubsampleRatio420), nil); err != nil {
		t.Fatal(err)
	}
	if planes, progressive := jpegLayout(baseline.Bytes()); planes != 1.5 || progressive {
		t.Fatalf("baseline 4:2:0 = %v planes, progressive %v", planes, progressive)
	}
	// A progressive 4:4:4 frame header: three full planes.
	header := []byte{0xFF, 0xD8, 0xFF, 0xC2, 0x00, 0x11, 0x08, 0x2E, 0xE0, 0x2E, 0xE0, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01}
	if planes, progressive := jpegLayout(header); planes != 3 || !progressive {
		t.Fatalf("progressive 4:4:4 = %v planes, progressive %v", planes, progressive)
	}
	if planes, progressive := jpegLayout([]byte{0xFF, 0xD8, 0x00}); planes != 4 || !progressive {
		t.Fatalf("unreadable header = %v planes, progressive %v", planes, progressive)
	}
	// Twelve thousand pixels square of progressive 4:4:4 would need gigabytes;
	// it is refused before anything is allocated.
	config := image.Config{Width: 12000, Height: 12000}
	if cost := decodeCost(header, "jpeg", config); cost <= decodeBudgetBytes {
		t.Fatalf("cost = %d", cost)
	}
}

func TestNormalizeImageWaitsForTheDecodeBudget(t *testing.T) {
	if err := decodeBudget.Acquire(context.Background(), decodeBudgetBytes); err != nil {
		t.Fatal(err)
	}
	defer decodeBudget.Release(decodeBudgetBytes)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, _, _, _, err := normalizeImage(ctx, encodedPNG(t, 40, 30, 255)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error while the budget is spent = %v", err)
	}
}

func TestDecodeCostCountsInterlacedPNGPasses(t *testing.T) {
	data := encodedPNG(t, 4, 4, 255)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	plain := decodeCost(data, format, config)
	interlaced := append([]byte(nil), data...)
	interlaced[28] = 1
	if cost := decodeCost(interlaced, format, config); cost <= plain {
		t.Fatalf("interlaced cost %d, plain %d", cost, plain)
	}
}
