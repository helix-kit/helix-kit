// Control-plane contract for the port-forward service; ./generated is the single
// source of truth (linux/device/go/.../port_forward.json), regenerate via
// `uv run helix protocol generate-all`.
import { portForwardContract } from './generated/port_forward';

export const portForwardControlContract = portForwardContract;
export type PortForwardControlContract = typeof portForwardControlContract;

export {
  OpenInputSchema as portForwardOpenInputSchema,
  CloseInputSchema as portForwardCloseInputSchema,
  SessionOutputSchema as portForwardSessionOutputSchema,
  ErrorSchema as portForwardErrorSchema,
} from './generated/port_forward';
