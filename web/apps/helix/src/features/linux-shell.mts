import { defineFeature } from '@helix/backend/features';

// Linux shell access (experimental) — a browser PTY to a Linux-class device.
// Declared here for now; moves to live beside the shell UI/route when that lands.
export const linuxShellFeature = defineFeature('linux-shell');
