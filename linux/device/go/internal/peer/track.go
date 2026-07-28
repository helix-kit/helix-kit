// SPDX-License-Identifier: AGPL-3.0-only

package peer

import (
	"fmt"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// Media codecs a track may carry. These name the wire codec, not an encoder:
// producing encoded samples is the app's job (a live-feed app owns the camera and
// the H.264 encoder), which is what keeps this package app-agnostic.
const (
	CodecH264 = webrtc.MimeTypeH264
	CodecVP8  = webrtc.MimeTypeVP8
	CodecOpus = webrtc.MimeTypeOpus
)

// TrackSpec declares one outbound media track. Tracks are declared in Config and
// attached BEFORE the offer is created — they cannot be added afterwards without
// renegotiation, and Helix deliberately keeps signaling to a single offer/answer
// exchange over the control plane. Declare every track the session needs up front.
type TrackSpec struct {
	// Codec is one of the Codec* constants.
	Codec string
	// ID identifies the track within the stream ("video", "audio", "camera-0"…);
	// it is also the key Peer.Track uses.
	ID string
	// StreamID groups tracks the browser should treat as one MediaStream.
	StreamID string
}

// Track is an outbound media track on a peer. Video and audio ride the SAME
// PeerConnection as the DataChannel that carries the HelixStream mux, so one
// device app can stream a camera and serve a shell over a single negotiated peer.
// That is the reason WebRTC is modelled as a transport rather than as a
// file-transfer feature.
type Track struct {
	track *webrtc.TrackLocalStaticSample
}

// Track returns a declared track by ID, or nil if the peer has no such track.
func (p *Peer) Track(id string) *Track { return p.tracks[id] }

func (p *Peer) addTracks(specs []TrackSpec) error {
	for _, spec := range specs {
		track, err := webrtc.NewTrackLocalStaticSample(
			webrtc.RTPCodecCapability{MimeType: spec.Codec},
			spec.ID,
			spec.StreamID,
		)
		if err != nil {
			return fmt.Errorf("new track %s: %w", spec.ID, err)
		}
		if _, err := p.pc.AddTrack(track); err != nil {
			return fmt.Errorf("add track %s: %w", spec.ID, err)
		}
		p.tracks[spec.ID] = &Track{track: track}
	}
	return nil
}

// WriteSample writes one encoded frame (an H.264 access unit, an Opus frame, …)
// to the track. The app supplies already-encoded bytes; RTP packetization and
// encryption happen below.
func (t *Track) WriteSample(data []byte, duration time.Duration) error {
	return t.track.WriteSample(media.Sample{Data: data, Duration: duration})
}
