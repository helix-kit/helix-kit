// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // pure-Go driver; keeps CGO_ENABLED=0

	"github.com/helix-kit/helix-device/internal/ipc"
)

// spool is helixd's durable at-least-once store-and-forward buffer for outbound events.
type spool struct {
	db       *sql.DB
	log      *slog.Logger
	maxBytes int64
}

func openSpool(path string, maxBytes int64, log *slog.Logger) (*spool, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // single writer; avoids SQLITE_BUSY under WAL
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service TEXT NOT NULL,
		payload BLOB NOT NULL,
		created_at INTEGER NOT NULL
	)`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &spool{db: db, log: log, maxBytes: maxBytes}, nil
}

func (s *spool) enqueue(service string, env ipc.DeviceEventEnvelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(
		`INSERT INTO events (service, payload, created_at) VALUES (?, ?, strftime('%s','now'))`,
		service, body); err != nil {
		return err
	}
	return s.enforceBound()
}

func (s *spool) enforceBound() error {
	if s.maxBytes <= 0 {
		return nil
	}
	var total int64
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(LENGTH(payload)),0) FROM events`).Scan(&total); err != nil {
		return err
	}
	for total > s.maxBytes {
		res, err := s.db.Exec(`DELETE FROM events WHERE id = (SELECT MIN(id) FROM events)`)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			break
		}
		s.log.Warn("event spool over budget, dropped oldest event")
		if err := s.db.QueryRow(`SELECT COALESCE(SUM(LENGTH(payload)),0) FROM events`).Scan(&total); err != nil {
			return err
		}
	}
	return nil
}

func (s *spool) pending() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM events`).Scan(&n)
	return n, err
}

type publishFunc func(service string, env ipc.DeviceEventEnvelope) error

// drain publishes spooled events in order, stopping at the first publish error.
func (s *spool) drain(pub publishFunc) (int, error) {
	rows, err := s.db.Query(`SELECT id, service, payload FROM events ORDER BY id ASC`)
	if err != nil {
		return 0, err
	}
	type row struct {
		id      int64
		service string
		payload []byte
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.service, &r.payload); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()

	sent := 0
	for _, r := range batch {
		var env ipc.DeviceEventEnvelope
		if err := json.Unmarshal(r.payload, &env); err != nil {
			// Corrupt row: drop it so it can't wedge the queue.
			_, _ = s.db.Exec(`DELETE FROM events WHERE id = ?`, r.id)
			continue
		}
		if err := pub(r.service, env); err != nil {
			return sent, err
		}
		if _, err := s.db.Exec(`DELETE FROM events WHERE id = ?`, r.id); err != nil {
			return sent, err
		}
		sent++
	}
	return sent, nil
}

func (s *spool) close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}
