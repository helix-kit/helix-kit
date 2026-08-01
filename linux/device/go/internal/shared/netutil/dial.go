// SPDX-License-Identifier: AGPL-3.0-only

// Package netutil dials the cloud with a bounded tolerance for a slow resolver.
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

const (
	defaultTTL     = 5 * time.Minute
	defaultGrace   = 150 * time.Millisecond
	defaultAttempt = 10 * time.Second
)

var ErrNoAddresses = errors.New("host resolved to no addresses")

type lookupFunc func(ctx context.Context, network, host string) ([]net.IP, error)

type entry struct {
	addrs   []net.IP
	expires time.Time
}

type Dialer struct {
	ttl     time.Duration
	grace   time.Duration
	attempt time.Duration
	lookup  lookupFunc
	now     func() time.Time

	mu    sync.Mutex
	cache map[string]entry
}

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

func Shared() *Dialer {
	sharedOnce.Do(func() { shared = New() })
	return shared
}

type result struct {
	addrs []net.IP
	err   error
}

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

func (d *Dialer) race(ctx context.Context, v6, v4 <-chan result) ([]net.IP, error) {
	var got6, got4 result
	var have6, have4 bool

	for !have6 || !have4 {
		var timeout <-chan time.Time
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

func (d *Dialer) Forget(host string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.cache, host)
}

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
	d.Forget(host)
	return nil, last
}

var brokerPorts = map[string]string{
	"tcp": "1883", "mqtt": "1883", "ws": "80",
	"tls": "8883", "ssl": "8883", "mqtts": "8883", "wss": "443",
}

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

func sortedStrings(addrs []net.IP) []string {
	out := make([]string, 0, len(addrs))
	for _, ip := range addrs {
		out = append(out, ip.String())
	}
	sort.Strings(out)
	return out
}
