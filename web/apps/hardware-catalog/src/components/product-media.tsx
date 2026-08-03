import Link from 'next/link';

import { ExternalLink } from 'lucide-react';

import { humanize } from '@/lib/format';

/** Images and outbound links — the two things a spec table can't convey on its own. */

type ImageRow = {
  id: string;
  kind: string;
  url: string;
  displayUrl: string;
  alt: string;
  credit: string;
  isPrimary: boolean;
};

type LinkRow = {
  id: string;
  kind: string;
  url: string;
  label: string;
  regionCode: string;
  isPrimary: boolean;
  isBroken: boolean;
};

export const ProductGallery = ({ images }: { readonly images: readonly ImageRow[] }) => {
  if (images.length === 0) {
    return null;
  }

  const [primary, ...rest] = [...images].sort(
    (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
  );
  if (primary == null) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="border-border bg-muted/30 overflow-hidden rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element -- sources are arbitrary vendor hosts; the loader adds nothing here */}
        <img
          alt={primary.alt === '' ? 'Product photo' : primary.alt}
          className="h-auto w-full object-contain"
          src={primary.displayUrl}
        />
      </div>
      {rest.length === 0 ? null : (
        <div className="grid grid-cols-4 gap-2">
          {rest.map((image) => (
            <a
              key={image.id}
              className="border-border hover:border-primary/60 block overflow-hidden rounded border transition-colors"
              href={image.url}
              rel="noreferrer"
              target="_blank"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- same */}
              <img
                alt={image.alt === '' ? humanize(image.kind) : image.alt}
                className="h-20 w-full object-cover"
                src={image.displayUrl}
              />
            </a>
          ))}
        </div>
      )}
      {primary.credit === '' ? null : (
        <p className="text-muted-foreground text-xs">Image: {primary.credit}</p>
      )}
    </div>
  );
};

/** Groups links by kind so the vendor's own page and a dozen shops don't sit in one blur. */
export const ProductLinks = ({ links }: { readonly links: readonly LinkRow[] }) => {
  if (links.length === 0) {
    return <p className="text-muted-foreground text-sm">No links recorded.</p>;
  }

  const byKind = new Map<string, LinkRow[]>();
  for (const link of links) {
    const bucket = byKind.get(link.kind);
    if (bucket == null) {
      byKind.set(link.kind, [link]);
    } else {
      bucket.push(link);
    }
  }

  return (
    <div className="space-y-4">
      {[...byKind.entries()].map(([kind, entries]) => (
        <div key={kind} className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {humanize(kind)}
          </div>
          <ul className="space-y-1">
            {entries.map((link) => (
              <li key={link.id}>
                <Link
                  className="hover:text-primary inline-flex items-baseline gap-1.5 text-sm transition-colors"
                  href={link.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span
                    className={link.isBroken ? 'text-muted-foreground line-through' : undefined}
                  >
                    {link.label === '' ? link.url : link.label}
                  </span>
                  {link.regionCode === '' ? null : (
                    <span className="text-muted-foreground text-xs">({link.regionCode})</span>
                  )}
                  <ExternalLink className="size-3 shrink-0 self-center" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

/** Small square used in listings. */
export const ProductThumbnail = ({
  src,
  alt,
}: {
  readonly src: string | null;
  readonly alt: string | null;
}) => {
  if (src == null) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground flex size-16 shrink-0 items-center justify-center rounded border text-[10px]">
        no image
      </div>
    );
  }
  return (
    <div className="border-border bg-muted/30 size-16 shrink-0 overflow-hidden rounded border">
      {/* eslint-disable-next-line @next/next/no-img-element -- locally mirrored files, no loader needed */}
      <img alt={alt ?? ''} className="size-full object-contain" src={src} />
    </div>
  );
};
