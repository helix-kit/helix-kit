import { defineFeature } from '@helix/backend/features';

// The ESP flashing utility, gated per device/profile. Declared here for now; when
// the flasher page/route is built this declaration moves to live beside it, so the
// feature is registered only when that code is bundled.
export const espFlasherFeature = defineFeature('esp-flasher');
