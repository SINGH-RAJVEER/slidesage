// Package jsvalue holds JSON values with the semantics JavaScript gives them:
// property order, coercion, and number formatting. The card schema and its
// wire format are defined in those terms, and the browser reads them that way.
//
// Strings are WTF-8: valid UTF-8, except that an unpaired UTF-16 surrogate,
// which JSON.parse accepts from a \u escape, is kept as its three-byte form.
package jsvalue

import (
	"strconv"
)

// Kind is a JavaScript value type that JSON can produce, plus undefined.
type Kind uint8

const (
	Undefined Kind = iota
	Null
	Bool
	Number
	String
	Array
	Object
)

// Value is one JavaScript value. The zero Value is undefined.
type Value struct {
	kind    Kind
	boolean bool
	number  float64
	text    string
	array   []Value
	object  *Obj
}

// Member is one own property of an object.
type Member struct {
	Key   string
	Value Value
}

// Obj is a plain object whose members are kept in JavaScript property order:
// array-index keys ascending, then other keys in insertion order.
type Obj struct {
	members []Member
}

func UndefinedValue() Value           { return Value{} }
func NullValue() Value                { return Value{kind: Null} }
func BoolValue(value bool) Value      { return Value{kind: Bool, boolean: value} }
func NumberValue(value float64) Value { return Value{kind: Number, number: value} }
func StringValue(value string) Value  { return Value{kind: String, text: value} }

// ArrayValue wraps values as an array. The slice is not copied.
func ArrayValue(values []Value) Value {
	if values == nil {
		values = []Value{}
	}
	return Value{kind: Array, array: values}
}

// ObjectValue builds an object, setting members in order as assignments would.
func ObjectValue(members ...Member) Value {
	object := &Obj{}
	for _, member := range members {
		object.Set(member.Key, member.Value)
	}
	return Value{kind: Object, object: object}
}

func (value Value) Kind() Kind        { return value.kind }
func (value Value) IsUndefined() bool { return value.kind == Undefined }
func (value Value) IsNullish() bool   { return value.kind == Undefined || value.kind == Null }
func (value Value) Bool() bool        { return value.boolean }
func (value Value) Number() float64   { return value.number }
func (value Value) Str() string       { return value.text }
func (value Value) Items() []Value    { return value.array }
func (value Value) Object() *Obj      { return value.object }
func (value Value) IsString() bool    { return value.kind == String }
func (value Value) IsNumber() bool    { return value.kind == Number }
func (value Value) IsArray() bool     { return value.kind == Array }
func (value Value) IsObject() bool    { return value.kind == Object }
func (value Value) IsTrue() bool      { return value.kind == Bool && value.boolean }

// Get reads a property the way `value[key]` does for the field names the
// converter uses: own properties of objects, and undefined otherwise.
func (value Value) Get(key string) Value {
	if value.kind != Object {
		return Value{}
	}
	return value.object.Get(key)
}

// Truthy is JavaScript's ToBoolean.
func (value Value) Truthy() bool {
	switch value.kind {
	case Bool:
		return value.boolean
	case Number:
		return value.number != 0 && value.number == value.number
	case String:
		return value.text != ""
	case Array, Object:
		return true
	}
	return false
}

// Get returns an own property, or undefined.
func (object *Obj) Get(key string) Value {
	if index := object.index(key); index >= 0 {
		return object.members[index].Value
	}
	return Value{}
}

// Has reports whether key is an own property.
func (object *Obj) Has(key string) bool { return object.index(key) >= 0 }

// Members returns the own properties in property order.
func (object *Obj) Members() []Member { return object.members }

// Keys returns the own property names in property order, as Object.keys does.
func (object *Obj) Keys() []string {
	keys := make([]string, len(object.members))
	for index, member := range object.members {
		keys[index] = member.Key
	}
	return keys
}

// Len is the number of own properties.
func (object *Obj) Len() int { return len(object.members) }

// Set assigns a property. An existing property keeps its position; a new
// array-index key is placed among the others in ascending order.
func (object *Obj) Set(key string, value Value) {
	if index := object.index(key); index >= 0 {
		object.members[index].Value = value
		return
	}
	key = Canonical(key)
	member := Member{Key: key, Value: value}
	position, isIndex := arrayIndex(key)
	if !isIndex {
		object.members = append(object.members, member)
		return
	}
	at := 0
	for at < len(object.members) {
		other, otherIsIndex := arrayIndex(object.members[at].Key)
		if !otherIsIndex || other > position {
			break
		}
		at++
	}
	object.members = append(object.members, Member{})
	copy(object.members[at+1:], object.members[at:])
	object.members[at] = member
}

func (object *Obj) index(key string) int {
	key = Canonical(key)
	for index, member := range object.members {
		if member.Key == key {
			return index
		}
	}
	return -1
}

// arrayIndex reports whether key is a canonical array index, below 2^32-1.
func arrayIndex(key string) (uint64, bool) {
	if key == "" || len(key) > 10 || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	position, err := strconv.ParseUint(key, 10, 64)
	if err != nil || position >= 1<<32-1 {
		return 0, false
	}
	return position, true
}
