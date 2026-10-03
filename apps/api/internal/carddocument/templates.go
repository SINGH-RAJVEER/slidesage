package carddocument

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// templateDeck comes from the private converter's shared, curated catalog.
// Clients name a template, never a URL or an asset to trust.
type templateDeck struct {
	Document json.RawMessage `json:"document"`
	Assets   map[string]struct {
		URL    string      `json:"url"`
		Width  int         `json:"width"`
		Height int         `json:"height"`
		Source AssetSource `json:"source"`
	} `json:"assets"`
}

func (converter *Converter) template(ctx context.Context, id string) (templateDeck, error) {
	var deck templateDeck
	err := converter.do(ctx, http.MethodPost, "/v1/templates", map[string]string{"templateId": id}, &deck)
	return deck, err
}

func (handler Handler) loadTemplate(writer http.ResponseWriter, request *http.Request, presentationID string) (templateDeck, []Asset, bool) {
	if handler.Converter == nil {
		writeError(writer, http.StatusServiceUnavailable, "Templates are not available")
		return templateDeck{}, nil, false
	}
	deck, err := handler.Converter.template(request.Context(), request.PathValue("templateId"))
	if err != nil {
		var refused *ConverterError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			writeError(writer, http.StatusNotFound, "Template not found")
		} else {
			writeError(writer, http.StatusServiceUnavailable, "The template could not be loaded. Try again shortly.")
		}
		return templateDeck{}, nil, false
	}
	assets := make([]Asset, 0, len(deck.Assets))
	for id, sample := range deck.Assets {
		asset, err := RemoteAsset(presentationID, sample.URL, sample.Width, sample.Height, sample.Source)
		if err != nil || asset.SHA256 != id {
			handler.fail(request.Context(), writer, "validate template asset", fmt.Errorf("invalid asset %s", id))
			return templateDeck{}, nil, false
		}
		assets = append(assets, asset)
	}
	return deck, assets, true
}

// prepareTemplate registers its images before the editor can save the starter
// document. It does not replace any slides; the editor's normal revision save does.
func (handler Handler) prepareTemplate(writer http.ResponseWriter, request *http.Request) {
	id, ok := handler.ownedEditable(writer, request)
	if !ok {
		return
	}
	deck, assets, ok := handler.loadTemplate(writer, request, id)
	if !ok {
		return
	}
	tx, err := handler.DB.BeginTx(request.Context(), nil)
	if err != nil {
		handler.fail(request.Context(), writer, "begin template assets", err)
		return
	}
	defer tx.Rollback()
	if err = RecordAssetsTx(request.Context(), tx, assets); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		handler.fail(request.Context(), writer, "register template assets", err)
		return
	}
	byID := make(map[string]Asset, len(assets))
	for _, asset := range assets {
		byID[asset.SHA256] = asset
	}
	writeJSON(writer, http.StatusOK, map[string]any{"document": deck.Document, "assets": byID})
}

// createTemplate creates an editable deck without a model call or generation
// charge. The operation ID makes retries return the same presentation.
func (handler Handler) createTemplate(writer http.ResponseWriter, request *http.Request) {
	userID, err := handler.Identity(request)
	if err != nil || strings.TrimSpace(userID) == "" {
		writeError(writer, http.StatusUnauthorized, "Authentication required")
		return
	}
	var input struct {
		OperationID string `json:"operationId"`
	}
	if err := json.NewDecoder(io.LimitReader(request.Body, 4096)).Decode(&input); err != nil || !operationIDPattern.MatchString(input.OperationID) {
		writeError(writer, http.StatusBadRequest, "Request must name an operation ID")
		return
	}
	id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(userID+":"+request.PathValue("templateId")+":"+input.OperationID)).String()
	deck, assets, ok := handler.loadTemplate(writer, request, id)
	if !ok {
		return
	}
	revision, err := Prepare(PrepareInput{PresentationID: id, AuthorID: userID, OperationID: input.OperationID, OperationKind: OperationGeneration, Document: deck.Document, Provenance: map[string]string{"source": "template", "templateId": request.PathValue("templateId")}})
	if err != nil {
		handler.fail(request.Context(), writer, "prepare starter presentation", err)
		return
	}
	var shape struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal(deck.Document, &shape)
	summary, _ := json.Marshal(map[string]any{"status": "ready", "title": shape.Title, "totalSlides": revision.CardCount, "currentRevision": map[string]any{"revision": 1, "cardCount": revision.CardCount}})
	ctx := request.Context()
	tx, err := handler.DB.BeginTx(ctx, nil)
	if err != nil {
		handler.fail(ctx, writer, "begin starter presentation", err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $2, $3, '', $4::jsonb) ON CONFLICT (id) DO NOTHING`, id, userID, shape.Title, summary); err != nil {
		handler.fail(ctx, writer, "create starter presentation", err)
		return
	}
	if err = RecordAssetsTx(ctx, tx, assets); err != nil {
		handler.fail(ctx, writer, "record starter images", err)
		return
	}
	if _, err = CommitTx(ctx, tx, 0, revision); err != nil {
		handler.fail(ctx, writer, "commit starter presentation", err)
		return
	}
	if err = tx.Commit(); err != nil {
		handler.fail(ctx, writer, "save starter presentation", err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]string{"presentationId": id})
}
