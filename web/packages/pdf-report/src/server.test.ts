import { describe, expect, it } from 'vitest';

import { defaultReportDocument } from './defaults';
import { isReportSpec, resolveReportDocument } from './document';
import { renderReportToBuffer } from './server';

import type { Spec, UIElement } from '@json-render/core';

const PDF_MAGIC = '%PDF-';

const decode = (pdf: Uint8Array): string => Buffer.from(pdf).toString('latin1');

describe('resolveReportDocument', () => {
  it('falls back to the default document for junk input', () => {
    expect(resolveReportDocument(null)).toEqual(defaultReportDocument);
    expect(resolveReportDocument('nope')).toEqual(defaultReportDocument);
  });

  it('falls back per-field, keeping a valid spec alongside a broken demoData', () => {
    const resolved = resolveReportDocument({
      spec: defaultReportDocument.spec,
      demoData: 'not an object',
    });
    expect(resolved.spec).toEqual(defaultReportDocument.spec);
    expect(resolved.demoData).toEqual(defaultReportDocument.demoData);
  });

  it('deep-clones so callers cannot mutate the default document', () => {
    const resolved = resolveReportDocument(defaultReportDocument);
    expect(resolved.spec).not.toBe(defaultReportDocument.spec);
    expect(resolved.demoData).not.toBe(defaultReportDocument.demoData);
  });

  it('rejects specs missing a root or an elements map', () => {
    expect(isReportSpec({ elements: {} })).toBe(false);
    expect(isReportSpec({ root: 'doc' })).toBe(false);
    expect(isReportSpec(defaultReportDocument.spec)).toBe(true);
  });
});

describe('renderReportToBuffer', () => {
  it('renders the default template to a real PDF', async () => {
    const pdf = await renderReportToBuffer(
      defaultReportDocument.spec,
      defaultReportDocument.demoData,
      { title: 'Fleet report', generatedAt: 'Thu, 06 Aug 2026 09:00:00 GMT' },
    );

    expect(decode(pdf).startsWith(PDF_MAGIC)).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });

  // react-pdf subsets its fonts, so rendered strings are not recoverable from the
  // bytes without a full PDF parser — assert differentially that state drives output.
  it('renders the supplied state rather than a fixed document', async () => {
    const [first, second] = await Promise.all([
      renderReportToBuffer(defaultReportDocument.spec, {
        ...defaultReportDocument.demoData,
        reportTitle: 'Alpha digest',
      }),
      renderReportToBuffer(defaultReportDocument.spec, {
        ...defaultReportDocument.demoData,
        reportTitle: 'A far longer title for the very same fleet digest',
      }),
    ]);

    expect(decode(first)).not.toEqual(decode(second));
  });

  it('grows the document as the bound data array grows', async () => {
    const devices = defaultReportDocument.demoData.devices as unknown[];
    const [few, many] = await Promise.all([
      renderReportToBuffer(defaultReportDocument.spec, {
        ...defaultReportDocument.demoData,
        devices: devices.slice(0, 1),
      }),
      renderReportToBuffer(defaultReportDocument.spec, {
        ...defaultReportDocument.demoData,
        devices,
      }),
    ]);

    expect(many.byteLength).toBeGreaterThan(few.byteLength);
  });

  it('renders a spec whose data arrays are empty without throwing', async () => {
    const pdf = await renderReportToBuffer(defaultReportDocument.spec, {
      reportTitle: 'Empty window',
      reportSummary: 'Nothing reported.',
      devices: [],
    });

    expect(decode(pdf).startsWith(PDF_MAGIC)).toBe(true);
  });

  it('names the offending component instead of failing deep inside the renderer', async () => {
    const spec = {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: {}, children: ['oops'] },
        oops: { type: 'NopeComponent', props: {}, children: [] },
      },
    } as unknown as Spec;

    await expect(renderReportToBuffer(spec)).rejects.toThrow(
      /Unknown component type\(s\): NopeComponent/,
    );
  });

  it('rejects a spec that is not a json-render document', async () => {
    await expect(renderReportToBuffer({ root: 'doc' } as unknown as Spec)).rejects.toThrow(
      /valid json-render spec/,
    );
  });

  it('leaves the caller’s spec untouched when injecting branding', async () => {
    const spec = JSON.parse(JSON.stringify(defaultReportDocument.spec)) as Spec;

    await renderReportToBuffer(spec, defaultReportDocument.demoData, { title: 'Injected' });

    const page = spec.elements.page as UIElement;
    expect(page.type).toBe('Page');
    expect(page.props).not.toHaveProperty('brandTitle');
  });
});
