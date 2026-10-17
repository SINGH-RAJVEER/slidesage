//go:build rustcompat

package carddocument

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type shareOracleResponse struct {
	status int
	body   any
}

func shareOracleCall(t *testing.T, o *currentOracle, base, method, id, token, cookie, payload string, status int) shareOracleResponse {
	t.Helper()
	request, err := http.NewRequest(method, base+"/presentations/"+id+"/share", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		t.Fatalf("%s %s: status=%d want=%d body=%s", base, method, response.StatusCode, status, raw)
	}
	if status == http.StatusNoContent {
		if len(raw) != 0 || response.Header.Get("Content-Type") != "" || response.Header.Get("Cache-Control") != "" {
			t.Fatalf("DELETE response has unexpected body/headers: %q %v", raw, response.Header)
		}
		return shareOracleResponse{status: status}
	}
	if response.Header.Get("Content-Type") != "application/json" || response.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("headers=%v", response.Header)
	}
	if method == http.MethodHead {
		if len(raw) != 0 {
			t.Fatalf("HEAD body=%q", raw)
		}
		return shareOracleResponse{status: status}
	}
	if !bytes.HasSuffix(raw, []byte("\n")) {
		t.Fatalf("JSON missing Go newline: %q", raw)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return shareOracleResponse{status: status, body: decoded}
}

func TestShareManagementMatchesRust(t *testing.T) {
	o := newCurrentOracle(t)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodHead} {
		for _, tc := range []struct {
			name, id, token, cookie string
			status                  int
		}{
			{"anonymous", o.id, "", "", 401},
			{"invalid bearer blocks cookie", o.id, "bad", "slidesage_token=" + o.token, 401},
			{"foreign owner", o.id, o.otherToken, "", 404},
			{"missing presentation", "missing-" + o.id, o.token, "", 404},
			{"untrimmed ID", "%20" + o.id + "%20", o.token, "", 404},
			{"anonymous invalid UTF8 ID", "%FF", "", "", 401},
			{"authenticated invalid UTF8 ID", "%FF", o.token, "", 500},
		} {
			t.Run(method+" "+tc.name, func(t *testing.T) {
				goResponse := shareOracleCall(t, o, o.reference, method, tc.id, tc.token, tc.cookie, "", tc.status)
				rust := shareOracleCall(t, o, o.target, method, tc.id, tc.token, tc.cookie, "", tc.status)
				if !reflect.DeepEqual(rust, goResponse) {
					t.Fatalf("Rust=%v Go=%v", rust, goResponse)
				}
			})
		}
	}
	var outcomes []any
	for _, base := range []string{o.reference, o.target} {
		o.exec(t, `DELETE FROM presentation_shares WHERE presentation_id=$1`, o.id)
		var sequence []any
		call := func(method, token, cookie, body string, status int) any {
			result := shareOracleCall(t, o, base, method, o.id, token, cookie, body, status)
			sequence = append(sequence, result)
			return result.body
		}
		body := call("GET", o.token, "", "", 200).(map[string]any)
		if len(body) != 1 || body["share"] != nil {
			t.Fatal("share before creation", body)
		}
		call("DELETE", o.token, "", "", 204)
		var lastToken string
		for rotation := 0; rotation < 2; rotation++ {
			// Management does not require a ready presentation or saved revision;
			// its POST body is ignored, including malformed/oversized JSON.
			payload := "{broken"
			if rotation == 1 {
				payload = strings.Repeat("x", 40*1024)
			}
			created := call("POST", o.token, "", payload, 201).(map[string]any)["share"].(map[string]any)
			token, ok := created["token"].(string)
			if !ok || !validShareToken(token) || len(token) != 43 || strings.ContainsAny(token, "+/=") || token == lastToken {
				t.Fatal("invalid/new token", created)
			}
			var id, digest, owner string
			var createdAt time.Time
			if err := o.db.QueryRow(`SELECT id,token_sha256,created_by,created_at FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL`, o.id).Scan(&id, &digest, &owner, &createdAt); err != nil {
				t.Fatal(err)
			}
			parsed, err := uuid.Parse(id)
			if err != nil || parsed.Version() != 4 || parsed.Variant() != uuid.RFC4122 || digest != shareDigest(token) || owner != o.owner {
				t.Fatalf("stored row: %s %s %s %v", id, digest, owner, err)
			}
			if created["createdAt"] != createdAt.In(time.Local).Format(time.RFC3339Nano) || len(created) != 2 {
				t.Fatal("created timestamp/shape", created, createdAt)
			}
			if createdAt.Before(time.Now().Add(-time.Minute)) || createdAt.After(time.Now().Add(time.Second)) {
				t.Fatal("creation timestamp is not current", createdAt)
			}
			current := call("GET", "", "slidesage_token="+o.token, "", 200).(map[string]any)["share"].(map[string]any)
			if len(current) != 1 || current["createdAt"] != created["createdAt"] {
				t.Fatal("GET exposes token or mismatched timestamp", current, created)
			}
			call("HEAD", o.token, "", "", 200)
			var live, revoked int
			if err := o.db.QueryRow(`SELECT count(*) FILTER(WHERE revoked_at IS NULL),count(*) FILTER(WHERE revoked_at IS NOT NULL) FROM presentation_shares WHERE presentation_id=$1`, o.id).Scan(&live, &revoked); err != nil || live != 1 || revoked != rotation {
				t.Fatalf("rotation live=%d revoked=%d err=%v", live, revoked, err)
			}
			if rotation == 1 {
				var oldRevoked bool
				if err := o.db.QueryRow(`SELECT revoked_at IS NOT NULL FROM presentation_shares WHERE token_sha256=$1`, shareDigest(lastToken)).Scan(&oldRevoked); err != nil || !oldRevoked {
					t.Fatal("old token remains live", err)
				}
			}
			lastToken = token
			// Only generated token/timestamp values are normalized, after checking
			// their formats, clock ranges, database values and rotation relationships.
			created["token"] = "<token>"
			created["createdAt"] = "<createdAt>"
			current["createdAt"] = "<createdAt>"
		}
		call("DELETE", "", "slidesage_token="+o.token, "", 204)
		call("DELETE", o.token, "", "", 204)
		body = call("GET", o.token, "", "", 200).(map[string]any)
		if body["share"] != nil {
			t.Fatal("revoked share remains visible", body)
		}
		var live int
		if err := o.db.QueryRow(`SELECT count(*) FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL`, o.id).Scan(&live); err != nil || live != 0 {
			t.Fatal("revoke DB state", live, err)
		}
		outcomes = append(outcomes, sequence)
	}
	if !reflect.DeepEqual(outcomes[0], outcomes[1]) {
		t.Fatalf("Rust=%v\nGo=%v", outcomes[1], outcomes[0])
	}
}

func TestShareManagementRustRollbackAndNoRowSemantics(t *testing.T) {
	if os.Getenv("TEST_RUST_DISPOSABLE_DATABASE") != "true" {
		t.Fatal("TEST_RUST_DISPOSABLE_DATABASE=true is required for fixture-specific trigger injection")
	}
	o := newCurrentOracle(t)
	name := "rust_share_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	// A temporary fixture-specific trigger exercises failures in the original
	// transaction without changing migrations or unrelated presentation writes.
	function := fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.presentation_id = '%s' THEN RAISE EXCEPTION 'share fixture failure'; END IF; RETURN NEW; END $$`, name, strings.ReplaceAll(o.id, "'", "''"))
	o.exec(t, function)
	t.Cleanup(func() {
		if _, err := o.db.Exec("DROP FUNCTION " + name + "() CASCADE"); err != nil {
			t.Error(err)
		}
	})
	for _, base := range []string{o.reference, o.target} {
		o.exec(t, `DELETE FROM presentation_shares WHERE presentation_id=$1`, o.id)
		created := shareOracleCall(t, o, base, "POST", o.id, o.token, "", "", 201).body
		o.exec(t, fmt.Sprintf(`CREATE TRIGGER %s BEFORE INSERT ON presentation_shares FOR EACH ROW EXECUTE FUNCTION %s()`, name, name))
		failed := shareOracleCall(t, o, base, "POST", o.id, o.token, "", "", 500)
		if !reflect.DeepEqual(failed.body, map[string]any{"error": map[string]any{"message": "Unable to load the presentation"}}) {
			t.Fatal(failed)
		}
		o.exec(t, "DROP TRIGGER "+name+" ON presentation_shares")
		current := shareOracleCall(t, o, base, "GET", o.id, o.token, "", "", 200).body.(map[string]any)
		if current["share"].(map[string]any)["createdAt"] != created.(map[string]any)["share"].(map[string]any)["createdAt"] {
			t.Fatal("failed rotation revoked existing share", current)
		}
		var total, live int
		if err := o.db.QueryRow(`SELECT count(*),count(*) FILTER(WHERE revoked_at IS NULL) FROM presentation_shares WHERE presentation_id=$1`, o.id).Scan(&total, &live); err != nil || total != 1 || live != 1 {
			t.Fatal("failed rotation did not roll back", total, live, err)
		}
		// A BEFORE INSERT trigger returning NULL produces QueryRow ErrNoRows.
		o.exec(t, fmt.Sprintf(`CREATE OR REPLACE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.presentation_id = '%s' THEN RETURN NULL; END IF; RETURN NEW; END $$`, name, strings.ReplaceAll(o.id, "'", "''")))
		o.exec(t, fmt.Sprintf(`CREATE TRIGGER %s BEFORE INSERT ON presentation_shares FOR EACH ROW EXECUTE FUNCTION %s()`, name, name))
		shareOracleCall(t, o, base, "POST", o.id, o.token, "", "", 500)
		o.exec(t, "DROP TRIGGER "+name+" ON presentation_shares")
		if err := o.db.QueryRow(`SELECT count(*),count(*) FILTER(WHERE revoked_at IS NULL) FROM presentation_shares WHERE presentation_id=$1`, o.id).Scan(&total, &live); err != nil || total != 1 || live != 1 {
			t.Fatal("no-row insert did not roll back", total, live, err)
		}
		// Exec reporting zero updated rows still counts as a successful revoke.
		o.exec(t, fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE ON presentation_shares FOR EACH ROW EXECUTE FUNCTION %s()`, name, name))
		shareOracleCall(t, o, base, "DELETE", o.id, o.token, "", "", 204)
		o.exec(t, "DROP TRIGGER "+name+" ON presentation_shares")
		if err := o.db.QueryRow(`SELECT count(*) FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL`, o.id).Scan(&live); err != nil || live != 1 {
			t.Fatal("zero-row revoke semantics", live, err)
		}
		// Reset the function before the next server's error-insertion case.
		o.exec(t, "CREATE OR REPLACE "+strings.TrimPrefix(function, "CREATE "))
		o.exec(t, fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE ON presentation_shares FOR EACH ROW EXECUTE FUNCTION %s()`, name, name))
		revocationFailed := shareOracleCall(t, o, base, "DELETE", o.id, o.token, "", "", 500)
		if !reflect.DeepEqual(revocationFailed.body, failed.body) {
			t.Fatal("revoke failure response differs from create failure", revocationFailed, failed)
		}
		o.exec(t, "DROP TRIGGER "+name+" ON presentation_shares")
		if err := o.db.QueryRow(`SELECT count(*) FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL`, o.id).Scan(&live); err != nil || live != 1 {
			t.Fatal("failed revoke changed live share", live, err)
		}
	}
}
