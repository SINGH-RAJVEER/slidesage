package main

import (
	"fmt"
	"net"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// requireLocalDatabase rejects a connection string unless every host it can
// reach is on this machine. It parses the string the way the driver will,
// including fallback hosts and PG* environment defaults, so a production URL
// cannot slip through in any accepted format.
func requireLocalDatabase(databaseURL string) error {
	config, err := pgconn.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("DATABASE_URL could not be parsed: %w", err)
	}
	hosts := []string{config.Host}
	for _, fallback := range config.Fallbacks {
		hosts = append(hosts, fallback.Host)
	}
	for _, host := range hosts {
		if !isLocalHost(host) {
			return fmt.Errorf("refusing to seed the database at %q: only localhost, loopback addresses, and Unix sockets are allowed", host)
		}
	}
	return nil
}

// isLocalHost accepts the exact name localhost, a loopback IP, or a Unix
// socket directory. Names that merely contain "localhost" are rejected.
func isLocalHost(host string) bool {
	if strings.HasPrefix(host, "/") || strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
