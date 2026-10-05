package presentation

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type listCache struct {
	values    map[string][]byte
	beforeSet func()
}

func (store *listCache) Get(_ context.Context, key string) ([]byte, bool) {
	value, ok := store.values[key]
	return value, ok
}
func (store *listCache) Set(_ context.Context, key string, value []byte, _ time.Duration) {
	if store.beforeSet != nil {
		hook := store.beforeSet
		store.beforeSet = nil
		hook()
	}
	store.values[key] = value
}

type countedDB struct {
	*sql.DB
	lists int
}

func (database *countedDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	database.lists++
	return database.DB.QueryContext(ctx, query, args...)
}

func TestListCacheTracksCommittedWrites(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	var migrated bool
	if err := db.QueryRow(`SELECT to_regclass('presentation_cache_versions') IS NOT NULL`).Scan(&migrated); err != nil || !migrated {
		t.Fatal("cache migration required", err)
	}
	user := fmt.Sprintf("cache-user-%d", time.Now().UnixNano())
	other := user + "-other"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, name, email) VALUES ($1, 'Cache', $1 || '@test.invalid'), ($2, 'Cache', $2 || '@test.invalid')`, user, other)
	defer func() {
		db.Exec(`DELETE FROM users WHERE id IN ($1, $2)`, user, other)
		db.Exec(`DELETE FROM presentation_cache_versions WHERE user_id IN ($1, $2)`, user, other)
	}()
	exec(`INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $2, 'Original', 'Prompt', '{"status":"ready","totalSlides":2}')`, user, user)
	counted := &countedDB{DB: db}
	store := &listCache{values: map[string][]byte{}}
	service := NewService(NewRepository(counted)).WithCache(store)
	list := func(owner string) []PresentationSummary {
		t.Helper()
		rows, _, _, err := service.List(ctx, owner, 20, 0)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if got := list(user); len(got) != 1 || got[0].Title != "Original" {
		t.Fatal(got)
	}
	list(user)
	if counted.lists != 1 {
		t.Fatal("second read queried presentation bodies")
	}
	if got := list(other); len(got) != 0 {
		t.Fatal("cache crossed user boundary", got)
	}
	exec(`UPDATE presentations SET title = 'Worker write' WHERE id = $1`, user)
	if got := list(user); got[0].Title != "Worker write" {
		t.Fatal("direct writer did not invalidate", got)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE presentations SET title = 'Rolled back' WHERE id = $1`, user); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	before := counted.lists
	if got := list(user); got[0].Title != "Worker write" || counted.lists != before {
		t.Fatal("rollback changed the cache generation", got)
	}
	// A write lands after the read but before its cache fill. The fill's old
	// generation must never become active again.
	store.values = map[string][]byte{}
	store.beforeSet = func() { exec(`UPDATE presentations SET title = 'Newer' WHERE id = $1`, user) }
	list(user)
	if got := list(user); got[0].Title != "Newer" {
		t.Fatal("late cache fill returned old content", got)
	}
	exec(`UPDATE presentations SET user_id = $1 WHERE id = $2`, other, user)
	if len(list(user)) != 0 || len(list(other)) != 1 {
		t.Fatal("ownership transfer did not invalidate both users")
	}
	if err := service.Delete(ctx, user, other); err != nil {
		t.Fatal(err)
	}
	if len(list(other)) != 0 {
		t.Fatal("delete left cached list")
	}
	// Account deletion must not fail because its presentation trigger runs
	// after the owning user has been removed by the cascade.
	exec(`INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $1, 'Delete account', 'Prompt', '{}')`, user)
	list(user)
	exec(`DELETE FROM users WHERE id = $1`, user)
	if len(list(user)) != 0 {
		t.Fatal("account deletion left cached list")
	}
	for key := range store.values {
		store.values[key] = []byte("broken JSON")
	}
	if len(list(other)) != 0 {
		t.Fatal("corrupt cache did not fall back")
	}
	if _, _, _, err := service.List(ctx, user, 0, 0); err == nil {
		t.Fatal("invalid pagination accepted")
	}
}
