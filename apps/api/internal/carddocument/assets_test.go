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
	"testing"
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
