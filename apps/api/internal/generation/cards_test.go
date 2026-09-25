package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/presentation"
)

type memoryObjects struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (store *memoryObjects) PutImmutable(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	contents, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.objects == nil {
		store.objects = map[string][]byte{}
	}
	store.objects[key] = contents
	return nil
}

func (store *memoryObjects) OpenObject(_ context.Context, key string) (io.ReadCloser, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	contents, found := store.objects[key]
	if !found {
		return nil, carddocument.ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(contents)), nil
}

// startConverter runs the real Bun converter, the schema authority, so the
// drafter is tested against the validation production uses.
func startConverter(t *testing.T) *carddocument.Converter {
	t.Helper()
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun is not installed")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.Command(bun, "src/main.ts")
	command.Dir, _ = filepath.Abs("../../../converter")
	command.Env = append(os.Environ(), fmt.Sprintf("CARD_CONVERTER_PORT=%d", port))
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	})
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := http.Get(baseURL + "/health")
		if err == nil {
			response.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("converter did not start: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	return carddocument.NewConverter(baseURL, &http.Client{Timeout: 5 * time.Second})
}

func decoded(t *testing.T, raw string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func bulletsCard(position int) string {
	return fmt.Sprintf(`{"position": %d, "layout": "bullets", "sourceIds": ["s1"], "nodes": [
		{"type": "heading", "text": "Point %d"},
		{"type": "bullets", "items": ["First **reason**", "Second reason"]}]}`, position, position)
}

func TestCardDrafterPlansDraftsRepairsAndStores(t *testing.T) {
	converter := startConverter(t)
	previousBatch := cardBatchSize
	cardBatchSize = 2
	defer func() { cardBatchSize = previousBatch }()

	var calls []string
	var repairPrompt string
	planAttempts := 0
	generate := func(_ context.Context, _ streamJob, promptName, _, user string, _ int) (map[string]any, int, error) {
		calls = append(calls, promptName)
		switch promptName {
		case "card-plan":
			planAttempts++
			entries := []string{}
			count := 3
			if planAttempts == 1 {
				count = 2 // one short: the planner must be asked again
			}
			for position := 1; position <= count; position++ {
				entries = append(entries, fmt.Sprintf(`{"position": %d, "takeaway": "Takeaway %d", "role": "evidence", "layout": "bullets", "evidence": "e", "sourceIds": ["s1"]}`, position, position))
			}
			return decoded(t, `{"title": "Grid storage", "cards": [`+strings.Join(entries, ",")+`]}`), 10, nil
		case "card-draft":
			if strings.Contains(user, "positions 1, 2.") {
				// Card 2 has one bullet, which the bullets layout refuses.
				return decoded(t, `{"cards": [`+bulletsCard(1)+`, {"position": 2, "layout": "bullets", "nodes": [
					{"type": "heading", "text": "Point 2"}, {"type": "bullets", "items": ["Only one"]}]}]}`), 20, nil
			}
			// Card 3 is missing from the response entirely.
			return decoded(t, `{"cards": []}`), 20, nil
		case "card-repair":
			repairPrompt += user
			position := 2
			if strings.Contains(user, "Card position 3") {
				position = 3
			}
			return decoded(t, `{"card": `+bulletsCard(position)+`}`), 5, nil
		}
		t.Fatalf("unexpected prompt %s", promptName)
		return nil, 0, nil
	}

	store := &memoryObjects{}
	drafter := newCardDrafter(converter, store, generate, nil)
	job := streamJob{
		kind: "generation", presentationID: "presentation-1", userID: "user-1", operationID: "operation-1",
		prompt: "Grid storage", slideCount: 3, detailLevel: "balanced", tonality: "professional",
		researchPayload: &presentation.ResearchPayload{Sources: []presentation.Source{{URL: "https://example.com", Title: "Report"}}},
	}
	draft, err := drafter.Draft(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}

	if planAttempts != 2 {
		t.Fatalf("plan attempts = %d", planAttempts)
	}
	if !strings.Contains(repairPrompt, "needs 2-6 bullets items, got 1") || !strings.Contains(repairPrompt, "missing from the response") {
		t.Fatalf("repair prompts did not carry the issues: %s", repairPrompt)
	}
	if draft.tokens != 10+10+20+20+5+5 {
		t.Fatalf("tokens = %d across %v", draft.tokens, calls)
	}
	if draft.document["totalSlides"] != 3 || draft.document["status"] != "ready" || draft.commit == nil {
		t.Fatalf("document = %+v", draft.document)
	}
	if len(store.objects) != 1 {
		t.Fatalf("stored %d objects", len(store.objects))
	}
	for _, contents := range store.objects {
		var document struct {
			SchemaVersion int                        `json:"schemaVersion"`
			CardOrder     []string                   `json:"cardOrder"`
			Cards         map[string]json.RawMessage `json:"cards"`
		}
		if err := json.Unmarshal(contents, &document); err != nil {
			t.Fatal(err)
		}
		if document.SchemaVersion != 2 || len(document.CardOrder) != 3 || len(document.Cards) != 3 {
			t.Fatalf("stored document = %s", contents)
		}
	}
}

func TestCardDrafterRefusesAPlanThatNeverReachesTheRequestedCount(t *testing.T) {
	converter := startConverter(t)
	generate := func(context.Context, streamJob, string, string, string, int) (map[string]any, int, error) {
		return decoded(t, `{"title": "Short", "cards": [{"position": 1, "takeaway": "Only", "role": "opening", "layout": "title", "evidence": "e"}]}`), 1, nil
	}
	drafter := newCardDrafter(converter, &memoryObjects{}, generate, nil)
	_, err := drafter.Draft(context.Background(), streamJob{kind: "generation", presentationID: "p", userID: "u", operationID: "o", slideCount: 4})
	if err == nil || !strings.Contains(err.Error(), "exactly 4 are required") {
		t.Fatalf("error = %v", err)
	}
}

func TestCardAuthorizationGrowsWithCardsAndSources(t *testing.T) {
	small := cardAuthorizationMillis(5, "Topic", nil, nil)
	large := cardAuthorizationMillis(20, "Topic", nil, nil)
	sourced := cardAuthorizationMillis(5, "Topic", nil, &presentation.ResearchPayload{Sources: []presentation.Source{{URL: "https://example.com", Snippet: strings.Repeat("x", 2000)}}})
	if small <= 0 || large <= small || sourced <= small {
		t.Fatalf("small=%d large=%d sourced=%d", small, large, sourced)
	}
}
