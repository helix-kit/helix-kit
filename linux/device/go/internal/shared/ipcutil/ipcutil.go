// SPDX-License-Identifier: AGPL-3.0-only

// Package ipcutil is the thin app-side glue over an ipc.Client: it decodes
// inbound command notifications and provides reply/error/emit helpers so an app
// never touches raw frames or the Helix wire format.
package ipcutil

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/helix-kit/helix-device/internal/ipc"
)

// CommandHandler handles one inbound cloud command for a service.
type CommandHandler func(ctx context.Context, cmd ipc.CommandParams)

// DispatchCommands pumps a client's notification stream into a handler until
// ctx is done or the stream closes.
func DispatchCommands(ctx context.Context, notifications <-chan ipc.Notification, handler CommandHandler) {
	for {
		select {
		case <-ctx.Done():
			return
		case n, ok := <-notifications:
			if !ok {
				return
			}
			if n.Method != ipc.NotifyCommand {
				continue
			}
			var cmd ipc.CommandParams
			if json.Unmarshal(n.Params, &cmd) == nil {
				handler(ctx, cmd)
			}
		}
	}
}

// Respond publishes a response (method + payload) correlated to requestID.
func Respond(client *ipc.Client, log *slog.Logger, requestID, method string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Warn("respond marshal failed", "method", method, "err", err)
		return
	}
	if err := client.Respond(requestID, method, raw); err != nil {
		log.Warn("respond failed", "method", method, "err", err)
	}
}

// RespondError sends a `<service>-error` response with the requestId + message.
func RespondError(client *ipc.Client, log *slog.Logger, requestID, service, message string) {
	Respond(client, log, requestID, service+"-error", map[string]string{
		"requestId": requestID,
		"error":     message,
	})
}
