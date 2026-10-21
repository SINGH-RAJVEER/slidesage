package cards

import (
	"errors"
	"fmt"
	"math"
	"regexp"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// Issue is a schema violation, located by path.
type Issue struct {
	Path    string
	Message string
}

// SchemaError reports the first issue found, as a thrown SchemaError does.
type SchemaError struct{ Issue Issue }

func (err *SchemaError) Error() string { return err.Issue.Path + ": " + err.Issue.Message }

// ErrType stands for a TypeError the TypeScript code throws on input it does
// not expect, which the converter answers with a server error.
var ErrType = jsvalue.ErrType

var (
	idPattern       = regexp.MustCompile(`^[a-z]_[a-z0-9]{6,32}$`)
	sourceIDPattern = regexp.MustCompile(`^s[0-9]{1,3}$`)
	assetIDPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// fail throws a schema error. Validation panics the way the TypeScript code
// throws, and recover turns the panic back into an error at each entry point.
func fail(path, message string) {
	panic(&SchemaError{Issue{Path: path, Message: message}})
}

// typeError throws the TypeError JavaScript would.
func typeError() { panic(ErrType) }

// catch recovers a thrown schema or type error into err.
func catch(err *error) {
	recovered := recover()
	if recovered == nil {
		return
	}
	switch thrown := recovered.(type) {
	case *SchemaError:
		*err = thrown
	case error:
		if errors.Is(thrown, ErrType) {
			*err = thrown
			return
		}
		panic(recovered)
	default:
		panic(recovered)
	}
}

func record(value jsvalue.Value, path string, keys []string) *jsvalue.Obj {
	if !value.IsObject() {
		fail(path, "must be an object")
	}
	for _, key := range value.Object().Keys() {
		if !contains(keys, key) {
			fail(path+"."+key, "is not a known field")
		}
	}
	return value.Object()
}

func array(value jsvalue.Value, path string) []jsvalue.Value {
	if !value.IsArray() {
		fail(path, "must be an array")
	}
	return value.Items()
}

// textLength counts code points, so limits do not penalize non-Latin scripts.
func textLength(value string) int { return jsvalue.CodePoints(value) }

func text(value jsvalue.Value, path string, maximum int) string {
	if !value.IsString() {
		fail(path, "must be a string")
	}
	if jsvalue.IsBlank(value.Str()) {
		fail(path, "must not be empty")
	}
	if length := textLength(value.Str()); length > maximum {
		fail(path, fmt.Sprintf("is %d characters, the limit is %d", length, maximum))
	}
	return value.Str()
}

func id(value jsvalue.Value, path string, seen map[string]bool) string {
	if !value.IsString() || !idPattern.MatchString(value.Str()) {
		fail(path, "is not a valid ID")
	}
	if seen[value.Str()] {
		fail(path, "duplicates ID "+value.Str())
	}
	seen[value.Str()] = true
	return value.Str()
}

// PlainText joins a run list's text.
func PlainText(runs RichText) string {
	parts := make([]string, len(runs))
	for index, run := range runs {
		parts[index] = run.Text
	}
	return jsvalue.Concat(parts...)
}

func richText(value jsvalue.Value, path string, maximum int) RichText {
	runs := array(value, path)
	if len(runs) == 0 {
		fail(path, "must not be empty")
	}
	result := make(RichText, len(runs))
	for index, raw := range runs {
		runPath := fmt.Sprintf("%s[%d]", path, index)
		run := record(raw, runPath, []string{"text", "bold", "italic"})
		if runText := run.Get("text"); !runText.IsString() || runText.Str() == "" {
			fail(runPath+".text", "must be a non-empty string")
		}
		next := TextRun{Text: run.Get("text").Str()}
		for _, mark := range []string{"bold", "italic"} {
			if run.Get(mark).IsUndefined() {
				continue
			}
			if !run.Get(mark).IsTrue() {
				fail(runPath+"."+mark, "must be true when present")
			}
			if mark == "bold" {
				next.Bold = true
			} else {
				next.Italic = true
			}
		}
		result[index] = next
	}
	plain := PlainText(result)
	if jsvalue.IsBlank(plain) {
		fail(path, "must not be blank")
	}
	if length := textLength(plain); length > maximum {
		fail(path, fmt.Sprintf("is %d characters, the limit is %d", length, maximum))
	}
	return result
}

func listItems(value jsvalue.Value, path string, seen map[string]bool) []ListItem {
	raws := array(value, path)
	items := make([]ListItem, len(raws))
	for index, raw := range raws {
		itemPath := fmt.Sprintf("%s[%d]", path, index)
		item := record(raw, itemPath, []string{"id", "text"})
		items[index].ID = id(item.Get("id"), itemPath+".id", seen)
		items[index].Text = richText(item.Get("text"), itemPath+".text", limits.listItem)
	}
	return items
}

func fraction(value jsvalue.Value, path string) float64 {
	if !value.IsNumber() || math.IsInf(value.Number(), 0) || value.Number() != value.Number() || value.Number() < 0 || value.Number() > 1 {
		fail(path, "must be a number from 0 to 1")
	}
	return value.Number()
}

func count(length int, path string, limit bounds, noun string) {
	if length < limit.min || length > limit.max {
		fail(path, fmt.Sprintf("must hold %d-%d %s, got %d", limit.min, limit.max, noun, length))
	}
}

func finite(value jsvalue.Value, path string, minimum, maximum float64) float64 {
	if !value.IsNumber() || math.IsInf(value.Number(), 0) || value.Number() != value.Number() {
		fail(path, "must be a number")
	}
	if value.Number() < minimum || value.Number() > maximum {
		fail(path, fmt.Sprintf("must be from %s to %s", jsvalue.FormatNumber(minimum), jsvalue.FormatNumber(maximum)))
	}
	return value.Number()
}

func oneOf(value jsvalue.Value, path string, allowed []string) string {
	if !value.IsString() || !contains(allowed, value.Str()) {
		fail(path, "must be one of "+joinList(allowed))
	}
	return value.Str()
}

func chart(value jsvalue.Value, path string, seen map[string]bool) Node {
	raw := record(value, path, []string{"id", "type", "kind", "size", "categories", "series", "prefix", "suffix", "caption"})
	nodeID := id(raw.Get("id"), path+".id", seen)
	rawCategories := array(raw.Get("categories"), path+".categories")
	categories := make([]string, len(rawCategories))
	for index, category := range rawCategories {
		categories[index] = text(category, fmt.Sprintf("%s.categories[%d]", path, index), limits.categoryLabel)
	}
	count(len(categories), path+".categories", limits.chartCategories, "categories")
	unique := map[string]bool{}
	for _, category := range categories {
		unique[category] = true
	}
	if len(unique) != len(categories) {
		fail(path+".categories", "must not repeat")
	}
	seriesList := array(raw.Get("series"), path+".series")
	count(len(seriesList), path+".series", limits.chartSeries, "series")
	series := make([]ChartSeries, len(seriesList))
	for index, rawSeries := range seriesList {
		seriesPath := fmt.Sprintf("%s.series[%d]", path, index)
		entry := record(rawSeries, seriesPath, []string{"id", "name", "values"})
		rawValues := array(entry.Get("values"), seriesPath+".values")
		values := make([]float64, len(rawValues))
		for valueIndex, number := range rawValues {
			values[valueIndex] = finite(number, fmt.Sprintf("%s.values[%d]", seriesPath, valueIndex), -limits.chartValue, limits.chartValue)
		}
		if len(values) != len(categories) {
			fail(seriesPath+".values", fmt.Sprintf("must hold one value per category, %d in all", len(categories)))
		}
		series[index].ID = id(entry.Get("id"), seriesPath+".id", seen)
		series[index].Name = text(entry.Get("name"), seriesPath+".name", limits.seriesName)
		series[index].Values = values
	}
	result := Node{ID: nodeID, Type: "chart", Categories: categories, Series: series}
	result.Kind = oneOf(raw.Get("kind"), path+".kind", chartKinds)
	result.Size = oneOf(raw.Get("size"), path+".size", widgetSizes)
	if !raw.Get("prefix").IsUndefined() {
		result.Prefix = text(raw.Get("prefix"), path+".prefix", limits.affix)
	}
	if !raw.Get("suffix").IsUndefined() {
		result.Suffix = text(raw.Get("suffix"), path+".suffix", limits.affix)
	}
	if !raw.Get("caption").IsUndefined() {
		result.Caption = text(raw.Get("caption"), path+".caption", limits.chartCaption)
	}
	if mismatch := chartKindMismatch(result.Kind, result.Categories, result.Series); mismatch != "" {
		fail(path+".kind", mismatch)
	}
	return result
}

func node(value jsvalue.Value, path string, seen map[string]bool, knownAssets map[string]bool) Node {
	nodeType := value.Get("type")
	switch {
	case nodeType.IsString() && (nodeType.Str() == "heading" || nodeType.Str() == "paragraph"):
		raw := record(value, path, []string{"id", "type", "text"})
		limit := limits.paragraph
		if nodeType.Str() == "heading" {
			limit = limits.heading
		}
		result := Node{Type: nodeType.Str()}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Text = richText(raw.Get("text"), path+".text", limit)
		return result
	case nodeType.IsString() && nodeType.Str() == "bullets":
		raw := record(value, path, []string{"id", "type", "items"})
		result := Node{Type: "bullets"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Items = listItems(raw.Get("items"), path+".items", seen)
		return result
	case nodeType.IsString() && nodeType.Str() == "quote":
		raw := record(value, path, []string{"id", "type", "text", "attribution"})
		result := Node{Type: "quote"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Text = richText(raw.Get("text"), path+".text", limits.quote)
		if !raw.Get("attribution").IsUndefined() {
			result.Attribution = text(raw.Get("attribution"), path+".attribution", limits.attribution)
		}
		return result
	case nodeType.IsString() && nodeType.Str() == "stat":
		raw := record(value, path, []string{"id", "type", "value", "label"})
		result := Node{Type: "stat"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Value = text(raw.Get("value"), path+".value", limits.statValue)
		result.Label = text(raw.Get("label"), path+".label", limits.statLabel)
		return result
	case nodeType.IsString() && nodeType.Str() == "steps":
		raw := record(value, path, []string{"id", "type", "items"})
		result := Node{Type: "steps"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		rawSteps := array(raw.Get("items"), path+".items")
		result.Steps = make([]Step, len(rawSteps))
		for index, rawStep := range rawSteps {
			stepPath := fmt.Sprintf("%s.items[%d]", path, index)
			step := record(rawStep, stepPath, []string{"id", "title", "detail"})
			result.Steps[index].ID = id(step.Get("id"), stepPath+".id", seen)
			result.Steps[index].Title = text(step.Get("title"), stepPath+".title", limits.stepTitle)
			if !step.Get("detail").IsUndefined() {
				result.Steps[index].Detail = richText(step.Get("detail"), stepPath+".detail", limits.stepDetail)
			}
		}
		return result
	case nodeType.IsString() && nodeType.Str() == "columns":
		raw := record(value, path, []string{"id", "type", "columns"})
		result := Node{Type: "columns"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		rawColumns := array(raw.Get("columns"), path+".columns")
		result.Columns = make([]Column, len(rawColumns))
		for index, rawColumn := range rawColumns {
			columnPath := fmt.Sprintf("%s.columns[%d]", path, index)
			column := record(rawColumn, columnPath, []string{"id", "heading", "items"})
			result.Columns[index].ID = id(column.Get("id"), columnPath+".id", seen)
			result.Columns[index].Heading = text(column.Get("heading"), columnPath+".heading", limits.columnHeading)
			result.Columns[index].Items = listItems(column.Get("items"), columnPath+".items", seen)
		}
		return result
	case nodeType.IsString() && nodeType.Str() == "image":
		raw := record(value, path, []string{"id", "type", "assetId", "alt", "fit", "focus"})
		assetID := raw.Get("assetId")
		if !assetID.IsString() || !assetIDPattern.MatchString(assetID.Str()) {
			fail(path+".assetId", "is not an asset ID")
		}
		if knownAssets != nil && !knownAssets[assetID.Str()] {
			fail(path+".assetId", "names an asset this presentation does not have")
		}
		result := Node{Type: "image", AssetID: assetID.Str()}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Alt = text(raw.Get("alt"), path+".alt", limits.imageAlt)
		result.Fit = oneOf(raw.Get("fit"), path+".fit", []string{"cover", "contain"})
		if !raw.Get("focus").IsUndefined() {
			focus := record(raw.Get("focus"), path+".focus", []string{"x", "y"})
			x := fraction(focus.Get("x"), path+".focus.x")
			y := fraction(focus.Get("y"), path+".focus.y")
			result.Focus = &Focus{X: x, Y: y}
		}
		return result
	case nodeType.IsString() && nodeType.Str() == "chart":
		return chart(value, path, seen)
	case nodeType.IsString() && nodeType.Str() == "progress":
		raw := record(value, path, []string{"id", "type", "size", "items"})
		result := Node{Type: "progress"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		rawMeters := array(raw.Get("items"), path+".items")
		result.Meters = make([]Meter, len(rawMeters))
		for index, rawMeter := range rawMeters {
			meterPath := fmt.Sprintf("%s.items[%d]", path, index)
			meter := record(rawMeter, meterPath, []string{"id", "label", "value"})
			result.Meters[index].ID = id(meter.Get("id"), meterPath+".id", seen)
			result.Meters[index].Label = text(meter.Get("label"), meterPath+".label", limits.meterLabel)
			result.Meters[index].Value = finite(meter.Get("value"), meterPath+".value", 0, 100)
		}
		count(len(result.Meters), path+".items", limits.meters, "meters")
		result.Size = oneOf(raw.Get("size"), path+".size", widgetSizes)
		return result
	case nodeType.IsString() && nodeType.Str() == "table":
		raw := record(value, path, []string{"id", "type", "size", "columns", "rows"})
		result := Node{Type: "table"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		rawColumns := array(raw.Get("columns"), path+".columns")
		result.TableColumns = make([]string, len(rawColumns))
		for index, heading := range rawColumns {
			result.TableColumns[index] = text(heading, fmt.Sprintf("%s.columns[%d]", path, index), limits.tableHeading)
		}
		count(len(result.TableColumns), path+".columns", limits.tableColumns, "columns")
		rawRows := array(raw.Get("rows"), path+".rows")
		result.Rows = make([]TableRow, len(rawRows))
		for index, rawRow := range rawRows {
			rowPath := fmt.Sprintf("%s.rows[%d]", path, index)
			row := record(rawRow, rowPath, []string{"id", "cells"})
			rawCells := array(row.Get("cells"), rowPath+".cells")
			cells := make([]string, len(rawCells))
			for cellIndex, cell := range rawCells {
				// An empty cell is allowed; a table may leave a value blank.
				if cell.IsString() && cell.Str() == "" {
					continue
				}
				cells[cellIndex] = text(cell, fmt.Sprintf("%s.cells[%d]", rowPath, cellIndex), limits.tableCell)
			}
			if len(cells) != len(result.TableColumns) {
				fail(rowPath+".cells", fmt.Sprintf("must hold one cell per column, %d in all", len(result.TableColumns)))
			}
			result.Rows[index] = TableRow{ID: id(row.Get("id"), rowPath+".id", seen), Cells: cells}
		}
		count(len(result.Rows), path+".rows", limits.tableRows, "rows")
		result.Size = oneOf(raw.Get("size"), path+".size", widgetSizes)
		return result
	case nodeType.IsString() && nodeType.Str() == "callout":
		raw := record(value, path, []string{"id", "type", "size", "tone", "text"})
		result := Node{Type: "callout"}
		result.ID = id(raw.Get("id"), path+".id", seen)
		result.Size = oneOf(raw.Get("size"), path+".size", widgetSizes)
		result.Tone = oneOf(raw.Get("tone"), path+".tone", calloutTones)
		result.Text = richText(raw.Get("text"), path+".text", limits.callout)
		return result
	}
	fail(path+".type", "unsupported node type "+jsvalue.JSONText(nodeType))
	return Node{}
}

func sourceIDs(value jsvalue.Value, path string, known map[string]bool) []string {
	ids := array(value, path)
	if len(ids) > limits.sourceIDs {
		fail(path, fmt.Sprintf("may name at most %d sources", limits.sourceIDs))
	}
	var unique []string
	seen := map[string]bool{}
	for index, raw := range ids {
		if !raw.IsString() || !sourceIDPattern.MatchString(raw.Str()) {
			fail(fmt.Sprintf("%s[%d]", path, index), "is not a source ID")
		}
		if known != nil && !known[raw.Str()] {
			fail(fmt.Sprintf("%s[%d]", path, index), "names unknown source "+raw.Str())
		}
		if !seen[raw.Str()] {
			seen[raw.Str()] = true
			unique = append(unique, raw.Str())
		}
	}
	if unique == nil {
		unique = []string{}
	}
	return unique
}

// CardContext is what a card is validated against.
type CardContext struct {
	// Seen holds every ID already used in the document; the card's are added.
	Seen map[string]bool
	// KnownAssets are the assets a card may show; nil accepts any asset ID.
	KnownAssets map[string]bool
	// KnownSources are the sources a card may cite; nil accepts any source ID.
	KnownSources map[string]bool
}

func parseCard(value jsvalue.Value, path string, context CardContext) *Card {
	raw := record(value, path, []string{"id", "takeaway", "role", "layout", "nodes", "sourceIds", "notes"})
	card := &Card{}
	card.ID = id(raw.Get("id"), path+".id", context.Seen)
	card.Takeaway = text(raw.Get("takeaway"), path+".takeaway", limits.takeaway)
	card.Role = oneOf(raw.Get("role"), path+".role", NarrativeRoles)
	card.Layout = oneOf(raw.Get("layout"), path+".layout", Layouts)
	rawNodes := array(raw.Get("nodes"), path+".nodes")
	card.Nodes = make([]Node, len(rawNodes))
	for index, rawNode := range rawNodes {
		card.Nodes[index] = node(rawNode, fmt.Sprintf("%s.nodes[%d]", path, index), context.Seen, context.KnownAssets)
	}
	card.SourceIDs = sourceIDs(raw.Get("sourceIds"), path+".sourceIds", context.KnownSources)
	if !raw.Get("notes").IsUndefined() {
		card.Notes = text(raw.Get("notes"), path+".notes", limits.notes)
	}
	if mismatch := layoutMismatch(card.Layout, card.Nodes); mismatch != "" {
		fail(path+".layout", mismatch)
	}
	return card
}

// objectPrototype names Object.prototype's properties, which a lookup on any
// plain object finds even when it has no such own key.
var objectPrototype = []string{
	"constructor",
	"__defineGetter__",
	"__defineSetter__",
	"hasOwnProperty",
	"__lookupGetter__",
	"__lookupSetter__",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toString",
	"valueOf",
	"__proto__",
	"toLocaleString",
}

// ParseDocument checks a value against the card document schema and returns
// it as the current version. knownAssets limits the assets the document may
// show; nil accepts any asset ID. The error is a *SchemaError, or ErrType
// where the TypeScript code would throw a TypeError.
func ParseDocument(value jsvalue.Value, knownAssets map[string]bool) (document *Document, err error) {
	defer catch(&err)
	return parseDocument(value, knownAssets), nil
}

func parseDocument(value jsvalue.Value, knownAssets map[string]bool) *Document {
	raw := record(value, "document", []string{"schemaVersion", "title", "theme", "cardOrder", "cards"})
	version := raw.Get("schemaVersion")
	readable := false
	for _, candidate := range readableVersions {
		if version.IsNumber() && version.Number() == candidate {
			readable = true
		}
	}
	if !readable {
		fail("document.schemaVersion", "must be one of 1, 2, 3")
	}
	order := array(raw.Get("cardOrder"), "document.cardOrder")
	if len(order) < limits.cards.min || len(order) > limits.cards.max {
		fail("document.cardOrder", fmt.Sprintf("must hold %d-%d cards", limits.cards.min, limits.cards.max))
	}
	keys := make([]string, len(order))
	for index, cardID := range order {
		key, err := jsvalue.ToString(cardID)
		if err != nil {
			typeError()
		}
		keys[index] = key
	}
	cardsRaw := record(raw.Get("cards"), "document.cards", keys)
	context := CardContext{Seen: map[string]bool{}, KnownAssets: knownAssets}
	document := &Document{Cards: map[string]*Card{}}
	for index, cardID := range order {
		if !cardID.IsString() {
			fail(fmt.Sprintf("document.cardOrder[%d]", index), "must be a string")
		}
		if document.Cards[cardID.Str()] != nil || contains(objectPrototype, cardID.Str()) {
			fail(fmt.Sprintf("document.cardOrder[%d]", index), "repeats card "+cardID.Str())
		}
		card := parseCard(cardsRaw.Get(cardID.Str()), "document.cards."+cardID.Str(), context)
		if card.ID != cardID.Str() {
			fail("document.cards."+cardID.Str()+".id", "does not match its key")
		}
		document.Cards[cardID.Str()] = card
		document.CardOrder = append(document.CardOrder, cardID.Str())
	}
	document.Title = text(raw.Get("title"), "document.title", limits.title)
	document.Theme = oneOf(raw.Get("theme"), "document.theme", Themes)
	return document
}
