// Package cardconverter serves the private card converter: validation, draft
// conversion, assembly, templates, and PPTX export. It answers the requests
// the Bun converter in apps/converter answers, with the same statuses and
// JSON bytes, so callers can use either.
package cardconverter

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/pptx"
)

const (
	// maxBodyBytes refuses requests larger than this before parsing.
	maxBodyBytes = 1024 * 1024
	// maxExportBodyBytes allows an export to carry the deck's images.
	maxExportBodyBytes = 96 * 1024 * 1024
	// maxServerBodyBytes is where Bun's server refuses a body by itself.
	maxServerBodyBytes = 128 * 1024 * 1024
)

const pptxType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

// SchemaVersionHeader names the schema version a caller was built against.
const SchemaVersionHeader = "X-Card-Schema-Version"

type requestError struct {
	status  int
	message string
}

func (err *requestError) Error() string { return err.message }

// response is a status, headers, and body ready to send.
type response struct {
	status      int
	contentType string
	body        []byte
}

func jsonResponse(status int, body jsvalue.Value) response {
	return response{status: status, contentType: "application/json;charset=utf-8", body: jsvalue.Stringify(body)}
}

type member = jsvalue.Member

func object(members ...member) jsvalue.Value { return jsvalue.ObjectValue(members...) }

func str(value string) jsvalue.Value { return jsvalue.StringValue(value) }

func number(value float64) jsvalue.Value { return jsvalue.NumberValue(value) }

func errorBody(message string) jsvalue.Value {
	return object(member{Key: "error", Value: str(message)})
}

// Handler serves the converter routes.
type Handler struct {
	Logger *slog.Logger
}

// ServeHTTP routes one request. Every conversion request names the schema
// version its caller was built against; a mismatch is refused rather than
// converted into a document the caller cannot read.
func (handler Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.ContentLength > maxServerBodyBytes {
		writer.Header().Set("Connection", "close")
		writer.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	result := handler.handle(request)
	headers := writer.Header()
	if result.contentType != "" {
		headers.Set("Content-Type", result.contentType)
	}
	headers.Set("Content-Length", strconv.Itoa(len(result.body)))
	writer.WriteHeader(result.status)
	if request.Method != http.MethodHead {
		_, _ = writer.Write(result.body)
	}
}

func (handler Handler) handle(request *http.Request) (result response) {
	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		handler.logger().Error("card conversion failed", "error", fmt.Sprint(recovered))
		result = jsonResponse(http.StatusInternalServerError, errorBody("conversion failed"))
	}()
	// The raw target keeps percent escapes and backslashes, which the URL
	// parser in front of the Bun handler treats in its own way.
	path := pathname(rawPath(request.RequestURI))
	result, err := handler.route(request, path)
	if err == nil {
		return result
	}
	var failure *requestError
	if errors.As(err, &failure) {
		return jsonResponse(failure.status, errorBody(failure.message))
	}
	handler.logger().Error("card conversion failed", "error", err)
	return jsonResponse(http.StatusInternalServerError, errorBody("conversion failed"))
}

func (handler Handler) logger() *slog.Logger {
	if handler.Logger != nil {
		return handler.Logger
	}
	return slog.Default()
}

type route func(request *http.Request) (response, error)

func (handler Handler) route(request *http.Request, path string) (response, error) {
	if request.Method == http.MethodGet && path == "/health" {
		return jsonResponse(http.StatusOK, object(member{Key: "status", Value: str("ok")}, member{Key: "schemaVersion", Value: number(cards.SchemaVersion)})), nil
	}
	if request.Method == http.MethodGet && path == "/v1/schema" {
		return jsonResponse(http.StatusOK, cards.DraftingSchema()), nil
	}
	if request.Method != http.MethodPost {
		return jsonResponse(http.StatusNotFound, errorBody("not found")), nil
	}
	routes := map[string]route{
		"/v1/cards":              convert,
		"/v1/templates":          templateDeck,
		"/v1/documents":          assemble,
		"/v1/documents/validate": validateDocument,
		"/v1/documents/drafts":   drafts,
		"/v1/documents/pptx":     exportPptx,
	}
	handle, ok := routes[path]
	if !ok {
		return jsonResponse(http.StatusNotFound, errorBody("not found")), nil
	}
	values := request.Header.Values(SchemaVersionHeader)
	version := latin1(strings.Join(values, ", "))
	if values == nil || version != strconv.Itoa(cards.SchemaVersion) {
		shown := version
		if values == nil {
			shown = "(missing)"
		}
		return jsonResponse(http.StatusConflict, errorBody(fmt.Sprintf("schema version %s is not served; this converter serves %d", shown, cards.SchemaVersion))), nil
	}
	return handle(request)
}

// latin1 reads header bytes as the ByteString a Fetch Headers object holds.
func latin1(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		builder.WriteRune(rune(value[index]))
	}
	return builder.String()
}

// rawPath is the path of a request target before the query.
func rawPath(target string) string {
	if index := strings.IndexAny(target, "?#"); index >= 0 {
		target = target[:index]
	}
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		rest := target[strings.Index(target, "//")+2:]
		if slash := strings.IndexByte(rest, '/'); slash >= 0 {
			return rest[slash:]
		}
		return "/"
	}
	return target
}

// pathname resolves a request path as the URL parser behind request.url
// does for an http URL: backslashes are slashes, and dot segments, including
// percent-encoded dots, are removed.
func pathname(path string) string {
	path = strings.ReplaceAll(path, `\`, "/")
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	var output []string
	for index, segment := range segments {
		last := index == len(segments)-1
		switch strings.ToLower(segment) {
		case "..", ".%2e", "%2e.", "%2e%2e":
			if len(output) > 0 {
				output = output[:len(output)-1]
			}
			if last {
				output = append(output, "")
			}
		case ".", "%2e":
			if last {
				output = append(output, "")
			}
		default:
			output = append(output, segment)
		}
	}
	return "/" + strings.Join(output, "/")
}

// readBody reads a JSON object body. The limit applies to the declared length
// and to the decoded text's UTF-16 length, as the Bun converter checks it.
func readBody(request *http.Request, limit int) (*jsvalue.Obj, error) {
	if request.ContentLength > int64(limit) {
		return nil, &requestError{http.StatusRequestEntityTooLarge, "request body is too large"}
	}
	// A body of more than three bytes per allowed code unit cannot decode to
	// fewer units than the limit, so reading stops there.
	raw, err := io.ReadAll(io.LimitReader(request.Body, int64(limit)*3+4))
	if err != nil {
		return nil, err
	}
	text := decodeUTF8(raw)
	if jsvalue.Length(text) > limit {
		return nil, &requestError{http.StatusRequestEntityTooLarge, "request body is too large"}
	}
	body, err := jsvalue.Parse(text)
	if err != nil {
		return nil, &requestError{http.StatusBadRequest, "request body is not JSON"}
	}
	if !body.IsObject() {
		return nil, &requestError{http.StatusBadRequest, "request body must be an object"}
	}
	return body.Object(), nil
}

// decodeUTF8 is the Encoding Standard's UTF-8 decode: a leading byte order
// mark is dropped and each maximal invalid subpart becomes U+FFFD.
func decodeUTF8(raw []byte) string {
	if len(raw) >= 3 && raw[0] == 0xef && raw[1] == 0xbb && raw[2] == 0xbf {
		raw = raw[3:]
	}
	if utf8.Valid(raw) {
		return string(raw)
	}
	var builder strings.Builder
	builder.Grow(len(raw))
	needed, seen := 0, 0
	var codePoint rune
	lower, upper := byte(0x80), byte(0xbf)
	for index := 0; index < len(raw); index++ {
		value := raw[index]
		if needed == 0 {
			switch {
			case value <= 0x7f:
				builder.WriteByte(value)
			case value >= 0xc2 && value <= 0xdf:
				needed, codePoint = 1, rune(value&0x1f)
			case value >= 0xe0 && value <= 0xef:
				if value == 0xe0 {
					lower = 0xa0
				}
				if value == 0xed {
					upper = 0x9f
				}
				needed, codePoint = 2, rune(value&0xf)
			case value >= 0xf0 && value <= 0xf4:
				if value == 0xf0 {
					lower = 0x90
				}
				if value == 0xf4 {
					upper = 0x8f
				}
				needed, codePoint = 3, rune(value&0x7)
			default:
				builder.WriteRune(utf8.RuneError)
			}
			continue
		}
		if value < lower || value > upper {
			needed, seen, codePoint = 0, 0, 0
			lower, upper = 0x80, 0xbf
			builder.WriteRune(utf8.RuneError)
			index--
			continue
		}
		lower, upper = 0x80, 0xbf
		codePoint = codePoint<<6 | rune(value&0x3f)
		seen++
		if seen == needed {
			builder.WriteRune(codePoint)
			needed, seen, codePoint = 0, 0, 0
		}
	}
	if needed != 0 {
		builder.WriteRune(utf8.RuneError)
	}
	return builder.String()
}

func requireString(value jsvalue.Value, field string) (string, error) {
	if !value.IsString() || jsvalue.IsBlank(value.Str()) {
		return "", &requestError{http.StatusBadRequest, field + " must be a non-empty string"}
	}
	return value.Str(), nil
}

func requireArray(value jsvalue.Value, field string) ([]jsvalue.Value, error) {
	if !value.IsArray() {
		return nil, &requestError{http.StatusBadRequest, field + " must be an array"}
	}
	return value.Items(), nil
}

// orEmpty is `value ?? []`.
func orEmpty(value jsvalue.Value) jsvalue.Value {
	if value.IsNullish() {
		return jsvalue.ArrayValue(nil)
	}
	return value
}

func stringList(value jsvalue.Value, field string) ([]string, error) {
	items, err := requireArray(orEmpty(value), field)
	if err != nil {
		return nil, err
	}
	result := make([]string, len(items))
	for index, item := range items {
		if result[index], err = requireString(item, fmt.Sprintf("%s[%d]", field, index)); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func draftInputs(value jsvalue.Value) ([]cards.DraftInput, error) {
	items, err := requireArray(value, "cards")
	if err != nil {
		return nil, err
	}
	inputs := make([]cards.DraftInput, len(items))
	for index, raw := range items {
		if !raw.IsObject() && !raw.IsArray() {
			return nil, &requestError{http.StatusBadRequest, fmt.Sprintf("cards[%d] must be an object", index)}
		}
		position := raw.Get("position")
		if !position.IsNumber() || !jsvalue.IsInteger(position.Number()) || position.Number() < 1 {
			return nil, &requestError{http.StatusBadRequest, fmt.Sprintf("cards[%d].position must be a positive integer", index)}
		}
		role := raw.Get("role")
		if !role.IsString() || !contains(cards.NarrativeRoles, role.Str()) {
			return nil, &requestError{http.StatusBadRequest, fmt.Sprintf("cards[%d].role is not a narrative role", index)}
		}
		takeaway, err := requireString(raw.Get("takeaway"), fmt.Sprintf("cards[%d].takeaway", index))
		if err != nil {
			return nil, err
		}
		inputs[index] = cards.DraftInput{Position: position.Number(), Takeaway: takeaway, Role: role.Str(), Draft: raw.Get("draft")}
	}
	return inputs, nil
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func schemaVersion() member { return member{Key: "schemaVersion", Value: number(cards.SchemaVersion)} }

// schemaFailure answers a schema error with its issue, and passes others on.
func schemaFailure(err error) (response, error) {
	var schemaErr *cards.SchemaError
	if errors.As(err, &schemaErr) {
		return jsonResponse(http.StatusUnprocessableEntity, object(schemaVersion(), member{Key: "issue", Value: schemaErr.Issue.JS()})), nil
	}
	return response{}, err
}

func convert(request *http.Request) (response, error) {
	body, err := readBody(request, maxBodyBytes)
	if err != nil {
		return response{}, err
	}
	operationID, err := requireString(body.Get("operationId"), "operationId")
	if err != nil {
		return response{}, err
	}
	rawSources, err := requireArray(orEmpty(body.Get("sourceIds")), "sourceIds")
	if err != nil {
		return response{}, err
	}
	sourceIDs := make([]string, len(rawSources))
	for index, sourceID := range rawSources {
		if sourceIDs[index], err = requireString(sourceID, fmt.Sprintf("sourceIds[%d]", index)); err != nil {
			return response{}, err
		}
	}
	assetIDs, err := stringList(body.Get("assetIds"), "assetIds")
	if err != nil {
		return response{}, err
	}
	inputs, err := draftInputs(body.Get("cards"))
	if err != nil {
		return response{}, err
	}
	results, err := cards.ConvertCards(operationID, sourceIDs, assetIDs, inputs)
	if err != nil {
		return response{}, err
	}
	values := make([]jsvalue.Value, len(results))
	for index, result := range results {
		values[index] = result.JS()
	}
	return jsonResponse(http.StatusOK, object(schemaVersion(), member{Key: "results", Value: jsvalue.ArrayValue(values)})), nil
}

func templateDeck(request *http.Request) (response, error) {
	body, err := readBody(request, maxBodyBytes)
	if err != nil {
		return response{}, err
	}
	templateID, err := requireString(body.Get("templateId"), "templateId")
	if err != nil {
		return response{}, err
	}
	template, ok := cards.Template(templateID)
	if !ok {
		return jsonResponse(http.StatusNotFound, errorBody("template not found")), nil
	}
	return jsonResponse(http.StatusOK, template), nil
}

func assemble(request *http.Request) (response, error) {
	body, err := readBody(request, maxBodyBytes)
	if err != nil {
		return response{}, err
	}
	theme := body.Get("theme")
	if !theme.IsString() || !contains(cards.Themes, theme.Str()) {
		return response{}, &requestError{http.StatusBadRequest, "theme is not known"}
	}
	title, err := requireString(body.Get("title"), "title")
	if err != nil {
		return response{}, err
	}
	cardValues, err := requireArray(body.Get("cards"), "cards")
	if err != nil {
		return response{}, err
	}
	assetIDs, err := stringList(body.Get("assetIds"), "assetIds")
	if err != nil {
		return response{}, err
	}
	document, err := cards.AssembleDocument(title, theme.Str(), cardValues, assetIDs)
	if err != nil {
		return schemaFailure(err)
	}
	return jsonResponse(http.StatusOK, object(schemaVersion(), member{Key: "document", Value: document.JS()})), nil
}

// parseDocument validates a whole edited document; only assets the caller
// lists may be shown.
func parseDocument(body *jsvalue.Obj) (*cards.Document, error) {
	assetIDs, err := stringList(body.Get("assetIds"), "assetIds")
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, assetID := range assetIDs {
		known[assetID] = true
	}
	return cards.ParseDocument(body.Get("document"), known)
}

// validateDocument returns an edited document normalized to the current
// schema version.
func validateDocument(request *http.Request) (response, error) {
	body, err := readBody(request, maxBodyBytes)
	if err != nil {
		return response{}, err
	}
	document, err := parseDocument(body)
	if err != nil {
		return schemaFailure(err)
	}
	return jsonResponse(http.StatusOK, object(schemaVersion(), member{Key: "document", Value: document.JS()})), nil
}

// drafts returns every card of a document in draft form, keyed by card ID,
// so an AI revision can show the model cards in the shape it writes them.
func drafts(request *http.Request) (response, error) {
	body, err := readBody(request, maxBodyBytes)
	if err != nil {
		return response{}, err
	}
	document, err := parseDocument(body)
	if err != nil {
		return schemaFailure(err)
	}
	result := object()
	for _, cardID := range document.CardOrder {
		result.Object().Set(cardID, document.Cards[cardID].Draft())
	}
	return jsonResponse(http.StatusOK, object(schemaVersion(), member{Key: "cards", Value: result})), nil
}

func exportAssets(value jsvalue.Value) (map[string]*pptx.Asset, []string, error) {
	if !value.IsObject() {
		return nil, nil, &requestError{http.StatusBadRequest, "assets must be an object"}
	}
	assets := map[string]*pptx.Asset{}
	var order []string
	for _, entry := range value.Object().Members() {
		assetID, raw := entry.Key, entry.Value
		mimeType := raw.Get("mimeType")
		if !mimeType.IsString() || (mimeType.Str() != "image/jpeg" && mimeType.Str() != "image/png") {
			return nil, nil, &requestError{http.StatusBadRequest, "assets." + assetID + ".mimeType must be image/jpeg or image/png"}
		}
		width, height := raw.Get("width"), raw.Get("height")
		if !width.IsNumber() || !(width.Number() >= 1) || !height.IsNumber() || !(height.Number() >= 1) {
			return nil, nil, &requestError{http.StatusBadRequest, "assets." + assetID + " must have a positive width and height"}
		}
		data, err := requireString(raw.Get("data"), "assets."+assetID+".data")
		if err != nil {
			return nil, nil, err
		}
		asset := &pptx.Asset{MimeType: mimeType.Str(), Width: width.Number(), Height: height.Number(), Data: decodeBase64(data)}
		if source := raw.Get("source"); source.IsObject() || source.IsArray() {
			asset.Source = source
		}
		assets[assetID] = asset
		order = append(order, assetID)
	}
	return assets, order, nil
}

// decodeBase64 decodes as Buffer.from(text, "base64") does: both alphabets,
// characters outside them skipped, and decoding stopped at the first "=".
func decodeBase64(text string) []byte {
	var values []byte
	for index := 0; index < len(text); index++ {
		char := text[index]
		var value byte
		switch {
		case char >= 'A' && char <= 'Z':
			value = char - 'A'
		case char >= 'a' && char <= 'z':
			value = char - 'a' + 26
		case char >= '0' && char <= '9':
			value = char - '0' + 52
		case char == '+' || char == '-':
			value = 62
		case char == '/' || char == '_':
			value = 63
		case char == '=':
			index = len(text)
			continue
		default:
			continue
		}
		values = append(values, value)
	}
	output := make([]byte, 0, len(values)*3/4)
	for index := 0; index+1 < len(values); index += 4 {
		group := values[index:min(index+4, len(values))]
		output = append(output, group[0]<<2|group[1]>>4)
		if len(group) > 2 {
			output = append(output, group[1]<<4|group[2]>>2)
		}
		if len(group) > 3 {
			output = append(output, group[2]<<6|group[3])
		}
	}
	return output
}

var webLink = regexp.MustCompile(`^[hH][tT][tT][pP][sS]?://`)

// exportSources keeps sources in position, since cards cite them by number,
// but only a web link becomes a hyperlink in the file.
func exportSources(value jsvalue.Value) ([]pptx.Source, error) {
	items, err := requireArray(orEmpty(value), "sources")
	if err != nil {
		return nil, err
	}
	sources := make([]pptx.Source, len(items))
	for index, raw := range items {
		if url := raw.Get("url"); url.IsString() && webLink.MatchString(url.Str()) {
			sources[index].URL = url.Str()
			sources[index].HasURL = true
		}
		if title := raw.Get("title"); title.IsString() {
			sources[index].Title = title.Str()
			sources[index].HasTitle = true
		}
	}
	return sources, nil
}

// exportPptx writes a document as an editable PowerPoint file. The caller
// sends the images the document shows, since the converter stores nothing.
func exportPptx(request *http.Request) (response, error) {
	body, err := readBody(request, maxExportBodyBytes)
	if err != nil {
		return response{}, err
	}
	assetsValue := body.Get("assets")
	if assetsValue.IsNullish() {
		assetsValue = object()
	}
	assets, assetIDs, err := exportAssets(assetsValue)
	if err != nil {
		return response{}, err
	}
	known := map[string]bool{}
	for _, assetID := range assetIDs {
		known[assetID] = true
	}
	document, err := cards.ParseDocument(body.Get("document"), known)
	if err != nil {
		return schemaFailure(err)
	}
	sources, err := exportSources(body.Get("sources"))
	if err != nil {
		return response{}, err
	}
	file, err := pptx.Write(document, assets, sources)
	if err != nil {
		return response{}, err
	}
	return response{status: http.StatusOK, contentType: pptxType, body: file}, nil
}
