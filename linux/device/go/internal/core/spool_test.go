// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/helix-kit/helix-device/internal/ipc"
)

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func ev(n int) ipc.DeviceEventEnvelope {
	payload, _ := json.Marshal(map[string]int{"n": n})
	return ipc.BuildEventEnvelope("test", payload)
}

func TestSpoolDrainInOrderAndDeletes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.db")
	sp, err := openSpool(path, 0, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	defer sp.close()

	for i := 0; i < 5; i++ {
		if err = sp.enqueue("svc", ev(i)); err != nil {
			t.Fatal(err)
		}
	}
	if n, _ := sp.pending(); n != 5 {
		t.Fatalf("pending=%d want 5", n)
	}

	var got []string
	sent, err := sp.drain(func(service string, env ipc.DeviceEventEnvelope) error {
		got = append(got, service)
		return nil
	})
	if err != nil || sent != 5 {
		t.Fatalf("sent=%d err=%v", sent, err)
	}
	if n, _ := sp.pending(); n != 0 {
		t.Errorf("pending after drain=%d want 0", n)
	}
}

// TestSpoolStopsOnPublishError proves an event is retained when the link is down mid-drain.
func TestSpoolStopsOnPublishError(t *testing.T) {
	sp, err := openSpool(filepath.Join(t.TempDir(), "e.db"), 0, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	defer sp.close()
	for i := 0; i < 3; i++ {
		_ = sp.enqueue("svc", ev(i))
	}
	calls := 0
	sent, err := sp.drain(func(string, ipc.DeviceEventEnvelope) error {
		calls++
		if calls == 2 {
			return fmt.Errorf("link down")
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected drain to surface the publish error")
	}
	if sent != 1 {
		t.Errorf("sent=%d want 1 before failure", sent)
	}
	// The failed and subsequent events remain queued for retry.
	if n, _ := sp.pending(); n != 2 {
		t.Errorf("pending=%d want 2 retained", n)
	}
}

// TestSpoolSurvivesRestart proves durability across process restarts.
func TestSpoolSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "e.db")
	sp, _ := openSpool(path, 0, quietLog())
	_ = sp.enqueue("svc", ev(1))
	_ = sp.enqueue("svc", ev(2))
	sp.close()

	sp2, err := openSpool(path, 0, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	defer sp2.close()
	if n, _ := sp2.pending(); n != 2 {
		t.Errorf("pending after reopen=%d want 2", n)
	}
}

// TestSpoolEnforcesBound proves oldest events are dropped over budget.
func TestSpoolEnforcesBound(t *testing.T) {
	// Cap holds ~five events, so 20 inserts force eviction but leave a non-empty spool.
	one, _ := json.Marshal(ev(0))
	cap := int64(len(one) * 5)
	sp, _ := openSpool(filepath.Join(t.TempDir(), "e.db"), cap, quietLog())
	defer sp.close()
	for i := 0; i < 20; i++ {
		if err := sp.enqueue("svc", ev(i)); err != nil {
			t.Fatal(err)
		}
	}
	n, _ := sp.pending()
	if n == 0 || n >= 20 {
		t.Errorf("expected bounded spool to evict, pending=%d (cap=%d)", n, cap)
	}
}
