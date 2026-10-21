package pptx

import (
	"strings"
	"time"
)

const (
	valueAxisID    = "2094734552"
	categoryAxisID = "2094734554"
	seriesAxisID   = "2094734556"
)

// chartSeries is one data series as addChart receives it.
type chartSeries struct {
	name   string
	labels []string
	values []float64
}

// chartOptions are the options pptx.ts passes, after addChartDefinition has
// filled in its defaults.
type chartOptions struct {
	x, y, w, h float64
	altText    string
	colors     []string
	surface    string

	showLegend                  bool
	legendPos                   string
	legendColor, legendFontFace string
	legendFontSize              float64

	dataLabelColor, dataLabelFontFace string
	dataLabelFontSize                 float64
	dataLabelFormatCode               string
	dataLabelPosition                 string
	showValue, showPercent            bool

	// pie and doughnut
	dataBorderPt    float64
	dataBorderColor string
	holeSize        float64

	// axes
	catAxisLabelColor, catAxisLabelFontFace string
	catAxisLabelFontSize                    float64
	catAxisLineColor                        string
	catAxisOrientation                      string
	valAxisLabelColor, valAxisLabelFontFace string
	valAxisLabelFontSize                    float64
	valAxisLabelFormatCode                  string
	valAxisLineShow                         bool
	valAxisHidden                           bool
	valGridNone                             bool
	valGridColor                            string
	valGridSize                             float64

	// bars
	barDir         string
	barGrouping    string
	barGapWidthPct float64

	// lines and areas
	lineSize                float64
	lineDataSymbol          string
	lineDataSymbolSize      float64
	lineDataSymbolLineSize  float64
	lineDataSymbolLineColor string
	opacity                 float64
}

// chartObject is a chart on a slide, numbered across the file from one.
type chartObject struct {
	kind       string
	series     []chartSeries
	options    chartOptions
	objectName string
	relID      int
	number     int
}

// addChart is Slide.addChart. kind is a pptxgenjs chart type: bar, line,
// area, pie, or doughnut.
func (deck *presentation) addChart(target *slide, kind string, series []chartSeries, options chartOptions) {
	deck.chartSeen++
	chart := &chartObject{kind: kind, series: series, options: options, number: deck.chartSeen}
	resolved := &chart.options
	if resolved.w == 0 || resolved.w != resolved.w {
		resolved.w = -1
	}
	if resolved.h == 0 || resolved.h != resolved.h {
		resolved.h = -1
	}
	chart.objectName = "Chart " + integer(target.count(chartKind))
	if resolved.barDir != "bar" && resolved.barDir != "col" {
		resolved.barDir = "col"
	}
	if kind == "area" && resolved.barGrouping != "stacked" && resolved.barGrouping != "standard" && resolved.barGrouping != "percentStacked" {
		resolved.barGrouping = "standard"
	}
	if kind == "bar" && resolved.barGrouping != "clustered" && resolved.barGrouping != "stacked" && resolved.barGrouping != "percentStacked" {
		resolved.barGrouping = "clustered"
	}
	if strings.Contains(resolved.barGrouping, "tacked") && resolved.barGapWidthPct == 0 {
		resolved.barGapWidthPct = 50
	}
	if resolved.dataLabelPosition != "" {
		switch kind {
		case "area", "doughnut":
			resolved.dataLabelPosition = ""
		case "pie":
			if !contains([]string{"bestFit", "ctr", "inEnd", "outEnd"}, resolved.dataLabelPosition) {
				resolved.dataLabelPosition = ""
			}
		case "line":
			if !contains([]string{"b", "ctr", "l", "r", "t"}, resolved.dataLabelPosition) {
				resolved.dataLabelPosition = ""
			}
		case "bar":
			if resolved.barGrouping != "stacked" && resolved.barGrouping != "percentStacked" && !contains([]string{"ctr", "inBase", "inEnd"}, resolved.dataLabelPosition) {
				resolved.dataLabelPosition = ""
			}
			if resolved.barGrouping != "clustered" && !contains([]string{"ctr", "inBase", "inEnd", "outEnd"}, resolved.dataLabelPosition) {
				resolved.dataLabelPosition = ""
			}
		}
	}
	if !contains([]string{"b", "l", "r", "t", "tr"}, resolved.legendPos) {
		resolved.legendPos = "r"
	}
	if !contains([]string{"circle", "dash", "diamond", "dot", "none", "square", "triangle"}, resolved.lineDataSymbol) {
		resolved.lineDataSymbol = "circle"
	}
	if resolved.lineDataSymbolSize == 0 || resolved.lineDataSymbolSize != resolved.lineDataSymbolSize {
		resolved.lineDataSymbolSize = 6
	}
	if resolved.lineDataSymbolLineSize == 0 || resolved.lineDataSymbolLineSize != resolved.lineDataSymbolLineSize {
		resolved.lineDataSymbolLineSize = points(0.75)
	} else {
		resolved.lineDataSymbolLineSize = points(resolved.lineDataSymbolLineSize)
	}
	if !(resolved.barGapWidthPct >= 0 && resolved.barGapWidthPct <= 1000) || resolved.barGapWidthPct != resolved.barGapWidthPct {
		resolved.barGapWidthPct = 150
	}
	if resolved.dataLabelFormatCode == "" {
		resolved.dataLabelFormatCode = "#,##0"
	}
	chart.relID = target.newRelID()
	target.charts = append(target.charts, chart)
	target.objects = append(target.objects, &slideObject{kind: chartKind, chart: chart})
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func (chart *chartObject) target() string {
	return "/ppt/charts/chart" + integer(chart.number) + ".xml"
}

func (chart *chartObject) size() (float64, float64) {
	width := smartNumber(chart.options.w)
	if chart.options.w == -1 {
		width = percent(50, slideWidth)
	}
	height := smartNumber(chart.options.h)
	if chart.options.h == -1 {
		height = percent(50, slideHeight)
	}
	return width, height
}

func (chart *chartObject) frameXML(index int) string {
	x, y := smartNumber(chart.options.x), smartNumber(chart.options.y)
	cx, cy := chart.size()
	var builder strings.Builder
	builder.WriteString("<p:graphicFrame>")
	builder.WriteString(" <p:nvGraphicFramePr>")
	builder.WriteString(`   <p:cNvPr id="` + integer(index+2) + `" name="` + chart.objectName + `" descr="` + encode(chart.options.altText) + `"/>`)
	builder.WriteString("   <p:cNvGraphicFramePr/>")
	builder.WriteString("   <p:nvPr></p:nvPr>")
	builder.WriteString(" </p:nvGraphicFramePr>")
	builder.WriteString(` <p:xfrm><a:off x="` + number(x) + `" y="` + number(y) + `"/><a:ext cx="` + number(cx) + `" cy="` + number(cy) + `"/></p:xfrm>`)
	builder.WriteString(` <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`)
	builder.WriteString(`  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`)
	builder.WriteString(`   <c:chart r:id="rId` + integer(chart.relID) + `" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`)
	builder.WriteString("  </a:graphicData>")
	builder.WriteString(" </a:graphic>")
	builder.WriteString("</p:graphicFrame>")
	return builder.String()
}

// columnName is getExcelColName.
func columnName(index int) string {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	position := index - 1
	if position <= 25 {
		return letters[position : position+1]
	}
	return letters[position/26-1:position/26] + letters[position%26:position%26+1]
}

// value writes a chart cache value: zero stays, a falsy value is empty.
func cacheValue(value float64) string {
	if value != value {
		return ""
	}
	return number(value)
}

// sheetValue writes a worksheet value, where pptxgenjs leaves zero empty.
func sheetValue(value float64) string {
	if value == 0 || value != value {
		return ""
	}
	return number(value)
}

func (chart *chartObject) xml() string {
	options := chart.options
	var builder strings.Builder
	builder.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	builder.WriteString(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	builder.WriteString(`<c:date1904 val="0"/>`)
	builder.WriteString(`<c:roundedCorners val="0"/>`)
	builder.WriteString("<c:chart>")
	builder.WriteString(`<c:autoTitleDeleted val="1"/>`)
	builder.WriteString("<c:plotArea>")
	builder.WriteString("<c:layout/>")
	if chart.kind == "pie" || chart.kind == "doughnut" {
		builder.WriteString(chart.pieXML())
	} else {
		builder.WriteString(chart.seriesXML())
		builder.WriteString(chart.categoryAxisXML())
		builder.WriteString(chart.valueAxisXML())
	}
	builder.WriteString("  <c:spPr>")
	builder.WriteString(solidFill(options.surface))
	builder.WriteString("<a:ln><a:noFill/></a:ln>")
	builder.WriteString("    <a:effectLst/>")
	builder.WriteString("  </c:spPr>")
	builder.WriteString("</c:plotArea>")
	if options.showLegend {
		builder.WriteString("<c:legend>")
		builder.WriteString(`<c:legendPos val="` + options.legendPos + `"/>`)
		builder.WriteString(`<c:overlay val="0"/>`)
		if options.legendFontFace != "" || options.legendFontSize != 0 || options.legendColor != "" {
			builder.WriteString("<c:txPr>")
			builder.WriteString("  <a:bodyPr/>")
			builder.WriteString("  <a:lstStyle/>")
			builder.WriteString("  <a:p>")
			builder.WriteString("    <a:pPr>")
			if options.legendFontSize != 0 {
				builder.WriteString(`<a:defRPr sz="` + number(round(float64(options.legendFontSize*100))) + `">`)
			} else {
				builder.WriteString("<a:defRPr>")
			}
			if options.legendColor != "" {
				builder.WriteString(solidFill(options.legendColor))
			}
			if options.legendFontFace != "" {
				builder.WriteString(`<a:latin typeface="` + options.legendFontFace + `"/>`)
				builder.WriteString(`<a:cs    typeface="` + options.legendFontFace + `"/>`)
			}
			builder.WriteString("      </a:defRPr>")
			builder.WriteString("    </a:pPr>")
			builder.WriteString(`    <a:endParaRPr lang="en-US"/>`)
			builder.WriteString("  </a:p>")
			builder.WriteString("</c:txPr>")
		}
		builder.WriteString("</c:legend>")
	}
	builder.WriteString(`  <c:plotVisOnly val="1"/>`)
	builder.WriteString(`  <c:dispBlanksAs val="span"/>`)
	builder.WriteString("</c:chart>")
	builder.WriteString("<c:spPr>")
	builder.WriteString(solidFill(options.surface))
	builder.WriteString("<a:ln><a:noFill/></a:ln>")
	builder.WriteString("  <a:effectLst/>")
	builder.WriteString("</c:spPr>")
	builder.WriteString(`<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>`)
	builder.WriteString("</c:chartSpace>")
	return builder.String()
}

func bit(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

func fontSize(size float64) string {
	if size == 0 || size != size {
		size = 12
	}
	return number(round(float64(size * 100)))
}

func orBlack(color string) string {
	if color == "" {
		return "000000"
	}
	return color
}

func orArial(face string) string {
	if face == "" {
		return "Arial"
	}
	return face
}

// seriesXML is makeChartType for bar, line, and area charts.
func (chart *chartObject) seriesXML() string {
	options := chart.options
	kind := chart.kind
	format := encode(options.dataLabelFormatCode)
	if format == "" {
		format = "General"
	}
	var builder strings.Builder
	builder.WriteString("<c:" + kind + "Chart>")
	if kind == "area" && options.barGrouping == "stacked" {
		builder.WriteString(`<c:grouping val="` + options.barGrouping + `"/>`)
	}
	if kind == "bar" {
		builder.WriteString(`<c:barDir val="` + options.barDir + `"/>`)
		grouping := options.barGrouping
		if grouping == "" {
			grouping = "clustered"
		}
		builder.WriteString(`<c:grouping val="` + grouping + `"/>`)
	}
	builder.WriteString(`<c:varyColors val="0"/>`)
	for index, series := range chart.series {
		color := options.colors[index%len(options.colors)]
		builder.WriteString("<c:ser>")
		builder.WriteString(`  <c:idx val="` + integer(index) + `"/><c:order val="` + integer(index) + `"/>`)
		builder.WriteString("  <c:tx>")
		builder.WriteString("    <c:strRef>")
		builder.WriteString("      <c:f>Sheet1!$" + columnName(index+2) + "$1</c:f>")
		builder.WriteString(`      <c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>` + encode(series.name) + "</c:v></c:pt></c:strCache>")
		builder.WriteString("    </c:strRef>")
		builder.WriteString("  </c:tx>")
		builder.WriteString("  <c:spPr>")
		if options.opacity != 0 {
			builder.WriteString("<a:solidFill>" + colorElement(color, `<a:alpha val="`+number(round(float64(options.opacity*1000)))+`"/>`) + "</a:solidFill>")
		} else {
			builder.WriteString("<a:solidFill>" + colorElement(color, "") + "</a:solidFill>")
		}
		if kind == "line" {
			if options.lineSize == 0 {
				builder.WriteString("<a:ln><a:noFill/></a:ln>")
			} else {
				builder.WriteString(`<a:ln w="` + number(points(options.lineSize)) + `" cap="flat"><a:solidFill>` + colorElement(color, "") + "</a:solidFill>")
				builder.WriteString(`<a:prstDash val="solid"/><a:round/></a:ln>`)
			}
		}
		builder.WriteString("<a:effectLst/>")
		builder.WriteString("  </c:spPr>")
		builder.WriteString(`  <c:invertIfNegative val="0"/>`)
		builder.WriteString("<c:dLbls>")
		builder.WriteString(`<c:numFmt formatCode="` + format + `" sourceLinked="0"/>`)
		builder.WriteString("<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>")
		builder.WriteString(`<a:defRPr b="1" i="0" strike="noStrike" sz="` + fontSize(options.dataLabelFontSize) + `" u="none">`)
		builder.WriteString("<a:solidFill>" + colorElement(orBlack(options.dataLabelColor), "") + "</a:solidFill>")
		builder.WriteString(`<a:latin typeface="` + orArial(options.dataLabelFontFace) + `"/>`)
		builder.WriteString("</a:defRPr></a:pPr></a:p></c:txPr>")
		if options.dataLabelPosition != "" {
			builder.WriteString(`<c:dLblPos val="` + options.dataLabelPosition + `"/>`)
		}
		builder.WriteString(`<c:showLegendKey val="0"/>`)
		builder.WriteString(`<c:showVal val="` + bit(options.showValue) + `"/>`)
		builder.WriteString(`<c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`)
		builder.WriteString(`<c:showLeaderLines val="0"/>`)
		builder.WriteString("</c:dLbls>")
		if kind == "line" {
			builder.WriteString("<c:marker>")
			builder.WriteString(`  <c:symbol val="` + options.lineDataSymbol + `"/>`)
			builder.WriteString(`<c:size val="` + number(options.lineDataSymbolSize) + `"/>`)
			builder.WriteString("  <c:spPr>")
			builder.WriteString("    <a:solidFill>" + colorElement(options.colors[index], "") + "</a:solidFill>")
			lineColor := options.lineDataSymbolLineColor
			if lineColor == "" {
				lineColor = color
			}
			builder.WriteString(`    <a:ln w="` + number(options.lineDataSymbolLineSize) + `" cap="flat"><a:solidFill>` + colorElement(lineColor, "") + `</a:solidFill><a:prstDash val="solid"/><a:round/></a:ln>`)
			builder.WriteString("    <a:effectLst/>")
			builder.WriteString("  </c:spPr>")
			builder.WriteString("</c:marker>")
		}
		if kind == "bar" && len(chart.series) == 1 && len(options.colors) > 1 {
			for valueIndex := range series.values {
				builder.WriteString("  <c:dPt>")
				builder.WriteString(`    <c:idx val="` + integer(valueIndex) + `"/>`)
				builder.WriteString(`      <c:invertIfNegative val="0"/>`)
				builder.WriteString(`    <c:bubble3D val="0"/>`)
				builder.WriteString("    <c:spPr>")
				if options.lineSize == 0 {
					builder.WriteString("<a:ln><a:noFill/></a:ln>")
				} else {
					builder.WriteString("<a:solidFill>")
					builder.WriteString(`  <a:srgbClr val="` + options.colors[valueIndex%len(options.colors)] + `"/>`)
					builder.WriteString("</a:solidFill>")
				}
				builder.WriteString("<a:effectLst/>")
				builder.WriteString("    </c:spPr>")
				builder.WriteString("  </c:dPt>")
			}
		}
		count := integer(len(series.labels))
		builder.WriteString("<c:cat>")
		builder.WriteString("  <c:multiLvlStrRef>")
		builder.WriteString("    <c:f>Sheet1!$A$2:$A$" + integer(len(series.labels)+1) + "</c:f>")
		builder.WriteString("    <c:multiLvlStrCache>")
		builder.WriteString(`      <c:ptCount val="` + count + `"/>`)
		builder.WriteString("<c:lvl>")
		for labelIndex, label := range series.labels {
			builder.WriteString(`<c:pt idx="` + integer(labelIndex) + `"><c:v>` + encode(label) + "</c:v></c:pt>")
		}
		builder.WriteString("</c:lvl>")
		builder.WriteString("    </c:multiLvlStrCache>")
		builder.WriteString("  </c:multiLvlStrRef>")
		builder.WriteString("</c:cat>")
		column := columnName(index + 2)
		builder.WriteString("<c:val>")
		builder.WriteString("  <c:numRef>")
		builder.WriteString("<c:f>Sheet1!$" + column + "$2:$" + column + "$" + integer(len(series.labels)+1) + "</c:f>")
		builder.WriteString("    <c:numCache>")
		builder.WriteString("      <c:formatCode>General</c:formatCode>")
		builder.WriteString(`      <c:ptCount val="` + count + `"/>`)
		for valueIndex, value := range series.values {
			builder.WriteString(`<c:pt idx="` + integer(valueIndex) + `"><c:v>` + cacheValue(value) + "</c:v></c:pt>")
		}
		builder.WriteString("    </c:numCache>")
		builder.WriteString("  </c:numRef>")
		builder.WriteString("</c:val>")
		if kind == "line" {
			builder.WriteString(`<c:smooth val="0"/>`)
		}
		builder.WriteString("</c:ser>")
	}
	builder.WriteString("  <c:dLbls>")
	builder.WriteString(`    <c:numFmt formatCode="` + format + `" sourceLinked="0"/>`)
	builder.WriteString("    <c:txPr>")
	builder.WriteString("      <a:bodyPr/>")
	builder.WriteString("      <a:lstStyle/>")
	builder.WriteString("      <a:p><a:pPr>")
	builder.WriteString(`        <a:defRPr b="1" i="0" strike="noStrike" sz="` + fontSize(options.dataLabelFontSize) + `" u="none">`)
	builder.WriteString("          <a:solidFill>" + colorElement(orBlack(options.dataLabelColor), "") + "</a:solidFill>")
	builder.WriteString(`          <a:latin typeface="` + orArial(options.dataLabelFontFace) + `"/>`)
	builder.WriteString("        </a:defRPr>")
	builder.WriteString("      </a:pPr></a:p>")
	builder.WriteString("    </c:txPr>")
	if options.dataLabelPosition != "" {
		builder.WriteString(` <c:dLblPos val="` + options.dataLabelPosition + `"/>`)
	}
	builder.WriteString(`    <c:showLegendKey val="0"/>`)
	builder.WriteString(`    <c:showVal val="` + bit(options.showValue) + `"/>`)
	builder.WriteString(`    <c:showCatName val="0"/>`)
	builder.WriteString(`    <c:showSerName val="0"/>`)
	builder.WriteString(`    <c:showPercent val="0"/>`)
	builder.WriteString(`    <c:showBubbleSize val="0"/>`)
	builder.WriteString(`    <c:showLeaderLines val="0"/>`)
	builder.WriteString("  </c:dLbls>")
	switch kind {
	case "bar":
		builder.WriteString(`  <c:gapWidth val="` + number(options.barGapWidthPct) + `"/>`)
		overlap := "0"
		if strings.Contains(options.barGrouping, "tacked") {
			overlap = "100"
		}
		builder.WriteString(`  <c:overlap val="` + overlap + `"/>`)
	case "line":
		builder.WriteString(`  <c:marker val="1"/>`)
	}
	builder.WriteString(`<c:axId val="` + categoryAxisID + `"/><c:axId val="` + valueAxisID + `"/><c:axId val="` + seriesAxisID + `"/>`)
	builder.WriteString("</c:" + kind + "Chart>")
	return builder.String()
}

// pieXML is makeChartType for pie and doughnut charts.
func (chart *chartObject) pieXML() string {
	options := chart.options
	kind := chart.kind
	data := chart.series[0]
	format := encode(options.dataLabelFormatCode)
	if format == "" {
		format = "General"
	}
	var builder strings.Builder
	builder.WriteString("<c:" + kind + "Chart>")
	builder.WriteString(`  <c:varyColors val="1"/>`)
	builder.WriteString("<c:ser>")
	builder.WriteString(`  <c:idx val="0"/>`)
	builder.WriteString(`  <c:order val="0"/>`)
	builder.WriteString("  <c:tx>")
	builder.WriteString("    <c:strRef>")
	builder.WriteString("      <c:f>Sheet1!$B$1</c:f>")
	builder.WriteString("      <c:strCache>")
	builder.WriteString(`        <c:ptCount val="1"/>`)
	builder.WriteString(`        <c:pt idx="0"><c:v>` + encode(data.name) + "</c:v></c:pt>")
	builder.WriteString("      </c:strCache>")
	builder.WriteString("    </c:strRef>")
	builder.WriteString("  </c:tx>")
	builder.WriteString("  <c:spPr>")
	builder.WriteString(`    <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>`)
	builder.WriteString(`    <a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="F9F9F9"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln>`)
	builder.WriteString("<a:effectLst/>")
	builder.WriteString("  </c:spPr>")
	for index := range data.labels {
		builder.WriteString("<c:dPt>")
		builder.WriteString(` <c:idx val="` + integer(index) + `"/>`)
		builder.WriteString(` <c:bubble3D val="0"/>`)
		builder.WriteString(" <c:spPr>")
		builder.WriteString("<a:solidFill>" + colorElement(options.colors[index], "") + "</a:solidFill>")
		if options.dataBorderColor != "" || options.dataBorderPt != 0 {
			builder.WriteString(`<a:ln w="` + number(points(options.dataBorderPt)) + `" cap="flat"><a:solidFill>` + colorElement(options.dataBorderColor, "") + `</a:solidFill><a:prstDash val="solid"/><a:round/></a:ln>`)
		}
		builder.WriteString("<a:effectLst/>")
		builder.WriteString("  </c:spPr>")
		builder.WriteString("</c:dPt>")
	}
	builder.WriteString("<c:dLbls>")
	for index := range data.labels {
		builder.WriteString("<c:dLbl>")
		builder.WriteString(` <c:idx val="` + integer(index) + `"/>`)
		builder.WriteString(`  <c:numFmt formatCode="` + format + `" sourceLinked="0"/>`)
		builder.WriteString("  <c:spPr/><c:txPr>")
		builder.WriteString("   <a:bodyPr/><a:lstStyle/>")
		builder.WriteString("   <a:p><a:pPr>")
		builder.WriteString(`   <a:defRPr sz="` + fontSize(options.dataLabelFontSize) + `" b="1" i="0" u="none" strike="noStrike">`)
		builder.WriteString("    <a:solidFill>" + colorElement(orBlack(options.dataLabelColor), "") + "</a:solidFill>")
		builder.WriteString(`    <a:latin typeface="` + orArial(options.dataLabelFontFace) + `"/>`)
		builder.WriteString("   </a:defRPr>")
		builder.WriteString("      </a:pPr></a:p>")
		builder.WriteString("    </c:txPr>")
		if kind == "pie" && options.dataLabelPosition != "" {
			builder.WriteString(`<c:dLblPos val="` + options.dataLabelPosition + `"/>`)
		}
		builder.WriteString(`    <c:showLegendKey val="0"/>`)
		builder.WriteString(`    <c:showVal val="` + bit(options.showValue) + `"/>`)
		builder.WriteString(`    <c:showCatName val="0"/>`)
		builder.WriteString(`    <c:showSerName val="0"/>`)
		builder.WriteString(`    <c:showPercent val="` + bit(options.showPercent) + `"/>`)
		builder.WriteString(`    <c:showBubbleSize val="0"/>`)
		builder.WriteString("  </c:dLbl>")
	}
	builder.WriteString(` <c:numFmt formatCode="` + format + `" sourceLinked="0"/>`)
	builder.WriteString("    <c:txPr>")
	builder.WriteString("      <a:bodyPr/>")
	builder.WriteString("      <a:lstStyle/>")
	builder.WriteString("      <a:p>")
	builder.WriteString("        <a:pPr>")
	builder.WriteString(`          <a:defRPr sz="1800" b="1" i="0" u="none" strike="noStrike">`)
	builder.WriteString(`            <a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/>`)
	builder.WriteString("          </a:defRPr>")
	builder.WriteString("        </a:pPr>")
	builder.WriteString("      </a:p>")
	builder.WriteString("    </c:txPr>")
	if kind == "pie" {
		builder.WriteString(`<c:dLblPos val="ctr"/>`)
	}
	builder.WriteString(`    <c:showLegendKey val="0"/>`)
	builder.WriteString(`    <c:showVal val="0"/>`)
	builder.WriteString(`    <c:showCatName val="1"/>`)
	builder.WriteString(`    <c:showSerName val="0"/>`)
	builder.WriteString(`    <c:showPercent val="1"/>`)
	builder.WriteString(`    <c:showBubbleSize val="0"/>`)
	builder.WriteString(` <c:showLeaderLines val="0"/>`)
	builder.WriteString("</c:dLbls>")
	builder.WriteString("<c:cat>")
	builder.WriteString("  <c:strRef>")
	builder.WriteString("    <c:f>Sheet1!$A$2:$A$" + integer(len(data.labels)+1) + "</c:f>")
	builder.WriteString("    <c:strCache>")
	builder.WriteString(`         <c:ptCount val="` + integer(len(data.labels)) + `"/>`)
	for index, label := range data.labels {
		builder.WriteString(`<c:pt idx="` + integer(index) + `"><c:v>` + encode(label) + "</c:v></c:pt>")
	}
	builder.WriteString("    </c:strCache>")
	builder.WriteString("  </c:strRef>")
	builder.WriteString("</c:cat>")
	builder.WriteString("  <c:val>")
	builder.WriteString("    <c:numRef>")
	builder.WriteString("      <c:f>Sheet1!$B$2:$B$" + integer(len(data.labels)+1) + "</c:f>")
	builder.WriteString("      <c:numCache>")
	builder.WriteString(`           <c:ptCount val="` + integer(len(data.labels)) + `"/>`)
	for index, value := range data.values {
		builder.WriteString(`<c:pt idx="` + integer(index) + `"><c:v>` + cacheValue(value) + "</c:v></c:pt>")
	}
	builder.WriteString("      </c:numCache>")
	builder.WriteString("    </c:numRef>")
	builder.WriteString("  </c:val>")
	builder.WriteString("  </c:ser>")
	builder.WriteString(`  <c:firstSliceAng val="0"/>`)
	if kind == "doughnut" {
		builder.WriteString(`<c:holeSize val="` + number(options.holeSize) + `"/>`)
	}
	builder.WriteString("</c:" + kind + "Chart>")
	return builder.String()
}

func (chart *chartObject) categoryAxisXML() string {
	options := chart.options
	orientation := options.catAxisOrientation
	if orientation == "" {
		orientation = "minMax"
	}
	position, labelPosition := "l", "nextTo"
	if options.barDir == "col" {
		position, labelPosition = "b", "low"
	}
	var builder strings.Builder
	builder.WriteString("<c:catAx>")
	builder.WriteString(`  <c:axId val="` + categoryAxisID + `"/>`)
	builder.WriteString("  <c:scaling>")
	builder.WriteString(`<c:orientation val="` + orientation + `"/>`)
	builder.WriteString("</c:scaling>")
	builder.WriteString(`  <c:delete val="0"/>`)
	builder.WriteString(`  <c:axPos val="` + position + `"/>`)
	builder.WriteString(`  <c:numFmt formatCode="General" sourceLinked="1"/>`)
	builder.WriteString(`  <c:majorTickMark val="out"/>`)
	builder.WriteString(`  <c:minorTickMark val="none"/>`)
	builder.WriteString(`  <c:tickLblPos val="` + labelPosition + `"/>`)
	builder.WriteString("  <c:spPr>")
	builder.WriteString(`    <a:ln w="12700" cap="flat">`)
	lineColor := options.catAxisLineColor
	if lineColor == "" {
		lineColor = "888888"
	}
	builder.WriteString("<a:solidFill>" + colorElement(lineColor, "") + "</a:solidFill>")
	builder.WriteString(`      <a:prstDash val="solid"/>`)
	builder.WriteString("      <a:round/>")
	builder.WriteString("    </a:ln>")
	builder.WriteString("  </c:spPr>")
	builder.WriteString("  <c:txPr>")
	builder.WriteString("<a:bodyPr/>")
	builder.WriteString("    <a:lstStyle/>")
	builder.WriteString("    <a:p>")
	builder.WriteString("    <a:pPr>")
	builder.WriteString(`      <a:defRPr sz="` + fontSize(options.catAxisLabelFontSize) + `" b="0" i="0" u="none" strike="noStrike">`)
	builder.WriteString("      <a:solidFill>" + colorElement(orBlack(options.catAxisLabelColor), "") + "</a:solidFill>")
	builder.WriteString(`      <a:latin typeface="` + orArial(options.catAxisLabelFontFace) + `"/>`)
	builder.WriteString("   </a:defRPr>")
	builder.WriteString("  </a:pPr>")
	builder.WriteString(`  <a:endParaRPr lang="en-US"/>`)
	builder.WriteString("  </a:p>")
	builder.WriteString(" </c:txPr>")
	builder.WriteString(` <c:crossAx val="` + valueAxisID + `"/>`)
	builder.WriteString(` <c:crosses val="autoZero"/>`)
	builder.WriteString(` <c:auto val="1"/>`)
	builder.WriteString(` <c:lblAlgn val="ctr"/>`)
	builder.WriteString(` <c:noMultiLvlLbl val="1"/>`)
	builder.WriteString("</c:catAx>")
	return builder.String()
}

func (chart *chartObject) valueAxisXML() string {
	options := chart.options
	position, labelPosition := "b", "low"
	if options.barDir == "col" {
		position, labelPosition = "l", "nextTo"
	}
	format := "General"
	if options.valAxisLabelFormatCode != "" {
		format = encode(options.valAxisLabelFormatCode)
	}
	var builder strings.Builder
	builder.WriteString("<c:valAx>")
	builder.WriteString(`  <c:axId val="` + valueAxisID + `"/>`)
	builder.WriteString("  <c:scaling>")
	builder.WriteString(`<c:orientation val="minMax"/>`)
	builder.WriteString("  </c:scaling>")
	builder.WriteString(`  <c:delete val="` + bit(options.valAxisHidden) + `"/>`)
	builder.WriteString(`  <c:axPos val="` + position + `"/>`)
	if !options.valGridNone {
		size := options.valGridSize
		if size == 0 {
			size = 1
		}
		color := options.valGridColor
		if color == "" {
			color = "888888"
		}
		builder.WriteString("<c:majorGridlines>")
		builder.WriteString(" <c:spPr>")
		builder.WriteString(`  <a:ln w="` + number(points(size)) + `" cap="flat">`)
		builder.WriteString(`  <a:solidFill><a:srgbClr val="` + color + `"/></a:solidFill>`)
		builder.WriteString(`   <a:prstDash val="solid"/><a:round/>`)
		builder.WriteString("  </a:ln>")
		builder.WriteString(" </c:spPr>")
		builder.WriteString("</c:majorGridlines>")
	}
	builder.WriteString(`<c:numFmt formatCode="` + format + `" sourceLinked="0"/>`)
	builder.WriteString(` <c:majorTickMark val="out"/>`)
	builder.WriteString(` <c:minorTickMark val="none"/>`)
	builder.WriteString(` <c:tickLblPos val="` + labelPosition + `"/>`)
	builder.WriteString(" <c:spPr>")
	builder.WriteString(`   <a:ln w="12700" cap="flat">`)
	if options.valAxisLineShow {
		builder.WriteString("<a:solidFill>" + colorElement("888888", "") + "</a:solidFill>")
	} else {
		builder.WriteString("<a:noFill/>")
	}
	builder.WriteString(`     <a:prstDash val="solid"/>`)
	builder.WriteString("     <a:round/>")
	builder.WriteString("   </a:ln>")
	builder.WriteString(" </c:spPr>")
	builder.WriteString(" <c:txPr>")
	builder.WriteString("  <a:bodyPr/>")
	builder.WriteString("  <a:lstStyle/>")
	builder.WriteString("  <a:p>")
	builder.WriteString("    <a:pPr>")
	builder.WriteString(`      <a:defRPr sz="` + fontSize(options.valAxisLabelFontSize) + `" b="0" i="0" u="none" strike="noStrike">`)
	builder.WriteString("        <a:solidFill>" + colorElement(orBlack(options.valAxisLabelColor), "") + "</a:solidFill>")
	builder.WriteString(`        <a:latin typeface="` + orArial(options.valAxisLabelFontFace) + `"/>`)
	builder.WriteString("      </a:defRPr>")
	builder.WriteString("    </a:pPr>")
	builder.WriteString(`  <a:endParaRPr lang="en-US"/>`)
	builder.WriteString("  </a:p>")
	builder.WriteString(" </c:txPr>")
	builder.WriteString(` <c:crossAx val="` + categoryAxisID + `"/>`)
	builder.WriteString(` <c:crosses val="autoZero"/>`)
	builder.WriteString(` <c:crossBetween val="between"/>`)
	builder.WriteString("</c:valAx>")
	return builder.String()
}

// workbook is the embedded worksheet holding the chart's data, written by
// createExcelWorksheet.
func (chart *chartObject) workbook(now time.Time, templates map[string][]byte) []byte {
	data := chart.series
	labels := data[0].labels
	sheet := newArchive(now)
	for _, folder := range []string{"_rels", "docProps", "xl/_rels", "xl/tables", "xl/theme", "xl/worksheets", "xl/worksheets/_rels"} {
		sheet.folder(folder)
	}
	sheet.file("[Content_Types].xml", templates["sheet-content-types.xml"])
	sheet.file("_rels/.rels", templates["sheet-root.rels"])
	sheet.file("docProps/app.xml", templates["sheet-app.xml"])
	stamp := now.UTC().Format("2006-01-02T15:04:05.000Z")
	sheet.text("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`+
		"<dc:creator>PptxGenJS</dc:creator>"+
		"<cp:lastModifiedBy>PptxGenJS</cp:lastModifiedBy>"+
		`<dcterms:created xsi:type="dcterms:W3CDTF">`+stamp+"</dcterms:created>"+
		`<dcterms:modified xsi:type="dcterms:W3CDTF">`+stamp+"</dcterms:modified>"+
		"</cp:coreProperties>")
	sheet.file("xl/_rels/workbook.xml.rels", templates["sheet-workbook.rels"])
	sheet.file("xl/styles.xml", templates["sheet-styles.xml"])
	sheet.file("xl/theme/theme1.xml", templates["sheet-theme.xml"])
	sheet.file("xl/workbook.xml", templates["sheet-workbook.xml"])
	sheet.file("xl/worksheets/_rels/sheet1.xml.rels", templates["sheet-sheet.rels"])

	var shared stringsBuilder
	shared.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	shared.WriteString(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="` + integer(len(data)+len(labels)+1) + `" uniqueCount="` + integer(len(data)+len(labels)+1) + `">`)
	shared.WriteString(`<si><t xml:space="preserve"></t></si>`)
	for _, series := range data {
		name := series.name
		if name == "" {
			name = " "
		}
		shared.WriteString("<si><t>" + encode(replaceFirst(name, "X-Axis", "X-Values")) + "</t></si>")
	}
	for _, label := range labels {
		if label != "" {
			shared.WriteString("<si><t>" + encode(label) + "</t></si>")
		}
	}
	shared.WriteString("</sst>\n")
	sheet.text("xl/sharedStrings.xml", shared.String())

	var table stringsBuilder
	table.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	table.WriteString(`<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="A1:` + columnName(len(data)+1) + integer(len(labels)+1) + `'" totalsRowShown="0">`)
	table.WriteString(`<tableColumns count="` + integer(len(data)+1) + `">`)
	table.WriteString(`<tableColumn id="1" name="Column1"/>`)
	for index, series := range data {
		table.WriteString(`<tableColumn id="` + integer(index+2) + `" name="` + encode(series.name) + `"/>`)
	}
	table.WriteString("</tableColumns>")
	table.WriteString(`<tableStyleInfo showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>`)
	table.WriteString("</table>")
	sheet.text("xl/tables/table1.xml", table.String())

	var worksheet stringsBuilder
	spans := integer(len(data) + 1)
	worksheet.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	worksheet.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">`)
	worksheet.WriteString(`<dimension ref="A1:` + columnName(len(data)+1) + integer(len(data[0].values)+1) + `"/>`)
	worksheet.WriteString(`<sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="B1" sqref="B1"/></sheetView></sheetViews>`)
	worksheet.WriteString(`<sheetFormatPr baseColWidth="10" defaultRowHeight="16"/>`)
	worksheet.WriteString("<sheetData>")
	worksheet.WriteString(`<row r="1" spans="1:` + spans + `">`)
	worksheet.WriteString(`<c r="A1" t="s"><v>0</v></c>`)
	for index := range data {
		worksheet.WriteString(`<c r="` + columnName(index+2) + `1" t="s"><v>` + integer(index+1) + "</v></c>")
	}
	worksheet.WriteString("</row>")
	for index := range labels {
		row := integer(index + 2)
		worksheet.WriteString(`<row r="` + row + `" spans="1:` + spans + `">`)
		worksheet.WriteString(`<c r="A` + row + `" t="s">`)
		worksheet.WriteString("<v>" + integer(len(data)+index+1) + "</v>")
		worksheet.WriteString("</c>")
		for seriesIndex, series := range data {
			value := ""
			if index < len(series.values) {
				value = sheetValue(series.values[index])
			}
			worksheet.WriteString(`<c r="` + columnName(seriesIndex+2) + row + `"><v>` + value + "</v></c>")
		}
		worksheet.WriteString("</row>")
	}
	worksheet.WriteString("</sheetData>")
	worksheet.WriteString(`<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`)
	worksheet.WriteString("</worksheet>\n")
	sheet.text("xl/worksheets/sheet1.xml", worksheet.String())
	return sheet.bytes()
}

type stringsBuilder = strings.Builder

func replaceFirst(text, old, replacement string) string {
	return strings.Replace(text, old, replacement, 1)
}
