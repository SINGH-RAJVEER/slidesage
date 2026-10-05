package carddocument

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

type bodyCache struct {
	values map[string][]byte
	gets   int
}

func (store *bodyCache) Get(_ context.Context, key string) ([]byte, bool) {
	store.gets++
	value, ok := store.values[key]
	return value, ok
}
func (store *bodyCache) Set(_ context.Context, key string, value []byte, _ time.Duration) {
	store.values[key] = bytes.Clone(value)
}

type bodyCountingDB struct {
	*sql.DB
	bodyReads int
}

func (db *bodyCountingDB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	if strings.HasPrefix(query, "SELECT r.document") {
		db.bodyReads++
	}
	return db.DB.QueryRowContext(ctx, query, args...)
}

func TestCachedBodyKeepsOwnershipAndHeadFresh(t *testing.T) {
	database := integrationDatabase(t)
	user, id := insertFixture(t, database)
	ctx := context.Background()
	commit := func(expected int, operation string) {
		t.Helper()
		input := prepareInput()
		input.PresentationID, input.AuthorID, input.OperationID = id, user, operation
		revision, err := Prepare(input)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err := CommitTx(ctx, tx, expected, revision); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	commit(0, "cached-revision-one")
	store := &bodyCache{values: map[string][]byte{}}
	db := &bodyCountingDB{DB: database}
	first, err := CachedCurrentRevision(ctx, db, id, user, store)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CachedCurrentRevision(ctx, db, id, user, store)
	if err != nil || second.Number != 1 || !bytes.Equal(first.Document, second.Document) || db.bodyReads != 1 {
		t.Fatalf("cached revision = %#v, %v, body reads %d", second, err, db.bodyReads)
	}
	gets := store.gets
	if _, err := CachedCurrentRevision(ctx, db, id, "another-user", store); !errors.Is(err, ErrPresentationMissing) || store.gets != gets {
		t.Fatal("authorization consulted cache", err)
	}
	commit(1, "cached-revision-two")
	newer, err := CachedCurrentRevision(ctx, db, id, user, store)
	if err != nil || newer.Number != 2 || db.bodyReads != 2 {
		t.Fatal("cached head did not advance", newer.Number, err)
	}
	for key := range store.values {
		store.values[key] = []byte("invalid JSON")
	}
	if _, err := CachedCurrentRevision(ctx, db, id, user, store); err != nil || db.bodyReads != 3 {
		t.Fatal("corrupt body did not fall back", err)
	}
	if _, err := database.Exec(`DELETE FROM presentations WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	gets = store.gets
	if _, err := CachedCurrentRevision(ctx, db, id, user, store); !errors.Is(err, ErrPresentationMissing) || store.gets != gets {
		t.Fatal("deleted presentation served from cache", err)
	}
}
