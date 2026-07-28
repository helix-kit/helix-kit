// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-metrics-linux is the baseline host-metrics provider (CPU, memory, load, root disk).
package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"

	"github.com/helix-kit/helix-device/internal/metricsplugin"
)

func main() {
	metrics := map[string]any{}
	if cpu, ok := cpuTimes(); ok {
		metrics["cpu"] = cpu
	}
	if mem, ok := memInfo(); ok {
		metrics["memory"] = mem
	}
	if load, ok := loadAvg(); ok {
		metrics["load"] = load
	}
	if disk, ok := rootDisk(); ok {
		metrics["disk"] = disk
	}
	if err := metricsplugin.Emit(metricsplugin.Output{
		Provider:        "linux",
		HardwareProfile: "generic-linux",
		Metrics:         metrics,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "helix-metrics-linux:", err)
		os.Exit(1)
	}
}

// cpuTimes reports aggregate CPU jiffies from /proc/stat; consumers compute utilization from deltas.
func cpuTimes() (map[string]any, bool) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return nil, false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var total, idle uint64
		for i, v := range fields[1:] {
			n, _ := strconv.ParseUint(v, 10, 64)
			total += n
			if i == 3 { // idle
				idle = n
			}
		}
		return map[string]any{"totalJiffies": total, "idleJiffies": idle}, true
	}
	return nil, false
}

func memInfo() (map[string]any, bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, false
	}
	defer f.Close()
	want := map[string]string{"MemTotal:": "totalBytes", "MemAvailable:": "availableBytes"}
	out := map[string]any{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		if key, ok := want[fields[0]]; ok {
			kb, _ := strconv.ParseInt(fields[1], 10, 64)
			out[key] = kb * 1024
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func loadAvg() (map[string]any, bool) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil, false
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return nil, false
	}
	f1, _ := strconv.ParseFloat(fields[0], 64)
	f5, _ := strconv.ParseFloat(fields[1], 64)
	f15, _ := strconv.ParseFloat(fields[2], 64)
	return map[string]any{"1m": f1, "5m": f5, "15m": f15}, true
}

func rootDisk() (map[string]any, bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return nil, false
	}
	bsize := uint64(st.Bsize)
	total := st.Blocks * bsize
	free := st.Bavail * bsize
	return map[string]any{"totalBytes": total, "availableBytes": free}, true
}
