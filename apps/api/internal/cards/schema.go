// Package cards is the Go port of the card document rules in libs/cards that
// the converter serves: validation, draft conversion, assembly, and the draft
// form of saved cards. libs/cards stays the source for the browser editor;
// converter compatibility tests hold the two to the same behavior.
package cards

// SchemaVersion is the card document version this build writes.
const SchemaVersion = 3

// readableVersions are the schema versions this build reads.
var readableVersions = []float64{1, 2, 3}

var Themes = []string{"slate", "paper", "ember", "ocean", "grove", "orchid", "sand", "cobalt", "mono"}

var NarrativeRoles = []string{"opening", "context", "evidence", "comparison", "process", "insight", "closing"}

var Layouts = []string{
	"title",
	"statement",
	"bullets",
	"comparison",
	"process",
	"quote",
	"stats",
	"image-left",
	"image-right",
	"cover",
	"chart",
	"table",
	"dashboard",
}

var widgetSizes = []string{"small", "medium", "large", "full"}

var chartKinds = []string{"column", "bar", "stacked-column", "line", "area", "pie", "donut"}

var calloutTones = []string{"note", "positive", "caution"}

var widgetTypes = []string{"chart", "progress", "table", "callout"}

type bounds struct{ min, max int }

// limits mirrors LIMITS in libs/cards.
var limits = struct {
	cards                                                bounds
	title, takeaway, notes, heading, paragraph, listItem int
	quote, attribution, statValue, statLabel             int
	stepTitle, stepDetail, columnHeading, imageAlt       int
	sourceIDs                                            int
	chartCategories, chartSeries                         bounds
	categoryLabel, seriesName, affix, chartCaption       int
	chartValue                                           float64
	meters                                               bounds
	meterLabel                                           int
	tableColumns, tableRows                              bounds
	tableHeading, tableCell, callout                     int
}{
	cards:           bounds{1, 40},
	title:           120,
	takeaway:        200,
	notes:           1200,
	heading:         90,
	paragraph:       420,
	listItem:        160,
	quote:           280,
	attribution:     80,
	statValue:       16,
	statLabel:       60,
	stepTitle:       60,
	stepDetail:      200,
	columnHeading:   40,
	imageAlt:        200,
	sourceIDs:       8,
	chartCategories: bounds{2, 12},
	chartSeries:     bounds{1, 4},
	categoryLabel:   24,
	seriesName:      40,
	affix:           8,
	chartCaption:    120,
	chartValue:      1e12,
	meters:          bounds{1, 6},
	meterLabel:      60,
	tableColumns:    bounds{2, 5},
	tableRows:       bounds{1, 8},
	tableHeading:    32,
	tableCell:       60,
	callout:         240,
}

// TextRun is a run of text with optional emphasis.
type TextRun struct {
	Text   string
	Bold   bool
	Italic bool
}

type RichText []TextRun

type ListItem struct {
	ID   string
	Text RichText
}

type Step struct {
	ID     string
	Title  string
	Detail RichText
}

type Column struct {
	ID      string
	Heading string
	Items   []ListItem
}

type Focus struct{ X, Y float64 }

type ChartSeries struct {
	ID     string
	Name   string
	Values []float64
}

type Meter struct {
	ID    string
	Label string
	Value float64
}

type TableRow struct {
	ID    string
	Cells []string
}

// Node is one content node. Type selects which fields are set; optional text
// fields are empty when absent, since a present one is never blank.
type Node struct {
	ID   string
	Type string

	// heading, paragraph, quote, callout
	Text RichText
	// bullets
	Items []ListItem
	// quote
	Attribution string
	// stat
	Value, Label string
	// steps
	Steps []Step
	// columns
	Columns []Column
	// image
	AssetID, Alt, Fit string
	Focus             *Focus
	// widgets
	Size string
	// chart
	Kind                    string
	Categories              []string
	Series                  []ChartSeries
	Prefix, Suffix, Caption string
	// progress
	Meters []Meter
	// table
	TableColumns []string
	Rows         []TableRow
	// callout
	Tone string
}

type Card struct {
	ID        string
	Takeaway  string
	Role      string
	Layout    string
	Nodes     []Node
	SourceIDs []string
	Notes     string
}

type Document struct {
	Title     string
	Theme     string
	CardOrder []string
	Cards     map[string]*Card
}

// IsWidget reports whether a node is a data widget.
func (node Node) IsWidget() bool { return contains(widgetTypes, node.Type) }

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
