// Shape of a nav entry in the generated registry. The registry is emitted by
// gate.mjs from the enabled features' feature.json manifests, so the app shell
// never hard-codes which features exist.
export interface NavItem {
  route: string;
  label: string;
  heavy: boolean;
}
