// The `files` service contract, generated from files.json — regenerate with
// `uv run helix protocol generate-all`; do not hand-edit ./generated.
// Control only: file BYTES ride the data plane, not this contract.
import { filesContract } from './generated/files';

import type { MethodOutput } from '@helix/protocol/service';

export const filesControlContract = filesContract;
export type FilesControlContract = typeof filesControlContract;

/** One directory entry, derived from the generated `list` output. */
export type FileEntry = MethodOutput<FilesControlContract['methods']['list']>['entries'][number];
