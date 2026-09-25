// Package carddocument owns card document revisions: immutable JSON objects in
// GCS addressed by digest, revision metadata and the current-revision pointer
// in PostgreSQL, and the converter that turns model drafts into valid cards.
//
// Callers never build object keys or edit document JSON directly. The
// converter is the schema authority, shared with the browser editor.
package carddocument

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"
)

// SchemaVersion is the card document schema this build reads and writes. The
// converter refuses requests for any other version.
const SchemaVersion = 2

const ContentType = "application/json"

// MaxDocumentBytes bounds a stored document. Forty cards at their text limits
// stay well inside it.
const MaxDocumentBytes = 2 << 20

var (
	ErrInvalidDocument     = errors.New("invalid card document")
	ErrRevisionConflict    = errors.New("card document revision conflict")
	ErrPresentationMissing = errors.New("presentation not found")
	ErrNoRevision          = errors.New("presentation has no card document yet")
	ErrObjectNotFound      = errors.New("object does not exist")
	ErrObjectConflict      = errors.New("immutable object contains different content")
	ErrObjectSize          = errors.New("object size does not match the declared size")
	ErrObjectDigest        = errors.New("object SHA-256 does not match the declared digest")
)

type OperationKind string

const (
	OperationGeneration OperationKind = "generation"
	OperationAIRevision OperationKind = "ai_revision"
	OperationManualEdit OperationKind = "manual_edit"
)

// Revision is immutable once committed.
type Revision struct {
	PresentationID string          `json:"-"`
	Number         int             `json:"revision"`
	ObjectKey      string          `json:"-"`
	SHA256         string          `json:"sha256"`
	ByteSize       int64           `json:"byteSize"`
	CardCount      int             `json:"cardCount"`
	SchemaVersion  int             `json:"schemaVersion"`
	AuthorID       string          `json:"-"`
	OperationKind  OperationKind   `json:"operationKind"`
	OperationID    string          `json:"-"`
	BaseRevision   *int            `json:"baseRevision,omitempty"`
	Provenance     json.RawMessage `json:"-"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// ObjectStore writes create-only objects and reads them back.
type ObjectStore interface {
	// PutImmutable is idempotent when key already holds identical bytes and
	// fails with ErrObjectConflict when it holds different ones.
	PutImmutable(ctx context.Context, key string, body io.Reader, size int64, contentType, sha256 string) error
	// OpenObject returns ErrObjectNotFound when key holds no object.
	OpenObject(ctx context.Context, key string) (io.ReadCloser, error)
}
