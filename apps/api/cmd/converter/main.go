// Command converter serves the private card converter. The generation worker
// and the API are its only callers, so it listens on loopback by default.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cardconverter"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	port := firstSet("CARD_CONVERTER_PORT", "PORT", "8090")
	host := "127.0.0.1"
	if value, ok := os.LookupEnv("CARD_CONVERTER_HOST"); ok {
		host = value
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, port))
	if err != nil {
		logger.Error("card converter could not listen", "error", err)
		os.Exit(1)
	}
	server := &http.Server{
		Handler:           cardconverter.Handler{Logger: logger},
		ReadHeaderTimeout: 10 * time.Second,
	}
	logger.Info("card converter listening on http://" + listener.Addr().String())

	signals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-signals.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("card converter stopped", "error", err)
		os.Exit(1)
	}
}

// firstSet returns the first environment variable that is set, or fallback,
// as `a ?? b ?? fallback` reads process.env.
func firstSet(first, second, fallback string) string {
	if value, ok := os.LookupEnv(first); ok {
		return value
	}
	if value, ok := os.LookupEnv(second); ok {
		return value
	}
	return fallback
}
