package pptx

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"strings"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cards/jsvalue"
)

// archive writes an uncompressed zip: explicit folder entries, entries in
// insertion order, DOS times in UTC, and no data descriptors or extra fields.
type archive struct {
	entries []entry
	names   map[string]bool
	time    time.Time
}

type entry struct {
	name string
	data []byte
}

func newArchive(now time.Time) *archive {
	return &archive{names: map[string]bool{}, time: now.UTC()}
}

// folder adds a folder entry and its missing parents.
func (archive *archive) folder(name string) {
	name = strings.TrimSuffix(name, "/") + "/"
	if archive.names[name] {
		return
	}
	if parent := name[:strings.LastIndex(strings.TrimSuffix(name, "/"), "/")+1]; parent != "" {
		archive.folder(parent)
	}
	archive.names[name] = true
	archive.entries = append(archive.entries, entry{name: name})
}

// file adds a file, creating its parent folders first. Text is written as
// UTF-8, with any unpaired surrogate replaced as Buffer.from does.
func (archive *archive) file(name string, data []byte) {
	if index := strings.LastIndex(name, "/"); index >= 0 {
		archive.folder(name[:index+1])
	}
	if archive.names[name] {
		for index := range archive.entries {
			if archive.entries[index].name == name {
				archive.entries[index].data = data
			}
		}
		return
	}
	archive.names[name] = true
	archive.entries = append(archive.entries, entry{name: name, data: data})
}

func (archive *archive) text(name, content string) {
	archive.file(name, []byte(wellFormed(content)))
}

// wellFormed replaces unpaired surrogates with U+FFFD.
func wellFormed(text string) string {
	text = jsvalue.Canonical(text)
	if !strings.Contains(text, "\xed") {
		return text
	}
	units := jsvalue.Units(text)
	for index := 0; index < len(units); index++ {
		unit := units[index]
		if unit >= 0xd800 && unit <= 0xdbff && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
			index++
			continue
		}
		if unit >= 0xd800 && unit <= 0xdfff {
			units[index] = 0xfffd
		}
	}
	return jsvalue.FromUnits(units)
}

func (archive *archive) bytes() []byte {
	moment := archive.time
	dosTime := uint16(moment.Hour()<<11 | moment.Minute()<<5 | moment.Second()/2)
	dosDate := uint16((moment.Year()-1980)<<9 | int(moment.Month())<<5 | moment.Day())
	var output, directory bytes.Buffer
	little := binary.LittleEndian
	for _, entry := range archive.entries {
		offset := uint32(output.Len())
		checksum := crc32.ChecksumIEEE(entry.data)
		size := uint32(len(entry.data))
		var flags uint16
		for index := 0; index < len(entry.name); index++ {
			if entry.name[index] >= 0x80 {
				flags = 0x0800
				break
			}
		}
		header := make([]byte, 30)
		little.PutUint32(header[0:], 0x04034b50)
		little.PutUint16(header[4:], 10)
		little.PutUint16(header[6:], flags)
		little.PutUint16(header[10:], dosTime)
		little.PutUint16(header[12:], dosDate)
		little.PutUint32(header[14:], checksum)
		little.PutUint32(header[18:], size)
		little.PutUint32(header[22:], size)
		little.PutUint16(header[26:], uint16(len(entry.name)))
		output.Write(header)
		output.WriteString(entry.name)
		output.Write(entry.data)

		central := make([]byte, 46)
		little.PutUint32(central[0:], 0x02014b50)
		little.PutUint16(central[4:], 0x14)
		little.PutUint16(central[6:], 10)
		little.PutUint16(central[8:], flags)
		little.PutUint16(central[12:], dosTime)
		little.PutUint16(central[14:], dosDate)
		little.PutUint32(central[16:], checksum)
		little.PutUint32(central[20:], size)
		little.PutUint32(central[24:], size)
		little.PutUint16(central[28:], uint16(len(entry.name)))
		if strings.HasSuffix(entry.name, "/") {
			little.PutUint32(central[38:], 0x10)
		}
		little.PutUint32(central[42:], offset)
		directory.Write(central)
		directory.WriteString(entry.name)
	}
	start := uint32(output.Len())
	output.Write(directory.Bytes())
	end := make([]byte, 22)
	little.PutUint32(end[0:], 0x06054b50)
	little.PutUint16(end[8:], uint16(len(archive.entries)))
	little.PutUint16(end[10:], uint16(len(archive.entries)))
	little.PutUint32(end[12:], uint32(directory.Len()))
	little.PutUint32(end[16:], start)
	output.Write(end)
	return output.Bytes()
}
