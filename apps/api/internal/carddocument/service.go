package carddocument

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
)

// documentShape is the part of a converted document this package checks
// before storing it. The converter validated the rest.
type documentShape struct {
	SchemaVersion int             `json:"schemaVersion"`
	CardOrder     []string        `json:"cardOrder"`
	Cards         json.RawMessage `json:"cards"`
}

// PrepareInput describes a converted document to store as a new revision.
type PrepareInput struct {
	PresentationID string
	AuthorID       string
	OperationID    string
	OperationKind  OperationKind
	Document       json.RawMessage
	Provenance     any
}

// Prepare uploads the document as an immutable, content-addressed object and
// returns the revision to commit. Uploading first means an interrupted database
// commit can retry safely: the object is already there, byte for byte.
func Prepare(ctx context.Context, store ObjectStore, input PrepareInput) (Revision, error) {
	if store == nil {
		return Revision{}, fmt.Errorf("card document storage is not configured")
	}
	if input.PresentationID == "" || input.AuthorID == "" || input.OperationID == "" {
		return Revision{}, fmt.Errorf("%w: presentation, author, and operation are required", ErrInvalidDocument)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, input.Document); err != nil {
		return Revision{}, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if compact.Len() > MaxDocumentBytes {
		return Revision{}, fmt.Errorf("%w: document is %d bytes", ErrInvalidDocument, compact.Len())
	}
	var shape documentShape
	if err := json.Unmarshal(compact.Bytes(), &shape); err != nil {
		return Revision{}, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if shape.SchemaVersion != SchemaVersion || len(shape.CardOrder) == 0 {
		return Revision{}, fmt.Errorf("%w: schema version %d with %d cards", ErrInvalidDocument, shape.SchemaVersion, len(shape.CardOrder))
	}
	provenance, err := json.Marshal(input.Provenance)
	if err != nil || input.Provenance == nil {
		provenance = []byte(`{}`)
	}
	sum := sha256.Sum256(compact.Bytes())
	digest := hex.EncodeToString(sum[:])
	key := objectKey(input.PresentationID, digest)
	if err := store.PutImmutable(ctx, key, bytes.NewReader(compact.Bytes()), int64(compact.Len()), ContentType, digest); err != nil {
		return Revision{}, fmt.Errorf("store card document: %w", err)
	}
	return Revision{
		PresentationID: input.PresentationID,
		ObjectKey:      key,
		SHA256:         digest,
		ByteSize:       int64(compact.Len()),
		CardCount:      len(shape.CardOrder),
		SchemaVersion:  shape.SchemaVersion,
		AuthorID:       input.AuthorID,
		OperationKind:  input.OperationKind,
		OperationID:    input.OperationID,
		Provenance:     provenance,
	}, nil
}

// Load reads a revision's document and checks it is the object the revision
// names, so a replaced or corrupted object is never served as the document.
func Load(ctx context.Context, store ObjectStore, revision Revision) (json.RawMessage, error) {
	reader, err := store.OpenObject(ctx, revision.ObjectKey)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	contents, err := io.ReadAll(io.LimitReader(reader, MaxDocumentBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read card document: %w", err)
	}
	if int64(len(contents)) != revision.ByteSize {
		return nil, ErrObjectSize
	}
	sum := sha256.Sum256(contents)
	if hex.EncodeToString(sum[:]) != revision.SHA256 {
		return nil, ErrObjectDigest
	}
	return contents, nil
}

func objectKey(presentationID, digest string) string {
	return "presentations/" + presentationID + "/cards/" + digest + ".json"
}
