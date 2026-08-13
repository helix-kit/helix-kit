import { defineFeature } from '@helix-hq/backend/features';

// Linux file browser — browse, download and upload files on a Linux-class device.
// Bulk bytes ride the data plane (peer-to-peer when available), never the control
// plane.
export const linuxFilesFeature = defineFeature('linux-files');
