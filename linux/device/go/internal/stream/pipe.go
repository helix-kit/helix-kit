// SPDX-License-Identifier: AGPL-3.0-only

package stream

import "io"

// Pipe relays bytes bidirectionally between a Stream and a local
// io.ReadWriteCloser (a TCP conn, a PTY, ...) until both directions finish. It
// half-closes the stream's write side when the local end reaches EOF, and
// closes the local end when the peer finishes — which unblocks the other copy.
func Pipe(st *Stream, local io.ReadWriteCloser) {
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(st, local) // local -> peer
		_ = st.CloseWrite()
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(local, st) // peer -> local
		_ = local.Close()
		done <- struct{}{}
	}()
	<-done
	<-done
	_ = st.Close()
}
