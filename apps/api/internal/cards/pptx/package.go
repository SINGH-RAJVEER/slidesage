package pptx

import (
	"embed"
	"strings"
	"time"
)

// The templates are parts pptxgenjs 4.0.1 writes the same way for every deck,
// or its own template literals for parts that vary, extracted from it once.
// They are maintained here now.
//
//go:embed templates/*.xml templates/*.rels templates/*.tmpl templates/*.base64
var templateFiles embed.FS

var templates = func() map[string][]byte {
	entries, err := templateFiles.ReadDir("templates")
	if err != nil {
		panic(err)
	}
	result := map[string][]byte{}
	for _, entry := range entries {
		data, err := templateFiles.ReadFile("templates/" + entry.Name())
		if err != nil {
			panic(err)
		}
		result[entry.Name()] = data
	}
	return result
}()

func template(name string) string { return string(templates[name]) }

const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`

const slideNumberField = "{F7021451-1387-4CA6-816F-3879F97B5CBC}"

// write is exportPresentation: the parts of the file, in the order JSZip
// receives them.
func (deck *presentation) write(now time.Time) []byte {
	zip := newArchive(now)
	for _, folder := range []string{
		"_rels", "docProps", "ppt", "ppt/_rels", "ppt/charts", "ppt/charts/_rels", "ppt/embeddings", "ppt/media",
		"ppt/slideLayouts", "ppt/slideLayouts/_rels", "ppt/slideMasters", "ppt/slideMasters/_rels", "ppt/slides",
		"ppt/slides/_rels", "ppt/theme", "ppt/notesMasters", "ppt/notesMasters/_rels", "ppt/notesSlides",
		"ppt/notesSlides/_rels",
	} {
		zip.folder(folder)
	}
	zip.text("[Content_Types].xml", deck.contentTypes())
	zip.file("_rels/.rels", templates["root.rels"])
	zip.text("docProps/app.xml", deck.app())
	zip.text("docProps/core.xml", deck.core(now))
	zip.text("ppt/_rels/presentation.xml.rels", deck.presentationRels())
	theme := strings.Replace(strings.Replace(template("theme.xml"), "{{heading}}", deck.headFont, 1), "{{body}}", deck.bodyFont, 1)
	zip.text("ppt/theme/theme1.xml", theme)
	zip.text("ppt/presentation.xml", deck.presentationXML())
	zip.file("ppt/presProps.xml", templates["presProps.xml"])
	zip.file("ppt/tableStyles.xml", templates["tableStyles.xml"])
	zip.file("ppt/viewProps.xml", templates["viewProps.xml"])
	zip.file("ppt/slideLayouts/slideLayout1.xml", templates["slideLayout.xml"])
	zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", templates["slideLayout.rels"])
	for _, page := range deck.slides {
		number := integer(page.number)
		zip.text("ppt/slides/slide"+number+".xml", xmlHeader+crlf+
			`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `+
			`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`+
			page.xml()+
			"<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
		zip.text("ppt/slides/_rels/slide"+number+".xml.rels", page.relsXML())
		zip.text("ppt/notesSlides/notesSlide"+number+".xml", page.notesXML())
		zip.text("ppt/notesSlides/_rels/notesSlide"+number+".xml.rels", strings.Replace(template("notesSlide.rels.tmpl"), "${slideNumber}", number, 1))
	}
	zip.file("ppt/slideMasters/slideMaster1.xml", templates["slideMaster.xml"])
	zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", templates["slideMaster.rels"])
	zip.file("ppt/notesMasters/notesMaster1.xml", templates["notesMaster.xml"])
	zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", templates["notesMaster.rels"])
	for _, page := range deck.slides {
		for _, media := range page.media {
			zip.file(strings.Replace(media.target, "..", "ppt", 1), media.data)
		}
	}
	for _, page := range deck.slides {
		for _, chart := range page.charts {
			number := integer(chart.number)
			zip.file("ppt/embeddings/Microsoft_Excel_Worksheet"+number+".xlsx", chart.workbook(now, templates))
			zip.text("ppt/charts/_rels/chart"+number+".xml.rels", xmlHeader+
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
				`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Worksheet`+number+`.xlsx"/>`+
				"</Relationships>")
			zip.text("ppt/charts/chart"+number+".xml", chart.xml())
		}
	}
	return zip.bytes()
}

func (deck *presentation) contentTypes() string {
	var builder strings.Builder
	builder.WriteString(xmlHeader + crlf)
	builder.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	builder.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	builder.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	builder.WriteString(`<Default Extension="jpeg" ContentType="image/jpeg"/>`)
	builder.WriteString(`<Default Extension="jpg" ContentType="image/jpg"/>`)
	builder.WriteString(`<Default Extension="svg" ContentType="image/svg+xml"/>`)
	builder.WriteString(`<Default Extension="png" ContentType="image/png"/>`)
	builder.WriteString(`<Default Extension="gif" ContentType="image/gif"/>`)
	builder.WriteString(`<Default Extension="m4v" ContentType="video/mp4"/>`)
	builder.WriteString(`<Default Extension="mp4" ContentType="video/mp4"/>`)
	builder.WriteString(`<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>`)
	builder.WriteString(`<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`)
	builder.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
	builder.WriteString(`<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`)
	for index, page := range deck.slides {
		number := integer(index + 1)
		builder.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster` + number + `.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
		builder.WriteString(`<Override PartName="/ppt/slides/slide` + number + `.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
		for _, chart := range page.charts {
			builder.WriteString(`<Override PartName="` + chart.target() + `" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
		}
	}
	builder.WriteString(`<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>`)
	builder.WriteString(`<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>`)
	builder.WriteString(`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`)
	builder.WriteString(`<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>`)
	builder.WriteString(`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`)
	for index := range deck.slides {
		builder.WriteString(`<Override PartName="/ppt/notesSlides/notesSlide` + integer(index+1) + `.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`)
	}
	builder.WriteString(` <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`)
	builder.WriteString(` <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`)
	builder.WriteString("</Types>")
	return builder.String()
}

func (deck *presentation) app() string {
	count := len(deck.slides)
	var titles strings.Builder
	for index := range deck.slides {
		titles.WriteString("<vt:lpstr>Slide " + integer(index+1) + "</vt:lpstr>")
	}
	return strings.NewReplacer(
		"${CRLF}", crlf,
		"${slides.length + 1 + 2}", integer(count+1+2),
		"${slides.length}", integer(count),
		"${slides.map((_slideObj, idx) => `<vt:lpstr>Slide ${idx + 1}</vt:lpstr>`).join('')}", titles.String(),
		"${company}", "PptxGenJS",
	).Replace(template("app.xml.tmpl"))
}

func (deck *presentation) core(now time.Time) string {
	stamp := now.UTC().Format("2006-01-02T15:04:05Z")
	return strings.NewReplacer(
		"${encodeXmlEntities(title)}", encode(deck.title),
		"${encodeXmlEntities(subject)}", "PptxGenJS Presentation",
		"${encodeXmlEntities(author)}", "PptxGenJS",
		"${revision}", "1",
		"${new Date().toISOString().replace(/\\.\\d\\d\\dZ/, 'Z')}", stamp,
	).Replace(template("core.xml.tmpl"))
}

func (deck *presentation) presentationRels() string {
	var builder strings.Builder
	builder.WriteString(xmlHeader + crlf)
	builder.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	builder.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`)
	relID := 1
	for index := range deck.slides {
		relID++
		builder.WriteString(`<Relationship Id="rId` + integer(relID) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide` + integer(index+1) + `.xml"/>`)
	}
	relID++
	builder.WriteString(`<Relationship Id="rId` + integer(relID) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>` +
		`<Relationship Id="rId` + integer(relID+1) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>` +
		`<Relationship Id="rId` + integer(relID+2) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>` +
		`<Relationship Id="rId` + integer(relID+3) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
		`<Relationship Id="rId` + integer(relID+4) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>` +
		"</Relationships>")
	return builder.String()
}

func (deck *presentation) presentationXML() string {
	var builder strings.Builder
	builder.WriteString(xmlHeader + crlf +
		`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
		`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"  saveSubsetFonts="1" autoCompressPictures="0">`)
	builder.WriteString(`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`)
	builder.WriteString("<p:sldIdLst>")
	for index := range deck.slides {
		builder.WriteString(`<p:sldId id="` + integer(index+256) + `" r:id="rId` + integer(index+2) + `"/>`)
	}
	builder.WriteString("</p:sldIdLst>")
	builder.WriteString(`<p:notesMasterIdLst><p:notesMasterId r:id="rId` + integer(len(deck.slides)+2) + `"/></p:notesMasterIdLst>`)
	builder.WriteString(`<p:sldSz cx="12192000" cy="6858000"/>`)
	builder.WriteString(`<p:notesSz cx="6858000" cy="12192000"/>`)
	builder.WriteString("<p:defaultTextStyle>")
	for level := 1; level < 10; level++ {
		builder.WriteString(`<a:lvl` + integer(level) + `pPr marL="` + integer((level-1)*457200) + `" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
			`<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>` +
			`</a:defRPr></a:lvl` + integer(level) + `pPr>`)
	}
	builder.WriteString("</p:defaultTextStyle>")
	builder.WriteString("</p:presentation>")
	return builder.String()
}

func (page *slide) relsXML() string {
	lastRelID := 0
	var builder strings.Builder
	builder.WriteString(xmlHeader + crlf + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	for _, rel := range page.rels {
		lastRelID = max(lastRelID, rel.relID)
		builder.WriteString(`<Relationship Id="rId` + integer(rel.relID) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="` + rel.target + `" TargetMode="External"/>`)
	}
	for _, chart := range page.charts {
		lastRelID = max(lastRelID, chart.relID)
		builder.WriteString(`<Relationship Id="rId` + integer(chart.relID) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="` + chart.target() + `"/>`)
	}
	for _, media := range page.media {
		lastRelID = max(lastRelID, media.relID)
		builder.WriteString(`<Relationship Id="rId` + integer(media.relID) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="` + media.target + `"/>`)
	}
	builder.WriteString(`<Relationship Id="rId` + integer(lastRelID+1) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
	builder.WriteString(`<Relationship Id="rId` + integer(lastRelID+2) + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide` + integer(page.number) + `.xml"/>`)
	builder.WriteString("</Relationships>")
	return builder.String()
}

func (page *slide) notesXML() string {
	var notes strings.Builder
	for _, object := range page.objects {
		if object.kind == notesKind {
			notes.WriteString(object.notes)
		}
	}
	text := lineBreaks.ReplaceAllLiteralString(notes.String(), crlf)
	return strings.NewReplacer(
		"${CRLF}", crlf,
		"${encodeXmlEntities(getNotesFromSlide(slide))}", encode(text),
		"${SLDNUMFLDID}", slideNumberField,
		"${slide._slideNum}", integer(page.number),
	).Replace(template("notesSlide.xml.tmpl"))
}
