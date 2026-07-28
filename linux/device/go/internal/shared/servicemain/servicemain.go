// SPDX-License-Identifier: AGPL-3.0-only

// Package servicemain is the shared bootstrap every device binary uses to run a Runner.
package servicemain

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

// Runner is the long-lived body of a service.
type Runner interface {
	Run(ctx context.Context) error
}

// Options configures Run for a concrete config type T.
type Options[T any] struct {
	ServiceName string
	Version     string
	// LoadConfig resolves the effective config for the given service name.
	LoadConfig func(service string) (T, error)
	// Setup builds the Runner; a Runner with Close() is closed on shutdown.
	Setup func(cfg T, log *slog.Logger) (Runner, error)
}

// Run parses flags, loads config, and runs the service until SIGINT/SIGTERM.
func Run[T any](opts Options[T]) {
	service := flag.String("service", opts.ServiceName, "service name for config resolution")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(opts.ServiceName, opts.Version)
		return
	}

	// Log to stdout so systemd's StandardOutput=journal captures it uniformly.
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})).
		With("service", opts.ServiceName)

	cfg, err := opts.LoadConfig(*service)
	if err != nil {
		fatal(opts.ServiceName, "load config: "+err.Error())
	}

	runner, err := opts.Setup(cfg, log)
	if err != nil {
		fatal(opts.ServiceName, "setup: "+err.Error())
	}
	if c, ok := runner.(interface{ Close() }); ok {
		defer c.Close()
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Info("starting")
	if err := runner.Run(ctx); err != nil && ctx.Err() == nil {
		fatal(opts.ServiceName, "run: "+err.Error())
	}
	log.Info("stopped")
}

func fatal(service, msg string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", service, msg)
	os.Exit(1)
}
