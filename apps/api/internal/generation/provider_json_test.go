package generation

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
)

func TestModelUsesOpenRouterFreeByDefault(t *testing.T) {
	t.Setenv("OPEN_ROUTER_MODEL", "")
	if got := model(); got != "openrouter/free" {
		t.Fatalf("default model = %q", got)
	}
}

func TestDecodeGeneratedDocumentRepairsTruncatedJSON(t *testing.T) {
	cases := []struct {
		name      string
		content   string
		wantSlide string
	}{
		{
			name:      "cut off inside a string value",
			content:   `{"title":"Deck","slides":[{"id":"s1","title":"The Gap Is Clos`,
			wantSlide: "s1",
		},
		{
			name:      "cut off between slide objects",
			content:   `{"title":"Deck","slides":[{"id":"s1"},{"id":"s2"},{"id":"s3"`,
			wantSlide: "s3",
		},
		{
			name:      "cut off inside an escaped string",
			content:   `{"title":"Deck","slides":[{"id":"s1","message":"costs \\`,
			wantSlide: "s1",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			document, err := decodeGeneratedDocument(tc.content)
			if err != nil {
				t.Fatalf("truncated JSON should be repaired: %v", err)
			}
			slides, ok := document["slides"].([]any)
			if !ok || len(slides) == 0 {
				t.Fatalf("repaired document lost its slides: %v", document)
			}
			last, _ := slides[len(slides)-1].(map[string]any)
			if last["id"] != tc.wantSlide {
				t.Fatalf("last slide id = %v, want %v", last["id"], tc.wantSlide)
			}
		})
	}
}

func TestDecodeGeneratedDocumentStillRejectsGarbage(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{"no braces at all", "Sorry, I cannot help with that."},
		{"object without slides", `{"title":"Only a title"`},
		{"truncated mid keyword", `{"title":"Deck","slides":[tru`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := decodeGeneratedDocument(tc.content); err == nil {
				t.Fatalf("content %q should not decode", tc.name)
			} else if !strings.Contains(err.Error(), "invalid presentation JSON") {
				t.Fatalf("error %v does not carry the user-facing message", err)
			}
		})
	}
}

func TestDecodeGeneratedDocumentToleratesSurroundingProse(t *testing.T) {
	document, err := decodeGeneratedDocument("<think>reasoning {with} braces</think>\n```json\n{\"title\":\"A\"}\n```\nand also {\"title\":\"B\"}")
	if err != nil {
		t.Fatalf("prose-wrapped JSON should decode: %v", err)
	}
	if document["title"] != "A" {
		t.Fatalf("title = %v, want the first object to win", document["title"])
	}
}

// A length-capped stream whose output cannot be salvaged must fail with a
// truncation explanation instead of the generic invalid-JSON message.
func TestGenerateJSONReportsLengthCappedStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"title\\\":\\\"Deck\\\",\\\"slides\\\":[tru\"},\"finish_reason\":\"length\"}]}\n\n"))
	}))
	defer server.Close()

	t.Setenv("OPEN_ROUTER_API_BASE", server.URL)
	t.Setenv("OPEN_ROUTER_MODEL", "test-model")
	t.Setenv("OPEN_ROUTER_API_KEY", "test-key")

	handler := &handler{client: server.Client()}
	_, _, err := handler.generateJSON(context.Background(), streamJob{slideCount: 5}, "test", "system", "user", 1000)
	if err == nil {
		t.Fatal("a length-capped truncated response must not decode as success")
	}
	if !strings.Contains(err.Error(), "output token limit") {
		t.Fatalf("error %v should explain the output token limit", err)
	}
	if !strings.Contains(err.Error(), "bytes received") {
		t.Fatalf("error %v should report how much arrived", err)
	}
}

// An error the provider reports inside an accepted stream is transient, so it
// has to reach the worker as a retryable provider failure rather than as a
// bare message that reads like a permanent application error.
func TestGenerateJSONTreatsMidStreamProviderErrorAsRetryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"title\\\":\\\"Deck\\\"\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"error\":{\"message\":\"Upstream idle timeout exceeded\"}}\n\n"))
	}))
	defer server.Close()

	t.Setenv("OPEN_ROUTER_API_BASE", server.URL)
	t.Setenv("OPEN_ROUTER_MODEL", "test-model")
	t.Setenv("OPEN_ROUTER_API_KEY", "test-key")

	handler := &handler{client: server.Client()}
	_, _, err := handler.generateJSON(context.Background(), streamJob{slideCount: 5}, "test", "system", "user", 1000)
	if err == nil {
		t.Fatal("a mid-stream provider error must not decode as success")
	}
	if !retryableProviderError(err) {
		t.Fatalf("error %v must be retryable so the job uses its remaining attempts", err)
	}
	if !strings.Contains(err.Error(), "OpenRouter request failed") {
		t.Fatalf("error %v should name the provider it came from", err)
	}
	if !strings.Contains(err.Error(), "Upstream idle timeout exceeded") {
		t.Fatalf("error %v should keep the provider's own wording", err)
	}
}

// streamIdleTimeoutForTest swaps the stream idle deadline and returns the
// previous value so the caller can restore it.
func streamIdleTimeoutForTest(value time.Duration) time.Duration {
	previous := streamIdleTimeout
	streamIdleTimeout = value
	return previous
}

// A stream that opens and then goes silent must fail on the idle deadline
// rather than holding the job until the whole-request timeout, and must be
// retryable so the remaining attempts are used.
func TestGenerateJSONFailsFastOnAStalledStream(t *testing.T) {
	previous := streamIdleTimeoutForTest(60 * time.Millisecond)
	defer streamIdleTimeoutForTest(previous)

	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"{\"}}]}\n\n"))
		if flusher, ok := writer.(http.Flusher); ok {
			flusher.Flush()
		}
		<-release
	}))
	defer server.Close()
	defer close(release)

	t.Setenv("OPEN_ROUTER_API_BASE", server.URL)
	t.Setenv("OPEN_ROUTER_MODEL", "test-model")
	t.Setenv("OPEN_ROUTER_API_KEY", "test-key")

	handler := &handler{client: server.Client()}
	started := time.Now()
	_, _, err := handler.generateJSON(context.Background(), streamJob{slideCount: 5}, "test", "system", "user", 1000)
	if err == nil {
		t.Fatal("a stalled stream must not decode as success")
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("stall took %s to surface, the idle deadline did not fire", elapsed)
	}
	if !retryableProviderError(err) {
		t.Fatalf("error %v must be retryable so the job uses its remaining attempts", err)
	}
	if !strings.Contains(err.Error(), "no output for") {
		t.Fatalf("error %v should name the idle deadline", err)
	}
}

func TestDirectProviderReportsLengthCap(t *testing.T) {
	const body = `{"choices":[{"message":{"content":"{\"title\":\"Deck\",\"slides\":[tru"},"finish_reason":"length"}],"usage":{"total_tokens":10}}`
	// directProvider hardcodes real provider endpoints, so stub the transport.
	client := &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}

	handler := &handler{client: client}
	_, _, err := handler.directProvider(context.Background(), ai.OpenAI, "gpt-4.1", "key", "system", "user", 1000)
	if err == nil {
		t.Fatal("a length-capped response must not decode as success")
	}
	if !strings.Contains(err.Error(), "output token limit") {
		t.Fatalf("error %v should explain the output token limit", err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (function roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

// The provider's own wording for an exhausted account names the key and links
// to its billing page. A failed presentation is shown to the reader, so that
// body must not reach it, and retrying cannot pay the bill.
func TestGenerateJSONReplacesAnOutOfCreditProviderBody(t *testing.T) {
	const body = `{"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 8896 tokens, but can only afford 7124. To increase, visit https://openrouter.ai/workspaces/default/keys/c9b08eaadfca5808a4a0080227e2df14 and adjust the key's total limit"}}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusPaymentRequired)
		_, _ = writer.Write([]byte(body))
	}))
	defer server.Close()

	t.Setenv("OPEN_ROUTER_API_BASE", server.URL)
	t.Setenv("OPEN_ROUTER_MODEL", "test-model")
	t.Setenv("OPEN_ROUTER_API_KEY", "test-key")

	handler := &handler{client: server.Client()}
	_, _, err := handler.generateJSON(context.Background(), streamJob{slideCount: 12}, "test", "system", "user", 4800)
	if err == nil {
		t.Fatal("a payment-required response must fail the generation")
	}
	if strings.Contains(err.Error(), "openrouter.ai/workspaces") || strings.Contains(err.Error(), "c9b08eaa") {
		t.Fatalf("error %v leaks the provider key's management link", err)
	}
	if !strings.Contains(err.Error(), "out of AI provider credit") {
		t.Fatalf("error %v should say the account is out of credit", err)
	}
	if retryableProviderError(err) {
		t.Fatalf("error %v must not spend the job's attempts on a bill that cannot be paid", err)
	}
}

// A connected key is the reader's own, so the same condition has to point at
// their account rather than SlideSage's. The direct providers are reached at
// their real endpoints, so the message is checked where it is built.
func TestProviderFailureMessageBlamesTheAccountThatOwnsTheKey(t *testing.T) {
	const quota = `{"error":{"message":"You exceeded your current quota, please check your plan and billing details","type":"insufficient_quota"}}`

	own := providerFailureMessage("AI provider request failed with status 429", http.StatusTooManyRequests, []byte(quota), true)
	if !strings.Contains(own, "Your AI provider account") {
		t.Fatalf("message %q should name the reader's own account", own)
	}

	shared := providerFailureMessage("OpenRouter request failed", http.StatusTooManyRequests, []byte(quota), false)
	if !strings.Contains(shared, "SlideSage is temporarily out of AI provider credit") {
		t.Fatalf("message %q should own the shared key's balance", shared)
	}
	if !strings.Contains(shared, "refunded") {
		t.Fatalf("message %q should say the points came back", shared)
	}
}

// Any other provider failure keeps its wording, minus the links, so an
// operator can still tell what the provider objected to.
func TestSummarizeProviderErrorStripsLinks(t *testing.T) {
	summary := summarizeProviderError([]byte(`{"error":{"message":"Bad model id, see https://openrouter.ai/docs/models for the list"}}`))
	if strings.Contains(summary, "https://") {
		t.Fatalf("summary %q keeps a provider link", summary)
	}
	if !strings.Contains(summary, "Bad model id") {
		t.Fatalf("summary %q dropped the provider's wording", summary)
	}
}
