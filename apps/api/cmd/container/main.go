// Command container supervises one application role, its private converter, and
// a restricted SSH tunnel to the persistent VPS database. It is PID 1 in the
// Cloudflare image and keeps dependencies alive while the application drains.
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
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
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
	secrets, err := os.MkdirTemp("", "slidesage-ssh-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(secrets)
	for name, variable := range map[string]string{"identity": "DATABASE_SSH_PRIVATE_KEY", "known_hosts": "DATABASE_SSH_KNOWN_HOSTS"} {
		value := os.Getenv(variable)
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", variable)
		}
		if err := os.WriteFile(filepath.Join(secrets, name), []byte(value+"\n"), 0o600); err != nil {
			return err
		}
	}
	args, err := tunnelArgs(secrets)
	if err != nil {
		return err
	}
	// Do not pass application credentials to the SSH process.
	tunnel, err := start("ssh", args, []string{"PATH=" + os.Getenv("PATH"), "HOME=" + secrets})
	if err != nil {
		return fmt.Errorf("start database tunnel: %w", err)
	}
	defer tunnel.kill()
	if err := waitPort(ctx, "127.0.0.1:15432", tunnel); err != nil {
		return errors.New("database tunnel did not become ready")
	}
	converter, err := start("/app/converter", nil, []string{"CARD_CONVERTER_HOST=127.0.0.1", "CARD_CONVERTER_PORT=8090"})
	if err != nil {
		return err
	}
	defer converter.kill()
	if err := waitPort(ctx, "127.0.0.1:8090", converter); err != nil {
		return errors.New("card converter did not become ready")
	}
	// The application needs the forwarded database, never the SSH private key.
	var applicationEnv []string
	for _, item := range os.Environ() {
		if !strings.HasPrefix(item, "DATABASE_SSH_") {
			applicationEnv = append(applicationEnv, item)
		}
	}
	app, err := start("/app/"+role, nil, applicationEnv)
	if err != nil {
		return err
	}
	defer app.kill()
	var failure error
	select {
	case <-ctx.Done():
	case <-app.done:
		failure = fmt.Errorf("%s process exited: %v", role, app.err)
	case <-tunnel.done:
		failure = errors.New("database tunnel exited")
	case <-converter.done:
		failure = errors.New("card converter exited")
	}
	// Leave SSH and the converter running until in-flight API/River work drains.
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
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Host != "127.0.0.1:15432" {
		return errors.New("DATABASE_URL must use the local SSH tunnel at 127.0.0.1:15432")
	}
	// pgx accepts host/port overrides in the query string. Disallow those so the
	// configured URL cannot silently bypass the encrypted tunnel.
	for _, key := range []string{"host", "hostaddr", "port", "service", "servicefile"} {
		if parsed.Query().Has(key) {
			return errors.New("DATABASE_URL must not override the tunnel host or port")
		}
	}
	return nil
}

func tunnelArgs(directory string) ([]string, error) {
	host, user, port, target := os.Getenv("DATABASE_SSH_HOST"), os.Getenv("DATABASE_SSH_USER"), os.Getenv("DATABASE_SSH_PORT"), os.Getenv("DATABASE_SSH_TARGET")
	number, err := strconv.Atoi(port)
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*$`).MatchString(host) || !regexp.MustCompile(`^[a-z_][a-z0-9_-]*$`).MatchString(user) || err != nil || number < 1 || number > 65535 || target != "127.0.0.1:15432" {
		return nil, errors.New("invalid database SSH connection settings")
	}
	return []string{"-NT", "-F", "/dev/null", "-p", port, "-i", filepath.Join(directory, "identity"),
		"-L", "127.0.0.1:15432:" + target, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
		"-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + filepath.Join(directory, "known_hosts"),
		"-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", user + "@" + host}, nil
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
