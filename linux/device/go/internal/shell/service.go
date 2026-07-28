// SPDX-License-Identifier: AGPL-3.0-only

// Package shell is the device-side remote-shell app; each data-plane stream is one PTY terminal.
package shell

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"

	"github.com/creack/pty"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/peer"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/dataplane"
	"github.com/helix-kit/helix-device/internal/shared/ipcutil"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
	"github.com/helix-kit/helix-device/internal/shell/generated"
	"github.com/helix-kit/helix-device/internal/stream"
)

// ServiceName is the Helix `message.service` for this app.
const ServiceName = generated.ShellService

type appConfig struct {
	Shell string `json:"shell"`
}

type winSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

type runner struct {
	cfg      *config.Config
	app      appConfig
	log      *slog.Logger
	client   *ipc.Client
	sessions *dataplane.Manager
	rootCtx  context.Context
}

// New builds the shell Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	r := &runner{cfg: cfg, log: log, sessions: dataplane.NewManager(cfg, log)}
	if err := cfg.AppSection(&r.app); err != nil {
		return nil, err
	}
	if r.app.Shell == "" {
		r.app.Shell = "/bin/bash"
	}
	return r, nil
}

func (r *runner) Run(ctx context.Context) error {
	r.rootCtx = ctx
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
	r.sessions.CloseAll()
	if r.client != nil {
		r.client.Close()
	}
}

func (r *runner) handle(ctx context.Context, cmd ipc.CommandParams) {
	generated.DispatchShell(ctx, r.client, r.log, cmd, r)
}

// HandleOpen opens one shell session's data plane and starts its accept loop.
func (r *runner) HandleOpen(
	_ context.Context,
	req generated.ShellOpenInput,
) (generated.ShellSessionOutput, error) {
	offer, err := r.sessions.Open(r.rootCtx, dataplane.OpenOptions{
		Params:        openParams(req),
		SendCandidate: r.candidateSender(req.SessionId),
		OnStream:      r.handleTerminal,
	})
	if err != nil {
		return generated.ShellSessionOutput{}, err
	}
	return generated.ShellSessionOutput{SessionId: req.SessionId, Offer: offer}, nil
}

func openParams(req generated.ShellOpenInput) dataplane.OpenParams {
	servers := make([]peer.ICEServer, 0, len(req.IceServers))
	for _, s := range req.IceServers {
		servers = append(servers, peer.ICEServer{
			URLs:       s.Urls,
			Username:   s.Username,
			Credential: s.Credential,
		})
	}
	return dataplane.OpenParams{
		SessionID:          req.SessionId,
		Transport:          req.Transport,
		DataURL:            req.DataUrl,
		Token:              req.Token,
		ICEServers:         servers,
		ICETransportPolicy: req.IceTransportPolicy,
	}
}

func (r *runner) candidateSender(sessionID string) func(string) {
	return func(candidate string) {
		ipcutil.Respond(r.client, r.log, "", dataplane.CandidateMethod, generated.ShellPeerCandidate{
			SessionId: sessionID,
			Candidate: candidate,
		})
	}
}

// HandleSignal carries the browser's half of the WebRTC handshake.
func (r *runner) HandleSignal(
	_ context.Context,
	req generated.ShellSignalInput,
) (generated.ShellSignalOutput, error) {
	if err := r.sessions.Signal(req.SessionId, req.Answer, req.Candidate); err != nil {
		return generated.ShellSignalOutput{}, err
	}
	return generated.ShellSignalOutput{SessionId: req.SessionId}, nil
}

// HandleClose cancels a shell session's stream (its accept loop tears down).
func (r *runner) HandleClose(
	_ context.Context,
	req generated.ShellCloseInput,
) (generated.ShellSessionOutput, error) {
	r.sessions.Close(req.SessionId)
	return generated.ShellSessionOutput{SessionId: req.SessionId}, nil
}

// HandleList reports every open shell session and its live terminal count.
func (r *runner) HandleList(
	_ context.Context,
	_ generated.ShellListInput,
) (generated.ShellSessionListOutput, error) {
	live := r.sessions.List()
	sessions := make([]generated.ShellSessionInfo, 0, len(live))
	for _, s := range live {
		sessions = append(sessions, generated.ShellSessionInfo{
			SessionId: s.ID,
			CreatedAt: int(s.CreatedAt.UnixMilli()),
			Terminals: s.Streams,
		})
	}
	return generated.ShellSessionListOutput{Sessions: sessions}, nil
}

func (r *runner) handleTerminal(st *stream.Stream) {
	size := winSize{Cols: 80, Rows: 24}
	if len(st.Meta()) > 0 {
		_ = json.Unmarshal(st.Meta(), &size)
	}
	cmd := exec.Command(r.app.Shell, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: size.Rows, Cols: size.Cols})
	if err != nil {
		r.log.Warn("pty start failed", "err", err)
		st.Reset("pty failed")
		return
	}

	go func() {
		for sig := range st.Signals() {
			var m struct {
				Type string `json:"type"`
				Cols uint16 `json:"cols"`
				Rows uint16 `json:"rows"`
			}
			if json.Unmarshal(sig, &m) == nil && m.Type == "resize" {
				_ = pty.Setsize(ptmx, &pty.Winsize{Rows: m.Rows, Cols: m.Cols})
			}
		}
	}()

	stream.Pipe(st, ptmx)
	_ = ptmx.Close()
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
}
