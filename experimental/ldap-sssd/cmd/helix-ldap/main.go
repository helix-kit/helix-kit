// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-ldap serves Helix identities stored in PostgreSQL over LDAP, so
// SSSD can resolve them as ordinary Unix users through NSS.
package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	ldapd "github.com/vjeantet/ldapserver"

	"github.com/helix-kit/experimental-ldap/internal/config"
	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/ldapserver"
	"github.com/helix-kit/experimental-ldap/internal/store/postgres"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel(cfg.LogLevel)}))
	slog.SetDefault(logger)

	// The library's package logger dumps every packet as hex; keep it off unless
	// explicitly asked for, and never let it become the service's log.
	if cfg.LogLDAPTrace {
		ldapd.Logger = log.New(os.Stderr, "ldap-wire ", log.LstdFlags)
	} else {
		ldapd.Logger = ldapd.DiscardingLogger
	}

	ctx := context.Background()
	// Reserve one row above the search limit so truncation stays detectable.
	st, err := postgres.New(ctx, cfg.DatabaseURL, cfg.DBTimeout, cfg.SearchLimit+1)
	if err != nil {
		return err
	}
	defer st.Close()
	logger.Info("connected to postgres")

	srv := ldapserver.New(st, ldapserver.Options{
		Directory:    identity.NewDirectory(cfg.BaseDN, cfg.HomeRoot, cfg.LoginShell),
		BindDN:       cfg.BindDN,
		BindPassword: cfg.BindPassword,
		SearchLimit:  cfg.SearchLimit,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		Logger:       logger,
	})

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe(cfg.ListenAddr) }()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errc:
		return err
	case s := <-sig:
		logger.Info("shutting down", "signal", s.String())
		srv.Stop()
		logger.Info("stopped")
		return nil
	}
}

func logLevel(name string) slog.Level {
	switch name {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
