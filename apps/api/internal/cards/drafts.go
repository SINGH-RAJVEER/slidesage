package cards

import "github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"

// runsToMarkup writes runs back as draft markup. The format cannot combine
// bold and italic, so such a run keeps its bold.
func runsToMarkup(runs RichText) string {
	parts := make([]string, len(runs))
	for index, run := range runs {
		switch {
		case run.Bold:
			parts[index] = "**" + run.Text + "**"
		case run.Italic:
			parts[index] = "*" + run.Text + "*"
		default:
			parts[index] = run.Text
		}
	}
	return jsvalue.Concat(parts...)
}

func markupList(items []ListItem) jsvalue.Value {
	values := make([]jsvalue.Value, len(items))
	for index, item := range items {
		values[index] = str(runsToMarkup(item.Text))
	}
	return jsvalue.ArrayValue(values)
}

// nodeDraft is a node in the shape the model drafts, or undefined for an image.
func nodeDraft(node *Node) jsvalue.Value {
	typeMember := member{Key: "type", Value: str(node.Type)}
	switch node.Type {
	case "heading", "paragraph":
		return jsvalue.ObjectValue(typeMember, member{Key: "text", Value: str(runsToMarkup(node.Text))})
	case "bullets":
		return jsvalue.ObjectValue(typeMember, member{Key: "items", Value: markupList(node.Items)})
	case "quote":
		result := jsvalue.ObjectValue(typeMember, member{Key: "text", Value: str(runsToMarkup(node.Text))})
		if node.Attribution != "" {
			result.Object().Set("attribution", str(node.Attribution))
		}
		return result
	case "stat":
		return jsvalue.ObjectValue(typeMember, member{Key: "value", Value: str(node.Value)}, member{Key: "label", Value: str(node.Label)})
	case "steps":
		steps := make([]jsvalue.Value, len(node.Steps))
		for index, step := range node.Steps {
			steps[index] = jsvalue.ObjectValue(member{Key: "title", Value: str(step.Title)})
			if step.Detail != nil {
				steps[index].Object().Set("detail", str(runsToMarkup(step.Detail)))
			}
		}
		return jsvalue.ObjectValue(typeMember, member{Key: "items", Value: jsvalue.ArrayValue(steps)})
	case "columns":
		columns := make([]jsvalue.Value, len(node.Columns))
		for index, column := range node.Columns {
			columns[index] = jsvalue.ObjectValue(member{Key: "heading", Value: str(column.Heading)}, member{Key: "items", Value: markupList(column.Items)})
		}
		return jsvalue.ObjectValue(typeMember, member{Key: "columns", Value: jsvalue.ArrayValue(columns)})
	case "chart":
		series := make([]jsvalue.Value, len(node.Series))
		for index, entry := range node.Series {
			series[index] = jsvalue.ObjectValue(member{Key: "name", Value: str(entry.Name)}, member{Key: "values", Value: numbers(entry.Values)})
		}
		result := jsvalue.ObjectValue(
			typeMember,
			member{Key: "kind", Value: str(node.Kind)},
			member{Key: "size", Value: str(node.Size)},
			member{Key: "categories", Value: stringList(node.Categories)},
			member{Key: "series", Value: jsvalue.ArrayValue(series)},
		)
		for _, affix := range []struct{ key, value string }{{"prefix", node.Prefix}, {"suffix", node.Suffix}, {"caption", node.Caption}} {
			if affix.value != "" {
				result.Object().Set(affix.key, str(affix.value))
			}
		}
		return result
	case "progress":
		meters := make([]jsvalue.Value, len(node.Meters))
		for index, meter := range node.Meters {
			meters[index] = jsvalue.ObjectValue(member{Key: "label", Value: str(meter.Label)}, member{Key: "value", Value: jsvalue.NumberValue(meter.Value)})
		}
		return jsvalue.ObjectValue(typeMember, member{Key: "size", Value: str(node.Size)}, member{Key: "items", Value: jsvalue.ArrayValue(meters)})
	case "table":
		rows := make([]jsvalue.Value, len(node.Rows))
		for index, row := range node.Rows {
			rows[index] = stringList(row.Cells)
		}
		return jsvalue.ObjectValue(typeMember, member{Key: "size", Value: str(node.Size)}, member{Key: "columns", Value: stringList(node.TableColumns)}, member{Key: "rows", Value: jsvalue.ArrayValue(rows)})
	case "callout":
		return jsvalue.ObjectValue(typeMember, member{Key: "size", Value: str(node.Size)}, member{Key: "tone", Value: str(node.Tone)}, member{Key: "text", Value: str(runsToMarkup(node.Text))})
	}
	return jsvalue.UndefinedValue()
}

// Draft is a saved card in the shape the model drafts, so an AI revision
// reads the card the way it would write it. IDs are dropped and image nodes
// are left out: the server keeps the card's photo and adds it back.
func (card *Card) Draft() jsvalue.Value {
	var nodes []jsvalue.Value
	for index := range card.Nodes {
		if draft := nodeDraft(&card.Nodes[index]); !draft.IsUndefined() {
			nodes = append(nodes, draft)
		}
	}
	result := jsvalue.ObjectValue(
		member{Key: "takeaway", Value: str(card.Takeaway)},
		member{Key: "layout", Value: str(card.Layout)},
		member{Key: "nodes", Value: jsvalue.ArrayValue(nodes)},
		member{Key: "sourceIds", Value: stringList(card.SourceIDs)},
	)
	if card.Notes != "" {
		result.Object().Set("notes", str(card.Notes))
	}
	return result
}
