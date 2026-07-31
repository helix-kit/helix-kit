// SPDX-License-Identifier: AGPL-3.0-only

package netutil

import (
	"context"
	"errors"
	"net"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

// testDialer builds a Dialer whose resolver is scripted per family.
func testDialer(t *testing.T, lookup lookupFunc) *Dialer {
	t.Helper()
	d := New()
	d.lookup = lookup
	d.grace = 20 * time.Millisecond
	return d
}

func families(v6, v4 []net.IP, v6Delay, v4Delay time.Duration, v6Err, v4Err error) lookupFunc {
	return func(ctx context.Context, network, _ string) ([]net.IP, error) {
		delay, addrs, err := v4Delay, v4, v4Err
		if network == "ip6" {
			delay, addrs, err = v6Delay, v6, v6Err
		}
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		return addrs, err
	}
}

// The measured failure: IPv4 answers immediately, IPv6 takes seconds. The dial must
// not wait for IPv6.
func TestAddrsDoesNotBlockOnSlowIPv6(t *testing.T) {
	d := testDialer(t, families(
		[]net.IP{net.ParseIP("2001:db8::1")}, []net.IP{net.ParseIP("1.2.3.4")},
		5*time.Second, time.Millisecond,
		nil, nil,
	))

	start := time.Now()
	addrs, err := d.Addrs(context.Background(), "helix-kit.test")
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Addrs: %v", err)
	}
	if elapsed > time.Second {
		t.Fatalf("waited %v for a slow IPv6 lookup; should give up after the grace period", elapsed)
	}
	if got := sortedStrings(addrs); !reflect.DeepEqual(got, []string{"1.2.3.4"}) {
		t.Fatalf("addrs = %v, want the IPv4 answer only", got)
	}
}

// A resolver that never answers AAAA at all (the site router drops it) must behave the
// same way rather than failing the dial.
func TestAddrsToleratesIPv6Failure(t *testing.T) {
	d := testDialer(t, families(
		nil, []net.IP{net.ParseIP("1.2.3.4")},
		time.Second, time.Millisecond,
		errors.New("no such host"), nil,
	))

	addrs, err := d.Addrs(context.Background(), "helix-kit.test")
	if err != nil {
		t.Fatalf("Addrs: %v", err)
	}
	if got := sortedStrings(addrs); !reflect.DeepEqual(got, []string{"1.2.3.4"}) {
		t.Fatalf("addrs = %v, want the IPv4 answer", got)
	}
}

// A healthy dual-stack network must still get IPv6, and it must come first.
func TestAddrsPrefersIPv6WhenItIsFast(t *testing.T) {
	d := testDialer(t, families(
		[]net.IP{net.ParseIP("2001:db8::1")}, []net.IP{net.ParseIP("1.2.3.4")},
		time.Millisecond, time.Millisecond,
		nil, nil,
	))

	addrs, err := d.Addrs(context.Background(), "helix-kit.test")
	if err != nil {
		t.Fatalf("Addrs: %v", err)
	}
	if len(addrs) != 2 {
		t.Fatalf("addrs = %v, want both families", addrs)
	}
	if addrs[0].To4() != nil {
		t.Fatalf("addrs[0] = %v, want the IPv6 address first", addrs[0])
	}
}

// Both families failing is a real error, not an empty success.
func TestAddrsFailsWhenBothFamiliesFail(t *testing.T) {
	d := testDialer(t, families(
		nil, nil,
		time.Millisecond, time.Millisecond,
		errors.New("v6 down"), errors.New("v4 down"),
	))

	if _, err := d.Addrs(context.Background(), "helix-kit.test"); err == nil {
		t.Fatal("Addrs succeeded with no addresses")
	}
}

// The per-session dials that made this hurt must resolve once, not every time.
func TestAddrsCachesWithinTTL(t *testing.T) {
	var calls atomic.Int32
	d := testDialer(t, func(ctx context.Context, network, host string) ([]net.IP, error) {
		calls.Add(1)
		return families(
			[]net.IP{net.ParseIP("2001:db8::1")}, []net.IP{net.ParseIP("1.2.3.4")},
			time.Millisecond, time.Millisecond, nil, nil,
		)(ctx, network, host)
	})

	for range 5 {
		if _, err := d.Addrs(context.Background(), "helix-kit.test"); err != nil {
			t.Fatalf("Addrs: %v", err)
		}
	}
	// One lookup per family, once.
	if got := calls.Load(); got != 2 {
		t.Fatalf("lookups = %d, want 2 (cached after the first resolution)", got)
	}

	d.Forget("helix-kit.test")
	if _, err := d.Addrs(context.Background(), "helix-kit.test"); err != nil {
		t.Fatalf("Addrs after Forget: %v", err)
	}
	if got := calls.Load(); got != 4 {
		t.Fatalf("lookups = %d, want 4 (Forget re-resolves)", got)
	}
}

// An expired entry must not be served.
func TestAddrsReresolvesAfterTTL(t *testing.T) {
	var calls atomic.Int32
	d := testDialer(t, func(ctx context.Context, network, host string) ([]net.IP, error) {
		calls.Add(1)
		return families(
			nil, []net.IP{net.ParseIP("1.2.3.4")},
			time.Millisecond, time.Millisecond, errors.New("no v6"), nil,
		)(ctx, network, host)
	})
	now := time.Now()
	d.now = func() time.Time { return now }

	if _, err := d.Addrs(context.Background(), "helix-kit.test"); err != nil {
		t.Fatalf("Addrs: %v", err)
	}
	now = now.Add(defaultTTL + time.Second)
	if _, err := d.Addrs(context.Background(), "helix-kit.test"); err != nil {
		t.Fatalf("Addrs after TTL: %v", err)
	}
	if got := calls.Load(); got != 4 {
		t.Fatalf("lookups = %d, want 4 (re-resolved after the TTL)", got)
	}
}

// An IP literal must not be resolved at all.
func TestAddrsPassesThroughIPLiterals(t *testing.T) {
	d := testDialer(t, func(context.Context, string, string) ([]net.IP, error) {
		t.Fatal("resolved an IP literal")
		return nil, nil
	})

	addrs, err := d.Addrs(context.Background(), "3.108.135.4")
	if err != nil {
		t.Fatalf("Addrs: %v", err)
	}
	if got := sortedStrings(addrs); !reflect.DeepEqual(got, []string{"3.108.135.4"}) {
		t.Fatalf("addrs = %v", got)
	}
}

// The published-but-unreachable case: an address that refuses must not sink the dial
// when another family works. This is exactly IPv6 being published before the listener
// is dual-stack.
func TestDialContextFallsBackToTheNextAddress(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("SplitHostPort: %v", err)
	}

	// ::1 on this port has nothing listening, so it refuses; 127.0.0.1 accepts.
	d := testDialer(t, families(
		[]net.IP{net.ParseIP("::1")}, []net.IP{net.ParseIP("127.0.0.1")},
		time.Millisecond, time.Millisecond,
		nil, nil,
	))

	conn, err := d.DialContext(context.Background(), "tcp", net.JoinHostPort("helix-kit.test", port))
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	defer conn.Close()
}
