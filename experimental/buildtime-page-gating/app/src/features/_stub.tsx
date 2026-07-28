'use client';

// Approach B replacement target. When a feature is gated out, webpack rewrites
// its ./impl import to this module, so the feature's heavy deps leave the graph
// and tree-shake away. The route still exists but renders this notice.
export default function GatedOut() {
  return <main><p>This feature is not enabled on this device.</p></main>;
}
