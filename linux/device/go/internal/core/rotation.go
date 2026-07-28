// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"context"
	"time"
)

// rotationInterval is how often helixd checks whether its leaf needs renewal.
const rotationInterval = 15 * time.Minute

// rotateLoop periodically renews the device certificate before it expires. When
// a new cert is issued it forces an MQTT reconnect so the new credential is
// presented. It runs only when enrollment is configured.
func (s *service) rotateLoop(ctx context.Context) {
	ticker := time.NewTicker(rotationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rotated, err := s.enroller.ensure()
			if err != nil {
				s.log.Warn("certificate rotation failed", "err", err)
				continue
			}
			if rotated {
				s.log.Info("certificate rotated; reconnecting mqtt")
				s.mqtt.reloadTLS()
			}
		}
	}
}
