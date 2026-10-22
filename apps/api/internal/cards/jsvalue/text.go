package jsvalue

import (
	"strings"
	"unicode/utf8"
)

// Units decodes a WTF-8 string into the UTF-16 code units JavaScript sees.
func Units(text string) []uint16 {
	units := make([]uint16, 0, len(text))
	for index := 0; index < len(text); {
		if unit, ok := surrogateAt(text, index); ok {
			units = append(units, unit)
			index += 3
			continue
		}
		char, width := utf8.DecodeRuneInString(text[index:])
		index += width
		if char >= 0x10000 {
			char -= 0x10000
			units = append(units, uint16(0xd800+(char>>10)), uint16(0xdc00+(char&0x3ff)))
			continue
		}
		units = append(units, uint16(char))
	}
	return units
}

// surrogateAt reads the three-byte encoding of a lone surrogate.
func surrogateAt(text string, index int) (uint16, bool) {
	if index+2 >= len(text) || text[index] != 0xed || text[index+1] < 0xa0 || text[index+1] > 0xbf || text[index+2] < 0x80 || text[index+2] > 0xbf {
		return 0, false
	}
	return 0xd000 | uint16(text[index+1]&0x3f)<<6 | uint16(text[index+2]&0x3f), true
}

// FromUnits encodes UTF-16 code units as WTF-8, joining surrogate pairs.
func FromUnits(units []uint16) string {
	var builder strings.Builder
	builder.Grow(len(units))
	for index := 0; index < len(units); index++ {
		unit := units[index]
		if unit >= 0xd800 && unit <= 0xdbff && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
			builder.WriteRune(rune(unit-0xd800)<<10 + rune(units[index+1]-0xdc00) + 0x10000)
			index++
			continue
		}
		if unit >= 0xd800 && unit <= 0xdfff {
			builder.WriteByte(0xed)
			builder.WriteByte(0x80 | byte(unit>>6&0x3f))
			builder.WriteByte(0x80 | byte(unit&0x3f))
			continue
		}
		builder.WriteRune(rune(unit))
	}
	return builder.String()
}

// Canonical joins surrogate halves that concatenation left apart, so equal
// JavaScript strings are equal Go strings.
func Canonical(text string) string {
	if !strings.Contains(text, "\xed") {
		return text
	}
	return FromUnits(Units(text))
}

// Concat joins strings as JavaScript's + does.
func Concat(parts ...string) string { return Canonical(strings.Join(parts, "")) }

// Length is a string's .length: its UTF-16 code units.
func Length(text string) int {
	length := 0
	for index := 0; index < len(text); {
		if _, ok := surrogateAt(text, index); ok {
			length++
			index += 3
			continue
		}
		char, width := utf8.DecodeRuneInString(text[index:])
		index += width
		length++
		if char >= 0x10000 {
			length++
		}
	}
	return length
}

// CodePoints counts what Array.from(text) yields: code points, with each
// unpaired surrogate counted once.
func CodePoints(text string) int {
	count := 0
	units := Units(text)
	for index := 0; index < len(units); index++ {
		if units[index] >= 0xd800 && units[index] <= 0xdbff && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
			index++
		}
		count++
	}
	return count
}

// SpaceClass is JavaScript's \s, written for Go regular expressions.
const SpaceClass = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// IsSpace reports whether a character is white space or a line terminator to
// JavaScript's trim and \s.
func IsSpace(char rune) bool {
	switch char {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return char >= 0x2000 && char <= 0x200a
}

// Trim is String.prototype.trim.
func Trim(text string) string {
	return strings.TrimFunc(text, IsSpace)
}

// IsBlank reports whether text.trim() === "".
func IsBlank(text string) bool { return Trim(text) == "" }
