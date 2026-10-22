package jsvalue

import (
	"errors"
	"sort"
	"strconv"
	"unicode/utf8"
)

// ErrSyntax is the SyntaxError JSON.parse throws.
var ErrSyntax = errors.New("JSON syntax error")

// Parse is JSON.parse without a reviver. Numbers beyond the float range become
// infinities, a repeated key keeps its first position and its last value, and
// \u escapes may leave unpaired surrogates.
func Parse(text string) (Value, error) {
	parser := parser{text: text}
	parser.space()
	value, err := parser.value()
	if err != nil {
		return Value{}, err
	}
	parser.space()
	if parser.at != len(parser.text) {
		return Value{}, ErrSyntax
	}
	return value, nil
}

type parser struct {
	text string
	at   int
}

// frame is one array or object still open, so nesting depth never grows the
// Go stack.
type frame struct {
	array  []Value
	object *Obj
	key    string
	// seen maps each key to its member, so a repeated key is found in
	// constant time.
	seen map[string]int
}

// set assigns a member while parsing. Members stay in insertion order until
// the object closes and is put in property order.
func (frame *frame) set(key string, value Value) {
	if index, ok := frame.seen[key]; ok {
		frame.object.members[index].Value = value
		return
	}
	frame.seen[key] = len(frame.object.members)
	frame.object.members = append(frame.object.members, Member{Key: key, Value: value})
}

// order moves array-index keys to the front in ascending order.
func (object *Obj) order() {
	var indexes, names []Member
	for _, member := range object.members {
		if _, ok := arrayIndex(member.Key); ok {
			indexes = append(indexes, member)
		} else {
			names = append(names, member)
		}
	}
	if len(indexes) == 0 {
		return
	}
	sort.SliceStable(indexes, func(left, right int) bool {
		first, _ := arrayIndex(indexes[left].Key)
		second, _ := arrayIndex(indexes[right].Key)
		return first < second
	})
	object.members = append(indexes, names...)
}

func (parser *parser) space() {
	for parser.at < len(parser.text) {
		switch parser.text[parser.at] {
		case ' ', '\t', '\n', '\r':
			parser.at++
		default:
			return
		}
	}
}

func (parser *parser) value() (Value, error) {
	var stack []*frame
	for {
		var value Value
		parser.space()
		if parser.at >= len(parser.text) {
			return Value{}, ErrSyntax
		}
		opened := false
		switch char := parser.text[parser.at]; {
		case char == '[':
			parser.at++
			parser.space()
			if parser.at < len(parser.text) && parser.text[parser.at] == ']' {
				parser.at++
				value = ArrayValue(nil)
				break
			}
			stack = append(stack, &frame{array: []Value{}})
			opened = true
		case char == '{':
			parser.at++
			parser.space()
			if parser.at < len(parser.text) && parser.text[parser.at] == '}' {
				parser.at++
				value = Value{kind: Object, object: &Obj{}}
				break
			}
			key, err := parser.key()
			if err != nil {
				return Value{}, err
			}
			stack = append(stack, &frame{object: &Obj{}, key: key, seen: map[string]int{}})
			opened = true
		case char == '"':
			text, err := parser.string()
			if err != nil {
				return Value{}, err
			}
			value = StringValue(text)
		case char == '-' || (char >= '0' && char <= '9'):
			number, err := parser.number()
			if err != nil {
				return Value{}, err
			}
			value = NumberValue(number)
		default:
			literal, err := parser.literal()
			if err != nil {
				return Value{}, err
			}
			value = literal
		}
		if opened {
			continue
		}
		// Attach the finished value to the open containers, closing any that end.
		for {
			if len(stack) == 0 {
				return value, nil
			}
			top := stack[len(stack)-1]
			if top.object != nil {
				top.set(top.key, value)
			} else {
				top.array = append(top.array, value)
			}
			parser.space()
			if parser.at >= len(parser.text) {
				return Value{}, ErrSyntax
			}
			separator := parser.text[parser.at]
			parser.at++
			if separator == ',' {
				if top.object != nil {
					parser.space()
					key, err := parser.key()
					if err != nil {
						return Value{}, err
					}
					top.key = key
				}
				break
			}
			if top.object != nil && separator == '}' {
				top.object.order()
				value = Value{kind: Object, object: top.object}
			} else if top.object == nil && separator == ']' {
				value = ArrayValue(top.array)
			} else {
				return Value{}, ErrSyntax
			}
			stack = stack[:len(stack)-1]
		}
	}
}

// key reads `"name":` and leaves the parser at the member's value.
func (parser *parser) key() (string, error) {
	if parser.at >= len(parser.text) || parser.text[parser.at] != '"' {
		return "", ErrSyntax
	}
	key, err := parser.string()
	if err != nil {
		return "", err
	}
	parser.space()
	if parser.at >= len(parser.text) || parser.text[parser.at] != ':' {
		return "", ErrSyntax
	}
	parser.at++
	return key, nil
}

func (parser *parser) literal() (Value, error) {
	for word, value := range map[string]Value{"true": BoolValue(true), "false": BoolValue(false), "null": NullValue()} {
		if len(parser.text)-parser.at >= len(word) && parser.text[parser.at:parser.at+len(word)] == word {
			parser.at += len(word)
			return value, nil
		}
	}
	return Value{}, ErrSyntax
}

func (parser *parser) number() (float64, error) {
	start := parser.at
	text := parser.text
	if text[parser.at] == '-' {
		parser.at++
	}
	if parser.at >= len(text) {
		return 0, ErrSyntax
	}
	if text[parser.at] == '0' {
		parser.at++
	} else if text[parser.at] >= '1' && text[parser.at] <= '9' {
		for parser.at < len(text) && text[parser.at] >= '0' && text[parser.at] <= '9' {
			parser.at++
		}
	} else {
		return 0, ErrSyntax
	}
	if parser.at < len(text) && text[parser.at] == '.' {
		parser.at++
		digits := parser.at
		for parser.at < len(text) && text[parser.at] >= '0' && text[parser.at] <= '9' {
			parser.at++
		}
		if parser.at == digits {
			return 0, ErrSyntax
		}
	}
	if parser.at < len(text) && (text[parser.at] == 'e' || text[parser.at] == 'E') {
		parser.at++
		if parser.at < len(text) && (text[parser.at] == '+' || text[parser.at] == '-') {
			parser.at++
		}
		digits := parser.at
		for parser.at < len(text) && text[parser.at] >= '0' && text[parser.at] <= '9' {
			parser.at++
		}
		if parser.at == digits {
			return 0, ErrSyntax
		}
	}
	value, err := strconv.ParseFloat(text[start:parser.at], 64)
	if err != nil && !isRangeError(err) {
		return 0, ErrSyntax
	}
	return value, nil
}

func (parser *parser) string() (string, error) {
	parser.at++
	var units []uint16
	plain := true
	start := parser.at
	text := parser.text
	for {
		if parser.at >= len(text) {
			return "", ErrSyntax
		}
		char := text[parser.at]
		switch {
		case char == '"':
			parser.at++
			if plain {
				return text[start : parser.at-1], nil
			}
			return FromUnits(units), nil
		case char < 0x20:
			return "", ErrSyntax
		case char == '\\':
			if plain {
				units = Units(text[start:parser.at])
				plain = false
			}
			parser.at++
			if parser.at >= len(text) {
				return "", ErrSyntax
			}
			escape := text[parser.at]
			parser.at++
			switch escape {
			case '"', '\\', '/':
				units = append(units, uint16(escape))
			case 'b':
				units = append(units, '\b')
			case 'f':
				units = append(units, '\f')
			case 'n':
				units = append(units, '\n')
			case 'r':
				units = append(units, '\r')
			case 't':
				units = append(units, '\t')
			case 'u':
				if parser.at+4 > len(text) {
					return "", ErrSyntax
				}
				code, err := strconv.ParseUint(text[parser.at:parser.at+4], 16, 16)
				if err != nil || !hexDigits(text[parser.at:parser.at+4]) {
					return "", ErrSyntax
				}
				units = append(units, uint16(code))
				parser.at += 4
			default:
				return "", ErrSyntax
			}
		default:
			char, width := utf8.DecodeRuneInString(text[parser.at:])
			if !plain {
				if char >= 0x10000 {
					char -= 0x10000
					units = append(units, uint16(0xd800+(char>>10)), uint16(0xdc00+(char&0x3ff)))
				} else {
					units = append(units, uint16(char))
				}
			}
			parser.at += width
		}
	}
}

func hexDigits(text string) bool {
	for index := 0; index < len(text); index++ {
		char := text[index]
		if !(char >= '0' && char <= '9' || char >= 'a' && char <= 'f' || char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}
