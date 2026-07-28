import Impl from './impl';

// Thin route entry. Both gating approaches key off this file: Approach A re-exports
// it into a generated route folder; Approach B keeps it in a committed route and
// swaps ./impl for a stub when gated.
export default function OverviewPage() {
  return <Impl />;
}
