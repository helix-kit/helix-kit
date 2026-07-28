// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// clkTck is the kernel USER_HZ (100 on Helix targets); fixed here because reading it needs cgo (sysconf), which static builds disable.
const clkTck = 100.0

// ServiceMetrics is one managed service's health + resource sample (systemd state + /proc/<MainPID>).
type ServiceMetrics struct {
	Name        string  `json:"name"`
	Enabled     bool    `json:"enabled"`
	ActiveState string  `json:"activeState"`
	SubState    string  `json:"subState"`
	MainPID     int     `json:"mainPid"`
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryBytes int64   `json:"memoryBytes"`
	UptimeSec   int64   `json:"uptimeSec"`
}

// Snapshot is the cached metrics view returned by get-status / get-metrics.
type Snapshot struct {
	CollectedAt int64            `json:"collectedAt"`
	Services    []ServiceMetrics `json:"services"`
	Host        HostMetrics      `json:"host"`
}

// Collector samples service + host metrics on an interval and caches the latest snapshot.
type Collector struct {
	sd      Systemd
	procDir string
	cfg     config.Metrics
	now     func() time.Time

	mu   sync.Mutex
	prev map[int]cpuSample
	snap Snapshot
}

type cpuSample struct {
	ticks uint64
	at    time.Time
}

// NewCollector builds a metrics collector reading the real /proc.
func NewCollector(sd Systemd, cfg config.Metrics) *Collector {
	return &Collector{
		sd:      sd,
		procDir: filepath.Join(config.Root(), "proc"),
		cfg:     cfg,
		now:     time.Now,
		prev:    map[int]cpuSample{},
	}
}

// Snapshot returns the latest cached snapshot, sampling once if none exists yet.
func (c *Collector) Snapshot(ctx context.Context) Snapshot {
	c.mu.Lock()
	has := c.snap.CollectedAt != 0
	c.mu.Unlock()
	if !has {
		c.Sample(ctx)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snap
}

// Loop samples until ctx is done.
func (c *Collector) Loop(ctx context.Context) {
	interval := time.Duration(c.cfg.IntervalSec) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	c.Sample(ctx)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.Sample(ctx)
		}
	}
}

// Sample computes a fresh snapshot and caches it.
func (c *Collector) Sample(ctx context.Context) {
	desired, err := loadDesired()
	if err != nil {
		return
	}
	services := make([]ServiceMetrics, 0, len(desired))
	live := map[int]bool{}
	for i := range desired {
		d := &desired[i]
		st, _ := c.sd.Show(d.UnitName())
		m := ServiceMetrics{
			Name: d.Name, Enabled: d.Enabled,
			ActiveState: st.ActiveState, SubState: st.SubState, MainPID: st.MainPID,
		}
		if st.MainPID > 0 {
			live[st.MainPID] = true
			m.CPUPercent = c.cpuPercent(st.MainPID)
			m.MemoryBytes = c.readRSS(st.MainPID)
			m.UptimeSec = c.uptime(st.MainPID)
		}
		services = append(services, m)
	}
	c.pruneCPU(live)

	host := runProviders(ctx, c.cfg)

	c.mu.Lock()
	c.snap = Snapshot{CollectedAt: c.now().Unix(), Services: services, Host: host}
	c.mu.Unlock()
}

// cpuPercent returns the process CPU% since the previous sample (0 on first).
func (c *Collector) cpuPercent(pid int) float64 {
	ticks, ok := c.readCPUTicks(pid)
	if !ok {
		return 0
	}
	now := c.now()
	c.mu.Lock()
	prev, had := c.prev[pid]
	c.prev[pid] = cpuSample{ticks: ticks, at: now}
	c.mu.Unlock()
	if !had {
		return 0
	}
	elapsed := now.Sub(prev.at).Seconds()
	if elapsed <= 0 || ticks < prev.ticks {
		return 0
	}
	return float64(ticks-prev.ticks) / clkTck / elapsed * 100.0
}

func (c *Collector) pruneCPU(live map[int]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for pid := range c.prev {
		if !live[pid] {
			delete(c.prev, pid)
		}
	}
}

// readCPUTicks returns utime+stime from /proc/<pid>/stat, read after the final ')' (comm may contain spaces/parens).
func (c *Collector) readCPUTicks(pid int) (uint64, bool) {
	data, err := os.ReadFile(filepath.Join(c.procDir, strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0, false
	}
	fields, ok := statFieldsAfterComm(string(data))
	if !ok || len(fields) < 13 {
		return 0, false
	}
	// After ')': fields[0]=state(3) ... utime=field14=fields[11], stime=field15=fields[12].
	utime, err1 := strconv.ParseUint(fields[11], 10, 64)
	stime, err2 := strconv.ParseUint(fields[12], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return utime + stime, true
}

// uptime returns process uptime in seconds (system uptime - process starttime).
func (c *Collector) uptime(pid int) int64 {
	data, err := os.ReadFile(filepath.Join(c.procDir, strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0
	}
	fields, ok := statFieldsAfterComm(string(data))
	if !ok || len(fields) < 20 {
		return 0
	}
	startTicks, err := strconv.ParseUint(fields[19], 10, 64) // starttime=field22=fields[19]
	if err != nil {
		return 0
	}
	sysUp := c.systemUptime()
	procStart := float64(startTicks) / clkTck
	if up := sysUp - procStart; up > 0 {
		return int64(up)
	}
	return 0
}

func (c *Collector) systemUptime() float64 {
	data, err := os.ReadFile(filepath.Join(c.procDir, "uptime"))
	if err != nil {
		return 0
	}
	first, _, _ := strings.Cut(strings.TrimSpace(string(data)), " ")
	v, _ := strconv.ParseFloat(first, 64)
	return v
}

// readRSS returns resident memory in bytes from /proc/<pid>/status VmRSS.
func (c *Collector) readRSS(pid int) int64 {
	f, err := os.Open(filepath.Join(c.procDir, strconv.Itoa(pid), "status"))
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				kb, _ := strconv.ParseInt(f[1], 10, 64)
				return kb * 1024
			}
		}
	}
	return 0
}

// statFieldsAfterComm splits a /proc/<pid>/stat line into the fields after the parenthesized comm field.
func statFieldsAfterComm(stat string) ([]string, bool) {
	i := strings.LastIndex(stat, ")")
	if i < 0 || i+2 > len(stat) {
		return nil, false
	}
	return strings.Fields(stat[i+2:]), true
}
