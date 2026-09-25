package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/observability"
)

const schemaVersionHeader = "X-Card-Schema-Version"

// ConverterError is a failed request to the converter. A 5xx is temporary and
// worth retrying; a 4xx means this build and the converter disagree, which no
// retry fixes.
type ConverterError struct {
	Status  int
	Message string
}

func (err *ConverterError) Error() string {
	return fmt.Sprintf("card converter returned %d: %s", err.Status, err.Message)
}

func (err *ConverterError) Temporary() bool { return err.Status >= 500 }

// Issue is a schema violation the converter found, located by path.
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

func (issue Issue) String() string { return issue.Path + ": " + issue.Message }

// DraftInput is one model-drafted card with the plan entry it was drafted from.
type DraftInput struct {
	Position int             `json:"position"`
	Takeaway string          `json:"takeaway"`
	Role     string          `json:"role"`
	Draft    json.RawMessage `json:"draft"`
}

// CardResult is either a converted card or the issue that stopped it.
type CardResult struct {
	Position int             `json:"position"`
	Card     json.RawMessage `json:"card,omitempty"`
	Issue    *Issue          `json:"issue,omitempty"`
}

// Converter calls the private card conversion service. It is the schema
// authority: it shares its validation code with the browser editor.
type Converter struct {
	baseURL string
	client  *http.Client
}

// ConverterFromEnv returns nil when CARD_CONVERTER_URL is unset, which leaves
// card generation disabled.
func ConverterFromEnv() *Converter {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CARD_CONVERTER_URL")), "/")
	if baseURL == "" {
		return nil
	}
	return NewConverter(baseURL, &http.Client{Timeout: 20 * time.Second, Transport: observability.HTTPTransport(nil)})
}

func NewConverter(baseURL string, client *http.Client) *Converter {
	return &Converter{baseURL: strings.TrimRight(baseURL, "/"), client: client}
}

// Configured reports whether card generation can run in this process
// environment. The API uses it to decide whether to accept submissions that
// only the worker will draft.
func Configured() bool {
	return strings.TrimSpace(os.Getenv("CARD_CONVERTER_URL")) != "" && strings.TrimSpace(os.Getenv("PRESENTATION_GCS_BUCKET")) != ""
}

// Schema returns the drafting schema the prompts are built from.
func (converter *Converter) Schema(ctx context.Context) (json.RawMessage, error) {
	var schema json.RawMessage
	err := converter.do(ctx, http.MethodGet, "/v1/schema", nil, &schema)
	return schema, err
}

// ConvertCards validates drafted cards independently, so one invalid card is
// returned as an issue for targeted repair while the others convert.
func (converter *Converter) ConvertCards(ctx context.Context, operationID string, sourceIDs, assetIDs []string, cards []DraftInput) ([]CardResult, error) {
	if sourceIDs == nil {
		sourceIDs = []string{}
	}
	if assetIDs == nil {
		assetIDs = []string{}
	}
	var response struct {
		Results []CardResult `json:"results"`
	}
	err := converter.do(ctx, http.MethodPost, "/v1/cards", map[string]any{"operationId": operationID, "sourceIds": sourceIDs, "assetIds": assetIDs, "cards": cards}, &response)
	if err != nil {
		return nil, err
	}
	if len(response.Results) != len(cards) {
		return nil, &ConverterError{Status: http.StatusBadGateway, Message: fmt.Sprintf("returned %d results for %d cards", len(response.Results), len(cards))}
	}
	return response.Results, nil
}

// Assemble orders converted cards into a validated document. A document the
// schema refuses is reported as an Issue rather than an error.
func (converter *Converter) Assemble(ctx context.Context, title, theme string, cards []json.RawMessage, assetIDs []string) (json.RawMessage, *Issue, error) {
	if assetIDs == nil {
		assetIDs = []string{}
	}
	var response struct {
		Document json.RawMessage `json:"document"`
		Issue    *Issue          `json:"issue"`
	}
	err := converter.do(ctx, http.MethodPost, "/v1/documents", map[string]any{"title": title, "theme": theme, "cards": cards, "assetIds": assetIDs}, &response)
	var converterErr *ConverterError
	if errors.As(err, &converterErr) && converterErr.Status == http.StatusUnprocessableEntity {
		return nil, response.Issue, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return response.Document, nil, nil
}

func (converter *Converter) do(ctx context.Context, method, path string, body any, destination any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, converter.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set(schemaVersionHeader, strconv.Itoa(SchemaVersion))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := converter.client.Do(request)
	if err != nil {
		return fmt.Errorf("call card converter: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, MaxDocumentBytes*2))
	if err != nil {
		return fmt.Errorf("read card converter response: %w", err)
	}
	if response.StatusCode == http.StatusUnprocessableEntity {
		_ = json.Unmarshal(raw, destination)
		return &ConverterError{Status: response.StatusCode, Message: "document failed validation"}
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &failure)
		return &ConverterError{Status: response.StatusCode, Message: failure.Error}
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		return &ConverterError{Status: http.StatusBadGateway, Message: "response was not JSON"}
	}
	return nil
}
