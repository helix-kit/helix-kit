// SPDX-License-Identifier: AGPL-3.0-only

// Package echo is a smoke-test app: it registers over IPC and answers "ping"
// commands with "pong". It demonstrates the entire app authoring surface —
// connect, auto-register, dispatch commands, respond — in ~40 lines.
package echo

import (
	"context"
	"log/slog"

	"github.com/helix-kit/helix-device/internal/echo/generated"
	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/ipcutil"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

// ServiceName is how this app registers with helixd (its `message.service`).
const ServiceName = generated.EchoService

type runner struct {
	cfg    *config.Config
	log    *slog.Logger
	client *ipc.Client
}

// New builds the echo Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	return &runner{cfg: cfg, log: log}, nil
}

func (r *runner) Run(ctx context.Context) error {
	r.client = ipc.NewClient(r.cfg.IPC.SocketPath, ServiceName, r.log)
	r.client.Start()
	if err := r.client.WaitUntilConnected(ctx); err != nil {
		return err
	}
	go ipcutil.DispatchCommands(ctx, r.client.Notifications(), r.handle)
	<-ctx.Done()
	return nil
}

func (r *runner) Close() {
	if r.client != nil {
		r.client.Close()
	}
}

func (r *runner) handle(ctx context.Context, cmd ipc.CommandParams) {
	generated.DispatchEcho(ctx, r.client, r.log, cmd, r)
}

// HandlePing answers a ping command with the echoed message and this service name.
func (r *runner) HandlePing(
	_ context.Context,
	req generated.EchoPingInput,
) (generated.EchoPongOutput, error) {
	return generated.EchoPongOutput{Echo: req.Message, Service: ServiceName}, nil
}
