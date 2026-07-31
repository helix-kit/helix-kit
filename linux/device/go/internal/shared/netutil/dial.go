// SPDX-License-Identifier: AGPL-3.0-only

// Package netutil dials the cloud without letting a slow resolver stall the device.
package netutil

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"sync"
	"time"
)

// A fleet device sits on a network we do not control, and a resolver that is slow to
// answer AAAA is common: measured on a Radxa A733, the site's router answered A in
// 0.15s but took 5.1s to say "no AAAA record", and Go's resolver (helixd is CGO_ENABLED=0)
// retries, so every dial cost ~10s while TCP+TLS together cost 0.09s. Waiting on both
// families is the whole bug, so resolve them concurrently and stop waiting for IPv6
// once IPv4 has an answer.

const (
	// How long a successful resolution is reused. Long enough that a burst of sessions
	// resolves once; short enough to follow a cloud IP change without a restart.
	defaultTTL = 5 * time.Minute
	// How long IPv4 waits for IPv6 after answering. Enough for a healthy dual-stack
	// resolver to win the race, far below a broken one's multi-second timeout.
	defaultGrace = 150 * time.Millisecond
	// Per-address connect budget, so one black-holed address cannot consume the dial.
	defaultAttempt = 10 * time.Second
)

// ErrNoAddresses reports that a host resolved to nothing usable.
var ErrNoAddresses = errors.New("host resolved to no addresses")

type lookupFunc func(ctx context.Context, network, host string) ([]net.IP, error)

type entry struct {
	addrs   []net.IP
	expires time.Time
}

// Dialer resolves and connects with a bounded tolerance for a slow resolver, caching
// what it learns. The zero value is not usable; call New.
type Dialer struct {
	ttl     time.Duration
	grace   time.Duration
	attempt time.Duration
	lookup  lookupFunc
	now     func() time.Time

	mu    sync.Mutex
	cache map[string]entry
}

// New builds a Dialer backed by the system resolver.
func New() *Dialer {
	resolver := &net.Resolver{}
	return &Dialer{
		ttl:     defaultTTL,
		grace:   defaultGrace,
		attempt: defaultAttempt,
		now:     time.Now,
		cache:   map[string]entry{},
		lookup: func(ctx context.Context, network, host string) ([]net.IP, error) {
			addrs, err := resolver.LookupIP(ctx, network, host)
			return addrs, err
		},
	}
}

var (
	shared     *Dialer
	sharedOnce sync.Once
)

// Shared is the process-wide Dialer, so every connection a service opens reuses one
// resolution cache.
func Shared() *Dialer {
	sharedOnce.Do(func() { shared = New() })
	return shared
}

type result struct {
	addrs []net.IP
	err   error
}

// Addrs resolves host, IPv6 first, without blocking on IPv6 once IPv4 has answered.
func (d *Dialer) Addrs(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	if addrs, ok := d.cached(host); ok {
		return addrs, nil
	}

	v6, v4 := make(chan result, 1), make(chan result, 1)
	go func() {
		addrs, err := d.lookup(ctx, "ip6", host)
		v6 <- result{addrs, err}
	}()
	go func() {
		addrs, err := d.lookup(ctx, "ip4", host)
		v4 <- result{addrs, err}
	}()

	addrs, err := d.race(ctx, v6, v4)
	if err != nil {
		return nil, err
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("%w: %s", ErrNoAddresses, host)
	}
	d.store(host, addrs)
	return addrs, nil
}

// race collects both families, giving up on the slower one after the grace period.
func (d *Dialer) race(ctx context.Context, v6, v4 <-chan result) ([]net.IP, error) {
	var got6, got4 result
	var have6, have4 bool

	for !have6 || !have4 {
		var timeout <-chan time.Time
		// Only start the clock once one family is in hand: before that there is
		// nothing to fall back to and we must wait for a real answer.
		if have4 && len(got4.addrs) > 0 || have6 && len(got6.addrs) > 0 {
			timer := time.NewTimer(d.grace)
			defer timer.Stop()
			timeout = timer.C
		}
		select {
		case got6 = <-v6:
			have6 = true
		case got4 = <-v4:
			have4 = true
		case <-timeout:
			return append(got6.addrs, got4.addrs...), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	// Both families failed: surface whichever error we have.
	if len(got6.addrs) == 0 && len(got4.addrs) == 0 {
		if got4.err != nil {
			return nil, got4.err
		}
		return nil, got6.err
	}
	return append(got6.addrs, got4.addrs...), nil
}

func (d *Dialer) cached(host string) ([]net.IP, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	found, ok := d.cache[host]
	if !ok || d.now().After(found.expires) {
		return nil, false
	}
	return found.addrs, true
}

func (d *Dialer) store(host string, addrs []net.IP) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cache[host] = entry{addrs: addrs, expires: d.now().Add(d.ttl)}
}

// Forget drops any cached resolution for host, so the next dial resolves afresh.
func (d *Dialer) Forget(host string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.cache, host)
}

// DialContext resolves addr and connects to the first address that accepts, so a
// published-but-unreachable family costs one attempt rather than the whole dial.
func (d *Dialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	addrs, err := d.Addrs(ctx, host)
	if err != nil {
		return nil, err
	}

	var last error
	for _, ip := range addrs {
		attemptCtx, cancel := context.WithTimeout(ctx, d.attempt)
		conn, err := (&net.Dialer{}).DialContext(attemptCtx, network, net.JoinHostPort(ip.String(), port))
		cancel()
		if err == nil {
			return conn, nil
		}
		last = err
		if ctx.Err() != nil {
			break
		}
	}
	if last == nil {
		last = fmt.Errorf("%w: %s", ErrNoAddresses, host)
	}
	// The cached set just failed end to end; re-resolve next time rather than pinning
	// the device to an address the cloud has moved off.
	d.Forget(host)
	return nil, last
}

// brokerPorts is the default port per MQTT scheme, used when the URL omits one.
var brokerPorts = map[string]string{
	"tcp": "1883", "mqtt": "1883", "ws": "80",
	"tls": "8883", "ssl": "8883", "mqtts": "8883", "wss": "443",
}

// DialBroker opens an MQTT broker connection through the shared resolver, wrapping it
// in TLS when the scheme calls for it. It satisfies paho's custom-open-connection hook.
func (d *Dialer) DialBroker(ctx context.Context, uri *url.URL, tlsConfig *tls.Config) (net.Conn, error) {
	if uri == nil {
		return nil, errors.New("nil broker url")
	}
	host, port := uri.Hostname(), uri.Port()
	if port == "" {
		known, ok := brokerPorts[uri.Scheme]
		if !ok {
			return nil, fmt.Errorf("broker url %q has no port and an unknown scheme", uri)
		}
		port = known
	}

	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return nil, err
	}
	if tlsConfig == nil {
		return conn, nil
	}

	// ServerName must survive dialing by IP, or verification fails against the SANs.
	cfg := tlsConfig.Clone()
	if cfg.ServerName == "" {
		cfg.ServerName = host
	}
	tlsConn := tls.Client(conn, cfg)
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	return tlsConn, nil
}

// sortedStrings renders addresses for logging and tests, order-independent.
func sortedStrings(addrs []net.IP) []string {
	out := make([]string, 0, len(addrs))
	for _, ip := range addrs {
		out = append(out, ip.String())
	}
	sort.Strings(out)
	return out
}
