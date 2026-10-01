package carddocument

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func jsonbDocument(fragment string) []byte {
	return []byte(`{"schemaVersion":2,"cardOrder":["c_a"],"cards":{"c_a":{"content":` + fragment + `}}}`)
}

func TestPrepareJSONBCompatibility(t *testing.T) {
	for _, test := range []struct {
		name     string
		fragment string
		want     string
	}{
		{"escaped NUL", `"before\u0000after"`, "NUL"},
		{"NUL key", `{"\u0000":"value"}`, "NUL"},
		{"duplicate discarded value", `{"x":"\u0000","x":"safe"}`, "NUL"},
		{"high surrogate", `"\ud800"`, "unpaired high surrogate"},
		{"low surrogate", `"\udfff"`, "unpaired low surrogate"},
		{"reversed pair", `"\uDC00\uD800"`, "unpaired low surrogate"},
		{"high then ordinary escape", `"\uD800\u0041"`, "unpaired high surrogate"},
		{"high then literal escape", `"\ud800\\udc00"`, "unpaired high surrogate"},
		{"high then raw Unicode", `"\ud800😀"`, "unpaired high surrogate"},
		{"invalid UTF8", "\"bad\xff\"", "invalid UTF-8"},
		{"raw encoded surrogate", "\"\xed\xa0\x80\"", "invalid UTF-8"},
		{"literal backslash NUL text", `"before\\u0000after"`, ""},
		{"escaped backslash then NUL", `"\\\u0000"`, "NUL"},
		{"escaped quote then NUL", `"\"\u0000"`, "NUL"},
		{"literal surrogate text", `"\\ud800"`, ""},
		{"valid pair", `"\uD83D\uDE00"`, ""},
		{"multiple pairs", `"\ud800\udc00\udbff\udfff"`, ""},
		{"replacement character", `"�"`, ""},
		{"raw Unicode", `"café 😀"`, ""},
		{"integer boundary", `1e131071`, ""},
		{"integer overflow", `1e131072`, "integer digit limit"},
		{"giant integer", strings.Repeat("9", 131073), "integer digit limit"},
		{"fraction boundary", `1e-16383`, ""},
		{"fraction overflow", `1e-16384`, "fractional scale limit"},
		{"zero scale overflow", `0e-16384`, "fractional scale limit"},
		{"trailing zero scale overflow", `0.` + strings.Repeat("0", 16384), "fractional scale limit"},
		{"exponent compensates scale", `0.` + strings.Repeat("0", 16384) + `e1`, ""},
		{"fraction leading zeros", `0.001e131074`, ""},
		{"fraction leading zeros overflow", `0.001e131075`, "integer digit limit"},
		{"zero positive exponent", `0e131072`, ""},
		{"exponent input boundary", `0e1073741823`, ""},
		{"exponent input overflow", `0e1073741824`, "exponent exceeds"},
		{"huge exponent", `1e9999999999999999999999`, "exponent exceeds"},
		{"ordinary number", `-12.34e+2`, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := prepareInput()
			input.Document = jsonbDocument(test.fragment)
			original := bytes.Clone(input.Document)
			revision, err := Prepare(input)
			if test.want != "" {
				if !errors.Is(err, ErrInvalidDocument) || !strings.Contains(err.Error(), "JSONB compatibility") || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("error = %v, want ErrInvalidDocument with %q", err, test.want)
				}
				if len(revision.Document) != 0 {
					t.Fatal("incompatible document produced a revision")
				}
			} else if err != nil || !bytes.Equal(revision.Document, original) {
				t.Fatalf("compatible document changed: %s, %v", revision.Document, err)
			}
			if !bytes.Equal(input.Document, original) {
				t.Fatal("Prepare modified input")
			}
		})
	}
}

func TestPrepareRejectsJSONBIncompatibleProvenance(t *testing.T) {
	input := prepareInput()
	input.Provenance = json.RawMessage(`{"source":"\u0000"}`)
	if _, err := Prepare(input); !errors.Is(err, ErrInvalidDocument) || !strings.Contains(err.Error(), "provenance: JSONB compatibility") {
		t.Fatalf("error = %v", err)
	}
}

func TestLegacyJSONBCompatibilityAfterSourceVerification(t *testing.T) {
	for _, fragment := range []string{`"\u0000"`, `"\ud800"`, `"\udc00"`, "\"\xff\"", `1e131072`, `1e-16384`} {
		t.Run(fragment, func(t *testing.T) {
			body := jsonbDocument(fragment)
			revision := Revision{ObjectKey: "legacy.json", SHA256: sha256Hex(body), ByteSize: int64(len(body)), CardCount: 1, SchemaVersion: 2}
			store := &memoryStore{objects: map[string][]byte{revision.ObjectKey: body}}
			imported, err := readLegacyDocument(context.Background(), store, revision)
			if imported != nil || !errors.Is(err, ErrInvalidDocument) {
				t.Fatalf("import = %s, %v", imported, err)
			}
			for _, message := range []string{"JSONB compatibility", revision.ObjectKey, "source object and revision metadata preserved", "resolve compatibility explicitly", "do not normalize or delete historical content"} {
				if !strings.Contains(err.Error(), message) {
					t.Fatalf("error lacks %q: %v", message, err)
				}
			}
			if !bytes.Equal(store.objects[revision.ObjectKey], body) {
				t.Fatal("legacy source changed")
			}
			wrongDigest := revision
			wrongDigest.SHA256 = strings.Repeat("0", 64)
			if _, err := readLegacyDocument(context.Background(), store, wrongDigest); !errors.Is(err, ErrObjectDigest) {
				t.Fatalf("compatibility checked before digest: %v", err)
			}
			wrongSize := revision
			wrongSize.ByteSize++
			if _, err := readLegacyDocument(context.Background(), store, wrongSize); !errors.Is(err, ErrObjectSize) {
				t.Fatalf("compatibility checked before size: %v", err)
			}
		})
	}
	body := jsonbDocument(`"\\u0000 \ud83d\ude00"`)
	revision := Revision{ObjectKey: "safe.json", SHA256: sha256Hex(body), ByteSize: int64(len(body)), CardCount: 1, SchemaVersion: 2}
	store := &memoryStore{objects: map[string][]byte{revision.ObjectKey: body}}
	if imported, err := readLegacyDocument(context.Background(), store, revision); err != nil || !bytes.Equal(imported, body) {
		t.Fatalf("safe legacy bytes changed: %s, %v", imported, err)
	}
}
