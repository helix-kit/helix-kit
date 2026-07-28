'use client';

// Approach B replacement target: webpack rewrites a gated-out feature's ./impl to this stub so its heavy deps tree-shake away.
export default function GatedOut() {
  return <main><p>This feature is not enabled on this device.</p></main>;
}
