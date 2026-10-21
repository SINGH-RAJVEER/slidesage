package jsvalue

import (
	"errors"
	"math"
	"strconv"
	"strings"
)

// Stringify is JSON.stringify without a replacer or indentation. Undefined
// members are left out, undefined array items and non-finite numbers are
// written as null, and nothing beyond quotes, backslashes, control characters,
// and unpaired surrogates is escaped.
func Stringify(value Value) []byte {
	var builder strings.Builder
	write(&builder, value)
	return []byte(builder.String())
}

func write(builder *strings.Builder, value Value) {
	switch value.kind {
	case Undefined, Null:
		builder.WriteString("null")
	case Bool:
		builder.WriteString(strconv.FormatBool(value.boolean))
	case Number:
		if math.IsInf(value.number, 0) || value.number != value.number {
			builder.WriteString("null")
			return
		}
		builder.WriteString(FormatNumber(value.number))
	case String:
		Quote(builder, value.text)
	case Array:
		builder.WriteByte('[')
		for index, item := range value.array {
			if index > 0 {
				builder.WriteByte(',')
			}
			write(builder, item)
		}
		builder.WriteByte(']')
	case Object:
		builder.WriteByte('{')
		first := true
		for _, member := range value.object.members {
			if member.Value.kind == Undefined {
				continue
			}
			if !first {
				builder.WriteByte(',')
			}
			first = false
			Quote(builder, member.Key)
			builder.WriteByte(':')
			write(builder, member.Value)
		}
		builder.WriteByte('}')
	}
}

// Quote writes a string as JSON.stringify quotes it.
func Quote(builder *strings.Builder, text string) {
	const hex = "0123456789abcdef"
	builder.WriteByte('"')
	units := Units(text)
	for index := 0; index < len(units); index++ {
		unit := units[index]
		switch {
		case unit == '"':
			builder.WriteString(`\"`)
		case unit == '\\':
			builder.WriteString(`\\`)
		case unit == '\b':
			builder.WriteString(`\b`)
		case unit == '\f':
			builder.WriteString(`\f`)
		case unit == '\n':
			builder.WriteString(`\n`)
		case unit == '\r':
			builder.WriteString(`\r`)
		case unit == '\t':
			builder.WriteString(`\t`)
		case unit < 0x20:
			builder.WriteString(`\u00`)
			builder.WriteByte(hex[unit>>4])
			builder.WriteByte(hex[unit&0xf])
		case unit >= 0xd800 && unit <= 0xdbff && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff:
			builder.WriteRune(rune(unit-0xd800)<<10 + rune(units[index+1]-0xdc00) + 0x10000)
			index++
		case unit >= 0xd800 && unit <= 0xdfff:
			builder.WriteString(`\u`)
			for shift := 12; shift >= 0; shift -= 4 {
				builder.WriteByte(hex[unit>>shift&0xf])
			}
		default:
			builder.WriteRune(rune(unit))
		}
	}
	builder.WriteByte('"')
}

// ErrType is a TypeError a coercion throws.
var ErrType = errors.New("TypeError")

// ToString is String(value). An object with an own toString property cannot
// be converted, since JSON never makes that property callable.
func ToString(value Value) (string, error) {
	switch value.kind {
	case Undefined:
		return "undefined", nil
	case Null:
		return "null", nil
	case Bool:
		return strconv.FormatBool(value.boolean), nil
	case Number:
		return FormatNumber(value.number), nil
	case String:
		return value.text, nil
	case Array:
		parts := make([]string, len(value.array))
		for index, item := range value.array {
			if item.IsNullish() {
				continue
			}
			part, err := ToString(item)
			if err != nil {
				return "", err
			}
			parts[index] = part
		}
		return Canonical(strings.Join(parts, ",")), nil
	}
	if value.object.Has("toString") {
		return "", ErrType
	}
	return "[object Object]", nil
}

// JSONText is JSON.stringify(value) as a template literal writes it, where an
// undefined result reads "undefined".
func JSONText(value Value) string {
	if value.kind == Undefined {
		return "undefined"
	}
	return string(Stringify(value))
}
