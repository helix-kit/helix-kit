import { ImageResponse } from 'next/og';

import { site } from '@/lib/site';
import { api } from '@/server/caller';

export const runtime = 'nodejs';
export const alt = 'Helix blog post';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const OgImage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;

  // Fall back to the site defaults if the post can't be loaded.
  const post = await api()
    .getBySlug({ slug })
    .catch(() => null);
  const title = post?.title ?? site.name;
  const description = post === null ? site.tagline : post.description;
  const tags = post?.tags.slice(0, 3) ?? [];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 80,
        background: '#09090b',
        color: '#fafafa',
        backgroundImage:
          'radial-gradient(1000px 500px at 15% -10%, rgba(45,212,191,0.18), transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 18, height: 18, borderRadius: 9999, background: '#2dd4bf' }} />
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>Helix</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>
          {title.length > 90 ? `${title.slice(0, 90)}…` : title}
        </div>
        {description !== '' ? (
          <div style={{ fontSize: 30, lineHeight: 1.4, color: '#a1a1aa' }}>
            {description.length > 140 ? `${description.slice(0, 140)}…` : description}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {tags.map((tag) => (
            <div
              key={tag}
              style={{
                display: 'flex',
                fontSize: 22,
                color: '#2dd4bf',
                border: '1px solid rgba(45,212,191,0.4)',
                borderRadius: 9999,
                padding: '6px 18px',
              }}
            >
              {tag}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 24, color: '#71717a' }}>helix-kit.com</div>
      </div>
    </div>,
    { ...size },
  );
};

export default OgImage;
