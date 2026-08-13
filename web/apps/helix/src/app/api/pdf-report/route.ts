import { NextResponse } from 'next/server';

import { isObjectRecord } from '@helix-hq/pdf-report';

// @react-pdf/renderer needs Node built-ins, and every render is data-dependent.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_FILENAME = 'helix-report.pdf';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export const POST = async (request: Request) => {
  try {
    // Loaded lazily so the PDF renderer and the code sandbox are not pulled into
    // the route's cold path until a render is actually requested.
    const [{ resolveReportTemplate }, { renderReportToBuffer }] = await Promise.all([
      import('@helix-hq/pdf-report'),
      import('@helix-hq/pdf-report/server'),
    ]);

    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body = isObjectRecord(rawBody) ? rawBody : {};
    const template = resolveReportTemplate(body.template);
    const filename = asString(body.filename) ?? DEFAULT_FILENAME;

    // Branding is stamped here rather than in the template, so a preview goes
    // through exactly the same path as a delivered report.
    const branding = isObjectRecord(body.branding) ? body.branding : {};
    const pdf = await renderReportToBuffer(template, {
      input: body.input,
      branding: {
        title: asString(branding.title),
        subtitle: asString(branding.subtitle),
        generatedAt: asString(branding.generatedAt) ?? new Date().toUTCString(),
        footerNote: asString(branding.footerNote),
      },
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'cache-control': 'no-store',
        'content-disposition': `inline; filename="${filename}"`,
        'content-type': 'application/pdf',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to render the PDF';
    return NextResponse.json({ error: message }, { status: 400 });
  }
};
