package carddocument

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// FileBlobStore keeps image bytes on local disk under root, one file per key.
// Writes land in a temporary file beside the target and are linked into place,
// so a key never holds a partial object and an existing key is never replaced.
type FileBlobStore struct {
	root string
}

var _ ObjectStore = (*FileBlobStore)(nil)

// StoreFromEnv opens the store at PRESENTATION_STORAGE_DIR. It returns nil
// when the variable is unset, which leaves documents text-only.
func StoreFromEnv() (*FileBlobStore, error) {
	root := strings.TrimSpace(os.Getenv("PRESENTATION_STORAGE_DIR"))
	if root == "" {
		return nil, nil
	}
	return NewFileBlobStore(root)
}

func NewFileBlobStore(root string) (*FileBlobStore, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("storage directory is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve storage directory: %w", err)
	}
	if err := os.MkdirAll(absolute, 0o750); err != nil {
		return nil, fmt.Errorf("create storage directory: %w", err)
	}
	return &FileBlobStore{root: absolute}, nil
}

func (store *FileBlobStore) PutImmutable(ctx context.Context, key string, body io.Reader, size int64, contentType, sha256 string) error {
	if err := validateObjectWrite(key, body, size, contentType, sha256); err != nil {
		return err
	}
	target := store.path(key)
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return fmt.Errorf("create object directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".upload-*")
	if err != nil {
		return fmt.Errorf("create object file: %w", err)
	}
	defer os.Remove(temporary.Name())
	if err := copyExactObject(temporary, body, size, sha256); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync object file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close object file: %w", err)
	}
	err = os.Link(temporary.Name(), target)
	if err == nil {
		return nil
	}
	if !errors.Is(err, fs.ErrExist) {
		return fmt.Errorf("store object: %w", err)
	}
	// Keys are content-addressed, so identical bytes mean the same object.
	same, err := fileMatches(target, size, sha256)
	if err != nil {
		return fmt.Errorf("inspect existing object: %w", err)
	}
	if !same {
		return ErrObjectConflict
	}
	return nil
}

func (store *FileBlobStore) OpenObject(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := validateObjectKey(key); err != nil {
		return nil, err
	}
	file, err := os.Open(store.path(key))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrObjectNotFound
		}
		return nil, fmt.Errorf("open object: %w", err)
	}
	return file, nil
}

func (store *FileBlobStore) path(key string) string {
	return filepath.Join(store.root, filepath.FromSlash(key))
}

func fileMatches(name string, size int64, expectedSHA256 string) (bool, error) {
	file, err := os.Open(name)
	if err != nil {
		return false, err
	}
	defer file.Close()
	err = copyExactObject(io.Discard, file, size, expectedSHA256)
	if errors.Is(err, ErrObjectSize) || errors.Is(err, ErrObjectDigest) {
		return false, nil
	}
	return err == nil, err
}

func validateObjectKey(key string) error {
	if key == "" || key == "." || key == ".." || !utf8.ValidString(key) || len([]byte(key)) > 1024 || strings.HasPrefix(key, "/") ||
		strings.ContainsAny(key, "\\\r\n\x00") || path.Clean(key) != key || strings.HasPrefix(key, "../") ||
		strings.HasPrefix(path.Base(key), ".") {
		return errors.New("invalid object key")
	}
	return nil
}

func validateObjectWrite(key string, body io.Reader, size int64, contentType, sha256 string) error {
	if err := validateObjectKey(key); err != nil {
		return err
	}
	if body == nil {
		return errors.New("object body is required")
	}
	if size <= 0 {
		return errors.New("object size must be positive")
	}
	if strings.TrimSpace(contentType) == "" {
		return errors.New("object content type is required")
	}
	if !validSHA256(sha256) {
		return errors.New("valid object SHA-256 is required")
	}
	return nil
}

// copyExactObject copies body to destination and fails unless it holds exactly
// size bytes with the expected digest.
func copyExactObject(destination io.Writer, body io.Reader, size int64, expectedSHA256 string) error {
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(digest, destination), io.LimitReader(body, size+1))
	if err != nil {
		return err
	}
	if written != size {
		return ErrObjectSize
	}
	if hex.EncodeToString(digest.Sum(nil)) != expectedSHA256 {
		return ErrObjectDigest
	}
	return nil
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
