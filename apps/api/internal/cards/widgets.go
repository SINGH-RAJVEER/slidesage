package cards

import (
	"fmt"
	"strings"
)

// SizeSpan is a widget's span on a twelve-column grid.
var SizeSpan = map[string]int{"small": 4, "medium": 6, "large": 8, "full": 12}

const gridColumns = 12

// dashboardRows is the most widget rows a dashboard card holds.
const dashboardRows = 2

// seriesSlots is the most series or pie slices a chart can show.
const seriesSlots = 6

// FeatureText are the nodes shown beside the chart of a chart card or the
// table of a table card.
var FeatureText = []string{"paragraph", "bullets", "callout"}

// PieKinds are the chart kinds drawn as a single series of slices.
var PieKinds = []string{"pie", "donut"}

// WidgetCell is a widget with its share of its row's width.
type WidgetCell struct {
	Widget *Node
	Width  float64
}

// WidgetRows packs widgets into rows in order: a widget starts a new row when
// its span would overflow the current one.
func WidgetRows(widgets []*Node) [][]WidgetCell {
	var rows [][]*Node
	used := gridColumns
	for _, widget := range widgets {
		span := SizeSpan[widget.Size]
		if used+span > gridColumns {
			rows = append(rows, nil)
			used = 0
		}
		rows[len(rows)-1] = append(rows[len(rows)-1], widget)
		used += span
	}
	result := make([][]WidgetCell, len(rows))
	for index, row := range rows {
		total := 0
		for _, widget := range row {
			total += SizeSpan[widget.Size]
		}
		for _, widget := range row {
			result[index] = append(result[index], WidgetCell{Widget: widget, Width: float64(SizeSpan[widget.Size]) / float64(total)})
		}
	}
	return result
}

// FeatureSplit is how a chart or table card places its widget beside its
// text: Row reports side by side, and Share is the widget's share of the width.
func FeatureSplit(size string, hasText bool) (row bool, share float64) {
	if !hasText || size == "full" {
		return false, 1
	}
	return true, float64(SizeSpan[size]) / gridColumns
}

// chartKindMismatch explains why a chart cannot be drawn as kind, or returns
// an empty string when it can.
func chartKindMismatch(kind string, categories []string, series []ChartSeries) string {
	if contains(PieKinds, kind) {
		if len(series) != 1 {
			return fmt.Sprintf("a %s chart shows exactly one series", kind)
		}
		if len(categories) > seriesSlots {
			return fmt.Sprintf("a %s chart shows at most %d slices", kind, seriesSlots)
		}
		var values []float64
		if len(series) > 0 {
			values = series[0].Values
		}
		positive := false
		for _, value := range values {
			if value < 0 {
				return fmt.Sprintf("a %s chart cannot show negative values", kind)
			}
		}
		for _, value := range values {
			if value > 0 {
				positive = true
			}
		}
		if !positive {
			return fmt.Sprintf("a %s chart needs a value above zero", kind)
		}
	}
	if kind == "stacked-column" && len(series) < 2 {
		return "a stacked-column chart needs at least two series"
	}
	return ""
}

func joinList(list []string) string { return strings.Join(list, ", ") }
