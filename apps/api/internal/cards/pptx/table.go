package pptx

import (
	"strings"
)

// border is one side of a table cell.
type border struct {
	none  bool
	color string
	pt    float64
}

// tableCell is one table cell and its formatting.
type tableCell struct {
	text     string
	bold     bool
	fontFace string
	color    string
	align    string
	// borders in top, right, bottom, left order
	borders [4]border
}

type tableObject struct {
	objectName string
	x, y, w    float64
	columns    []float64
	rows       []float64
	cells      [][]tableCell
	fontSize   float64
	margin     [4]float64
	valign     string
	// color is the table's default color, unset when any cell mentions a
	// hyperlink.
	color string
}

// addTable places a table with column widths, row heights, and a margin in
// points.
func (target *slide) addTable(cells [][]tableCell, x, y, w float64, columns, rows []float64, fontSize float64, margin [4]float64, valign string) {
	table := &tableObject{
		objectName: "Table " + integer(target.count(tableKind)),
		cells:      cells,
		columns:    columns,
		rows:       rows,
		fontSize:   fontSize,
		margin:     margin,
		valign:     valign,
	}
	if fontSize == 0 || fontSize != fontSize {
		table.fontSize = 12
	}
	table.x = smartNumber(orHalfInch(x))
	table.y = smartNumber(orHalfInch(y))
	mentionsLink := false
	for _, row := range cells {
		for _, cell := range row {
			if strings.Contains(cell.text, "hyperlink") {
				mentionsLink = true
			}
		}
	}
	if !mentionsLink {
		table.color = "000000"
	}
	if len(columns) != len(cells[0]) {
		// Mismatched widths are dropped; the export never passes them.
		table.columns = nil
	}
	table.w = w
	if table.x != 0 && table.x < 20 {
		table.x = inchToEMU(table.x)
	}
	if table.y != 0 && table.y < 20 {
		table.y = inchToEMU(table.y)
	}
	if table.w != 0 && table.w < 20 {
		table.w = inchToEMU(table.w)
	}
	target.objects = append(target.objects, &slideObject{kind: tableKind, table: table})
}

// orHalfInch is `value || (value === 0 ? 0 : EMU / 2)`.
func orHalfInch(value float64) float64 {
	if value == 0 {
		return 0
	}
	if value != value {
		return emu / 2
	}
	return value
}

func (table *tableObject) xml(id int) string {
	x, y := smartNumber(table.x), smartNumber(table.y)
	cx := smartNumber(table.w)
	columns := len(table.cells[0])
	var builder strings.Builder
	builder.WriteString(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="` + integer(id) + `" name="` + table.objectName + `"/>`)
	builder.WriteString(`<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
		`  <p:nvPr><p:extLst><p:ext uri="{D42A27DB-BD31-4B8C-83A1-F6EECF244321}"><p14:modId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1579011935"/></p:ext></p:extLst></p:nvPr>` +
		`</p:nvGraphicFramePr>`)
	orEMU := func(value float64) float64 {
		if value == 0 {
			return 0
		}
		if value != value {
			return emu
		}
		return value
	}
	builder.WriteString(`<p:xfrm><a:off x="` + number(orEMU(x)) + `" y="` + number(orEMU(y)) + `"/><a:ext cx="` + number(orEMU(cx)) + `" cy="` + number(emu) + `"/></p:xfrm>`)
	builder.WriteString(`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/>`)
	builder.WriteString("<a:tblGrid>")
	for column := 0; column < columns; column++ {
		if table.columns != nil {
			builder.WriteString(`<a:gridCol w="` + number(round(inchToEMU(table.columns[column]))) + `"/>`)
			continue
		}
		width := float64(emu)
		if table.w != 0 {
			width = round(table.w / float64(columns))
		}
		builder.WriteString(`<a:gridCol w="` + number(width) + `"/>`)
	}
	builder.WriteString("</a:tblGrid>")
	for rowIndex, row := range table.cells {
		height := 0.0
		if rowIndex < len(table.rows) && table.rows[rowIndex] != 0 && table.rows[rowIndex] == table.rows[rowIndex] {
			height = inchToEMU(table.rows[rowIndex])
		}
		builder.WriteString(`<a:tr h="` + number(height) + `">`)
		for _, cell := range row {
			builder.WriteString(table.cellXML(cell))
		}
		builder.WriteString("</a:tr>")
	}
	builder.WriteString("      </a:tbl>")
	builder.WriteString("    </a:graphicData>")
	builder.WriteString("  </a:graphic>")
	builder.WriteString("</p:graphicFrame>")
	return builder.String()
}

func (table *tableObject) cellXML(cell tableCell) string {
	options := &textOptions{
		bold:     cell.bold,
		fontFace: cell.fontFace,
		color:    cell.color,
		align:    cell.align,
		fontSize: table.fontSize,
		valign:   table.valign,
	}
	if options.color == "" {
		options.color = table.color
	}
	anchor := ""
	if options.valign != "" {
		anchor = ` anchor="` + cellAnchor(options.valign) + `"`
	}
	margin := ""
	if table.margin[0] >= 1 {
		margin = ` marL="` + number(points(table.margin[3])) + `" marR="` + number(points(table.margin[1])) + `" marT="` + number(points(table.margin[0])) + `" marB="` + number(points(table.margin[2])) + `"`
	} else {
		margin = ` marL="` + number(inchToEMU(table.margin[3])) + `" marR="` + number(inchToEMU(table.margin[1])) + `" marT="` + number(inchToEMU(table.margin[0])) + `" marB="` + number(inchToEMU(table.margin[2])) + `"`
	}
	object := &slideObject{options: options, runs: []*textRun{{text: cell.text, options: options}}}
	var builder strings.Builder
	builder.WriteString("<a:tc>" + textBody(object, true) + "<a:tcPr" + margin + anchor + ">")
	for _, side := range []struct {
		index int
		name  string
	}{{3, "lnL"}, {1, "lnR"}, {0, "lnT"}, {2, "lnB"}} {
		edge := cell.borders[side.index]
		if edge.none {
			builder.WriteString("<a:" + side.name + ` w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></a:` + side.name + ">")
			continue
		}
		builder.WriteString("<a:" + side.name + ` w="` + number(points(edge.pt)) + `" cap="flat" cmpd="sng" algn="ctr">`)
		builder.WriteString("<a:solidFill>" + colorElement(edge.color, "") + "</a:solidFill>")
		builder.WriteString(`<a:prstDash val="solid"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/>`)
		builder.WriteString("</a:" + side.name + ">")
	}
	builder.WriteString("  </a:tcPr>")
	builder.WriteString(" </a:tc>")
	return builder.String()
}

// cellAnchor rewrites a vertical alignment as the table writer does.
func cellAnchor(valign string) string {
	switch strings.ToLower(valign) {
	case "c", "m":
		valign = "ctr"
	}
	for _, pair := range [][2]string{{"center", "ctr"}, {"middle", "ctr"}, {"top", "t"}, {"btm", "b"}, {"bottom", "b"}} {
		valign = strings.Replace(valign, pair[0], pair[1], 1)
	}
	return valign
}
