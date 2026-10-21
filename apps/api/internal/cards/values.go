package cards

import "github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"

// The methods below write validated documents as the JavaScript objects the
// TypeScript validator builds, so their JSON keeps the same key order and
// leaves out the same absent fields.

func (run TextRun) value() jsvalue.Value {
	result := jsvalue.ObjectValue(member{Key: "text", Value: str(run.Text)})
	if run.Bold {
		result.Object().Set("bold", jsvalue.BoolValue(true))
	}
	if run.Italic {
		result.Object().Set("italic", jsvalue.BoolValue(true))
	}
	return result
}

func stringList(values []string) jsvalue.Value {
	result := make([]jsvalue.Value, len(values))
	for index, value := range values {
		result[index] = str(value)
	}
	return jsvalue.ArrayValue(result)
}

func numbers(values []float64) jsvalue.Value {
	result := make([]jsvalue.Value, len(values))
	for index, value := range values {
		result[index] = jsvalue.NumberValue(value)
	}
	return jsvalue.ArrayValue(result)
}

func listValue(items []ListItem) jsvalue.Value {
	result := make([]jsvalue.Value, len(items))
	for index, item := range items {
		result[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(item.ID)}, member{Key: "text", Value: richValue(item.Text)})
	}
	return jsvalue.ArrayValue(result)
}

// JS is the node as the validator returns it.
func (node *Node) JS() jsvalue.Value {
	result := jsvalue.ObjectValue(member{Key: "id", Value: str(node.ID)}, member{Key: "type", Value: str(node.Type)})
	object := result.Object()
	switch node.Type {
	case "heading", "paragraph":
		object.Set("text", richValue(node.Text))
	case "bullets":
		object.Set("items", listValue(node.Items))
	case "quote":
		object.Set("text", richValue(node.Text))
		if node.Attribution != "" {
			object.Set("attribution", str(node.Attribution))
		}
	case "stat":
		object.Set("value", str(node.Value))
		object.Set("label", str(node.Label))
	case "steps":
		steps := make([]jsvalue.Value, len(node.Steps))
		for index, step := range node.Steps {
			steps[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(step.ID)}, member{Key: "title", Value: str(step.Title)})
			if step.Detail != nil {
				steps[index].Object().Set("detail", richValue(step.Detail))
			}
		}
		object.Set("items", jsvalue.ArrayValue(steps))
	case "columns":
		columns := make([]jsvalue.Value, len(node.Columns))
		for index, column := range node.Columns {
			columns[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(column.ID)}, member{Key: "heading", Value: str(column.Heading)}, member{Key: "items", Value: listValue(column.Items)})
		}
		object.Set("columns", jsvalue.ArrayValue(columns))
	case "image":
		object.Set("assetId", str(node.AssetID))
		object.Set("alt", str(node.Alt))
		object.Set("fit", str(node.Fit))
		if node.Focus != nil {
			object.Set("focus", jsvalue.ObjectValue(member{Key: "x", Value: jsvalue.NumberValue(node.Focus.X)}, member{Key: "y", Value: jsvalue.NumberValue(node.Focus.Y)}))
		}
	case "chart":
		object.Set("kind", str(node.Kind))
		object.Set("size", str(node.Size))
		object.Set("categories", stringList(node.Categories))
		series := make([]jsvalue.Value, len(node.Series))
		for index, entry := range node.Series {
			series[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(entry.ID)}, member{Key: "name", Value: str(entry.Name)}, member{Key: "values", Value: numbers(entry.Values)})
		}
		object.Set("series", jsvalue.ArrayValue(series))
		for _, affix := range []struct{ key, value string }{{"prefix", node.Prefix}, {"suffix", node.Suffix}, {"caption", node.Caption}} {
			if affix.value != "" {
				object.Set(affix.key, str(affix.value))
			}
		}
	case "progress":
		object.Set("size", str(node.Size))
		meters := make([]jsvalue.Value, len(node.Meters))
		for index, meter := range node.Meters {
			meters[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(meter.ID)}, member{Key: "label", Value: str(meter.Label)}, member{Key: "value", Value: jsvalue.NumberValue(meter.Value)})
		}
		object.Set("items", jsvalue.ArrayValue(meters))
	case "table":
		object.Set("size", str(node.Size))
		object.Set("columns", stringList(node.TableColumns))
		rows := make([]jsvalue.Value, len(node.Rows))
		for index, row := range node.Rows {
			rows[index] = jsvalue.ObjectValue(member{Key: "id", Value: str(row.ID)}, member{Key: "cells", Value: stringList(row.Cells)})
		}
		object.Set("rows", jsvalue.ArrayValue(rows))
	case "callout":
		object.Set("size", str(node.Size))
		object.Set("tone", str(node.Tone))
		object.Set("text", richValue(node.Text))
	}
	return result
}

// JS is the card as the validator returns it.
func (card *Card) JS() jsvalue.Value {
	nodes := make([]jsvalue.Value, len(card.Nodes))
	for index := range card.Nodes {
		nodes[index] = card.Nodes[index].JS()
	}
	result := jsvalue.ObjectValue(
		member{Key: "id", Value: str(card.ID)},
		member{Key: "takeaway", Value: str(card.Takeaway)},
		member{Key: "role", Value: str(card.Role)},
		member{Key: "layout", Value: str(card.Layout)},
		member{Key: "nodes", Value: jsvalue.ArrayValue(nodes)},
		member{Key: "sourceIds", Value: stringList(card.SourceIDs)},
	)
	if card.Notes != "" {
		result.Object().Set("notes", str(card.Notes))
	}
	return result
}

// JS is the document as the validator returns it, at the current version.
func (document *Document) JS() jsvalue.Value {
	cards := jsvalue.ObjectValue()
	for _, cardID := range document.CardOrder {
		cards.Object().Set(cardID, document.Cards[cardID].JS())
	}
	return jsvalue.ObjectValue(
		member{Key: "schemaVersion", Value: jsvalue.NumberValue(SchemaVersion)},
		member{Key: "title", Value: str(document.Title)},
		member{Key: "theme", Value: str(document.Theme)},
		member{Key: "cardOrder", Value: stringList(document.CardOrder)},
		member{Key: "cards", Value: cards},
	)
}

// JS is the result as convertCards returns it.
func (result CardResult) JS() jsvalue.Value {
	if result.Issue != nil {
		return jsvalue.ObjectValue(member{Key: "position", Value: jsvalue.NumberValue(result.Position)}, member{Key: "issue", Value: result.Issue.JS()})
	}
	return jsvalue.ObjectValue(member{Key: "position", Value: jsvalue.NumberValue(result.Position)}, member{Key: "card", Value: result.Card.JS()})
}

// JS is the issue as a SchemaIssue object.
func (issue Issue) JS() jsvalue.Value {
	return jsvalue.ObjectValue(member{Key: "path", Value: str(issue.Path)}, member{Key: "message", Value: str(issue.Message)})
}
