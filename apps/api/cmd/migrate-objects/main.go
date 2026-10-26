// Command migrate-objects copies the old image volume through the authenticated
// R2 gateway without changing keys. A second run safely verifies the same data.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/carddocument"
)

func main() {
	root := flag.String("source", "", "root of the existing image volume")
	flag.Parse()
	if *root == "" {
		log.Fatal("--source is required")
	}
	store, err := carddocument.NewHTTPBlobStore(os.Getenv("OBJECT_STORAGE_URL"), os.Getenv("OBJECT_STORAGE_TOKEN"), nil)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	count, err := copyObjects(ctx, *root, store)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("copied and verified %d image objects", count)
}

func copyObjects(ctx context.Context, root string, store carddocument.ObjectStore) (int, error) {
	pattern := regexp.MustCompile(`^presentations/[A-Za-z0-9_-]+/assets/([0-9a-f]{64})\.(jpg|png)$`)
	count := 0
	err := filepath.WalkDir(root, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".upload-") {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("non-regular object %s", name)
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(relative)
		match := pattern.FindStringSubmatch(key)
		if match == nil {
			return fmt.Errorf("unexpected object key %s", key)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		file, err := os.Open(name)
		if err != nil {
			return err
		}
		contentType := "image/jpeg"
		if match[2] == "png" {
			contentType = "image/png"
		}
		err = store.PutImmutable(ctx, key, file, info.Size(), contentType, match[1])
		file.Close()
		if err != nil {
			return fmt.Errorf("copy %s: %w", key, err)
		}
		remote, err := store.OpenObject(ctx, key)
		if err != nil {
			return err
		}
		hash := sha256.New()
		written, err := io.Copy(hash, io.LimitReader(remote, info.Size()+1))
		remote.Close()
		if err != nil {
			return err
		}
		if written != info.Size() || hex.EncodeToString(hash.Sum(nil)) != match[1] {
			return fmt.Errorf("remote image differs: %s", key)
		}
		count++
		return nil
	})
	return count, err
}
