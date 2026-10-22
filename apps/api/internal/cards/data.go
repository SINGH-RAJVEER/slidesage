package cards

import (
	_ "embed"
	"encoding/json"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// The files in data/ are written from libs/cards by data/generate.ts.

//go:embed data/templates.json
var templatesJSON string

//go:embed data/drafting-schema.json
var draftingSchemaJSON string

//go:embed data/themes.json
var themesJSON []byte

var (
	draftingSchema = mustParse(draftingSchemaJSON)
	templates      = mustParse(templatesJSON)
)

func mustParse(text string) jsvalue.Value {
	value, err := jsvalue.Parse(text)
	if err != nil {
		panic("embedded card data is not JSON: " + err.Error())
	}
	return value
}

// DraftingSchema is everything a drafting prompt needs to know about the
// schema, as draftingSchema() in libs/cards returns it.
func DraftingSchema() jsvalue.Value { return draftingSchema }

// Template returns a curated starter deck as {document, assets}.
func Template(id string) (jsvalue.Value, bool) {
	if !templates.Object().Has(id) {
		return jsvalue.Value{}, false
	}
	return templates.Get(id), true
}

// Palette is a theme's solid colors as CSS hex values.
type Palette struct {
	Surface string `json:"surface"`
	Heading string `json:"heading"`
	Body    string `json:"body"`
	Muted   string `json:"muted"`
	Accent  string `json:"accent"`
	Rule    string `json:"rule"`
}

// ChartPalette is a theme's data colors.
type ChartPalette struct {
	Series   []string `json:"series"`
	Positive string   `json:"positive"`
	Caution  string   `json:"caution"`
}

// Theme is what an export needs of a theme definition.
type Theme struct {
	Palette Palette      `json:"palette"`
	Chart   ChartPalette `json:"chart"`
	Fonts   struct {
		Heading string `json:"heading"`
		Body    string `json:"body"`
	} `json:"fonts"`
}

// StockLibrary is a stock photo library as its guidelines ask to be credited.
type StockLibrary struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

var themeData = func() (data struct {
	Themes         map[string]Theme        `json:"themes"`
	Cover          Palette                 `json:"cover"`
	StockLibraries map[string]StockLibrary `json:"stockLibraries"`
}) {
	if err := json.Unmarshal(themesJSON, &data); err != nil {
		panic("embedded theme data is not JSON: " + err.Error())
	}
	return data
}()

// ThemeDefinition returns a theme by ID.
func ThemeDefinition(id string) Theme { return themeData.Themes[id] }

// CoverPalette is neutral text over photos.
func CoverPalette() Palette { return themeData.Cover }

// StockLibraries are the libraries photo credits name and link.
func StockLibraries() map[string]StockLibrary { return themeData.StockLibraries }
