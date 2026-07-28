import { defineFeature } from '@helix/backend/features';

// Linux port forwarding (experimental) — tunnel a device-local port to the cloud.
// Declared here for now; moves to live beside the port-forward UI/route when built.
export const linuxPortForwardFeature = defineFeature('linux-port-forward');
