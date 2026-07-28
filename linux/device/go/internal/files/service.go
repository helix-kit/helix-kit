// SPDX-License-Identifier: AGPL-3.0-only

// Package files is the device-side file-browser app.
//
// Control (open/close a session, list a directory) arrives over IPC as Helix
// commands. The bytes ride the data plane: each stream the far end opens is ONE
// transfer, described by the stream's meta blob — so many files move in parallel
// over a single session, each with its own credit-based flow control, for free
// from the mux.
//
// It is transport-agnostic like every other stream app: the same code serves a
// relayed session and a peer-to-peer one. P2P is the interesting case here —
// bulk file bytes are exactly what you do not want to pay cloud bandwidth for.
package files

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/helix-kit/helix-device/internal/files/generated"
	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/peer"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/dataplane"
	"github.com/helix-kit/helix-device/internal/shared/ipcutil"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
	"github.com/helix-kit/helix-device/internal/stream"
)

// ServiceName is the Helix `message.service` for this app.
const ServiceName = generated.FilesService

// Transfer operations, carried in a stream's meta blob.
const (
	opGet = "get"
	opPut = "put"
)

// appConfig is this app's section of the device config (apps.files).
type appConfig struct {
	// Roots the browser may see. Everything outside them is invisible; there is no
	// default, so an unconfigured app serves nothing rather than the whole disk.
	Roots []string `json:"roots"`
}

type runner struct {
	cfg      *config.Config
	log      *slog.Logger
	client   *ipc.Client
	roots    []string
	sessions *dataplane.Manager
	rootCtx  context.Context
}

// New builds the files Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	r := &runner{cfg: cfg, log: log, sessions: dataplane.NewManager(cfg, log)}
	var app appConfig
	if err := cfg.AppSection(&app); err != nil {
		return nil, err
	}
	roots, err := resolveRoots(app.Roots)
	if err != nil {
		return nil, err
	}
	r.roots = roots
	return r, nil
}

func (r *runner) Run(ctx context.Context) error {
	r.rootCtx = ctx
	r.client = ipc.NewClient(r.cfg.IPC.SocketPath, ServiceName, r.log)
	r.client.Start()
	if err := r.client.WaitUntilConnected(ctx); err != nil {
		return err
	}
	r.log.Info("files app ready", "roots", r.roots)
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
	generated.DispatchFiles(ctx, r.client, r.log, cmd, r)
}

// HandleOpen opens the session's data plane (relayed or peer-to-peer) and starts
// its accept loop. On the p2p path it returns as soon as the SDP offer exists.
func (r *runner) HandleOpen(
	_ context.Context,
	req generated.FilesOpenInput,
) (generated.FilesSessionOutput, error) {
	offer, err := r.sessions.Open(r.rootCtx, dataplane.OpenOptions{
		Params:        openParams(req),
		SendCandidate: r.candidateSender(req.SessionId),
		OnStream:      r.handleTransfer,
	})
	if err != nil {
		return generated.FilesSessionOutput{}, err
	}
	return generated.FilesSessionOutput{SessionId: req.SessionId, Offer: offer}, nil
}

// openParams maps this service's generated contract types onto the transport's.
func openParams(req generated.FilesOpenInput) dataplane.OpenParams {
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

// candidateSender trickles a locally-gathered ICE candidate back to the browser as
// an unsolicited response; the gateway routes it to the session's owner.
func (r *runner) candidateSender(sessionID string) func(string) {
	return func(candidate string) {
		ipcutil.Respond(
			r.client, r.log, "", dataplane.CandidateMethod,
			generated.FilesPeerCandidate{SessionId: sessionID, Candidate: candidate},
		)
	}
}

// HandleSignal carries the browser's half of the WebRTC handshake.
func (r *runner) HandleSignal(
	_ context.Context,
	req generated.FilesSignalInput,
) (generated.FilesSignalOutput, error) {
	if err := r.sessions.Signal(req.SessionId, req.Answer, req.Candidate); err != nil {
		return generated.FilesSignalOutput{}, err
	}
	return generated.FilesSignalOutput{SessionId: req.SessionId}, nil
}

// HandleClose tears a session down.
func (r *runner) HandleClose(
	_ context.Context,
	req generated.FilesCloseInput,
) (generated.FilesSessionOutput, error) {
	r.sessions.Close(req.SessionId)
	return generated.FilesSessionOutput{SessionId: req.SessionId}, nil
}

// HandleRoots reports the directories this device is willing to expose, so the
// browser knows where it may start rather than guessing.
func (r *runner) HandleRoots(
	_ context.Context,
	_ generated.FilesRootsInput,
) (generated.FilesRootsOutput, error) {
	return generated.FilesRootsOutput{Roots: append([]string(nil), r.roots...)}, nil
}

// HandleList reads one directory. Listings are small and structured, so they ride
// the control plane; only file BYTES go on the data plane.
func (r *runner) HandleList(
	_ context.Context,
	req generated.FilesListInput,
) (generated.FilesListOutput, error) {
	dir, err := r.resolve(req.Path)
	if err != nil {
		return generated.FilesListOutput{}, err
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return generated.FilesListOutput{}, err
	}

	entries := make([]generated.FilesFileEntry, 0, len(items))
	for _, item := range items {
		info, infoErr := item.Info()
		if infoErr != nil {
			continue // vanished between ReadDir and Info; just omit it
		}
		entries = append(entries, generated.FilesFileEntry{
			Name:       item.Name(),
			Path:       filepath.Join(dir, item.Name()),
			Size:       int(info.Size()),
			IsDir:      item.IsDir(),
			ModifiedAt: int(info.ModTime().UnixMilli()),
		})
	}
	// Directories first, then by name — the ordering a file browser wants, done
	// here so every client does not have to reimplement it.
	sort.Slice(entries, func(a, b int) bool {
		if entries[a].IsDir != entries[b].IsDir {
			return entries[a].IsDir
		}
		return entries[a].Name < entries[b].Name
	})

	out := generated.FilesListOutput{Path: dir, Entries: entries}
	// Offer a parent only while it stays inside a root, so the browser cannot walk
	// out of the allow-list by following it.
	if parent := filepath.Dir(dir); parent != dir {
		if _, err := r.resolve(parent); err == nil {
			out.Parent = parent
		}
	}
	return out, nil
}

// handleTransfer serves one stream: one file, in one direction. The stream's meta
// says which file and which way; after that it is raw bytes, so a transfer moves at
// the transport's speed with no per-chunk framing of our own.
func (r *runner) handleTransfer(st *stream.Stream) {
	var meta generated.FilesTransferMeta
	if err := json.Unmarshal(st.Meta(), &meta); err != nil {
		st.Reset("bad transfer meta")
		return
	}
	path, err := r.resolve(meta.Path)
	if err != nil {
		r.log.Warn("files transfer rejected", "path", meta.Path, "err", err)
		st.Reset(ErrOutsideRoots.Error())
		return
	}

	switch meta.Op {
	case opGet:
		r.sendFile(st, path)
	case opPut:
		r.receiveFile(st, path)
	default:
		st.Reset("unknown transfer op")
	}
}

func (r *runner) sendFile(st *stream.Stream, path string) {
	file, err := os.Open(path)
	if err != nil {
		r.log.Warn("files open failed", "path", path, "err", err)
		st.Reset("cannot read file")
		return
	}
	defer func() { _ = file.Close() }()

	// io.Copy streams straight from disk into the mux — the credit window supplies
	// the backpressure, so a big file never buffers in memory on either side.
	if _, err := io.Copy(st, file); err != nil && !errors.Is(err, io.EOF) {
		r.log.Warn("files send failed", "path", path, "err", err)
		st.Reset("send failed")
		return
	}
	// Half-close: EOF for the reader, while the stream stays open for its ack.
	_ = st.CloseWrite()
	r.log.Info("files sent", "path", path)
}

func (r *runner) receiveFile(st *stream.Stream, path string) {
	// Write to a temp file in the destination directory and rename on success, so a
	// failed or aborted upload never leaves a half-written file at the real path.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".helix-upload-*")
	if err != nil {
		r.log.Warn("files temp create failed", "path", path, "err", err)
		st.Reset("cannot write file")
		return
	}
	tmpName := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}

	if _, err := io.Copy(tmp, st); err != nil {
		r.log.Warn("files receive failed", "path", path, "err", err)
		cleanup()
		st.Reset("receive failed")
		return
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		st.Reset("write failed")
		return
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		r.log.Warn("files rename failed", "path", path, "err", err)
		st.Reset("write failed")
		return
	}
	_ = st.CloseWrite()
	r.log.Info("files received", "path", path)
}
