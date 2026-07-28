// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/pkg"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/ipcutil"
)

// Controller executes runtime-manager's control operations. The same Controller
// backs both the local control socket (trusted CLI) and the cloud-facing
// `runtime` IPC service (untrusted — subject to per-service AllowControl gates).
type Controller struct {
	sd        Systemd
	collector *Collector
	log       *slog.Logger
}

// NewController builds a controller over the given systemd driver. The collector
// (metrics) may be nil, in which case get-status/get-metrics sample on demand.
func NewController(sd Systemd, collector *Collector, log *slog.Logger) *Controller {
	return &Controller{sd: sd, collector: collector, log: log}
}

// snapshot returns the cached metrics snapshot, or a one-shot sample when no
// collector is wired (e.g. in tests).
func (c *Controller) snapshot(ctx context.Context) Snapshot {
	col := c.collector
	if col == nil {
		col = NewCollector(c.sd, config.Metrics{})
	}
	return col.Snapshot(ctx)
}

// Handle dispatches one control request. trusted callers bypass the AllowControl
// gates; cloud callers do not.
func (c *Controller) Handle(method string, params json.RawMessage, trusted bool) (json.RawMessage, error) {
	switch method {
	case "get-status":
		return marshal(c.snapshot(context.Background())), nil
	case "get-metrics":
		return marshal(c.snapshot(context.Background()).Host), nil
	case "list-packages":
		db, err := pkg.LoadDB()
		if err != nil {
			return nil, err
		}
		return marshal(db.List()), nil
	case "reconcile":
		return marshal(map[string]bool{"ok": true}), Reconcile(c.sd, c.log)
	case "install-package":
		var p struct {
			Path   string `json:"path"`
			SHA256 string `json:"sha256"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		m, err := InstallPackage(c.sd, p.Path, p.SHA256, c.log)
		if err != nil {
			return nil, err
		}
		return marshal(map[string]string{"name": m.Name, "version": m.Version}), nil
	case "remove-package":
		var p struct {
			Name  string `json:"name"`
			Purge bool   `json:"purge"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return marshal(map[string]bool{"ok": true}), RemovePackage(c.sd, p.Name, p.Purge, c.log)
	case "start-service", "stop-service", "restart-service":
		var p struct {
			Service string `json:"service"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return marshal(map[string]bool{"ok": true}), c.serviceAction(method, p.Service, trusted)
	case "put-config":
		var p struct {
			Service string          `json:"service"`
			Section json.RawMessage `json:"section"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := c.gateControl(p.Service, trusted); err != nil {
			return nil, err
		}
		return marshal(map[string]bool{"ok": true}), PutConfig(c.sd, p.Service, p.Section, c.log)
	case "get-config":
		var p struct {
			Service string `json:"service"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return GetConfig(p.Service)
	default:
		return nil, fmt.Errorf("unknown method %q", method)
	}
}

func (c *Controller) serviceAction(method, service string, trusted bool) error {
	if err := c.gateControl(service, trusted); err != nil {
		return err
	}
	unit, ok := resolveUnit(service)
	if !ok {
		return fmt.Errorf("unknown service %q", service)
	}
	switch method {
	case "start-service":
		return c.sd.Start(unit)
	case "stop-service":
		return c.sd.Stop(unit)
	case "restart-service":
		return c.sd.Restart(unit)
	}
	return fmt.Errorf("unknown action %q", method)
}

// gateControl enforces a service's AllowControl flag for untrusted (cloud)
// callers. Core services and the trusted local socket are always allowed.
func (c *Controller) gateControl(service string, trusted bool) error {
	if trusted {
		return nil
	}
	if _, isCore := coreServices[service]; isCore {
		return nil
	}
	desired, err := loadDesired()
	if err != nil {
		return err
	}
	for i := range desired {
		if desired[i].Name == service {
			if !desired[i].AllowControl {
				return fmt.Errorf("service %q does not allow remote control", service)
			}
			return nil
		}
	}
	return fmt.Errorf("unknown service %q", service)
}

// ServeControlSocket runs the local control socket (trusted). The CLI connects
// here to drive install/remove/status/config on the device.
func (c *Controller) ServeControlSocket(ctx context.Context) error {
	path := config.RuntimeSocketPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	_ = os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	_ = os.Chmod(path, 0o660)
	go func() { <-ctx.Done(); _ = ln.Close() }()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go c.serveControlConn(conn)
	}
}

type ctrlRequest struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type ctrlResponse struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

func (c *Controller) serveControlConn(conn net.Conn) {
	defer conn.Close()
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 64*1024), ipc.MaxMessageBytes)
	for sc.Scan() {
		var req ctrlRequest
		resp := ctrlResponse{OK: true}
		if err := json.Unmarshal(sc.Bytes(), &req); err != nil {
			resp = ctrlResponse{Error: err.Error()}
		} else if result, err := c.Handle(req.Method, req.Params, true); err != nil {
			resp = ctrlResponse{Error: err.Error()}
		} else {
			resp.Result = result
		}
		out, _ := json.Marshal(resp)
		out = append(out, '\n')
		if _, err := conn.Write(out); err != nil {
			return
		}
	}
}

// registerRuntimeService registers as the `runtime` service on helixd's IPC bus
// so cloud requests on helix/device/<id>/in for service "runtime" route here.
// Cloud calls are untrusted, so AllowControl gates apply.
func (c *Controller) registerRuntimeService(ctx context.Context, socketPath string) {
	client := ipc.NewClient(socketPath, "runtime", c.log)
	client.Start()
	if err := client.WaitUntilConnected(ctx); err != nil {
		return
	}
	ipcutil.DispatchCommands(ctx, client.Notifications(), func(ctx context.Context, cmd ipc.CommandParams) {
		result, err := c.Handle(cmd.Method, cmd.Payload, false)
		if err != nil {
			ipcutil.RespondError(client, c.log, cmd.RequestID, "runtime", err.Error())
			return
		}
		if err := client.Respond(cmd.RequestID, cmd.Method+"-result", result); err != nil {
			c.log.Warn("runtime respond failed", "err", err)
		}
	})
}

func marshal(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
