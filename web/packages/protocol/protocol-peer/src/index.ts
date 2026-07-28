// @helix/protocol-peer — the browser side of the Helix WebRTC data plane.
//
// WebRTC is a TRANSPORT under HelixStream, not a parallel stack. This package
// negotiates a peer connection with a device (signaling rides the ordinary typed
// control plane) and exposes what rides on it:
//
//   - a reliable DataChannel adapted to a HelixStream transport, so the same mux
//     the gateway runs — and therefore every stream app: shell, port forwarding,
//     file transfer — works peer-to-peer with no app changes; and
//   - the device's media tracks, so live video/audio ride the SAME peer.
//
// The device is the offerer: it creates the DataChannel and returns its SDP offer
// in the app's `open` response, so no extra round trip and no inbound reachability
// on the device.

export { connectPeer, selectedCandidatePair } from './peer';
export type { HelixPeer, IceServer, PeerOptions, PeerSignaller } from './peer';
export { dataChannelTransport } from './transport';
