// SPDX-License-Identifier: AGPL-3.0-only

// Package config loads the LDAP façade's settings from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the full runtime configuration. Secrets arrive by environment only
// and are never written to logs.
type Config struct {
	ListenAddr   string
	BaseDN       string
	BindDN       string
	BindPassword string
	DatabaseURL  string
	SearchLimit  int
	DBTimeout    time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	HomeRoot     string
	LoginShell   string
	LogLevel     string
	LogLDAPTrace bool
}

// Load reads the environment and applies defaults. It fails when a required
// secret is missing rather than falling back to a built-in one.
func Load() (*Config, error) {
	c := &Config{
		ListenAddr:   env("LDAP_LISTEN_ADDR", ":3389"),
		BaseDN:       env("LDAP_BASE_DN", "dc=helix,dc=local"),
		BindDN:       env("LDAP_BIND_DN", "cn=sssd,dc=helix,dc=local"),
		BindPassword: os.Getenv("LDAP_BIND_PASSWORD"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		HomeRoot:     env("HELIX_HOME_ROOT", "/home"),
		LoginShell:   env("HELIX_LOGIN_SHELL", "/usr/libexec/helix/session-launcher"),
		LogLevel:     strings.ToLower(env("LOG_LEVEL", "info")),
		LogLDAPTrace: env("LDAP_WIRE_TRACE", "false") == "true",
	}

	var err error
	if c.SearchLimit, err = envInt("LDAP_SEARCH_LIMIT", 1000); err != nil {
		return nil, err
	}
	if c.DBTimeout, err = envDuration("DB_QUERY_TIMEOUT", 5*time.Second); err != nil {
		return nil, err
	}
	// Read timeout is an idle timeout on an established connection: SSSD holds
	// connections open between lookups, so it must be generous.
	if c.ReadTimeout, err = envDuration("LDAP_READ_TIMEOUT", 10*time.Minute); err != nil {
		return nil, err
	}
	if c.WriteTimeout, err = envDuration("LDAP_WRITE_TIMEOUT", 30*time.Second); err != nil {
		return nil, err
	}

	if c.BindPassword == "" {
		return nil, fmt.Errorf("LDAP_BIND_PASSWORD is required")
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if c.SearchLimit <= 0 {
		return nil, fmt.Errorf("LDAP_SEARCH_LIMIT must be positive, got %d", c.SearchLimit)
	}
	if !strings.HasPrefix(c.LoginShell, "/") {
		return nil, fmt.Errorf("HELIX_LOGIN_SHELL must be an absolute path, got %q", c.LoginShell)
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func envDuration(key string, def time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}
