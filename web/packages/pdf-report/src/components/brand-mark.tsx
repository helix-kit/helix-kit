import type { ReactElement } from 'react';

import { Path, Svg } from '@react-pdf/renderer';

import { reportTheme } from './theme';

// The Helix double-strand mark, vector-identical to the app icon
// (web/apps/helix/src/app/icon.tsx), so the PDF header carries the real logo
// rather than a rasterized asset.
const STRAND_LEFT = 'M5 3c0 6 14 6 14 12s-14 6-14 12';
const STRAND_RIGHT = 'M19 3c0 6-14 6-14 12s14 6 14 12';
const RUNGS = 'M7 8h10M7 16h10';

export const BrandMark = ({
  size = 16,
  color = reportTheme.brandDeep,
}: {
  size?: number;
  color?: string;
}): ReactElement => (
  <Svg height={size} viewBox="0 0 24 24" width={size}>
    <Path
      d={STRAND_LEFT}
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeWidth={2.4}
    />
    <Path
      d={STRAND_RIGHT}
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeWidth={2.4}
    />
    <Path
      d={RUNGS}
      fill="none"
      stroke={reportTheme.brandDark}
      strokeLinecap="round"
      strokeWidth={2.4}
    />
  </Svg>
);
