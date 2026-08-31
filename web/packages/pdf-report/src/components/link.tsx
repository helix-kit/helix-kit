import type { ReactElement } from 'react';

import { Link, StyleSheet } from '@react-pdf/renderer';

/**
 * Schemes a report is allowed to link to.
 *
 * A template's code step is user-authored and a rendered report is a file that
 * gets forwarded, so an href is untrusted input that outlives the person who
 * produced it. Most viewers refuse `javascript:` in a URI action already, but
 * the ones that do not are exactly the ones worth defending against, and no
 * report has a reason to use anything outside this set.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

/** The href to render, or null if it is unusable or not permitted. */
export const safeHref = (href: string | null | undefined): string | null => {
  if (href === null || href === undefined || href === '') {
    return null;
  }
  try {
    return ALLOWED_SCHEMES.includes(new URL(href).protocol) ? href : null;
  } catch {
    // Relative hrefs have no base to resolve against inside a PDF, so a value
    // `URL` cannot parse is not something a viewer could follow either.
    return null;
  }
};

const styles = StyleSheet.create({
  /**
   * Fills whatever it is placed inside.
   *
   * The element it covers stays outside the link, which is the point: a cell
   * wrapped in `Link` would pick up react-pdf's blue underline and no longer
   * match the text beside it, whereas an overlay changes nothing on the page.
   * Its parent needs no `position: relative` — that is already the default.
   */
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});

/**
 * An invisible clickable region covering its parent.
 *
 * react-pdf emits a link annotation from the laid-out box, so this needs no
 * children and draws nothing — the annotation is the entire contribution.
 */
export const LinkOverlay = ({ href }: { href: string | null }): ReactElement | null =>
  href === null ? null : <Link src={href} style={styles.fill} />;

/**
 * An invisible clickable region at an explicit offset from its parent's origin.
 *
 * For marks a layout box cannot describe — a pie slice is drawn inside an `Svg`,
 * where a link annotation cannot be placed, so the region is positioned over it
 * from outside.
 */
export const LinkHotspot = ({
  href,
  left,
  top,
  size,
}: {
  href: string | null;
  left: number;
  top: number;
  size: number;
}): ReactElement | null =>
  href === null ? null : (
    <Link src={href} style={{ position: 'absolute', left, top, width: size, height: size }} />
  );
