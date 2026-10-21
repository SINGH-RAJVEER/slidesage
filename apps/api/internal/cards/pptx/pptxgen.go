package pptx

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// This file reproduces the parts of pptxgenjs 4.0.1 that the export uses:
// text boxes, shapes, pictures, tables, and notes, written as the same XML,
// including the option defaults and mutations that reach the output.

const (
	emu         = 914400
	onePoint    = 12700
	crlf        = "\r\n"
	slideWidth  = 12192000
	slideHeight = 6858000
)

var hexColor = regexp.MustCompile(`^[0-9a-fA-F]{6}$`)

var schemeColors = []string{"tx1", "tx2", "bg1", "bg2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"}

// number writes a number as a template literal does.
func number(value float64) string { return jsvalue.FormatNumber(value) }

func integer(value int) string { return strconv.Itoa(value) }

func round(value float64) float64 { return jsvalue.Round(value) }

// encode is encodeXmlEntities.
func encode(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(text)
}

// inchToEMU is inch2Emu for a number.
func inchToEMU(inches float64) float64 {
	if inches > 100 {
		return inches
	}
	return round(float64(emu * inches))
}

// smartNumber is getSmartParseNumber for a number: inches below 100, EMU
// above, and zero for NaN.
func smartNumber(size float64) float64 {
	switch {
	case size < 100:
		return inchToEMU(size)
	case size >= 100:
		return size
	}
	return 0
}

// percent is getSmartParseNumber for a percentage of the slide.
func percent(value float64, length float64) float64 {
	return round(float64(value / 100 * length))
}

// points is valToPts.
func points(value float64) float64 {
	if value != value {
		return 0
	}
	return round(float64(value * onePoint))
}

// colorElement is createColorElement.
func colorElement(color, inner string) string {
	value := strings.Replace(color, "#", "", 1)
	isHex := hexColor.MatchString(value)
	scheme := false
	for _, name := range schemeColors {
		if value == name {
			scheme = true
		}
	}
	if !isHex && !scheme {
		value = "000000"
		isHex = true
	}
	tag := "schemeClr"
	if isHex {
		tag = "srgbClr"
		value = strings.ToUpper(value)
	}
	if inner != "" {
		return "<a:" + tag + ` val="` + value + `">` + inner + "</a:" + tag + ">"
	}
	return "<a:" + tag + ` val="` + value + `"/>`
}

// solidFill is genXmlColorSelection for a solid color with no transparency.
func solidFill(color string) string {
	return "<a:solidFill>" + colorElement(color, "") + "</a:solidFill>"
}

// hyperlink is a run's link. URL is what the link's url converts to.
type hyperlink struct {
	url        string
	tooltip    string
	hasTooltip bool
	relID      int
}

// bullet is a paragraph bullet character and its indent in points.
type bullet struct {
	characterCode string
	indent        float64
}

// textOptions are the options of a text box or of one run. Zero values stand
// for the falsy values JavaScript would see.
type textOptions struct {
	x, y, w, h      float64
	margin          bool
	align           string
	valign          string
	fit             string
	bold, italic    bool
	fontFace        string
	fontSize        float64
	color           string
	lineSpacing     float64
	paraSpaceBefore float64
	bullet          *bullet
	breakLine       bool
	link            *hyperlink

	objectName string
	anchor     string
}

// textRun is one run of a text box. Raw marks text that was not a string, so
// it skips line-break handling and is written even when empty.
type textRun struct {
	text    string
	raw     bool
	options *textOptions
}

type lineOptions struct {
	none  bool
	color string
	width float64
}

type objectKind int

const (
	textKind objectKind = iota
	imageKind
	tableKind
	chartKind
	notesKind
)

type slideObject struct {
	kind objectKind

	// text boxes and shapes
	options *textOptions
	runs    []*textRun
	shape   string
	fill    string
	line    *lineOptions
	radius  float64

	// pictures
	image *imageObject

	// tables
	table *tableObject

	// charts
	chart *chartObject

	// notes
	notes string
}

type imageObject struct {
	x, y, w, h float64
	altText    string
	objectName string
	relID      int
	crop       *cropBox
}

type cropBox struct{ x, y, w, h float64 }

type hyperlinkRel struct {
	relID  int
	target string
}

type mediaRel struct {
	relID  int
	target string
	data   []byte
}

type slide struct {
	number     int
	background string
	objects    []*slideObject
	rels       []hyperlinkRel
	charts     []*chartObject
	media      []mediaRel
}

// presentation is the deck being written.
type presentation struct {
	title     string
	headFont  string
	bodyFont  string
	slides    []*slide
	chartSeen int
}

func (deck *presentation) addSlide() *slide {
	created := &slide{number: len(deck.slides) + 1}
	deck.slides = append(deck.slides, created)
	return created
}

func (target *slide) newRelID() int {
	return len(target.rels) + len(target.charts) + len(target.media) + 1
}

func (target *slide) count(kind objectKind) int {
	total := 0
	for _, object := range target.objects {
		if object.kind == kind {
			total++
		}
	}
	return total
}

// clean applies addTextDefinition's cleanOpts. parentColor is the text box's
// own color, already cleaned, for its runs.
func (target *slide) clean(options *textOptions, parentColor string) {
	if options.color == "" {
		options.color = parentColor
	}
	if options.color == "" {
		options.color = "000000"
	}
	if options.objectName == "" {
		options.objectName = "Text " + integer(target.count(textKind))
	} else {
		options.objectName = encode(options.objectName)
	}
	options.anchor = "ctr"
	switch {
	case strings.HasPrefix(strings.ToLower(options.valign), "b"):
		options.anchor = "b"
	case strings.HasPrefix(strings.ToLower(options.valign), "m"):
		options.anchor = "ctr"
	case strings.HasPrefix(strings.ToLower(options.valign), "t"):
		options.anchor = "t"
	}
}

// addText is Slide.addText with a list of runs. A run without options gets
// its own empty options, as addTextDefinition gives it.
func (target *slide) addText(runs []*textRun, options *textOptions) {
	if len(runs) == 0 {
		runs = []*textRun{{}}
	}
	target.clean(options, "")
	for _, run := range runs {
		if run.options == nil {
			run.options = &textOptions{}
		}
		if run.options != options {
			target.clean(run.options, options.color)
		}
	}
	for _, run := range runs {
		if link := run.options.link; link != nil && link.relID == 0 {
			link.relID = target.newRelID()
			target.rels = append(target.rels, hyperlinkRel{relID: link.relID, target: encode(link.url)})
		}
	}
	target.objects = append(target.objects, &slideObject{kind: textKind, options: options, runs: runs, shape: "rect", line: &lineOptions{}})
}

// addTextString is Slide.addText with a string, whose one run shares the text
// box's options.
func (target *slide) addTextString(text string, options *textOptions) {
	target.addText([]*textRun{{text: text, options: options}}, options)
}

// addShape is Slide.addShape for a preset shape.
func (target *slide) addShape(shape string, x, y, w, h float64, fill string, line *lineOptions, radius float64) {
	if line == nil {
		line = &lineOptions{none: true}
	}
	options := &textOptions{x: x, y: y, w: w, h: h, objectName: "Shape " + integer(target.count(textKind))}
	target.objects = append(target.objects, &slideObject{kind: textKind, options: options, shape: shape, fill: fill, line: line, radius: radius})
}

// addImage is Slide.addImage for base64 data of the given extension.
func (target *slide) addImage(extension string, data []byte, x, y, w, h float64, altText string, crop *cropBox) {
	relID := target.newRelID()
	image := &imageObject{
		x:          orZero(x),
		y:          orZero(y),
		w:          orOne(w),
		h:          orOne(h),
		altText:    altText,
		objectName: "Image " + integer(target.count(imageKind)),
		relID:      relID,
		crop:       crop,
	}
	target.media = append(target.media, mediaRel{relID: relID, target: "../media/image-" + integer(target.number) + "-" + integer(len(target.media)+1) + "." + extension, data: data})
	target.objects = append(target.objects, &slideObject{kind: imageKind, image: image})
}

// orZero is `value || 0`, and orOne is `value || 1`.
func orZero(value float64) float64 {
	if value == 0 || value != value {
		return 0
	}
	return value
}

func orOne(value float64) float64 {
	if value == 0 || value != value {
		return 1
	}
	return value
}

func (target *slide) addNotes(text string) {
	target.objects = append(target.objects, &slideObject{kind: notesKind, notes: text})
}

// xml is slideObjectToXml for a slide.
func (target *slide) xml() string {
	var builder strings.Builder
	builder.WriteString(`<p:cSld name="Slide ` + integer(target.number) + `">`)
	if target.background != "" {
		builder.WriteString("<p:bg><p:bgPr>" + solidFill(target.background) + "</p:bgPr></p:bg>")
	}
	builder.WriteString("<p:spTree>")
	builder.WriteString(`<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`)
	builder.WriteString(`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>`)
	builder.WriteString(`<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`)
	tableNumber := 1
	for index, object := range target.objects {
		switch object.kind {
		case textKind:
			builder.WriteString(target.shapeXML(index, object))
		case imageKind:
			builder.WriteString(imageXML(index, object.image))
		case tableKind:
			builder.WriteString(object.table.xml(tableNumber*target.number + 1))
			tableNumber++
		case chartKind:
			builder.WriteString(object.chart.frameXML(index))
		}
	}
	builder.WriteString("</p:spTree>")
	builder.WriteString("</p:cSld>")
	return builder.String()
}

func (target *slide) shapeXML(index int, object *slideObject) string {
	options := object.options
	x, y := smartNumber(options.x), smartNumber(options.y)
	cx, cy := smartNumber(options.w), smartNumber(options.h)
	var builder strings.Builder
	builder.WriteString("<p:sp>")
	builder.WriteString(`<p:nvSpPr><p:cNvPr id="` + integer(index+2) + `" name="` + options.objectName + `">`)
	builder.WriteString("</p:cNvPr>")
	builder.WriteString("<p:cNvSpPr/>")
	builder.WriteString("<p:nvPr></p:nvPr>")
	builder.WriteString("</p:nvSpPr><p:spPr>")
	builder.WriteString("<a:xfrm>")
	builder.WriteString(`<a:off x="` + number(x) + `" y="` + number(y) + `"/>`)
	builder.WriteString(`<a:ext cx="` + number(cx) + `" cy="` + number(cy) + `"/></a:xfrm>`)
	builder.WriteString(`<a:prstGeom prst="` + object.shape + `"><a:avLst>`)
	if object.radius != 0 && object.radius == object.radius {
		builder.WriteString(`<a:gd name="adj" fmla="val ` + number(round(float64(float64(object.radius*emu)*100000)/math.Min(cx, cy))) + `"/>`)
	}
	builder.WriteString("</a:avLst></a:prstGeom>")
	if object.fill != "" {
		builder.WriteString(solidFill(object.fill))
	} else {
		builder.WriteString("<a:noFill/>")
	}
	line := object.line
	if line.width != 0 && !line.none {
		builder.WriteString(`<a:ln w="` + number(points(line.width)) + `">`)
	} else {
		builder.WriteString("<a:ln>")
	}
	if !line.none && line.color != "" {
		builder.WriteString(solidFill(line.color))
		builder.WriteString(`<a:prstDash val="solid"/>`)
	}
	builder.WriteString("</a:ln>")
	builder.WriteString("</p:spPr>")
	if object.runs != nil {
		builder.WriteString(textBody(object, false))
	}
	builder.WriteString("</p:sp>")
	return builder.String()
}

func imageXML(index int, image *imageObject) string {
	x, y := smartNumber(image.x), smartNumber(image.y)
	cx, cy := smartNumber(image.w), smartNumber(image.h)
	description := image.altText
	if description == "" {
		description = "preencoded.png"
	}
	var builder strings.Builder
	builder.WriteString("<p:pic>")
	builder.WriteString("  <p:nvPicPr>")
	builder.WriteString(`<p:cNvPr id="` + integer(index+2) + `" name="` + image.objectName + `" descr="` + encode(description) + `">`)
	builder.WriteString("    </p:cNvPr>")
	builder.WriteString(`    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>`)
	builder.WriteString("    <p:nvPr></p:nvPr>")
	builder.WriteString("  </p:nvPicPr>")
	builder.WriteString("<p:blipFill>")
	builder.WriteString(`<a:blip r:embed="rId` + integer(image.relID) + `">`)
	builder.WriteString("</a:blip>")
	width, height := cx, cy
	if crop := image.crop; crop != nil {
		boxW, boxH := cx, cy
		if crop.w != 0 && crop.w == crop.w {
			boxW = smartNumber(crop.w)
		}
		if crop.h != 0 && crop.h == crop.h {
			boxH = smartNumber(crop.h)
		}
		boxX, boxY := smartNumber(orZero(crop.x)), smartNumber(orZero(crop.y))
		left := boxX
		right := width - (boxX + boxW)
		top := boxY
		bottom := height - (boxY + boxH)
		builder.WriteString(`<a:srcRect l="` + number(round(float64(1e5*(left/width)))) + `" r="` + number(round(float64(1e5*(right/width)))) + `" t="` + number(round(float64(1e5*(top/height)))) + `" b="` + number(round(float64(1e5*(bottom/height)))) + `"/><a:stretch/>`)
		width, height = boxW, boxH
	} else {
		builder.WriteString("  <a:stretch><a:fillRect/></a:stretch>")
	}
	builder.WriteString("</p:blipFill>")
	builder.WriteString("<p:spPr>")
	builder.WriteString(" <a:xfrm>")
	builder.WriteString(`  <a:off x="` + number(x) + `" y="` + number(y) + `"/>`)
	builder.WriteString(`  <a:ext cx="` + number(width) + `" cy="` + number(height) + `"/>`)
	builder.WriteString(" </a:xfrm>")
	builder.WriteString(` <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`)
	builder.WriteString("</p:spPr>")
	builder.WriteString("</p:pic>")
	return builder.String()
}

// paragraphProperties is genXmlParagraphProperties for a run.
func paragraphProperties(options *textOptions) string {
	var properties strings.Builder
	properties.WriteString("<a:pPr")
	switch options.align {
	case "left":
		properties.WriteString(` algn="l"`)
	case "right":
		properties.WriteString(` algn="r"`)
	case "center":
		properties.WriteString(` algn="ctr"`)
	case "justify":
		properties.WriteString(` algn="just"`)
	}
	spacing := ""
	if options.lineSpacing != 0 && options.lineSpacing == options.lineSpacing {
		spacing = `<a:lnSpc><a:spcPts val="` + number(round(float64(options.lineSpacing*100))) + `"/></a:lnSpc>`
	}
	before := ""
	if options.paraSpaceBefore > 0 {
		before = `<a:spcBef><a:spcPts val="` + number(round(float64(options.paraSpaceBefore*100))) + `"/></a:spcBef>`
	}
	bulletXML := ""
	if marker := options.bullet; marker != nil {
		margin := points(27)
		if marker.indent != 0 && marker.indent == marker.indent {
			margin = points(marker.indent)
		}
		code := "&#x" + marker.characterCode + ";"
		if !regexp.MustCompile(`^[0-9A-Fa-f]{4}$`).MatchString(marker.characterCode) {
			code = "&#x2022;"
		}
		properties.WriteString(` marL="` + number(margin) + `" indent="-` + number(margin) + `"`)
		bulletXML = `<a:buSzPct val="100000"/><a:buChar char="` + code + `"/>`
	} else {
		properties.WriteString(` indent="0" marL="0"`)
		bulletXML = "<a:buNone/>"
	}
	properties.WriteString(">" + spacing + before + bulletXML)
	properties.WriteString("</a:pPr>")
	return properties.String()
}

// runProperties is genXmlTextRunProperties for a run.
func runProperties(options *textOptions) string {
	var properties strings.Builder
	properties.WriteString(`<a:rPr lang="en-US"`)
	if options.fontSize != 0 && options.fontSize == options.fontSize {
		properties.WriteString(` sz="` + number(round(float64(options.fontSize*100))) + `"`)
	}
	if options.bold {
		properties.WriteString(` b="1"`)
	}
	if options.italic {
		properties.WriteString(` i="1"`)
	}
	if options.link != nil {
		properties.WriteString(` u="sng"`)
	}
	properties.WriteString(` dirty="0">`)
	if options.color != "" || options.fontFace != "" {
		if options.color != "" {
			properties.WriteString(solidFill(options.color))
		}
		if options.fontFace != "" {
			face := options.fontFace
			properties.WriteString(`<a:latin typeface="` + face + `" pitchFamily="34" charset="0"/><a:ea typeface="` + face + `" pitchFamily="34" charset="-122"/><a:cs typeface="` + face + `" pitchFamily="34" charset="-120"/>`)
		}
	}
	if link := options.link; link != nil {
		tooltip := ""
		if link.hasTooltip {
			tooltip = encode(link.tooltip)
		}
		properties.WriteString(`<a:hlinkClick r:id="rId` + integer(link.relID) + `" invalidUrl="" action="" tgtFrame="" tooltip="` + tooltip + `" history="1" highlightClick="0" endSnd="0"`)
		if options.color != "" {
			properties.WriteString(">")
			properties.WriteString(" <a:extLst>")
			properties.WriteString(`  <a:ext uri="{A12FA001-AC4F-418D-AE19-62706E023703}">`)
			properties.WriteString(`   <ahyp:hlinkClr xmlns:ahyp="http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor" val="tx"/>`)
			properties.WriteString("  </a:ext>")
			properties.WriteString(" </a:extLst>")
			properties.WriteString("</a:hlinkClick>")
		} else {
			properties.WriteString("/>")
		}
	}
	properties.WriteString("</a:rPr>")
	return properties.String()
}

var lineBreaks = regexp.MustCompile(`\r*\n`)

// inherit copies a text box's options onto a run wherever the run's own
// value is falsy, as genXmlTextBody's Object.entries loop does for the keys
// that reach the XML. Links keep their own color.
func inherit(run, box *textOptions) {
	if run == box {
		return
	}
	if !run.bold {
		run.bold = box.bold
	}
	if !run.italic {
		run.italic = box.italic
	}
	if run.fontFace == "" {
		run.fontFace = box.fontFace
	}
	if run.fontSize == 0 || run.fontSize != run.fontSize {
		run.fontSize = box.fontSize
	}
	if run.color == "" && run.link == nil {
		run.color = box.color
	}
	if run.align == "" {
		run.align = box.align
	}
	if run.lineSpacing == 0 {
		run.lineSpacing = box.lineSpacing
	}
	if run.paraSpaceBefore == 0 {
		run.paraSpaceBefore = box.paraSpaceBefore
	}
	if run.link == nil {
		run.link = box.link
	}
}

// textBody is genXmlTextBody for a text box or, with cell set, a table cell.
func textBody(object *slideObject, cell bool) string {
	box := object.options
	var builder strings.Builder
	if cell {
		builder.WriteString("<a:txBody>")
		builder.WriteString("<a:bodyPr/>")
	} else {
		builder.WriteString("<p:txBody>")
		builder.WriteString(`<a:bodyPr wrap="square"`)
		if box.margin {
			builder.WriteString(` lIns="0" tIns="0" rIns="0" bIns="0"`)
		}
		builder.WriteString(` rtlCol="0"`)
		if box.anchor != "" {
			builder.WriteString(` anchor="` + box.anchor + `"`)
		}
		builder.WriteString(">")
		if box.fit == "shrink" {
			builder.WriteString("<a:normAutofit/>")
		}
		builder.WriteString("</a:bodyPr>")
	}
	if !cell && box.h == 0 && box.align != "" {
		builder.WriteString(`<a:lstStyle><a:lvl1pPr algn="l"/></a:lstStyle>`)
	} else {
		builder.WriteString("<a:lstStyle/>")
	}

	// Break runs at line breaks: each line of a run shares the run's options.
	var pieces []*textRun
	for _, run := range object.runs {
		if run.raw {
			pieces = append(pieces, run)
			continue
		}
		text := lineBreaks.ReplaceAllLiteralString(run.text, crlf)
		run.text = text
		if strings.Contains(text, crlf) && !strings.HasSuffix(text, "\n") {
			for _, line := range strings.Split(text, crlf) {
				run.options.breakLine = true
				pieces = append(pieces, &textRun{text: line, options: run.options})
			}
			continue
		}
		pieces = append(pieces, run)
	}

	// Group pieces into paragraphs at alignment changes, bullets, and breaks.
	var lines [][]*textRun
	var current []*textRun
	for index, piece := range pieces {
		if len(current) > 0 && (piece.options.align != "" || box.align != "") {
			if piece.options.align != pieces[index-1].options.align {
				lines = append(lines, current)
				current = nil
			}
		} else if len(current) > 0 && piece.options.bullet != nil {
			lines = append(lines, current)
			current = nil
			piece.options.breakLine = false
		}
		current = append(current, piece)
		if piece.options.breakLine && index+1 < len(pieces) {
			lines = append(lines, current)
			current = nil
		}
		if index+1 == len(pieces) {
			lines = append(lines, current)
		}
	}

	for _, line := range lines {
		closingSize := false
		builder.WriteString("<a:p>")
		for _, piece := range line {
			options := piece.options
			if options.align == "" {
				options.align = box.align
			}
			if options.lineSpacing == 0 {
				options.lineSpacing = box.lineSpacing
			}
			if options.paraSpaceBefore == 0 {
				options.paraSpaceBefore = box.paraSpaceBefore
			}
			builder.WriteString(paragraphProperties(options))
			inherit(options, box)
			if piece.text != "" || piece.raw {
				builder.WriteString("<a:r>" + runProperties(options) + "<a:t>" + encode(piece.text) + "</a:t></a:r>")
			}
			if (piece.text == "" && !piece.raw && box.fontSize != 0) || options.fontSize != 0 {
				closingSize = true
				if box.fontSize == 0 {
					box.fontSize = options.fontSize
				}
			}
		}
		switch {
		case cell && (box.fontSize != 0 || box.fontFace != ""):
			size := ""
			if box.fontSize != 0 {
				size = ` sz="` + number(round(float64(box.fontSize*100))) + `"`
			}
			if box.fontFace != "" {
				builder.WriteString(`<a:endParaRPr lang="en-US"` + size + ` dirty="0">`)
				builder.WriteString(`<a:latin typeface="` + box.fontFace + `" charset="0"/>`)
				builder.WriteString(`<a:ea typeface="` + box.fontFace + `" charset="0"/>`)
				builder.WriteString(`<a:cs typeface="` + box.fontFace + `" charset="0"/>`)
				builder.WriteString("</a:endParaRPr>")
			} else {
				builder.WriteString(`<a:endParaRPr lang="en-US"` + size + ` dirty="0"/>`)
			}
		case closingSize:
			size := ""
			if box.fontSize != 0 {
				size = ` sz="` + number(round(float64(box.fontSize*100))) + `"`
			}
			builder.WriteString(`<a:endParaRPr lang="en-US"` + size + ` dirty="0"/>`)
		default:
			builder.WriteString(`<a:endParaRPr lang="en-US" dirty="0"/>`)
		}
		builder.WriteString("</a:p>")
	}
	if !strings.Contains(builder.String(), "<a:p>") {
		builder.WriteString("<a:p><a:endParaRPr/></a:p>")
	}
	if cell {
		builder.WriteString("</a:txBody>")
	} else {
		builder.WriteString("</p:txBody>")
	}
	return builder.String()
}
