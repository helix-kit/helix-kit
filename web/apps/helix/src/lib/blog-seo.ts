import { publicOrigin, site } from './site';

const EXCERPT_MAX = 157;

/** Plain-text excerpt from MDX, used when a post has no explicit description. */
export const excerpt = (mdx: string, max = EXCERPT_MAX): string => {
  const text = mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
};

export const wordCount = (mdx: string): number =>
  mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

export const absoluteUrl = (path: string): string => {
  if (path.startsWith('http')) return path;
  const separator = path.startsWith('/') ? '' : '/';
  return `${publicOrigin}${separator}${path}`;
};

type PostForJsonLd = {
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  tags: string[];
  readingTime: number | null;
  authorName: string | null;
  content: string;
};

/** BlogPosting + BreadcrumbList JSON-LD for a post page. */
export const postJsonLd = (
  post: PostForJsonLd,
  opts: { description: string; published?: string; modified?: string },
): Record<string, unknown>[] => {
  const url = absoluteUrl(`/blog/${post.slug}`);
  const image =
    post.coverImage !== '' ? absoluteUrl(post.coverImage) : absoluteUrl('/helix-logo.svg');

  const blogPosting: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: opts.description,
    image: [image],
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: opts.published,
    dateModified: opts.modified ?? opts.published,
    author: {
      '@type': 'Person',
      name: post.authorName ?? site.name,
    },
    publisher: {
      '@type': 'Organization',
      name: site.name,
      logo: { '@type': 'ImageObject', url: absoluteUrl('/helix-logo.svg') },
    },
    keywords: post.tags.join(', '),
    wordCount: wordCount(post.content),
    ...(post.readingTime !== null ? { timeRequired: `PT${post.readingTime}M` } : {}),
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/blog') },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };

  return [blogPosting, breadcrumb];
};
