// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"context"
	"time"
)

const rotationInterval = 15 * time.Minute

// rotateLoop renews the device cert before expiry, forcing an MQTT reconnect on rotation.
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
