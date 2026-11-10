// Command container supervises one application role and its private converter.
// It is PID 1 in the Cloudflare image and keeps the converter alive while the
// application drains. PostgreSQL is the managed Neon database, reached over TLS.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

type process struct {
	cmd  *exec.Cmd
	done chan struct{}
	err  error
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	if err := run(ctx); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	role := os.Getenv("APP_ROLE")
	if role != "api" && role != "worker" {
		return errors.New("APP_ROLE must be api or worker")
	}
	if err := validateDatabaseURL(os.Getenv("DATABASE_URL")); err != nil {
		return err
	}
	converter, err := start("/app/converter", nil, []string{"CARD_CONVERTER_HOST=127.0.0.1", "CARD_CONVERTER_PORT=8090"})
	if err != nil {
		return err
	}
	defer converter.kill()
	if err := waitPort(ctx, "127.0.0.1:8090", converter); err != nil {
		return errors.New("card converter did not become ready")
	}
	app, err := start("/app/"+role, nil, os.Environ())
	if err != nil {
		return err
	}
	defer app.kill()
	var failure error
	select {
	case <-ctx.Done():
	case <-app.done:
		// An idle on-demand worker exits cleanly, which stops the Container.
		if app.err != nil {
			failure = fmt.Errorf("%s process exited: %v", role, app.err)
		}
	case <-converter.done:
		failure = errors.New("card converter exited")
	}
	// Leave the converter running until in-flight API/River work drains.
	_ = app.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-app.done:
	case <-time.After(55 * time.Second):
		app.kill()
	}
	return failure
}

func validateDatabaseURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() == "" {
		return errors.New("DATABASE_URL must be a postgres URL with a host")
	}
	query := parsed.Query()
	// pgx accepts host/port overrides in the query string. Disallow those so the
	// host checked here is the one the application connects to.
	for _, key := range []string{"host", "hostaddr", "port", "service", "servicefile"} {
		if query.Has(key) {
			return errors.New("DATABASE_URL must not override the host or port")
		}
	}
	// The database is reached over the public internet, so TLS is mandatory.
	switch query.Get("sslmode") {
	case "require", "verify-ca", "verify-full":
		return nil
	}
	return errors.New("DATABASE_URL must set sslmode to require, verify-ca, or verify-full")
}

func start(name string, args, environment []string) (*process, error) {
	command := exec.Command(name, args...)
	command.Env, command.Stdout, command.Stderr = environment, os.Stdout, os.Stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	child := &process{cmd: command, done: make(chan struct{})}
	go func() { child.err = command.Wait(); close(child.done) }()
	return child, nil
}

func (child *process) kill() {
	select {
	case <-child.done:
		return
	default:
	}
	_ = child.cmd.Process.Kill()
	<-child.done
}

func waitPort(ctx context.Context, address string, child *process) error {
	deadline := time.NewTimer(25 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		connection, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			connection.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-child.done:
			return errors.New("dependency exited")
		case <-deadline.C:
			return errors.New("dependency startup timed out")
		case <-ticker.C:
		}
	}
}
