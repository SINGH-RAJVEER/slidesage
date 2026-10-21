package cards

import (
	"fmt"
	"strings"
)

type nodeBounds struct {
	nodeType string
	bounds
}

// layoutRule is the content a layout supports, as LAYOUT_RULES in libs/cards
// lists it. Node bounds keep their order there, which decides which count a
// mismatch reports first.
type layoutRule struct {
	nodes        []nodeBounds
	items        *bounds
	requireOneOf []string
	widgets      *bounds
}

func (rule layoutRule) accepts(nodeType string) bool {
	for _, entry := range rule.nodes {
		if entry.nodeType == nodeType {
			return true
		}
	}
	return false
}

var layoutRules = map[string]layoutRule{
	"title":     {nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"paragraph", bounds{0, 1}}}},
	"statement": {nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"paragraph", bounds{1, 2}}}},
	"bullets": {
		nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"bullets", bounds{1, 1}}, {"paragraph", bounds{0, 1}}},
		items: &bounds{2, 6},
	},
	"comparison": {
		nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"columns", bounds{1, 1}}},
		items: &bounds{2, 5},
	},
	"process": {
		nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"steps", bounds{1, 1}}},
		items: &bounds{3, 6},
	},
	"quote": {nodes: []nodeBounds{{"heading", bounds{0, 1}}, {"quote", bounds{1, 1}}}},
	"stats": {nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"stat", bounds{2, 4}}, {"paragraph", bounds{0, 1}}}},
	"image-left": {
		nodes:        []nodeBounds{{"image", bounds{1, 1}}, {"heading", bounds{1, 1}}, {"paragraph", bounds{0, 1}}, {"bullets", bounds{0, 1}}},
		items:        &bounds{2, 4},
		requireOneOf: []string{"paragraph", "bullets"},
	},
	"image-right": {
		nodes:        []nodeBounds{{"image", bounds{1, 1}}, {"heading", bounds{1, 1}}, {"paragraph", bounds{0, 1}}, {"bullets", bounds{0, 1}}},
		items:        &bounds{2, 4},
		requireOneOf: []string{"paragraph", "bullets"},
	},
	"cover": {nodes: []nodeBounds{{"image", bounds{1, 1}}, {"heading", bounds{1, 1}}, {"paragraph", bounds{0, 1}}}},
	"chart": {
		nodes: []nodeBounds{
			{"heading", bounds{1, 1}},
			{"chart", bounds{1, 1}},
			{"paragraph", bounds{0, 1}},
			{"bullets", bounds{0, 1}},
			{"callout", bounds{0, 1}},
		},
		items: &bounds{2, 4},
	},
	"table": {
		nodes: []nodeBounds{{"heading", bounds{1, 1}}, {"table", bounds{1, 1}}, {"paragraph", bounds{0, 1}}, {"callout", bounds{0, 1}}},
	},
	"dashboard": {
		nodes: []nodeBounds{
			{"heading", bounds{1, 1}},
			{"chart", bounds{0, 4}},
			{"progress", bounds{0, 4}},
			{"table", bounds{0, 2}},
			{"callout", bounds{0, 4}},
		},
		widgets: &bounds{2, 4},
	},
}

var comparisonColumns = bounds{2, 3}

// layoutMismatch explains why nodes do not fit layout, or returns an empty
// string when they do.
func layoutMismatch(layout string, nodes []Node) string {
	rule := layoutRules[layout]
	counts := map[string]int{}
	for index := range nodes {
		node := &nodes[index]
		if !rule.accepts(node.Type) {
			return fmt.Sprintf("layout \"%s\" does not accept %s nodes", layout, node.Type)
		}
		counts[node.Type]++
		items := -1
		switch node.Type {
		case "bullets":
			items = len(node.Items)
		case "steps":
			items = len(node.Steps)
		}
		if items >= 0 && rule.items != nil && (items < rule.items.min || items > rule.items.max) {
			return fmt.Sprintf("layout \"%s\" needs %d-%d %s items, got %d", layout, rule.items.min, rule.items.max, node.Type, items)
		}
		if node.Type == "columns" {
			columns := len(node.Columns)
			if columns < comparisonColumns.min || columns > comparisonColumns.max {
				return fmt.Sprintf("layout \"%s\" needs %d-%d columns, got %d", layout, comparisonColumns.min, comparisonColumns.max, columns)
			}
			for _, column := range node.Columns {
				size := len(column.Items)
				if rule.items != nil && (size < rule.items.min || size > rule.items.max) {
					return fmt.Sprintf("column %s needs %d-%d items, got %d", quoted(column.Heading), rule.items.min, rule.items.max, size)
				}
			}
		}
	}
	if rule.widgets != nil {
		var widgets []*Node
		for index := range nodes {
			if nodes[index].IsWidget() {
				widgets = append(widgets, &nodes[index])
			}
		}
		if len(widgets) < rule.widgets.min || len(widgets) > rule.widgets.max {
			return fmt.Sprintf("layout \"%s\" needs %d-%d widgets, got %d", layout, rule.widgets.min, rule.widgets.max, len(widgets))
		}
		if rows := len(WidgetRows(widgets)); rows > dashboardRows {
			return fmt.Sprintf("layout \"%s\" fits its widgets in %d rows, these sizes need %d; use smaller sizes", layout, dashboardRows, rows)
		}
	}
	if rule.requireOneOf != nil {
		found := false
		for _, nodeType := range rule.requireOneOf {
			if counts[nodeType] > 0 {
				found = true
			}
		}
		if !found {
			return fmt.Sprintf("layout \"%s\" needs a %s node", layout, strings.Join(rule.requireOneOf, " or "))
		}
	}
	for _, entry := range rule.nodes {
		count := counts[entry.nodeType]
		if count < entry.min || count > entry.max {
			expected := fmt.Sprintf("%d-%d", entry.min, entry.max)
			if entry.min == entry.max {
				expected = fmt.Sprintf("%d", entry.min)
			}
			return fmt.Sprintf("layout \"%s\" needs %s %s node(s), got %d", layout, expected, entry.nodeType, count)
		}
	}
	return ""
}

// quoted wraps text in double quotes as a template literal writes "${text}",
// without escaping.
func quoted(text string) string { return `"` + text + `"` }
