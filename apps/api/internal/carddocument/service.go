package carddocument

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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

// Prepare validates and copies the submitted document for an atomic JSONB commit.
func Prepare(input PrepareInput) (Revision, error) {
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
	if err := validateJSONB(compact.Bytes()); err != nil {
		return Revision{}, fmt.Errorf("%w: document: %v", ErrInvalidDocument, err)
	}
	var shape documentShape
	if err := json.Unmarshal(compact.Bytes(), &shape); err != nil {
		return Revision{}, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if shape.SchemaVersion != SchemaVersion || len(shape.CardOrder) == 0 || len(shape.CardOrder) > 40 || len(shape.Cards) == 0 || shape.Cards[0] != '{' {
		return Revision{}, fmt.Errorf("%w: schema version %d with %d cards", ErrInvalidDocument, shape.SchemaVersion, len(shape.CardOrder))
	}
	provenance, err := json.Marshal(input.Provenance)
	if err != nil || input.Provenance == nil {
		provenance = []byte(`{}`)
	}
	if err := validateJSONB(provenance); err != nil {
		return Revision{}, fmt.Errorf("%w: provenance: %v", ErrInvalidDocument, err)
	}
	assetIDs, err := ReferencedAssets(compact.Bytes())
	if err != nil {
		return Revision{}, err
	}
	sum := sha256.Sum256(compact.Bytes())
	digest := hex.EncodeToString(sum[:])
	return Revision{
		PresentationID: input.PresentationID,
		Document:       append(json.RawMessage(nil), compact.Bytes()...),
		SHA256:         digest,
		ByteSize:       int64(compact.Len()),
		CardCount:      len(shape.CardOrder),
		SchemaVersion:  shape.SchemaVersion,
		AuthorID:       input.AuthorID,
		OperationKind:  input.OperationKind,
		OperationID:    input.OperationID,
		Provenance:     provenance,
		AssetIDs:       assetIDs,
	}, nil
}

// Load returns the body selected atomically with the revision metadata. Digest
// metadata must not be compared against JSONB's reserialized bytes.
func Load(revision Revision) (json.RawMessage, error) {
	if len(revision.Document) == 0 || !json.Valid(revision.Document) {
		return nil, fmt.Errorf("%w: revision body is missing; run cmd/migrate", ErrInvalidDocument)
	}
	return append(json.RawMessage(nil), revision.Document...), nil
}
