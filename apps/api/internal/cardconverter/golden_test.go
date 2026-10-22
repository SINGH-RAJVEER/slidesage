package cardconverter

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

// exchange is one request and the answer the TypeScript converter gave it,
// recorded before that converter was retired. A PPTX answer is kept as a hash
// of every normalized part instead of the file itself.
type exchange struct {
	Name           string            `json:"name"`
	Method         string            `json:"method"`
	Path           string            `json:"path"`
	Headers        map[string]string `json:"headers"`
	Body           *string           `json:"body"`
	BodyBase64     string            `json:"bodyBase64"`
	Status         int               `json:"status"`
	ContentType    string            `json:"contentType"`
	Response       *string           `json:"response"`
	ResponseBase64 string            `json:"responseBase64"`
	Parts          [][2]string       `json:"parts"`
}

func bytesOf(text *string, encoded string) []byte {
	if text != nil {
		return []byte(*text)
	}
	decoded, _ := base64.StdEncoding.DecodeString(encoded)
	return decoded
}

func TestAnswersMatchTheRecordedConverter(t *testing.T) {
	file, err := os.Open("testdata/exchanges.jsonl.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(nil, 16<<20)
	handler := Handler{Logger: discardLogger()}
	count := 0
	for scanner.Scan() {
		var want exchange
		if err := json.Unmarshal(scanner.Bytes(), &want); err != nil {
			t.Fatal(err)
		}
		count++
		request := httptest.NewRequest(want.Method, want.Path, bytes.NewReader(bytesOf(want.Body, want.BodyBase64)))
		for key, value := range want.Headers {
			// The HTTP parser drops the whitespace around a header value.
			request.Header.Set(key, strings.Trim(value, " \t"))
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != want.Status || recorder.Header().Get("Content-Type") != want.ContentType {
			t.Errorf("%s: got %d %q, want %d %q", want.Name, recorder.Code, recorder.Header().Get("Content-Type"), want.Status, want.ContentType)
			continue
		}
		if want.Parts != nil {
			got, err := exportParts(recorder.Body.Bytes())
			if err != nil {
				t.Errorf("%s: %v", want.Name, err)
			} else if diff := firstDifference(got, want.Parts); diff != "" {
				t.Errorf("%s: %s", want.Name, diff)
			}
			continue
		}
		if expected := bytesOf(want.Response, want.ResponseBase64); !bytes.Equal(recorder.Body.Bytes(), expected) {
			t.Errorf("%s:\n got %.400s\nwant %.400s", want.Name, recorder.Body.Bytes(), expected)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if count < 400 {
		t.Fatalf("replayed %d exchanges", count)
	}
}

func TestRefusesOversizedBodies(t *testing.T) {
	body := `{"operationId":"op-big","cards":[],"pad":"` + strings.Repeat("x", maxBodyBytes) + `"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/cards", strings.NewReader(body))
	request.Header.Set(SchemaVersionHeader, "3")
	recorder := httptest.NewRecorder()
	Handler{Logger: discardLogger()}.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge || recorder.Body.String() != `{"error":"request body is too large"}` {
		t.Fatalf("got %d %s", recorder.Code, recorder.Body.String())
	}
}

var (
	timestampPattern = regexp.MustCompile(`(dcterms:(?:created|modified) xsi:type="dcterms:W3CDTF">)[^<]*`)
	chartPattern     = regexp.MustCompile(`(chart|Microsoft_Excel_Worksheet)(\d+)\.(xml|xlsx)`)
)

// normalize blanks timestamps and renumbers charts in order of first use, as
// the recording did.
func normalize(text string, numbers map[string]string) string {
	text = timestampPattern.ReplaceAllString(text, "${1}TIME")
	return chartPattern.ReplaceAllStringFunc(text, func(match string) string {
		groups := chartPattern.FindStringSubmatch(match)
		if _, ok := numbers[groups[2]]; !ok {
			numbers[groups[2]] = fmt.Sprint(len(numbers) + 1)
		}
		return groups[1] + numbers[groups[2]] + "." + groups[3]
	})
}

func exportParts(data []byte) ([][2]string, error) {
	return zipParts(data, "", map[string]string{})
}

func zipParts(data []byte, prefix string, numbers map[string]string) ([][2]string, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	read := func(entry *zip.File) ([]byte, error) {
		contents, err := entry.Open()
		if err != nil {
			return nil, err
		}
		defer contents.Close()
		return io.ReadAll(contents)
	}
	for _, entry := range archive.File {
		if entry.Name == "[Content_Types].xml" {
			text, err := read(entry)
			if err != nil {
				return nil, err
			}
			normalize(string(text), numbers)
		}
	}
	var parts [][2]string
	for _, entry := range archive.File {
		name := prefix + normalize(entry.Name, numbers)
		if strings.HasSuffix(entry.Name, "/") {
			parts = append(parts, [2]string{name, ""})
			continue
		}
		contents, err := read(entry)
		if err != nil {
			return nil, err
		}
		if strings.HasSuffix(entry.Name, ".xlsx") {
			nested, err := zipParts(contents, name+"!", numbers)
			if err != nil {
				return nil, err
			}
			parts = append(parts, nested...)
			continue
		}
		if !regexp.MustCompile(`\.(png|jpe?g)$`).MatchString(entry.Name) {
			contents = []byte(normalize(string(contents), numbers))
		}
		sum := sha256.Sum256(contents)
		parts = append(parts, [2]string{name, hex.EncodeToString(sum[:])[:16]})
	}
	return parts, nil
}

func firstDifference(got, want [][2]string) string {
	for index := range max(len(got), len(want)) {
		if index >= len(got) || index >= len(want) || got[index] != want[index] {
			var have, expected [2]string
			if index < len(got) {
				have = got[index]
			}
			if index < len(want) {
				expected = want[index]
			}
			return fmt.Sprintf("part %d is %v, want %v", index, have, expected)
		}
	}
	return ""
}

// discardLogger keeps the expected conversion failures out of the test output.
func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}
