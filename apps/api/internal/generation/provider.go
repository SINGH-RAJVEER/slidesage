package generation

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/integrations/ai"
)

// defaultModel is used when no model is configured and no per-user AI selection exists.
const defaultModel = "openrouter/free"

// streamIdleTimeout bounds the gap between two chunks of an accepted stream. A
// stalled upstream would otherwise cost the whole three-minute request timeout
// before the job could retry, and the provider often reports the stall first,
// which reads as its failure rather than a slow one. It is a var so tests can
// shorten it; nothing at runtime reassigns it.
var streamIdleTimeout = 45 * time.Second

// doProviderRequest sends a provider request and retries transient failures (429 and 5xx) with exponential backoff, honoring Retry-After when present.
func (h *handler) doProviderRequest(ctx context.Context, send func() (*http.Response, error)) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		response, err := send()
		if err != nil {
			return nil, err
		}
		if !retryableStatus(response.StatusCode) || attempt == providerMaxAttempts-1 {
			return response, nil
		}
		delay := backoffDelay(attempt)
		if after := parseRetryAfter(response.Header.Get("Retry-After")); after > delay {
			delay = min(after, providerMaximumWait)
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 16*1024))
		response.Body.Close()
		if err := h.wait(ctx, delay); err != nil {
			return nil, err
		}
	}
}

func (h *handler) wait(ctx context.Context, delay time.Duration) error {
	if h.sleep != nil {
		return h.sleep(ctx, delay)
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func retryableStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

func backoffDelay(attempt int) time.Duration {
	delay := providerInitialWait << attempt
	return min(delay, providerMaximumWait)
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(value); err == nil {
		if remaining := time.Until(when); remaining > 0 {
			return remaining
		}
	}
	return 0
}

func (h *handler) generateJSON(ctx context.Context, job streamJob, system, user string, maxOutput int) (map[string]any, int, error) {
	key := strings.TrimSpace(os.Getenv("OPEN_ROUTER_API_KEY"))
	if key == "" {
		key = strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	}
	provider := ai.Provider("openrouter")
	model := strings.TrimSpace(os.Getenv("OPEN_ROUTER_MODEL"))
	if model == "" {
		model = defaultModel
	}
	if job.selection != nil {
		provider, model, key = job.selection.Provider, job.selection.Model, job.credential
	}
	if key == "" {
		return nil, 0, errors.New("AI provider is not configured")
	}
	if provider != "openrouter" {
		return h.directProvider(ctx, provider, model, key, system, user, maxOutput)
	}
	// openRouterGeneratePayload always includes the reasoning parameter because
	// OpenRouter normalizes it across providers and drops it for models that
	// cannot reason. Reasoning tokens count toward the completion bound on
	// reasoning models, and the same amount is added on top of the requested
	// output bound to keep the full answer budget available.
	payload := openRouterGeneratePayload(model, system, user, maxOutput)
	encoded, _ := json.Marshal(payload)
	endpoint := strings.TrimSpace(os.Getenv("OPEN_ROUTER_API_BASE"))
	if endpoint == "" {
		endpoint = "https://openrouter.ai/api/v1/chat/completions"
	}
	send := func() (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(encoded)))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("HTTP-Referer", strings.TrimSpace(os.Getenv("BASE_URL")))
		req.Header.Set("X-OpenRouter-Title", "Slide Sage")
		return h.client.Do(req)
	}
	response, err := h.doProviderRequest(ctx, send)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		return nil, 0, &providerRequestError{
			Status:  response.StatusCode,
			Message: providerFailureMessage("OpenRouter request failed", response.StatusCode, body, job.selection != nil),
		}
	}
	var content strings.Builder
	tokens := 0
	finishReason := ""
	sawDone := false
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 16*1024), 2*1024*1024)
	// Closing the body is what unblocks a scanner parked on a silent upstream.
	// The flag records why it was closed, since the read then fails with an
	// unhelpful "read on closed response body". A buffered line can still
	// arrive after the timer fires and reschedule it, so the close is guarded.
	var stalled atomic.Bool
	var once sync.Once
	idle := time.AfterFunc(streamIdleTimeout, func() {
		once.Do(func() {
			stalled.Store(true)
			_ = response.Body.Close()
		})
	})
	defer idle.Stop()
	for scanner.Scan() {
		idle.Reset(streamIdleTimeout)
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			sawDone = true
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Error != nil {
			// OpenRouter accepted the request and then reported an upstream
			// failure mid-stream. It carries no status of its own, so it is
			// marked retryable explicitly rather than read as a clean refusal.
			message := []byte(chunk.Error.Message)
			return nil, 0, &providerRequestError{
				Message: providerFailureMessage("OpenRouter request failed", 0, message, job.selection != nil),
				// An exhausted account is not cleared by trying again, so it is
				// the one mid-stream failure that is not marked retryable.
				Retryable: !outOfProviderCredit(0, message),
			}
		}
		for _, choice := range chunk.Choices {
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				finishReason = *choice.FinishReason
			}
		}
		if len(chunk.Choices) > 0 {
			if content.Len()+len(chunk.Choices[0].Delta.Content) > 8*1024*1024 {
				return nil, 0, errors.New("OpenRouter response is too large")
			}
			content.WriteString(chunk.Choices[0].Delta.Content)
		}
		if chunk.Usage.TotalTokens > 0 {
			tokens = chunk.Usage.TotalTokens
		}
	}
	// Checked before scanner.Err() because a stall that lands on a buffer
	// boundary can end the scan without surfacing any read error at all.
	if stalled.Load() {
		return nil, 0, &providerRequestError{
			Message:   fmt.Sprintf("OpenRouter request failed: no output for %s", streamIdleTimeout),
			Retryable: true,
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, 0, err
	}
	document, err := decodeGeneratedDocument(content.String())
	if err != nil {
		if finishReason == "length" || !sawDone {
			return nil, 0, fmt.Errorf("%w (%d bytes received before the stream ended)", truncatedOutputError(finishReason, sawDone), content.Len())
		}
		return nil, 0, fmt.Errorf("%w (%d bytes received)", err, content.Len())
	}
	return document, tokens, nil
}

// truncatedOutputError explains a failed decode in terms of how the stream
// ended. A "length" finish reason means the model hit its output token cap
// mid-JSON; a missing [DONE] marker means the connection dropped early.
func truncatedOutputError(finishReason string, sawDone bool) error {
	switch {
	case finishReason == "length":
		return errors.New("AI provider hit its output token limit before finishing the presentation JSON")
	case !sawDone:
		return errors.New("AI provider closed the stream before finishing the presentation JSON")
	default:
		return errors.New("AI provider returned invalid presentation JSON")
	}
}

// reasoningBudget is the per-call reasoning allowance reserved on top of the
// requested answer bound for every provider whose thinking tokens compete with
// output tokens. It sits at the largest of the smallest supported nonzero
// budgets (128 for Gemini Pro, 512 for Gemini Flash Lite, 1024 for Anthropic
// extended thinking), so it stays valid for every reasoning-capable family
// while asking for what slot filling actually needs: the work is transcription
// into a fixed schema, not deduction, and the measured reasoning spend on it is
// zero. A bound is also what a provider's affordability check refuses on, and
// this one was reserving more than the slides it accompanied.
const reasoningBudget = 1024

func googleGeneratePayload(model, system, user string, maxOutput int) map[string]any {
	config := map[string]any{"responseMimeType": "application/json", "maxOutputTokens": maxOutput}
	if googleSupportsThinkingControl(model) {
		// Google nests thinking control under generationConfig.thinkingConfig;
		// a bare thinkingBudget field is rejected with 400 INVALID_ARGUMENT.
		config["thinkingConfig"] = map[string]any{"thinkingBudget": reasoningBudget}
		config["maxOutputTokens"] = maxOutput + reasoningBudget
	}
	return map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": system}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": user}}}},
		"generationConfig":  config,
	}
}

func openRouterGeneratePayload(model, system, user string, maxOutput int) map[string]any {
	return map[string]any{"model": model, "max_tokens": maxOutput + reasoningBudget, "reasoning": map[string]any{"max_tokens": reasoningBudget}, "stream": true, "stream_options": map[string]bool{"include_usage": true}, "response_format": map[string]string{"type": "json_object"}, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": user}}}
}

func googleSupportsThinkingControl(model string) bool {
	name := strings.ToLower(model)
	return strings.HasPrefix(name, "gemini-2.5") || strings.HasPrefix(name, "gemini-3") || strings.HasPrefix(name, "gemini-4")
}

// openAIGeneratePayload switches reasoning models to max_completion_tokens,
// which they require and which counts reasoning toward the completion bound.
// Classic GPT models keep the legacy max_tokens parameter untouched.
func openAIGeneratePayload(model string, system, user string, maxOutput int) map[string]any {
	messages := []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": user}}
	if openAIReasoningModel(model) {
		return map[string]any{"model": model, "max_completion_tokens": maxOutput + reasoningBudget, "response_format": map[string]string{"type": "json_object"}, "messages": messages}
	}
	return map[string]any{"model": model, "max_tokens": maxOutput, "response_format": map[string]string{"type": "json_object"}, "messages": messages}
}

func openAIReasoningModel(model string) bool {
	base := strings.ToLower(strings.TrimPrefix(model, "ft:"))
	if i := strings.IndexByte(base, ':'); i >= 0 {
		base = base[:i]
	}
	oSeries := len(base) > 1 && base[0] == 'o' && base[1] >= '1' && base[1] <= '9'
	return oSeries || strings.HasPrefix(base, "gpt-5")
}

// anthropicGeneratePayload enables extended thinking for Claude generations
// that support it. Thinking tokens count against max_tokens, so the same
// amount is added on top of the requested output bound. Anthropic requires
// budget_tokens of at least 1024 and a max_tokens strictly greater than it.
func anthropicGeneratePayload(model, system, user string, maxOutput int) map[string]any {
	payload := map[string]any{"model": model, "max_tokens": maxOutput, "system": system, "messages": []map[string]string{{"role": "user", "content": user}}}
	if anthropicSupportsThinking(model) {
		payload["thinking"] = map[string]any{"type": "enabled", "budget_tokens": reasoningBudget}
		payload["max_tokens"] = maxOutput + reasoningBudget
	}
	return payload
}

func anthropicSupportsThinking(model string) bool {
	name := strings.ToLower(model)
	return strings.Contains(name, "-3-7") || strings.Contains(name, "-4")
}

func (h *handler) directProvider(ctx context.Context, provider ai.Provider, model, key, system, user string, maxOutput int) (map[string]any, int, error) {
	var endpoint string
	var payload any
	headers := map[string]string{"Content-Type": "application/json"}
	switch provider {
	case ai.OpenAI:
		endpoint = "https://api.openai.com/v1/chat/completions"
		headers["Authorization"] = "Bearer " + key
		payload = openAIGeneratePayload(model, system, user, maxOutput)
	case ai.Google:
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent"
		headers["x-goog-api-key"] = key
		payload = googleGeneratePayload(model, system, user, maxOutput)
	case ai.Anthropic:
		endpoint = "https://api.anthropic.com/v1/messages"
		headers["x-api-key"] = key
		headers["anthropic-version"] = "2023-06-01"
		payload = anthropicGeneratePayload(model, system, user, maxOutput)
	default:
		return nil, 0, errors.New("unsupported AI provider")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	send := func() (*http.Response, error) {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(encoded)))
		if err != nil {
			return nil, err
		}
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		return h.client.Do(request)
	}
	response, err := h.doProviderRequest(ctx, send)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if err != nil {
		return nil, 0, err
	}
	if len(body) > 8*1024*1024 {
		return nil, 0, errors.New("AI provider response is too large")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// A direct provider is only ever reached through a key the reader
		// connected themselves, so an exhausted account is theirs to top up.
		return nil, 0, &providerRequestError{
			Status: response.StatusCode,
			Message: providerFailureMessage(
				fmt.Sprintf("AI provider request failed with status %d", response.StatusCode),
				response.StatusCode, body, true),
		}
	}
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			TotalTokens  int `json:"total_tokens"`
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
		UsageMetadata struct {
			TotalTokens int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, 0, errors.New("AI provider returned invalid JSON")
	}
	content := ""
	finishReason := ""
	if len(envelope.Choices) > 0 {
		content = envelope.Choices[0].Message.Content
		finishReason = envelope.Choices[0].FinishReason
	}
	if len(envelope.Candidates) > 0 && len(envelope.Candidates[0].Content.Parts) > 0 {
		content = envelope.Candidates[0].Content.Parts[0].Text
		// Google spells the length cap "MAX_TOKENS".
		finishReason = strings.ToLower(envelope.Candidates[0].FinishReason)
	}
	if len(envelope.Content) > 0 {
		content = envelope.Content[0].Text
		// Anthropic signals the cap with stop_reason "max_tokens".
		if envelope.StopReason == "max_tokens" {
			finishReason = "length"
		}
	}
	if strings.TrimSpace(content) == "" {
		return nil, 0, errors.New("AI provider returned no text content")
	}
	document, err := decodeGeneratedDocument(content)
	if err != nil {
		if finishReason == "length" {
			return nil, 0, fmt.Errorf("%w (%d bytes received)", truncatedOutputError(finishReason, true), len(content))
		}
		return nil, 0, fmt.Errorf("%w (%d bytes received)", err, len(content))
	}
	tokens := envelope.Usage.TotalTokens
	if tokens == 0 {
		tokens = envelope.Usage.InputTokens + envelope.Usage.OutputTokens
	}
	if tokens == 0 {
		tokens = envelope.UsageMetadata.TotalTokens
	}
	return document, tokens, nil
}

// summarizeProviderError condenses an upstream error body into a bounded,
// single-line snippet so failure surfaces carry the provider's actual reason
// (invalid API keys, rejected parameters, quota text) instead of a bare status.
// providerLinkPattern matches the URLs providers embed in their error text.
// OpenRouter's credit message links to the key's own management page, which
// names the key, and a failed presentation is shown to the user, so no
// provider link is passed through.
var providerLinkPattern = regexp.MustCompile(`https?://[^\s"'\\]+`)

func summarizeProviderError(body []byte) string {
	snippet := strings.TrimSpace(string(body))
	if idx := strings.IndexByte(snippet, '\n'); idx >= 0 {
		snippet = snippet[:idx]
	}
	return truncate(providerLinkPattern.ReplaceAllString(snippet, "[link removed]"), 300)
}

// outOfProviderCredit reports the provider responses that mean the account
// behind the key cannot pay for the request, rather than anything about the
// presentation being generated. Retrying the same request cannot clear it, so
// these never reach retryableProviderError.
func outOfProviderCredit(status int, body []byte) bool {
	if status == http.StatusPaymentRequired {
		return true
	}
	text := strings.ToLower(string(body))
	for _, marker := range []string{
		"requires more credits",
		"insufficient_quota",
		"insufficient credit",
		"insufficient balance",
		"exceeded your current quota",
	} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// providerFailureMessage is what a failed presentation carries back to the
// reader. A provider's own wording for an exhausted account describes the key
// and its billing page, which is SlideSage's business on the shared key and
// unreachable advice on the reader's, so that case is stated directly instead.
func providerFailureMessage(prefix string, status int, body []byte, ownKey bool) string {
	if outOfProviderCredit(status, body) {
		if ownKey {
			return "Your AI provider account does not have enough credit for this presentation. Add credit to it, or generate fewer slides, and retry."
		}
		return "SlideSage is temporarily out of AI provider credit. The points for this generation were refunded. Try again shortly, or connect your own provider key in settings."
	}
	return fmt.Sprintf("%s: %s", prefix, summarizeProviderError(body))
}

func decodeGeneratedDocument(content string) (map[string]any, error) {
	content = strings.TrimSpace(content)
	// Some models emit reasoning inline as <think> blocks before the answer.
	if start := strings.Index(content, "<think>"); start >= 0 {
		if end := strings.Index(content[start:], "</think>"); end >= 0 {
			content = strings.TrimSpace(content[:start] + content[start+end+len("</think>"):])
		}
	}
	start, end := strings.IndexByte(content, '{'), strings.LastIndexByte(content, '}')
	if start >= 0 && end > start {
		if document := unmarshalDocument(content[start : end+1]); document != nil {
			return document, nil
		}
	}
	// A completion cut off by an output token limit leaves a truncated but
	// mostly complete object behind. Closing whatever strings and containers
	// were left open often recovers every slide the model did write; anything
	// genuinely mangled fails later document validation instead.
	if start >= 0 {
		if repaired := repairTruncatedObject(content[start:]); repaired != "" {
			if document := unmarshalDocument(repaired); document != nil && document["slides"] != nil {
				return document, nil
			}
		}
	}
	return nil, errors.New("AI provider returned invalid presentation JSON")
}

// unmarshalDocument decodes a JSON object with number preservation and
// rejects empty results.
func unmarshalDocument(encoded string) map[string]any {
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil || document == nil {
		return nil
	}
	return document
}

// repairTruncatedObject closes any string or container left open by a cut-off
// and returns the repaired encoding, or "" when the content is already a
// balanced object (meaning the failure was not truncation).
func repairTruncatedObject(content string) string {
	var stack []byte
	inString := false
	escaped := false
	for i := 0; i < len(content); i++ {
		switch character := content[i]; {
		case escaped:
			escaped = false
		case inString && character == '\\':
			escaped = true
		case inString && character == '"':
			inString = false
		case !inString && character == '"':
			inString = true
		case !inString && (character == '{' || character == '['):
			stack = append(stack, character)
		case !inString && (character == '}' || character == ']'):
			if len(stack) == 0 {
				return ""
			}
			stack = stack[:len(stack)-1]
		}
	}
	if !inString && len(stack) == 0 {
		return ""
	}
	repaired := []byte(content)
	if inString {
		repaired = append(repaired, '"')
	}
	for index := len(stack) - 1; index >= 0; index-- {
		closer := byte('}')
		if stack[index] == '[' {
			closer = ']'
		}
		repaired = append(repaired, closer)
	}
	return string(repaired)
}

func model() string {
	value := strings.TrimSpace(os.Getenv("OPEN_ROUTER_MODEL"))
	if value == "" {
		return defaultModel
	}
	return value
}
