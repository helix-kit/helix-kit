import { inflateSync } from 'node:zlib';

import { renderToBuffer } from '@json-render/react-pdf/render';
import { describe, expect, it } from 'vitest';

import { createHelixPdfComponents } from './registry';

import type { ReportTemplate } from '../types';

/**
 * These render a real PDF and read the link annotations back out, because the
 * thing worth testing is not that a prop was accepted — it is that react-pdf
 * emitted an annotation a viewer will act on.
 */
const linkTargets = (pdf: Uint8Array): string[] =>
  [...Buffer.from(pdf).toString('latin1').matchAll(/\/URI \(([^)]*)\)/g)].map(
    (match) => match[1] ?? '',
  );

/**
 * The page's drawing operators, inflated out of its content streams.
 *
 * Comparing whole files would only prove the object graph shifted — adding an
 * annotation renumbers objects. What matters is that the marks on the page are
 * the same, and those live in the deflated content stream.
 */
const drawnContent = (pdf: Uint8Array): string => {
  const raw = Buffer.from(pdf);
  const text = raw.toString('latin1');
  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match = marker.exec(text);
  while (match !== null) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    try {
      streams.push(inflateSync(raw.subarray(start, end)).toString('latin1'));
    } catch {
      // Fonts and other non-deflated streams; not page marks.
    }
    match = marker.exec(text);
  }
  return streams
    .filter((stream) => stream.includes('BT'))
    .join('\n')
    .split('\n')
    // An overlay contributes a save/restore pair and no marks. Those are the
    // one difference it is allowed to make, so they are not compared.
    .filter((line) => line !== 'q' && line !== 'Q' && line !== '')
    .join('\n');
};

const render = async (elements: ReportTemplate['spec']['elements']): Promise<Uint8Array> =>
  renderToBuffer(
    {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: { size: 'A4' }, children: Object.keys(elements) },
        ...elements,
      },
    },
    { registry: createHelixPdfComponents(), state: {} },
  );

const CATEGORY = 'Category';
const FOOD_LINK = 'https://app.test/s?c=Food';
const TRAVEL_LINK = 'https://app.test/s?c=Travel';

describe('DataTable rowLinks', () => {
  it('emits one annotation per linked row and none for the others', async () => {
    const pdf = await render({
      table: {
        type: 'DataTable',
        props: {
          headers: [CATEGORY, 'Total'],
          rows: [
            ['Food', '1,000'],
            ['Rent', '22,000'],
            ['Travel', '500'],
          ],
          rowLinks: [FOOD_LINK, null, TRAVEL_LINK],
        },
        children: [],
      },
    });
    expect(linkTargets(pdf)).toEqual([FOOD_LINK, TRAVEL_LINK]);
  });

  it('renders identically whether or not rows are linked', async () => {
    // The whole point of an overlay: a linked table must not pick up react-pdf's
    // blue underlined link text, so the drawn page has to be byte-identical.
    const props = { headers: [CATEGORY], rows: [['Food']] };
    const plain = await render({ t: { type: 'DataTable', props, children: [] } });
    const linked = await render({
      t: { type: 'DataTable', props: { ...props, rowLinks: ['https://app.test/x'] }, children: [] },
    });
    expect(drawnContent(linked)).toBe(drawnContent(plain));
    expect(drawnContent(plain)).not.toBe('');
  });

  it('drops a row link that is not a navigable URL', async () => {
    const pdf = await render({
      table: {
        type: 'DataTable',
        props: {
          headers: [CATEGORY],
          rows: [['Food'], ['Rent']],
          rowLinks: ['javascript:alert(1)', '/relative'],
        },
        children: [],
      },
    });
    expect(linkTargets(pdf)).toEqual([]);
  });
});

describe('PieChart links', () => {
  it('links both the slice and its legend entry', async () => {
    const pdf = await render({
      pie: {
        type: 'PieChart',
        props: {
          series: [
            { label: 'Food', value: 40 },
            { label: 'Rent', value: 60 },
          ],
          links: [FOOD_LINK, 'https://app.test/s?c=Rent'],
        },
        children: [],
      },
    });
    const targets = linkTargets(pdf);
    // One for the slice, one for the legend row, per point.
    expect(targets.filter((t) => t.endsWith('Food'))).toHaveLength(2);
    expect(targets.filter((t) => t.endsWith('Rent'))).toHaveLength(2);
  });

  it('links only the legend when a slice is too thin for a hotspot', async () => {
    const pdf = await render({
      pie: {
        type: 'PieChart',
        props: {
          series: [
            { label: 'Tiny', value: 0.05 },
            { label: 'Rest', value: 9999 },
          ],
          links: ['https://app.test/tiny', 'https://app.test/rest'],
        },
        children: [],
      },
    });
    const targets = linkTargets(pdf);
    expect(targets.filter((t) => t.endsWith('tiny'))).toHaveLength(1);
    expect(targets.filter((t) => t.endsWith('rest'))).toHaveLength(2);
  });

  it('leaves an unlinked pie with no annotations', async () => {
    const pdf = await render({
      pie: {
        type: 'PieChart',
        props: { series: [{ label: 'Food', value: 40 }] },
        children: [],
      },
    });
    expect(linkTargets(pdf)).toEqual([]);
  });
});
