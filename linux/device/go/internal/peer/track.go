// SPDX-License-Identifier: AGPL-3.0-only

package peer

import (
	"fmt"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// Media codecs a track may carry. These name the wire codec, not an encoder; producing samples is the app's job.
const (
	CodecH264 = webrtc.MimeTypeH264
	CodecVP8  = webrtc.MimeTypeVP8
	CodecOpus = webrtc.MimeTypeOpus
)

// TrackSpec declares one outbound media track; all tracks must be declared up front since they attach before the offer and Helix does not renegotiate.
type TrackSpec struct {
	// Codec is one of the Codec* constants.
	Codec string
	// ID identifies the track within the stream and is the key Peer.Track uses.
	ID string
	// StreamID groups tracks the browser should treat as one MediaStream.
	StreamID string
}

// Track is an outbound media track on a peer, riding the same PeerConnection as the DataChannel that carries the mux.
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

// WriteSample writes one already-encoded frame to the track; RTP packetization and encryption happen below.
func (t *Track) WriteSample(data []byte, duration time.Duration) error {
	return t.track.WriteSample(media.Sample{Data: data, Duration: duration})
}
