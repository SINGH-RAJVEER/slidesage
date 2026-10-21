package cards

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// DraftInput is model output for one card with its plan entry.
type DraftInput struct {
	Position float64
	Takeaway string
	Role     string
	Draft    jsvalue.Value
}

// CardResult is a converted card or the issue that stopped it.
type CardResult struct {
	Position float64
	Card     *Card
	Issue    *Issue
}

// hash is cyrb53 over UTF-16 code units, written in base 36 and padded to
// eight characters. IDs derived from it only need to be unique within one
// document, and a retried conversion produces identical IDs.
func hash(value string) string {
	first := uint32(0xdeadbeef)
	second := uint32(0x41c6ce57)
	for _, code := range jsvalue.Units(value) {
		first = (first ^ uint32(code)) * 2654435761
		second = (second ^ uint32(code)) * 1597334677
	}
	first = (first^first>>16)*2246822507 ^ (second^second>>13)*3266489909
	second = (second^second>>16)*2246822507 ^ (first^first>>13)*3266489909
	result := strconv.FormatUint(uint64(2097151&second)<<32+uint64(first), 36)
	if len(result) < 8 {
		result = strings.Repeat("0", 8-len(result)) + result
	}
	return result
}

// unsafeCharacters are C0/C1 controls, zero-width characters, and
// bidirectional overrides, which can hide or reorder text.
var unsafeCharacters = regexp.MustCompile(`[\x{0}-\x{1f}\x{7f}-\x{9f}\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2060}-\x{2069}\x{feff}]`)

// markupTag matches the HTML tags a model might emit, case-insensitively for
// ASCII letters only, as a JavaScript /i pattern without the u flag does.
var markupTag = regexp.MustCompile(`<\/?(?:` + asciiFold("a|b|big|blockquote|br|code|del|div|em|embed|font|h[1-6]|hr|i|iframe|img|ins|li|mark|object|ol|p|pre|s|script|small|span|strike|strong|style|sub|sup|svg|table|tbody|td|th|thead|tr|u|ul") + `)(?:[` + jsvalue.SpaceClass + `]+[\w:-]+[` + jsvalue.SpaceClass + `]*=[` + jsvalue.SpaceClass + `]*(?:"[^"]*"|'[^']*'|[^` + jsvalue.SpaceClass + `"'<>=` + "`" + `]+))*[` + jsvalue.SpaceClass + `]*\/?>`)

var spaces = regexp.MustCompile(`[` + jsvalue.SpaceClass + `]+`)

// asciiFold turns each ASCII letter of a pattern into a class of both cases.
func asciiFold(pattern string) string {
	var builder strings.Builder
	inClass := false
	for _, char := range pattern {
		switch {
		case char == '[':
			inClass = true
			builder.WriteRune(char)
		case char == ']':
			inClass = false
			builder.WriteRune(char)
		case !inClass && char >= 'a' && char <= 'z':
			builder.WriteString("[" + string(char) + strings.ToUpper(string(char)) + "]")
		default:
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

// CleanText normalizes model text: no tags, no control characters, single
// spaces.
func CleanText(value string) string {
	value = norm.NFC.String(value)
	value = markupTag.ReplaceAllLiteralString(value, "")
	value = unsafeCharacters.ReplaceAllLiteralString(value, " ")
	value = spaces.ReplaceAllLiteralString(value, " ")
	return jsvalue.Canonical(jsvalue.Trim(value))
}

// cleanAffix cleans a value's prefix or suffix, keeping one space between it
// and the number when the original had one, so " GW" reads "12 GW".
func cleanAffix(value, side string) string {
	text := CleanText(value)
	if text == "" {
		return ""
	}
	units := jsvalue.Units(value)
	if side == "suffix" && len(units) > 0 && jsvalue.IsSpace(rune(units[0])) {
		return " " + text
	}
	if side == "prefix" && len(units) > 0 && jsvalue.IsSpace(rune(units[len(units)-1])) {
		return text + " "
	}
	return text
}

var emphasis = regexp.MustCompile(`\*\*[^*]+\*\*|\*[^*` + jsvalue.SpaceClass + `][^*]*\*`)

// ParseInlineMarkup parses **bold** and *italic* into runs; any other
// asterisk stays literal.
func ParseInlineMarkup(value string) RichText {
	cleaned := CleanText(value)
	var parts []string
	last := 0
	for _, match := range emphasis.FindAllStringIndex(cleaned, -1) {
		parts = append(parts, cleaned[last:match[0]], cleaned[match[0]:match[1]])
		last = match[1]
	}
	parts = append(parts, cleaned[last:])
	runs := RichText{}
	for _, part := range parts {
		if part == "" {
			continue
		}
		length := jsvalue.Length(part)
		switch {
		case strings.HasPrefix(part, "**") && strings.HasSuffix(part, "**") && length > 4:
			runs = append(runs, TextRun{Text: part[2 : len(part)-2], Bold: true})
		case strings.HasPrefix(part, "*") && strings.HasSuffix(part, "*") && length > 2:
			runs = append(runs, TextRun{Text: part[1 : len(part)-1], Italic: true})
		default:
			runs = append(runs, TextRun{Text: part})
		}
	}
	return runs
}

// richValue writes runs as the JavaScript objects parseInlineMarkup returns.
func richValue(runs RichText) jsvalue.Value {
	values := make([]jsvalue.Value, len(runs))
	for index, run := range runs {
		values[index] = run.value()
	}
	return jsvalue.ArrayValue(values)
}

type member = jsvalue.Member

func str(value string) jsvalue.Value { return jsvalue.StringValue(value) }

// draftReader turns one model-drafted card into a candidate card object.
type draftReader struct {
	counter     int
	operationID string
	position    float64
}

func (reader *draftReader) nextID(prefix string) jsvalue.Value {
	reader.counter++
	return str(prefix + "_" + hash(jsvalue.Concat(reader.operationID, ":", jsvalue.FormatNumber(reader.position), ":", strconv.Itoa(reader.counter))))
}

func (reader *draftReader) object(value jsvalue.Value, path string) *jsvalue.Obj {
	if !value.IsObject() {
		fail(path, "must be an object")
	}
	return value.Object()
}

func (reader *draftReader) list(value jsvalue.Value, path string) []jsvalue.Value {
	if !value.IsArray() {
		fail(path, "must be an array")
	}
	return value.Items()
}

func (reader *draftReader) string(value jsvalue.Value, path string) jsvalue.Value {
	if !value.IsString() {
		fail(path, "must be a string")
	}
	return str(CleanText(value.Str()))
}

func (reader *draftReader) rich(value jsvalue.Value, path string) jsvalue.Value {
	if !value.IsString() {
		fail(path, "must be a string")
	}
	return richValue(ParseInlineMarkup(value.Str()))
}

var plainNumber = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

var numberNoise = regexp.MustCompile(`[,` + jsvalue.SpaceClass + `]`)

// number accepts a number, or a plain numeric string such as "1,200" or
// "-3.5". Other values pass through for validation to refuse.
func (reader *draftReader) number(value jsvalue.Value, path string) jsvalue.Value {
	if !value.IsString() {
		return value
	}
	plain := numberNoise.ReplaceAllLiteralString(value.Str(), "")
	if !plainNumber.MatchString(plain) {
		fail(path, "must be a number without units")
	}
	return jsvalue.NumberValue(jsvalue.ParseNumber(plain))
}

func (reader *draftReader) optional(raw *jsvalue.Obj, field string, node *jsvalue.Obj) {
	if value := raw.Get(field); value.IsString() && CleanText(value.Str()) != "" {
		node.Set(field, str(CleanText(value.Str())))
	}
}

func (reader *draftReader) items(value jsvalue.Value, path string) jsvalue.Value {
	raws := reader.list(value, path)
	items := make([]jsvalue.Value, len(raws))
	for index, item := range raws {
		itemID := reader.nextID("i")
		items[index] = jsvalue.ObjectValue(member{Key: "id", Value: itemID}, member{Key: "text", Value: reader.rich(item, fmt.Sprintf("%s[%d]", path, index))})
	}
	return jsvalue.ArrayValue(items)
}

func (reader *draftReader) node(value jsvalue.Value, path string) jsvalue.Value {
	raw := reader.object(value, path)
	nodeType := raw.Get("type")
	typeName := ""
	if nodeType.IsString() {
		typeName = nodeType.Str()
	}
	switch typeName {
	case "heading", "paragraph":
		nodeID := reader.nextID("n")
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "text", Value: reader.rich(raw.Get("text"), path+".text")})
	case "bullets":
		nodeID := reader.nextID("n")
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "items", Value: reader.items(raw.Get("items"), path+".items")})
	case "quote":
		nodeID := reader.nextID("n")
		node := jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "text", Value: reader.rich(raw.Get("text"), path+".text")})
		if attribution := raw.Get("attribution"); attribution.IsString() && CleanText(attribution.Str()) != "" {
			node.Object().Set("attribution", str(CleanText(attribution.Str())))
		}
		return node
	case "stat":
		nodeID := reader.nextID("n")
		statValue := reader.string(raw.Get("value"), path+".value")
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "value", Value: statValue}, member{Key: "label", Value: reader.string(raw.Get("label"), path+".label")})
	case "steps":
		nodeID := reader.nextID("n")
		rawSteps := reader.list(raw.Get("items"), path+".items")
		steps := make([]jsvalue.Value, len(rawSteps))
		for index, rawStep := range rawSteps {
			stepPath := fmt.Sprintf("%s.items[%d]", path, index)
			step := reader.object(rawStep, stepPath)
			stepID := reader.nextID("i")
			result := jsvalue.ObjectValue(member{Key: "id", Value: stepID}, member{Key: "title", Value: reader.string(step.Get("title"), stepPath+".title")})
			if detail := step.Get("detail"); detail.IsString() && CleanText(detail.Str()) != "" {
				result.Object().Set("detail", reader.rich(detail, stepPath+".detail"))
			}
			steps[index] = result
		}
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "items", Value: jsvalue.ArrayValue(steps)})
	case "columns":
		nodeID := reader.nextID("n")
		rawColumns := reader.list(raw.Get("columns"), path+".columns")
		columns := make([]jsvalue.Value, len(rawColumns))
		for index, rawColumn := range rawColumns {
			columnPath := fmt.Sprintf("%s.columns[%d]", path, index)
			column := reader.object(rawColumn, columnPath)
			columnID := reader.nextID("i")
			heading := reader.string(column.Get("heading"), columnPath+".heading")
			columns[index] = jsvalue.ObjectValue(member{Key: "id", Value: columnID}, member{Key: "heading", Value: heading}, member{Key: "items", Value: reader.items(column.Get("items"), columnPath+".items")})
		}
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "columns", Value: jsvalue.ArrayValue(columns)})
	case "image":
		// Image nodes are placed by the drafter, not the model, so the asset
		// ID is taken verbatim and checked against the known assets on parse.
		nodeID := reader.nextID("n")
		alt := raw.Get("alt")
		if alt.IsString() {
			alt = str(CleanText(alt.Str()))
		}
		fit := raw.Get("fit")
		if fit.IsNullish() {
			fit = str("cover")
		}
		node := jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "assetId", Value: raw.Get("assetId")}, member{Key: "alt", Value: alt}, member{Key: "fit", Value: fit})
		if focus := raw.Get("focus"); !focus.IsUndefined() {
			node.Object().Set("focus", focus)
		}
		return node
	case "chart":
		nodeID := reader.nextID("n")
		rawCategories := reader.list(raw.Get("categories"), path+".categories")
		categories := make([]jsvalue.Value, len(rawCategories))
		for index, category := range rawCategories {
			if category.IsNumber() {
				categories[index] = str(jsvalue.FormatNumber(category.Number()))
				continue
			}
			categories[index] = reader.string(category, fmt.Sprintf("%s.categories[%d]", path, index))
		}
		rawSeriesList := reader.list(raw.Get("series"), path+".series")
		seriesList := make([]jsvalue.Value, len(rawSeriesList))
		for index, rawSeries := range rawSeriesList {
			seriesPath := fmt.Sprintf("%s.series[%d]", path, index)
			series := reader.object(rawSeries, seriesPath)
			seriesID := reader.nextID("i")
			name := reader.string(series.Get("name"), seriesPath+".name")
			rawValues := reader.list(series.Get("values"), seriesPath+".values")
			values := make([]jsvalue.Value, len(rawValues))
			for valueIndex, number := range rawValues {
				values[valueIndex] = reader.number(number, fmt.Sprintf("%s.values[%d]", seriesPath, valueIndex))
			}
			seriesList[index] = jsvalue.ObjectValue(member{Key: "id", Value: seriesID}, member{Key: "name", Value: name}, member{Key: "values", Value: jsvalue.ArrayValue(values)})
		}
		node := jsvalue.ObjectValue(
			member{Key: "id", Value: nodeID},
			member{Key: "type", Value: nodeType},
			member{Key: "kind", Value: raw.Get("kind")},
			member{Key: "size", Value: raw.Get("size")},
			member{Key: "categories", Value: jsvalue.ArrayValue(categories)},
			member{Key: "series", Value: jsvalue.ArrayValue(seriesList)},
		)
		for _, side := range []string{"prefix", "suffix"} {
			affix := ""
			if value := raw.Get(side); value.IsString() {
				affix = cleanAffix(value.Str(), side)
			}
			if affix != "" {
				node.Object().Set(side, str(affix))
			}
		}
		reader.optional(raw, "caption", node.Object())
		return node
	case "progress":
		nodeID := reader.nextID("n")
		rawMeters := reader.list(raw.Get("items"), path+".items")
		meters := make([]jsvalue.Value, len(rawMeters))
		for index, rawMeter := range rawMeters {
			meterPath := fmt.Sprintf("%s.items[%d]", path, index)
			meter := reader.object(rawMeter, meterPath)
			meterID := reader.nextID("i")
			label := reader.string(meter.Get("label"), meterPath+".label")
			meters[index] = jsvalue.ObjectValue(member{Key: "id", Value: meterID}, member{Key: "label", Value: label}, member{Key: "value", Value: reader.number(meter.Get("value"), meterPath+".value")})
		}
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "size", Value: raw.Get("size")}, member{Key: "items", Value: jsvalue.ArrayValue(meters)})
	case "table":
		nodeID := reader.nextID("n")
		rawColumns := reader.list(raw.Get("columns"), path+".columns")
		columns := make([]jsvalue.Value, len(rawColumns))
		for index, heading := range rawColumns {
			columns[index] = reader.string(heading, fmt.Sprintf("%s.columns[%d]", path, index))
		}
		rawRows := reader.list(raw.Get("rows"), path+".rows")
		rows := make([]jsvalue.Value, len(rawRows))
		for index, rawRow := range rawRows {
			rowID := reader.nextID("i")
			rawCells := reader.list(rawRow, fmt.Sprintf("%s.rows[%d]", path, index))
			cells := make([]jsvalue.Value, len(rawCells))
			for cellIndex, cell := range rawCells {
				if cell.IsNumber() {
					cells[cellIndex] = str(jsvalue.FormatNumber(cell.Number()))
					continue
				}
				cells[cellIndex] = reader.string(cell, fmt.Sprintf("%s.rows[%d][%d]", path, index, cellIndex))
			}
			rows[index] = jsvalue.ObjectValue(member{Key: "id", Value: rowID}, member{Key: "cells", Value: jsvalue.ArrayValue(cells)})
		}
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "size", Value: raw.Get("size")}, member{Key: "columns", Value: jsvalue.ArrayValue(columns)}, member{Key: "rows", Value: jsvalue.ArrayValue(rows)})
	case "callout":
		nodeID := reader.nextID("n")
		tone := raw.Get("tone")
		if tone.IsNullish() {
			tone = str("note")
		}
		return jsvalue.ObjectValue(member{Key: "id", Value: nodeID}, member{Key: "type", Value: nodeType}, member{Key: "size", Value: raw.Get("size")}, member{Key: "tone", Value: tone}, member{Key: "text", Value: reader.rich(raw.Get("text"), path+".text")})
	}
	fail(path+".type", "unsupported node type "+jsvalue.JSONText(nodeType)+"; use heading, paragraph, bullets, quote, stat, steps, columns, chart, progress, table, or callout")
	return jsvalue.Value{}
}

// defaultSizes sizes drafted widgets the model left unsized: the chart of a
// chart card or the table of a table card takes two thirds of the width beside
// text and fills the card alone; any other widget takes half a row.
func defaultSizes(layout jsvalue.Value, nodes []jsvalue.Value) {
	hasText := false
	for _, node := range nodes {
		if nodeType := node.Get("type"); nodeType.IsString() && contains(FeatureText, nodeType.Str()) {
			hasText = true
		}
	}
	for _, node := range nodes {
		nodeType := node.Get("type")
		if !nodeType.IsString() || !contains(widgetTypes, nodeType.Str()) || !node.Get("size").IsUndefined() {
			continue
		}
		feature := layout.IsString() && nodeType.Str() == layout.Str() && (layout.Str() == "chart" || layout.Str() == "table")
		size := "medium"
		if feature {
			size = "full"
			if hasText {
				size = "large"
			}
		}
		node.Object().Set("size", str(size))
	}
}

func convertOne(input DraftInput, operationID string, knownSources, knownAssets map[string]bool) *Card {
	reader := &draftReader{operationID: operationID, position: input.Position}
	draft := reader.object(input.Draft, "card")
	cardID := str("c_" + hash(jsvalue.Concat(operationID, ":card:", jsvalue.FormatNumber(input.Position))))
	takeaway := str(CleanText(input.Takeaway))
	rawNodes := reader.list(draft.Get("nodes"), "card.nodes")
	nodes := make([]jsvalue.Value, len(rawNodes))
	for index, rawNode := range rawNodes {
		nodes[index] = reader.node(rawNode, fmt.Sprintf("card.nodes[%d]", index))
	}
	sources := draft.Get("sourceIds")
	if !sources.IsArray() {
		sources = jsvalue.ArrayValue(nil)
	}
	candidate := jsvalue.ObjectValue(
		member{Key: "id", Value: cardID},
		member{Key: "takeaway", Value: takeaway},
		member{Key: "role", Value: str(input.Role)},
		member{Key: "layout", Value: draft.Get("layout")},
		member{Key: "nodes", Value: jsvalue.ArrayValue(nodes)},
		member{Key: "sourceIds", Value: sources},
	)
	if notes := draft.Get("notes"); notes.IsString() && CleanText(notes.Str()) != "" {
		candidate.Object().Set("notes", str(CleanText(notes.Str())))
	}
	defaultSizes(draft.Get("layout"), nodes)
	return parseCard(candidate, "card", CardContext{Seen: map[string]bool{}, KnownSources: knownSources, KnownAssets: knownAssets})
}

// ConvertCards converts drafted cards independently, so one invalid card is
// reported for a targeted repair without discarding the rest of the batch.
func ConvertCards(operationID string, sourceIDs, assetIDs []string, inputs []DraftInput) (results []CardResult, err error) {
	knownSources := set(sourceIDs)
	knownAssets := set(assetIDs)
	results = make([]CardResult, len(inputs))
	for index, input := range inputs {
		card, convertErr := convertCard(input, operationID, knownSources, knownAssets)
		if schemaErr, ok := convertErr.(*SchemaError); ok {
			results[index] = CardResult{Position: input.Position, Issue: &schemaErr.Issue}
			continue
		}
		if convertErr != nil {
			return nil, convertErr
		}
		results[index] = CardResult{Position: input.Position, Card: card}
	}
	return results, nil
}

func convertCard(input DraftInput, operationID string, knownSources, knownAssets map[string]bool) (card *Card, err error) {
	defer catch(&err)
	return convertOne(input, operationID, knownSources, knownAssets), nil
}

func set(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

// AssembleDocument orders converted cards into a document and validates it.
// cards are the request's raw values, which need not be well-formed cards.
func AssembleDocument(title, theme string, cards []jsvalue.Value, assetIDs []string) (document *Document, err error) {
	defer catch(&err)
	order := make([]jsvalue.Value, len(cards))
	for index, card := range cards {
		if card.IsNullish() {
			typeError()
		}
		order[index] = card.Get("id")
	}
	byID := jsvalue.ObjectValue()
	for index, card := range cards {
		key, err := jsvalue.ToString(order[index])
		if err != nil {
			typeError()
		}
		byID.Object().Set(key, card)
	}
	candidate := jsvalue.ObjectValue(
		member{Key: "schemaVersion", Value: jsvalue.NumberValue(SchemaVersion)},
		member{Key: "title", Value: str(CleanText(title))},
		member{Key: "theme", Value: str(theme)},
		member{Key: "cardOrder", Value: jsvalue.ArrayValue(order)},
		member{Key: "cards", Value: byID},
	)
	return parseDocument(candidate, set(assetIDs)), nil
}
