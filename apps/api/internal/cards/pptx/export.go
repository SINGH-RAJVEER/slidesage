// Package pptx writes a card document as a PowerPoint file of native,
// editable shapes: text boxes, lists, pictures, charts, and tables, placed the
// way the web card view places them. It is the Go port of apps/converter's
// pptx.ts together with the pptxgenjs code it calls, and writes the same parts
// byte for byte, apart from timestamps.
//
// A card can grow taller than one slide in the browser; here its text shrinks
// until it fits, down to a floor, and PowerPoint's own shrink-on-overflow is
// left on for anything the estimate misses.
//
// Arithmetic follows the TypeScript expression by expression in float64.
// Literal subexpressions go through n(), so Go never folds them exactly where
// JavaScript rounds each step.
package pptx

import (
	"encoding/base64"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// Asset is a stored image the document shows.
type Asset struct {
	MimeType string
	Width    float64
	Height   float64
	Data     []byte
	// Source is the asset's provenance as the caller sent it: an object, an
	// array, or undefined.
	Source jsvalue.Value
}

// Source is a research source, numbered by its position as cited.
type Source struct {
	URL      string
	HasURL   bool
	Title    string
	HasTitle bool
}

// ErrInput stands for a TypeError the TypeScript export throws on asset
// metadata of an unexpected type.
var ErrInput = jsvalue.ErrType

// n keeps a literal a float64 value, so the expression around it is
// evaluated step by step as JavaScript does.
func n(value float64) float64 { return value }

// Slide geometry in inches. One "cqw" is 1% of the card width, the unit the
// web card view sizes everything in.
var (
	slideW   = n(13.333)
	slideH   = n(7.5)
	cqw      = slideW / 100
	ptPerCQW = cqw * 72
	minScale = n(0.5)
)

// palette is a theme's colors without # prefixes.
type palette struct {
	surface, heading, body, muted, accent, rule string
	headingFace, bodyFace                       string
	series                                      []string
	positive, caution                           string
}

func bare(color string) string { return strings.ToUpper(color[1:]) }

func exportPalette(colors cards.Palette, theme cards.Theme, series []string, positive, caution string) palette {
	return palette{
		surface:     bare(colors.Surface),
		heading:     bare(colors.Heading),
		body:        bare(colors.Body),
		muted:       bare(colors.Muted),
		accent:      bare(colors.Accent),
		rule:        bare(colors.Rule),
		headingFace: theme.Fonts.Heading,
		bodyFace:    theme.Fonts.Body,
		series:      series,
		positive:    positive,
		caution:     caution,
	}
}

// Text measurement. Widths are estimated from average glyph widths, and
// words wrap greedily, which is close enough to size text conservatively.
var (
	averageGlyph     = n(0.52)
	averageBoldGlyph = n(0.57)
)

var whitespace = regexp.MustCompile(`[` + jsvalue.SpaceClass + `]+`)

func textWidthPt(text string, sizePt float64, bold bool) float64 {
	glyph := averageGlyph
	if bold {
		glyph = averageBoldGlyph
	}
	return float64(float64(jsvalue.Length(text))*sizePt) * glyph
}

// wrappedLines is the number of lines a paragraph wraps to in a box widthPt
// wide.
func wrappedLines(text string, sizePt, widthPt float64, bold bool) float64 {
	space := textWidthPt(" ", sizePt, bold)
	lines := n(1)
	used := n(0)
	for _, word := range whitespace.Split(text, -1) {
		if word == "" {
			continue
		}
		width := textWidthPt(word, sizePt, bold)
		if used > 0 && float64(used+space)+width > widthPt {
			lines++
			used = 0
		}
		// A word wider than the box breaks across lines on its own.
		lines += math.Max(0, math.Ceil(width/widthPt)-1)
		remainder := math.Mod(width, widthPt)
		if remainder == 0 || remainder != remainder {
			remainder = width
		}
		gap := n(0)
		if used > 0 {
			gap = space
		}
		used += gap + remainder
	}
	return lines
}

type textStyle struct {
	fontFace string
	// size is the designed size in cqw.
	size    float64
	color   string
	bold    bool
	leading float64
}

type paragraph struct {
	runs   cards.RichText
	style  textStyle
	bullet bool
}

// block is content stacked in a card, sized for a width and a scale. Its
// height is the least it needs; a block that can grow, such as a chart, fills
// the height it is drawn into when one is given.
type block interface {
	height(width, scale float64) float64
	draw(context *drawing, x, y, width, scale float64, height *float64)
}

// drawing is what blocks draw into.
type drawing struct {
	deck  *presentation
	slide *slide
	err   error
}

var bulletIndentCQW = n(2.1)

func lineHeightIn(style textStyle, scale float64) float64 {
	return float64(float64(float64(style.size*ptPerCQW)*scale)*style.leading) / 72
}

func roundTenth(value float64) float64 { return round(float64(value*10)) / 10 }

func some(value float64) *float64 { return &value }

type textBlock struct {
	paragraphs []paragraph
	gap        float64
	align      string
}

func newTextBlock(paragraphs []paragraph, gap float64) *textBlock {
	return &textBlock{paragraphs: paragraphs, gap: gap, align: "left"}
}

func (text *textBlock) height(width, scale float64) float64 {
	total := n(0)
	for index, paragraph := range text.paragraphs {
		sizePt := float64(paragraph.style.size*ptPerCQW) * scale
		indent := n(0)
		if paragraph.bullet {
			indent = float64(bulletIndentCQW*cqw) * scale
		}
		lines := wrappedLines(cards.PlainText(paragraph.runs), sizePt, float64(width-indent)*72, paragraph.style.bold)
		gap := n(0)
		if index > 0 {
			gap = float64(text.gap*cqw) * scale
		}
		total = float64(total+float64(lines*lineHeightIn(paragraph.style, scale))) + gap
	}
	return total
}

func (text *textBlock) draw(context *drawing, x, y, width, scale float64, _ *float64) {
	var runs []*textRun
	for index, paragraph := range text.paragraphs {
		sizePt := float64(paragraph.style.size*ptPerCQW) * scale
		shared := textOptions{
			fontFace:    paragraph.style.fontFace,
			fontSize:    roundTenth(sizePt),
			color:       paragraph.style.color,
			lineSpacing: roundTenth(sizePt * paragraph.style.leading),
			align:       text.align,
		}
		if index > 0 {
			shared.paraSpaceBefore = roundTenth(float64(text.gap*ptPerCQW) * scale)
		}
		if paragraph.bullet {
			shared.bullet = &bullet{characterCode: "25CF", indent: roundTenth(float64(bulletIndentCQW*ptPerCQW) * scale)}
		}
		paragraphRuns := paragraph.runs
		if len(paragraphRuns) == 0 {
			paragraphRuns = cards.RichText{{}}
		}
		for runIndex, run := range paragraphRuns {
			options := shared
			options.bold = paragraph.style.bold || run.Bold
			options.italic = run.Italic
			options.breakLine = runIndex == len(paragraphRuns)-1 && index < len(text.paragraphs)-1
			runs = append(runs, &textRun{text: run.Text, options: &options})
		}
	}
	context.slide.addText(runs, &textOptions{x: x, y: y, w: width, h: text.height(width, scale), margin: true, valign: "top", fit: "shrink"})
}

// stack is blocks one above another. Given a height to fill, the last block
// receives whatever the others leave, so a chart at the bottom of a card
// grows.
type stack struct {
	blocks []block
	gap    float64
}

func (column *stack) height(width, scale float64) float64 {
	sum := n(0)
	for _, item := range column.blocks {
		sum += item.height(width, scale)
	}
	return sum + float64(float64(math.Max(0, float64(len(column.blocks)-1))*column.gap)*cqw)*scale
}

func (column *stack) draw(context *drawing, x, y, width, scale float64, height *float64) {
	top := y
	for index, item := range column.blocks {
		own := item.height(width, scale)
		last := index == len(column.blocks)-1
		fill := own
		if last && height != nil {
			fill = float64(y+*height) - top
		}
		item.draw(context, x, top, width, scale, some(fill))
		top += own + float64(column.gap*cqw)*scale
	}
}

type rule struct {
	color string
	top   bool
	inset float64
}

// row is equal columns side by side, with an optional hairline on each.
type row struct {
	columns []block
	gap     float64
	rule    *rule
}

func (line *row) columnWidth(width float64) float64 {
	return float64(width-float64(float64(len(line.columns)-1)*line.gap)*cqw) / float64(len(line.columns))
}

func (line *row) inset(index int, scale float64) (float64, float64) {
	if line.rule == nil {
		return 0, 0
	}
	if line.rule.top {
		return 0, float64(line.rule.inset*cqw) * scale
	}
	if index > 0 {
		return line.rule.inset * cqw, 0
	}
	return 0, 0
}

func (line *row) height(width, scale float64) float64 {
	tallest := math.Inf(-1)
	for index, column := range line.columns {
		offsetX, offsetY := line.inset(index, scale)
		tallest = math.Max(tallest, column.height(line.columnWidth(width)-offsetX, scale)+offsetY)
	}
	return tallest
}

func (line *row) draw(context *drawing, x, y, width, scale float64, _ *float64) {
	height := line.height(width, scale)
	for index, column := range line.columns {
		left := x + float64(index)*float64(line.columnWidth(width)+float64(line.gap*cqw))
		offsetX, offsetY := line.inset(index, scale)
		if line.rule != nil && (line.rule.top || index > 0) {
			w, h := n(0), height
			if line.rule.top {
				w, h = line.columnWidth(width), 0
			}
			context.slide.addShape("line", left, y, w, h, "", &lineOptions{color: line.rule.color, width: 0.75}, 0)
		}
		column.draw(context, left+offsetX, y+offsetY, line.columnWidth(width)-offsetX, scale, nil)
	}
}

func nodesOf(card *cards.Card, nodeType string) []*cards.Node {
	var found []*cards.Node
	for index := range card.Nodes {
		if card.Nodes[index].Type == nodeType {
			found = append(found, &card.Nodes[index])
		}
	}
	return found
}

func plainRuns(text string) cards.RichText { return cards.RichText{{Text: text}} }

func headingBlocks(card *cards.Card, colors palette, large bool) []block {
	nodes := nodesOf(card, "heading")
	if len(nodes) == 0 {
		return nil
	}
	size := n(3.4)
	if large {
		size = 5.4
	}
	return []block{newTextBlock([]paragraph{{runs: nodes[0].Text, style: textStyle{fontFace: colors.headingFace, size: size, color: colors.heading, bold: true, leading: 1.1}}}, 0)}
}

func paragraphBlocks(card *cards.Card, colors palette, large bool) []block {
	size := n(1.8)
	if large {
		size = 2.2
	}
	var blocks []block
	for _, node := range nodesOf(card, "paragraph") {
		blocks = append(blocks, newTextBlock([]paragraph{{runs: node.Text, style: textStyle{fontFace: colors.bodyFace, size: size, color: colors.body, leading: 1.3}}}, 0))
	}
	return blocks
}

func bulletBlock(node *cards.Node, colors palette) block {
	var paragraphs []paragraph
	for _, item := range node.Items {
		paragraphs = append(paragraphs, paragraph{runs: item.Text, bullet: true, style: textStyle{fontFace: colors.bodyFace, size: 1.9, color: colors.body, leading: 1.3}})
	}
	return newTextBlock(paragraphs, 1.2)
}

func bulletBlocks(card *cards.Card, colors palette) []block {
	var blocks []block
	for _, node := range nodesOf(card, "bullets") {
		blocks = append(blocks, bulletBlock(node, colors))
	}
	return blocks
}

func columnsBlock(node *cards.Node, colors palette) block {
	var columns []block
	for _, column := range node.Columns {
		var items []paragraph
		for _, item := range column.Items {
			items = append(items, paragraph{runs: item.Text, style: textStyle{fontFace: colors.bodyFace, size: 1.7, color: colors.body, leading: 1.3}})
		}
		columns = append(columns, &stack{blocks: []block{
			newTextBlock([]paragraph{{runs: plainRuns(column.Heading), style: textStyle{fontFace: colors.headingFace, size: 2.1, color: colors.accent, bold: true, leading: 1.2}}}, 0),
			newTextBlock(items, 1),
		}, gap: 1.4})
	}
	return &row{columns: columns, gap: 3, rule: &rule{color: colors.rule, inset: 3}}
}

func stepsBlock(node *cards.Node, colors palette) block {
	var columns []block
	for index, step := range node.Steps {
		label := jsvalue.FormatNumber(float64(index + 1))
		if len(label) < 2 {
			label = "0" + label
		}
		blocks := []block{
			newTextBlock([]paragraph{{runs: plainRuns(label), style: textStyle{fontFace: colors.bodyFace, size: 1.6, color: colors.accent, bold: true, leading: 1.2}}}, 0),
			newTextBlock([]paragraph{{runs: plainRuns(step.Title), style: textStyle{fontFace: colors.headingFace, size: 1.9, color: colors.heading, bold: true, leading: 1.2}}}, 0),
		}
		if step.Detail != nil {
			blocks = append(blocks, newTextBlock([]paragraph{{runs: step.Detail, style: textStyle{fontFace: colors.bodyFace, size: 1.5, color: colors.body, leading: 1.3}}}, 0))
		}
		columns = append(columns, &stack{blocks: blocks, gap: 1})
	}
	return &row{columns: columns, gap: 2.4, rule: &rule{color: colors.rule, top: true, inset: 1.6}}
}

func statsBlock(nodes []*cards.Node, colors palette) block {
	var columns []block
	for _, stat := range nodes {
		columns = append(columns, &stack{blocks: []block{
			newTextBlock([]paragraph{{runs: plainRuns(stat.Value), style: textStyle{fontFace: colors.headingFace, size: 5, color: colors.accent, bold: true, leading: 1.1}}}, 0),
			newTextBlock([]paragraph{{runs: plainRuns(stat.Label), style: textStyle{fontFace: colors.bodyFace, size: 1.6, color: colors.body, leading: 1.3}}}, 0),
		}, gap: 0.6})
	}
	return &row{columns: columns, gap: 3}
}

func quoteBlock(node *cards.Node, colors palette) block {
	runs := append(cards.RichText{{Text: "“"}}, node.Text...)
	runs = append(runs, cards.TextRun{Text: "”"})
	blocks := []block{newTextBlock([]paragraph{{runs: runs, style: textStyle{fontFace: colors.headingFace, size: 3.2, color: colors.heading, leading: 1.2}}}, 0)}
	if node.Attribution != "" {
		blocks = append(blocks, newTextBlock([]paragraph{{runs: plainRuns(node.Attribution), style: textStyle{fontFace: colors.bodyFace, size: 1.7, color: colors.muted, leading: 1.3}}}, 0))
	}
	return &stack{blocks: blocks, gap: 2}
}

// Widgets. Sizes are in cqw, as in the web card view's widgets.
var (
	// chartMin is the least height a chart's plot takes, as in the browser.
	chartMin      = n(12)
	widgetGapX    = n(3)
	dashboardGapY = n(2.4)
)

var quotes = regexp.MustCompile(`"`)

// numberFormat is an Excel number format writing a chart's prefix and suffix
// around its values.
func numberFormat(node *cards.Node) string {
	quote := func(text string) string {
		if text == "" {
			return ""
		}
		return `"` + quotes.ReplaceAllLiteralString(text, "") + `"`
	}
	whole := true
	for _, series := range node.Series {
		for _, value := range series.Values {
			if !jsvalue.IsInteger(value) {
				whole = false
			}
		}
	}
	decimals := ".0#"
	if whole {
		decimals = ""
	}
	return quote(node.Prefix) + "#,##0" + decimals + quote(node.Suffix)
}

var chartTypes = map[string]string{
	"column":         "bar",
	"bar":            "bar",
	"stacked-column": "bar",
	"line":           "line",
	"area":           "area",
	"pie":            "pie",
	"donut":          "doughnut",
}

// chartBlock is a native PowerPoint chart of the node's data, editable in
// PowerPoint's own data sheet, in the theme's series colors. Its plot fills
// the height left after the caption.
type chartBlock struct {
	node    *cards.Node
	colors  palette
	caption *textBlock
}

func newChartBlock(node *cards.Node, colors palette) *chartBlock {
	chart := &chartBlock{node: node, colors: colors}
	if node.Caption != "" {
		chart.caption = newTextBlock([]paragraph{{runs: plainRuns(node.Caption), style: textStyle{fontFace: colors.bodyFace, size: 1.1, color: colors.muted, leading: 1.3}}}, 0)
	}
	return chart
}

func (chart *chartBlock) captionHeight(width, scale float64) float64 {
	if chart.caption == nil {
		return 0
	}
	return chart.caption.height(width, scale) + cqw*scale
}

func (chart *chartBlock) height(width, scale float64) float64 {
	return float64(float64(chartMin*cqw)*scale) + chart.captionHeight(width, scale)
}

func (chart *chartBlock) draw(context *drawing, x, y, width, scale float64, height *float64) {
	node, colors := chart.node, chart.colors
	total := chart.height(width, scale)
	if height != nil {
		total = *height
	}
	plot := total - chart.captionHeight(width, scale)
	pie := node.Kind == "pie" || node.Kind == "donut"
	labelPt := roundTenth(float64(n(1.25)*ptPerCQW) * scale)
	legendSize := n(1.3)
	if pie {
		legendSize = 1.4
	}
	legendPt := roundTenth(float64(legendSize*ptPerCQW) * scale)
	single := len(node.Series) == 1
	format := numberFormat(node)
	names := make([]string, len(node.Series))
	for index, series := range node.Series {
		names[index] = series.Name
	}
	count := len(node.Series)
	if pie {
		count = len(node.Categories)
	}
	colorCount := min(count, len(colors.series))
	options := chartOptions{
		x:                   x,
		y:                   y,
		w:                   width,
		h:                   plot,
		altText:             jsvalue.Concat(node.Kind, " chart of ", strings.Join(names, ", ")),
		colors:              colors.series[:colorCount],
		surface:             colors.surface,
		showLegend:          pie || !single,
		legendPos:           "t",
		legendColor:         colors.body,
		legendFontFace:      colors.bodyFace,
		legendFontSize:      legendPt,
		dataLabelColor:      colors.heading,
		dataLabelFontFace:   colors.bodyFace,
		dataLabelFontSize:   labelPt,
		dataLabelFormatCode: format,
		valAxisLineShow:     true,
	}
	if pie {
		options.legendPos = "r"
		options.showPercent = true
		options.showValue = false
		options.dataLabelPosition = "bestFit"
		options.dataLabelFormatCode = "0%"
		options.dataBorderPt = 1.5
		options.dataBorderColor = colors.surface
		options.holeSize = 62
	} else {
		options.catAxisLabelColor = colors.muted
		options.catAxisLabelFontFace = colors.bodyFace
		options.catAxisLabelFontSize = labelPt
		options.catAxisLineColor = colors.muted
		options.valAxisLabelColor = colors.muted
		options.valAxisLabelFontFace = colors.bodyFace
		options.valAxisLabelFontSize = labelPt
		options.valAxisLabelFormatCode = format
		options.valAxisLineShow = false
		options.valGridColor = colors.rule
		options.valGridSize = 0.75
	}
	if node.Kind == "column" || node.Kind == "bar" || node.Kind == "stacked-column" {
		labelled := single && len(node.Categories) <= 8 && node.Kind != "stacked-column"
		options.barDir = "col"
		if node.Kind == "bar" {
			options.barDir = "bar"
		}
		options.barGrouping = "clustered"
		if node.Kind == "stacked-column" {
			options.barGrouping = "stacked"
		}
		options.barGapWidthPct = 40
		options.showValue = labelled
		options.dataLabelPosition = "outEnd"
		// A horizontal chart lists its first category at the top, as the
		// browser does.
		if node.Kind == "bar" {
			options.catAxisOrientation = "maxMin"
		}
		if node.Kind == "bar" && labelled {
			options.valAxisHidden = true
			options.valGridNone = true
		}
	}
	if node.Kind == "line" || node.Kind == "area" {
		options.lineSize = 2
		options.lineDataSymbol = "circle"
		if node.Kind == "area" {
			options.lineDataSymbol = "none"
			options.opacity = 40
		}
		options.lineDataSymbolSize = roundTenth(float64(float64(n(0.6)*ptPerCQW)*scale) + 2)
		options.lineDataSymbolLineColor = colors.surface
		options.lineDataSymbolLineSize = 1.5
	} else {
		options.lineSize = 2
	}
	series := make([]chartSeries, len(node.Series))
	for index, entry := range node.Series {
		series[index] = chartSeries{name: entry.Name, labels: node.Categories, values: entry.Values}
	}
	context.deck.addChart(context.slide, chartTypes[node.Kind], series, options)
	if chart.caption != nil {
		chart.caption.draw(context, x, float64(y+plot)+cqw*scale, width, scale, nil)
	}
}

var numericCell = regexp.MustCompile(`^[-+−]?[$€£¥₹]?[` + jsvalue.SpaceClass + `]?[0-9.,]+[` + jsvalue.SpaceClass + `]?(%|[A-Za-z]{1,3})?$`)

var (
	cellPadX = n(1)
	cellPadY = n(0.75)
)

// tableBlock is a native table: headings over a heavier rule, rows over
// hairlines, figures aligned right.
type tableBlock struct {
	node    *cards.Node
	colors  palette
	numeric []bool
	rows    [][]string
}

var (
	tableSize    = n(1.5)
	tableLeading = n(1.3)
)

func newTableBlock(node *cards.Node, colors palette) *tableBlock {
	table := &tableBlock{node: node, colors: colors}
	for column := range node.TableColumns {
		var cells []string
		for _, row := range node.Rows {
			if column < len(row.Cells) && row.Cells[column] != "" {
				cells = append(cells, row.Cells[column])
			}
		}
		numeric := len(cells) > 0
		for _, cell := range cells {
			if !numericCell.MatchString(jsvalue.Trim(cell)) {
				numeric = false
			}
		}
		table.numeric = append(table.numeric, numeric)
	}
	table.rows = append(table.rows, node.TableColumns)
	for _, row := range node.Rows {
		table.rows = append(table.rows, row.Cells)
	}
	return table
}

func (table *tableBlock) rowHeights(width, scale float64) []float64 {
	columnWidth := width/float64(len(table.node.TableColumns)) - float64(float64(2*cellPadX)*cqw)*scale
	sizePt := float64(tableSize*ptPerCQW) * scale
	heights := make([]float64, len(table.rows))
	for index, cells := range table.rows {
		lines := n(1)
		for _, cell := range cells {
			if cell == "" {
				cell = " "
			}
			lines = math.Max(lines, wrappedLines(cell, sizePt, columnWidth*72, index == 0))
		}
		heights[index] = float64(float64(lines*sizePt)*tableLeading)/72 + float64(float64(2*cellPadY)*cqw)*scale
	}
	return heights
}

func (table *tableBlock) height(width, scale float64) float64 {
	sum := n(0)
	for _, value := range table.rowHeights(width, scale) {
		sum += value
	}
	return sum
}

func (table *tableBlock) draw(context *drawing, x, y, width, scale float64, _ *float64) {
	colors := table.colors
	sizePt := roundTenth(float64(tableSize*ptPerCQW) * scale)
	var margin [4]float64
	for index, value := range []float64{cellPadY, cellPadX, cellPadY, cellPadX} {
		margin[index] = roundTenth(float64(value*ptPerCQW) * scale)
	}
	cells := make([][]tableCell, len(table.rows))
	for index, row := range table.rows {
		for column, text := range row {
			cell := tableCell{text: text, bold: index == 0, fontFace: colors.bodyFace, color: colors.body, align: "left"}
			if index == 0 {
				cell.fontFace, cell.color = colors.headingFace, colors.heading
			}
			if column < len(table.numeric) && table.numeric[column] {
				cell.align = "right"
			}
			weight := n(0.75)
			if index == 0 {
				weight = 1.5
			}
			none := border{none: true, color: "666666", pt: 1}
			cell.borders = [4]border{none, none, {color: colors.rule, pt: weight}, none}
			cells[index] = append(cells[index], cell)
		}
	}
	columns := make([]float64, len(table.node.TableColumns))
	for index := range columns {
		columns[index] = width / float64(len(table.node.TableColumns))
	}
	context.slide.addTable(cells, x, y, width, columns, table.rowHeights(width, scale), sizePt, margin, "top")
}

// progressBlock is labelled meters: a label and percentage over a rounded
// track filled to the value.
type progressBlock struct {
	node   *cards.Node
	colors palette
	labels []*textBlock
}

var meterTrack = n(0.8)

func newProgressBlock(node *cards.Node, colors palette) *progressBlock {
	progress := &progressBlock{node: node, colors: colors}
	for _, meter := range node.Meters {
		progress.labels = append(progress.labels, newTextBlock([]paragraph{{runs: plainRuns(meter.Label), style: textStyle{fontFace: colors.bodyFace, size: 1.6, color: colors.body, leading: 1.3}}}, 0))
	}
	return progress
}

func valueWidth(scale float64) float64 { return float64(float64(n(1.6)*3.2)*cqw) * scale }

func (progress *progressBlock) meterHeight(index int, width, scale float64) float64 {
	return progress.labels[index].height(width-valueWidth(scale), scale) + float64(float64(n(0.6)+meterTrack)*cqw)*scale
}

func (progress *progressBlock) height(width, scale float64) float64 {
	sum := n(0)
	for index := range progress.labels {
		sum += progress.meterHeight(index, width, scale)
	}
	return sum + float64(float64(math.Max(0, float64(len(progress.labels)-1))*1.6)*cqw)*scale
}

func (progress *progressBlock) draw(context *drawing, x, y, width, scale float64, _ *float64) {
	colors := progress.colors
	top := y
	for index, label := range progress.labels {
		meter := progress.node.Meters[index]
		labelWidth := width - valueWidth(scale)
		labelHeight := label.height(labelWidth, scale)
		label.draw(context, x, top, labelWidth, scale, nil)
		context.slide.addTextString(jsvalue.FormatNumber(meter.Value)+"%", &textOptions{
			x: x + labelWidth, y: top, w: valueWidth(scale), h: labelHeight, margin: true,
			align: "right", valign: "top", bold: true, fontFace: colors.headingFace,
			fontSize: roundTenth(float64(n(1.6)*ptPerCQW) * scale), color: colors.heading,
		})
		trackTop := float64(top+labelHeight) + float64(n(0.6)*cqw)*scale
		trackHeight := float64(meterTrack*cqw) * scale
		context.slide.addShape("roundRect", x, trackTop, width, trackHeight, colors.rule, nil, trackHeight/2)
		if meter.Value > 0 {
			fill := colors.accent
			if len(colors.series) > 0 {
				fill = colors.series[0]
			}
			context.slide.addShape("roundRect", x, trackTop, math.Max(trackHeight, float64(width*meter.Value)/100), trackHeight, fill, nil, trackHeight/2)
		}
		top += progress.meterHeight(index, width, scale) + float64(n(1.6)*cqw)*scale
	}
}

var toneMarks = map[string]string{"note": "i", "positive": "✓", "caution": "!"}

// calloutBlock is a remark beside a rule in its tone's color, marked with the
// tone's sign.
type calloutBlock struct {
	node   *cards.Node
	colors palette
	text   *textBlock
}

var calloutPad = n(0.3)

func newCalloutBlock(node *cards.Node, colors palette) *calloutBlock {
	return &calloutBlock{node: node, colors: colors, text: newTextBlock([]paragraph{{runs: node.Text, style: textStyle{fontFace: colors.bodyFace, size: 1.7, color: colors.body, leading: 1.3}}}, 0)}
}

func calloutInset(scale float64) float64 {
	return float64(float64(float64(float64(n(0.35)+1.6)+2)+1.2)*cqw) * scale
}

func (callout *calloutBlock) color() string {
	switch callout.node.Tone {
	case "positive":
		return callout.colors.positive
	case "caution":
		return callout.colors.caution
	}
	return callout.colors.accent
}

func (callout *calloutBlock) height(width, scale float64) float64 {
	return callout.text.height(width-calloutInset(scale), scale) + float64(float64(2*calloutPad)*cqw)*scale
}

func (callout *calloutBlock) draw(context *drawing, x, y, width, scale float64, _ *float64) {
	height := callout.height(width, scale)
	color := callout.color()
	context.slide.addShape("rect", x, y, float64(n(0.35)*cqw)*scale, height, color, nil, 0)
	context.slide.addTextString(toneMarks[callout.node.Tone], &textOptions{
		x: x + float64(float64(n(0.35)+1.6)*cqw)*scale, y: y + float64(calloutPad*cqw)*scale,
		w: float64(n(2)*cqw) * scale, h: float64(n(2)*cqw) * scale, margin: true,
		align: "center", valign: "middle", bold: true, fontFace: callout.colors.bodyFace,
		fontSize: roundTenth(float64(n(1.4)*ptPerCQW) * scale), color: color,
	})
	callout.text.draw(context, x+calloutInset(scale), y+float64(calloutPad*cqw)*scale, width-calloutInset(scale), scale, nil)
}

func widget(node *cards.Node, colors palette) block {
	switch node.Type {
	case "chart":
		return newChartBlock(node, colors)
	case "table":
		return newTableBlock(node, colors)
	case "progress":
		return newProgressBlock(node, colors)
	}
	return newCalloutBlock(node, colors)
}

// centered is a block centered in the height it is drawn into, unless it
// grows to fill it.
type centered struct {
	inner block
	grows bool
}

func (box centered) height(width, scale float64) float64 { return box.inner.height(width, scale) }

func (box centered) draw(context *drawing, x, y, width, scale float64, height *float64) {
	own := box.inner.height(width, scale)
	if box.grows || height == nil {
		box.inner.draw(context, x, y, width, scale, height)
		return
	}
	box.inner.draw(context, x, y+math.Max(0, (*height-own)/2), width, scale, nil)
}

// featureBlock is the body of a chart or table card: its widget beside the
// text at its size's share of the width, or above the text at full size. A
// chart grows into the height left over; a table keeps its own.
type featureBlock struct {
	content block
	text    *stack
	hasText bool
	grows   bool
	row     bool
	share   float64
}

func feature(card *cards.Card, colors palette) block {
	var widgetNode *cards.Node
	for index := range card.Nodes {
		if card.Nodes[index].Type == card.Layout {
			widgetNode = &card.Nodes[index]
			break
		}
	}
	textBlocks := &stack{gap: 1.8}
	count := 0
	for index := range card.Nodes {
		entry := &card.Nodes[index]
		if entry == widgetNode || (entry.Type != "paragraph" && entry.Type != "bullets" && entry.Type != "callout") {
			continue
		}
		count++
		switch entry.Type {
		case "callout":
			textBlocks.blocks = append(textBlocks.blocks, newCalloutBlock(entry, colors))
		case "bullets":
			textBlocks.blocks = append(textBlocks.blocks, bulletBlock(entry, colors))
		default:
			textBlocks.blocks = append(textBlocks.blocks, newTextBlock([]paragraph{{runs: entry.Text, style: textStyle{fontFace: colors.bodyFace, size: 1.8, color: colors.body, leading: 1.3}}}, 0))
		}
	}
	if widgetNode == nil {
		return textBlocks
	}
	isRow, share := cards.FeatureSplit(widgetNode.Size, count > 0)
	return &featureBlock{content: widget(widgetNode, colors), text: textBlocks, hasText: count > 0, grows: widgetNode.Type == "chart", row: isRow, share: share}
}

func (box *featureBlock) widths(width, scale float64) (float64, float64) {
	room := width - float64(widgetGapX*cqw)*scale
	return room * box.share, room * float64(1-box.share)
}

func (box *featureBlock) gap(scale float64) float64 {
	if !box.hasText {
		return 0
	}
	return float64(widgetGapX*cqw) * scale
}

func (box *featureBlock) height(width, scale float64) float64 {
	if box.row {
		left, right := box.widths(width, scale)
		return math.Max(box.content.height(left, scale), box.text.height(right, scale))
	}
	textHeight := n(0)
	if box.hasText {
		textHeight = box.text.height(width, scale)
	}
	return float64(box.content.height(width, scale)+box.gap(scale)) + textHeight
}

func (box *featureBlock) draw(context *drawing, x, y, width, scale float64, height *float64) {
	total := box.height(width, scale)
	if height != nil {
		total = *height
	}
	if box.row {
		left, right := box.widths(width, scale)
		var fill *float64
		if box.grows {
			fill = some(total)
		}
		box.content.draw(context, x, y, left, scale, fill)
		centered{inner: box.text}.draw(context, float64(x+left)+float64(widgetGapX*cqw)*scale, y, right, scale, some(total))
		return
	}
	textHeight := n(0)
	if box.hasText {
		textHeight = box.text.height(width, scale)
	}
	own := box.content.height(width, scale)
	if box.grows {
		own = float64(total-textHeight) - box.gap(scale)
	}
	box.content.draw(context, x, y, width, scale, some(own))
	if box.hasText {
		box.text.draw(context, x, float64(y+own)+box.gap(scale), width, scale, nil)
	}
}

type dashboardCell struct {
	content block
	width   float64
	grows   bool
}

// dashboardBlock is dashboard widgets in rows that share the height; each
// widget takes its share of its row.
type dashboardBlock struct {
	rows [][]dashboardCell
}

func dashboard(card *cards.Card, colors palette) block {
	var widgets []*cards.Node
	for index := range card.Nodes {
		if card.Nodes[index].IsWidget() {
			widgets = append(widgets, &card.Nodes[index])
		}
	}
	board := &dashboardBlock{}
	for _, cells := range cards.WidgetRows(widgets) {
		var row []dashboardCell
		for _, cell := range cells {
			row = append(row, dashboardCell{content: widget(cell.Widget, colors), width: cell.Width, grows: cell.Widget.Type == "chart"})
		}
		board.rows = append(board.rows, row)
	}
	return board
}

func (board *dashboardBlock) cellWidths(row []dashboardCell, width, scale float64) []float64 {
	room := width - float64(float64(math.Max(0, float64(len(row)-1))*widgetGapX)*cqw)*scale
	widths := make([]float64, len(row))
	for index, cell := range row {
		widths[index] = room * cell.width
	}
	return widths
}

func (board *dashboardBlock) rowHeight(row []dashboardCell, width, scale float64) float64 {
	widths := board.cellWidths(row, width, scale)
	tallest := math.Inf(-1)
	for index, cell := range row {
		tallest = math.Max(tallest, cell.content.height(widths[index], scale))
	}
	return tallest
}

func (board *dashboardBlock) gaps(scale float64) float64 {
	return float64(float64(math.Max(0, float64(len(board.rows)-1))*dashboardGapY)*cqw) * scale
}

func (board *dashboardBlock) height(width, scale float64) float64 {
	sum := n(0)
	for _, row := range board.rows {
		sum += board.rowHeight(row, width, scale)
	}
	return sum + board.gaps(scale)
}

func (board *dashboardBlock) draw(context *drawing, x, y, width, scale float64, height *float64) {
	natural := make([]float64, len(board.rows))
	for index, row := range board.rows {
		natural[index] = board.rowHeight(row, width, scale)
	}
	// Rows share the height equally, as flex rows do, unless one needs more.
	total := board.height(width, scale)
	if height != nil {
		total = *height
	}
	spare := math.Max(0, total-board.gaps(scale))
	even := spare / float64(len(board.rows))
	var tall []float64
	for _, value := range natural {
		if value > even {
			tall = append(tall, value)
		}
	}
	tallSum := n(0)
	for _, value := range tall {
		tallSum += value
	}
	others := float64(len(board.rows) - len(tall))
	if others == 0 {
		others = 1
	}
	rest := (spare - tallSum) / others
	top := y
	for rowIndex, row := range board.rows {
		share := even
		if len(tall) > 0 {
			share = rest
		}
		own := math.Max(natural[rowIndex], share)
		widths := board.cellWidths(row, width, scale)
		left := x
		for index, cell := range row {
			centered{inner: cell.content, grows: cell.grows}.draw(context, left, top, widths[index], scale, some(own))
			left += widths[index] + float64(widgetGapX*cqw)*scale
		}
		top += own + float64(dashboardGapY*cqw)*scale
	}
}

type arrangement struct {
	justify string
	gap     float64
}

// arrangements are where a layout's content sits in its box, and the gap
// between blocks.
var arrangements = map[string]arrangement{
	"title":       {"center", 2},
	"statement":   {"center", 2.4},
	"bullets":     {"start", 3},
	"comparison":  {"start", 3},
	"process":     {"start", 3.4},
	"quote":       {"center", 2.4},
	"image-left":  {"center", 2.4},
	"image-right": {"center", 2.4},
	"cover":       {"end", 1.6},
	"stats":       {"center", 3.4},
	"chart":       {"start", 2.6},
	"table":       {"start", 2.6},
	"dashboard":   {"start", 2.6},
}

// body is the card's content blocks, in the order the web card view stacks
// them.
func body(card *cards.Card, colors palette) []block {
	var blocks []block
	switch card.Layout {
	case "title", "cover":
		blocks = append(headingBlocks(card, colors, true), paragraphBlocks(card, colors, true)...)
	case "statement":
		blocks = append(headingBlocks(card, colors, false), paragraphBlocks(card, colors, true)...)
	case "bullets", "image-left", "image-right":
		blocks = append(headingBlocks(card, colors, false), bulletBlocks(card, colors)...)
		blocks = append(blocks, paragraphBlocks(card, colors, false)...)
	case "comparison":
		blocks = headingBlocks(card, colors, false)
		for _, node := range nodesOf(card, "columns") {
			blocks = append(blocks, columnsBlock(node, colors))
		}
	case "process":
		blocks = headingBlocks(card, colors, false)
		for _, node := range nodesOf(card, "steps") {
			blocks = append(blocks, stepsBlock(node, colors))
		}
	case "quote":
		blocks = headingBlocks(card, colors, false)
		for _, node := range nodesOf(card, "quote") {
			blocks = append(blocks, quoteBlock(node, colors))
		}
	case "stats":
		blocks = append(headingBlocks(card, colors, false), statsBlock(nodesOf(card, "stat"), colors))
		blocks = append(blocks, paragraphBlocks(card, colors, false)...)
	case "chart", "table":
		blocks = append(headingBlocks(card, colors, false), feature(card, colors))
	case "dashboard":
		blocks = append(headingBlocks(card, colors, false), dashboard(card, colors))
	}
	return blocks
}

// fittingScale is the largest text scale, at most 1, at which content fits
// the height. Below the floor the text would be unreadable, so the floor is
// used and PowerPoint's shrink-on-overflow takes over.
func fittingScale(content block, width, height float64) float64 {
	if content.height(width, 1) <= height {
		return 1
	}
	low, high := minScale, n(1)
	for step := 0; step < 12; step++ {
		middle := (low + high) / 2
		if content.height(width, middle) <= height {
			low = middle
		} else {
			high = middle
		}
	}
	return low
}

type box struct{ x, y, w, h float64 }

// placeImage fills a box with a picture the way CSS object-fit and
// object-position would.
func placeImage(target *slide, node *cards.Node, asset *Asset, frame box) {
	focusX, focusY := n(0.5), n(0.5)
	if node.Focus != nil {
		focusX, focusY = node.Focus.X, node.Focus.Y
	}
	extension := "png"
	if asset.MimeType == "image/jpeg" {
		extension = "jpeg"
	}
	ratio := asset.Width / asset.Height
	if node.Fit == "contain" {
		w := math.Min(frame.w, frame.h*ratio)
		h := w / ratio
		target.addImage(extension, asset.Data, frame.x+float64(frame.w-w)*focusX, frame.y+float64(frame.h-h)*focusY, w, h, node.Alt, nil)
		return
	}
	w := math.Max(frame.w, frame.h*ratio)
	h := w / ratio
	target.addImage(extension, asset.Data, frame.x, frame.y, w, h, node.Alt, &cropBox{x: float64(w-frame.w) * focusX, y: float64(h-frame.h) * focusY, w: frame.w, h: frame.h})
}

// Padding and footer, in cqw, as the web card view lays them out.
var (
	padX       = n(6)
	padSplit   = n(5)
	padTop     = n(5)
	padBottom  = n(2.2)
	footerSize = n(1.1)
	footerGap  = n(2.8)
)

var sourceNumber = regexp.MustCompile(`^s([0-9]+)$`)

// prototypeNames are Object.prototype's properties, found by a lookup in the
// stock library table when no library has the name, with their .name.
var prototypeNames = map[string]string{
	"constructor":          "Object",
	"__defineGetter__":     "__defineGetter__",
	"__defineSetter__":     "__defineSetter__",
	"hasOwnProperty":       "hasOwnProperty",
	"__lookupGetter__":     "__lookupGetter__",
	"__lookupSetter__":     "__lookupSetter__",
	"isPrototypeOf":        "isPrototypeOf",
	"propertyIsEnumerable": "propertyIsEnumerable",
	"toString":             "toString",
	"valueOf":              "valueOf",
	"toLocaleString":       "toLocaleString",
	"__proto__":            "",
}

// runFrom turns an asset metadata value into a run's text as pptxgenjs reads
// a run's text: strings and numbers as text, falsy values as no text, an
// array as its joined text, and anything else as a TypeError.
func runFrom(value jsvalue.Value) (*textRun, error) {
	switch value.Kind() {
	case jsvalue.String:
		return &textRun{text: value.Str()}, nil
	case jsvalue.Number:
		if value.Number() == 0 || value.Number() != value.Number() {
			return &textRun{}, nil
		}
		return &textRun{text: jsvalue.FormatNumber(value.Number())}, nil
	case jsvalue.Undefined, jsvalue.Null:
		return &textRun{}, nil
	case jsvalue.Bool:
		if !value.Bool() {
			return &textRun{}, nil
		}
		return nil, ErrInput
	case jsvalue.Array:
		for _, item := range value.Items() {
			if item.IsString() && item.Str() == crlf {
				return nil, ErrInput
			}
		}
		if hasOptions(value) {
			return nil, ErrInput
		}
		text, err := jsvalue.ToString(value)
		if err != nil {
			return nil, ErrInput
		}
		return &textRun{text: text, raw: true}, nil
	}
	return nil, ErrInput
}

// hasOptions reports an array that pptxgenjs's hyperlink scan cannot walk:
// it reads every item as a text object, so a null item throws, and an object
// item with options or nested text becomes text formatting. The export does
// not reproduce that formatting and refuses such metadata instead.
func hasOptions(value jsvalue.Value) bool {
	for _, item := range value.Items() {
		switch {
		case item.IsNullish():
			return true
		case item.IsObject() && (item.Get("options").Truthy() || item.Get("text").IsArray()):
			return true
		case item.IsArray() && hasOptions(item):
			return true
		}
	}
	return false
}

// linkFrom is `url ? { hyperlink: { url }, color } : {}` for a metadata value.
func linkFrom(value jsvalue.Value, color string) (*textOptions, error) {
	if !value.Truthy() {
		return &textOptions{}, nil
	}
	text, err := jsvalue.ToString(value)
	if err != nil || text == "" {
		return nil, ErrInput
	}
	return &textOptions{link: &hyperlink{url: text}, color: color}, nil
}

func footer(target *slide, card *cards.Card, position int, colors palette, x, width float64, sources []Source, asset *Asset) (float64, error) {
	sizePt := roundTenth(footerSize * ptPerCQW)
	height := float64(float64(footerSize*ptPerCQW)*1.4) / 72
	y := float64(slideH-float64(padBottom*cqw)) - height
	var runs []*textRun
	for _, sourceID := range card.SourceIDs {
		match := sourceNumber.FindStringSubmatch(sourceID)
		number := jsvalue.ParseNumber(match[1])
		index := int(number) - 1
		if index < 0 || index >= len(sources) {
			continue
		}
		source := sources[index]
		options := &textOptions{}
		if source.HasURL {
			tooltip := source.URL
			if source.HasTitle {
				tooltip = source.Title
			}
			options = &textOptions{link: &hyperlink{url: source.URL, tooltip: tooltip, hasTooltip: tooltip != ""}, color: colors.muted}
		}
		runs = append(runs, &textRun{text: "[" + jsvalue.FormatNumber(number) + "]", options: options}, &textRun{text: " "})
	}
	if asset != nil {
		credit := asset.Source
		if credit.Get("type").IsString() && credit.Get("type").Str() == "stock" && credit.Get("photographer").Truthy() {
			// "Photo by X on Library", with both names linked as the libraries ask.
			provider := credit.Get("provider")
			key := ""
			if !provider.IsNullish() {
				converted, err := jsvalue.ToString(provider)
				if err != nil {
					return 0, ErrInput
				}
				key = converted
			}
			name, url := jsvalue.UndefinedValue(), jsvalue.UndefinedValue()
			if library, ok := cards.StockLibraries()[key]; ok {
				name, url = jsvalue.StringValue(library.Name), jsvalue.StringValue(library.URL)
			} else if functionName, ok := prototypeNames[key]; ok && functionName != "" {
				name = jsvalue.StringValue(functionName)
			}
			if name.IsUndefined() {
				name = provider
				if name.IsNullish() {
					name = jsvalue.StringValue("")
				}
			}
			photographer, err := runFrom(credit.Get("photographer"))
			if err != nil {
				return 0, err
			}
			if photographer.options, err = linkFrom(credit.Get("photographerUrl"), colors.muted); err != nil {
				return 0, err
			}
			library, err := runFrom(name)
			if err != nil {
				return 0, err
			}
			if library.options, err = linkFrom(url, colors.muted); err != nil {
				return 0, err
			}
			runs = append(runs, &textRun{text: "Photo by "}, photographer, &textRun{text: " on "}, library)
		}
	}
	options := func() textOptions {
		return textOptions{y: y, h: height, margin: true, fontFace: colors.bodyFace, fontSize: sizePt, color: colors.muted}
	}
	if len(runs) > 0 {
		box := options()
		box.x, box.w, box.valign = x, width*0.8, "bottom"
		target.addText(runs, &box)
	}
	number := options()
	number.x, number.w, number.align = x+width*0.8, width*0.2, "right"
	target.addTextString(jsvalue.FormatNumber(float64(position)), &number)
	return y, nil
}

func addCard(context *drawing, card *cards.Card, position int, theme palette, assets map[string]*Asset, sources []Source, scrim []byte) error {
	target := context.deck.addSlide()
	context.slide = target
	target.background = theme.surface
	images := nodesOf(card, "image")
	var image *cards.Node
	var asset *Asset
	if len(images) > 0 {
		image = images[0]
		asset = assets[image.AssetID]
	}
	split := card.Layout == "image-left" || card.Layout == "image-right"
	cover := card.Layout == "cover"
	colors := theme
	if cover {
		colors = exportPalette(cards.CoverPalette(), cards.Theme{}, theme.series, theme.positive, theme.caution)
		colors.headingFace, colors.bodyFace = theme.headingFace, theme.bodyFace
	}
	x := padX * cqw
	width := slideW - float64(2*padX)*cqw
	if split {
		half := slideW / 2
		imageLeft := card.Layout == "image-left"
		if image != nil && asset != nil {
			left := half
			if imageLeft {
				left = 0
			}
			placeImage(target, image, asset, box{x: left, y: 0, w: half, h: slideH})
		}
		start := n(0)
		if imageLeft {
			start = half
		}
		x = start + padSplit*cqw
		width = half - float64(2*padSplit)*cqw
	}
	if cover && image != nil && asset != nil {
		placeImage(target, image, asset, box{x: 0, y: 0, w: slideW, h: slideH})
		target.addImage("png", scrim, 0, 0, slideW, slideH, "", nil)
	}
	footerTop, err := footer(target, card, position, colors, x, width, sources, asset)
	if err != nil {
		return err
	}
	top := padTop * cqw
	available := float64(footerTop-footerGap*cqw) - top
	layout := arrangements[card.Layout]
	content := &stack{blocks: body(card, colors), gap: layout.gap}
	scale := fittingScale(content, width, available)
	height := math.Min(content.height(width, scale), available)
	offset := n(0)
	switch layout.justify {
	case "center":
		offset = (available - height) / 2
	case "end":
		offset = available - height
	}
	// Widget cards fill the slide, so their charts grow into the room left.
	var fill *float64
	if card.Layout == "chart" || card.Layout == "table" || card.Layout == "dashboard" {
		fill = some(available)
	}
	content.draw(context, x, top+offset, width, scale, fill)
	if card.Notes != "" {
		target.addNotes(card.Notes)
	}
	return context.err
}

// coverScrim is the cover card's scrim: black fading from 80% at the bottom
// to 5% at the top, as a one-pixel-wide PNG stretched over the slide. It is
// the PNG the TypeScript export compresses, generated by templates/generate.ts.
func coverScrim() []byte {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(template("scrim.png.base64")))
	if err != nil {
		panic("embedded scrim is not base64: " + err.Error())
	}
	return data
}

// Write writes the document as PPTX file bytes.
func Write(document *cards.Document, assets map[string]*Asset, sources []Source) ([]byte, error) {
	return write(document, assets, sources, time.Now())
}

func write(document *cards.Document, assets map[string]*Asset, sources []Source, now time.Time) ([]byte, error) {
	definition := cards.ThemeDefinition(document.Theme)
	deck := &presentation{title: document.Title, headFont: definition.Fonts.Heading, bodyFont: definition.Fonts.Body}
	series := make([]string, len(definition.Chart.Series))
	for index, color := range definition.Chart.Series {
		series[index] = bare(color)
	}
	theme := exportPalette(definition.Palette, definition, series, bare(definition.Chart.Positive), bare(definition.Chart.Caution))
	context := &drawing{deck: deck}
	var scrim []byte
	for index, cardID := range document.CardOrder {
		card := document.Cards[cardID]
		if card == nil {
			continue
		}
		if card.Layout == "cover" && scrim == nil {
			scrim = coverScrim()
		}
		if err := addCard(context, card, index+1, theme, assets, sources, scrim); err != nil {
			if errors.Is(err, ErrInput) {
				return nil, err
			}
			return nil, err
		}
	}
	return deck.write(now), nil
}
