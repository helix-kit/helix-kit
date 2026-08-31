import { describe, expect, it } from 'vitest';

import { safeHref } from './link';

describe('safeHref', () => {
  it('passes through the schemes a report can legitimately link to', () => {
    expect(safeHref('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('treats an absent or empty href as no link', () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('')).toBeNull();
  });

  it('refuses schemes that are not navigation', () => {
    // Template code is user-authored and a rendered report gets forwarded, so
    // an href outlives whoever produced it.
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });

  it('refuses a relative href, which a PDF has no base to resolve', () => {
    expect(safeHref('/statements?category=Food')).toBeNull();
    expect(safeHref('statements')).toBeNull();
  });
});
