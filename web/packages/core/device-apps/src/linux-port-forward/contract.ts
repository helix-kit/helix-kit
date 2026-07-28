// The Helix `port-forward` service contract is generated from the single source
// of truth at linux/device/go/internal/portforward/contracts/port_forward.json
// (shared by the Go device service and this app). Regenerate with `uv run helix
// protocol generate-all`; do not hand-edit the ./generated output.
//
// Control only — open/close/list a forward; the tunnelled bytes flow on the data
// plane. `open` gives the device a data-plane URL to dial under a session id and
// the target (host:port) it should net.Dial for each stream; the public URL is
// `<sessionId>.port.<domain>`.
import { portForwardContract } from './generated/port_forward';

export const portForwardControlContract = portForwardContract;
export type PortForwardControlContract = typeof portForwardControlContract;

export {
  OpenInputSchema as portForwardOpenInputSchema,
  CloseInputSchema as portForwardCloseInputSchema,
  SessionOutputSchema as portForwardSessionOutputSchema,
  ErrorSchema as portForwardErrorSchema,
} from './generated/port_forward';
