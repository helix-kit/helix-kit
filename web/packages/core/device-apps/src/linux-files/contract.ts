// The Helix `files` service contract is generated from the single source of truth
// at linux/device/go/internal/files/contracts/files.json (shared by the Go device
// service and this app). Regenerate with `uv run helix protocol generate-all`; do
// not hand-edit the ./generated output.
//
// Control only — open/close a session, list a directory, ask which roots are
// exposed. File BYTES never come through here: each transfer is one stream on the
// data plane, described by the stream's meta blob (see TransferMetaSchema).
import { filesContract } from './generated/files';

import type { MethodOutput } from '@helix/protocol-service';

export const filesControlContract = filesContract;
export type FilesControlContract = typeof filesControlContract;

// One directory entry, derived from the generated `list` output so it cannot drift
// from the contract.
export type FileEntry = MethodOutput<FilesControlContract['methods']['list']>['entries'][number];
