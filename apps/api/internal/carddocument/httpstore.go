package carddocument

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HTTPBlobStore accesses the authenticated R2 gateway in the edge Worker.
// Containers never depend on their ephemeral disk for presentation images.
type HTTPBlobStore struct {
	endpoint string
	token    string
	client   *http.Client
}

var _ BlobStore = (*HTTPBlobStore)(nil)

func NewHTTPBlobStore(endpoint, token string, client *http.Client) (*HTTPBlobStore, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return nil, errors.New("object storage URL must be HTTPS without credentials, query, or fragment")
	}
	if len(token) < 32 || strings.ContainsAny(token, "\r\n") {
		return nil, errors.New("object storage token must contain at least 32 characters and no line breaks")
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	// Never send the storage credential to a redirect target.
	copyClient := *client
	copyClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &HTTPBlobStore{endpoint: strings.TrimRight(endpoint, "/"), token: token, client: &copyClient}, nil
}

func (store *HTTPBlobStore) PutImmutable(ctx context.Context, key string, body io.Reader, size int64, contentType, digest string) error {
	if err := validateObjectWrite(key, body, size, contentType, digest); err != nil {
		return err
	}
	// PNG normalization can expand a compressed source. Do not apply the
	// original upload limit again to the resulting immutable object.
	if size > 96<<20 {
		return ErrObjectSize
	}
	var data bytes.Buffer
	if err := copyExactObject(&data, body, size, digest); err != nil {
		return err
	}
	request, err := store.request(ctx, http.MethodPut, key, bytes.NewReader(data.Bytes()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("X-Object-SHA256", digest)
	response, err := store.client.Do(request)
	if err != nil {
		return fmt.Errorf("write object: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusConflict {
		return ErrObjectConflict
	}
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("write object: HTTP %d", response.StatusCode)
	}
	return nil
}

func (store *HTTPBlobStore) OpenObject(ctx context.Context, key string) (io.ReadCloser, error) {
	request, err := store.request(ctx, http.MethodGet, key, nil)
	if err != nil {
		return nil, err
	}
	response, err := store.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read object: %w", err)
	}
	if response.StatusCode == http.StatusOK {
		return response.Body, nil
	}
	response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrObjectNotFound
	}
	return nil, fmt.Errorf("read object: HTTP %d", response.StatusCode)
}

func (store *HTTPBlobStore) DeleteObject(ctx context.Context, key string) error {
	request, err := store.request(ctx, http.MethodDelete, key, nil)
	if err != nil {
		return err
	}
	response, err := store.client.Do(request)
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("delete object: HTTP %d", response.StatusCode)
	}
	return nil
}

func (store *HTTPBlobStore) request(ctx context.Context, method, key string, body io.Reader) (*http.Request, error) {
	if !storedAssetKey.MatchString(key) || validateObjectKey(key) != nil {
		return nil, errors.New("invalid image object key")
	}
	parts := strings.Split(key, "/")
	for index := range parts {
		parts[index] = url.PathEscape(parts[index])
	}
	request, err := http.NewRequestWithContext(ctx, method, store.endpoint+"/"+strings.Join(parts, "/"), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+store.token)
	return request, nil
}
