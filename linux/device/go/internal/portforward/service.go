// SPDX-License-Identifier: AGPL-3.0-only

// Package portforward is the device-side port-forwarding app. Control
// (open/close/list a forwarding session) arrives over IPC as Helix commands;
// the actual bytes flow over a separate HelixStream data-plane connection this
// app dials to the gateway. On each stream the gateway opens, it dials the
// session's allow-listed local target and pipes raw bytes.
package portforward

import (
	"context"
	"fmt"
	"log/slog"
	"net"

	"time"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/peer"
	"github.com/helix-kit/helix-device/internal/portforward/generated"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/dataplane"
	"github.com/helix-kit/helix-device/internal/shared/ipcutil"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
	"github.com/helix-kit/helix-device/internal/stream"
)

// ServiceName is the Helix `message.service` for this app.
const ServiceName = generated.PortForwardService

// appConfig is this app's section of the device config (apps."port-forward").
type appConfig struct {
	AllowedTargets []string `json:"allowedTargets"`
}

type runner struct {
	cfg      *config.Config
	app      appConfig
	log      *slog.Logger
	client   *ipc.Client
	allowed  map[string]struct{}
	sessions *dataplane.Manager
	rootCtx  context.Context
}

// New builds the port-forward Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	r := &runner{
		cfg:      cfg,
		log:      log,
		allowed:  map[string]struct{}{},
		sessions: dataplane.NewManager(cfg, log),
	}
	if err := cfg.AppSection(&r.app); err != nil {
		return nil, err
	}
	for _, t := range r.app.AllowedTargets {
		r.allowed[t] = struct{}{}
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
	generated.DispatchPortForward(ctx, r.client, r.log, cmd, r)
}

// HandleOpen opens the data plane for one forwarding session (to an allow-listed
// target) — relayed or peer-to-peer — and starts its accept loop; each stream is
// piped to a fresh dial. On the p2p path it returns as soon as the SDP offer
// exists, since the browser needs the offer before it can answer.
func (r *runner) HandleOpen(
	_ context.Context,
	req generated.PortForwardOpenInput,
) (generated.PortForwardSessionOutput, error) {
	if _, ok := r.allowed[req.Target]; !ok {
		return generated.PortForwardSessionOutput{}, fmt.Errorf("target not allowed: %s", req.Target)
	}
	target := req.Target
	offer, err := r.sessions.Open(r.rootCtx, dataplane.OpenOptions{
		Params:        openParams(req),
		Meta:          target,
		SendCandidate: r.candidateSender(req.SessionId),
		OnStream:      func(st *stream.Stream) { r.handleStream(target, st) },
	})
	if err != nil {
		return generated.PortForwardSessionOutput{}, err
	}
	r.log.Info("tunnel opened", "session", req.SessionId, "target", target, "transport", req.Transport)
	return generated.PortForwardSessionOutput{SessionId: req.SessionId, Offer: offer}, nil
}

// openParams maps this service's generated contract types onto the transport's.
func openParams(req generated.PortForwardOpenInput) dataplane.OpenParams {
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

// candidateSender trickles a locally-gathered ICE candidate back to the browser
// as an unsolicited response (empty requestId); the gateway routes it to the
// connection that owns this session.
func (r *runner) candidateSender(sessionID string) func(string) {
	return func(candidate string) {
		ipcutil.Respond(
			r.client, r.log, "", dataplane.CandidateMethod,
			generated.PortForwardPeerCandidate{SessionId: sessionID, Candidate: candidate},
		)
	}
}

// HandleSignal carries the browser's half of the WebRTC handshake: its SDP answer
// and its trickled ICE candidates.
func (r *runner) HandleSignal(
	_ context.Context,
	req generated.PortForwardSignalInput,
) (generated.PortForwardSignalOutput, error) {
	if err := r.sessions.Signal(req.SessionId, req.Answer, req.Candidate); err != nil {
		return generated.PortForwardSignalOutput{}, err
	}
	return generated.PortForwardSignalOutput{SessionId: req.SessionId}, nil
}

func (r *runner) handleStream(target string, st *stream.Stream) {
	conn, err := net.DialTimeout("tcp", target, 5*time.Second)
	if err != nil {
		r.log.Warn("target dial failed", "target", target, "err", err)
		st.Reset("dial failed")
		return
	}
	stream.Pipe(st, conn)
}

// HandleClose cancels a forwarding session (its accept loop tears down).
func (r *runner) HandleClose(
	_ context.Context,
	req generated.PortForwardCloseInput,
) (generated.PortForwardSessionOutput, error) {
	r.sessions.Close(req.SessionId)
	return generated.PortForwardSessionOutput{SessionId: req.SessionId}, nil
}

// HandleList reports every open forwarding tunnel: its target, age, and the
// number of connections currently piped over it.
func (r *runner) HandleList(
	_ context.Context,
	_ generated.PortForwardListInput,
) (generated.PortForwardSessionListOutput, error) {
	live := r.sessions.List()
	sessions := make([]generated.PortForwardSessionInfo, 0, len(live))
	for _, s := range live {
		target, _ := s.Meta.(string)
		sessions = append(sessions, generated.PortForwardSessionInfo{
			SessionId:   s.ID,
			Target:      target,
			CreatedAt:   int(s.CreatedAt.UnixMilli()),
			Connections: s.Streams,
		})
	}
	return generated.PortForwardSessionListOutput{Sessions: sessions}, nil
}
