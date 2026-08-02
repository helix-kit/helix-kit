const EXCERPT_MAX = 157;

const SCHEMA_CONTEXT = 'https://schema.org';

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

const wordCount = (mdx: string): number =>
  mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

/** Host-supplied identity: the package builds the structured data but owns none of the branding. */
export type BlogSeoConfig = Readonly<{
  /** Absolute public origin, without a trailing slash. */
  origin: string;
  /** Publisher/organization name. */
  siteName: string;
  /** Route the blog is mounted at. */
  basePath?: string;
  /** Publisher logo, and the fallback image for posts with no cover. */
  fallbackImagePath?: string;
}>;

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

type PostSummaryForJsonLd = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string | Date | null;
};

export const createBlogSeo = ({
  origin,
  siteName,
  basePath = '/blog',
  fallbackImagePath = '/apple-icon',
}: BlogSeoConfig) => {
  const absoluteUrl = (path: string): string => {
    if (path.startsWith('http')) return path;
    const separator = path.startsWith('/') ? '' : '/';
    return `${origin}${separator}${path}`;
  };

  /** BlogPosting + BreadcrumbList JSON-LD for a post page. */
  const postJsonLd = (
    post: PostForJsonLd,
    opts: { description: string; published?: string; modified?: string },
  ): Record<string, unknown>[] => {
    const url = absoluteUrl(`${basePath}/${post.slug}`);
    const image =
      post.coverImage !== '' ? absoluteUrl(post.coverImage) : absoluteUrl(fallbackImagePath);

    const blogPosting: Record<string, unknown> = {
      '@context': SCHEMA_CONTEXT,
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
        name: post.authorName ?? siteName,
      },
      publisher: {
        '@type': 'Organization',
        name: siteName,
        logo: { '@type': 'ImageObject', url: absoluteUrl(fallbackImagePath) },
      },
      keywords: post.tags.join(', '),
      wordCount: wordCount(post.content),
      ...(post.readingTime !== null ? { timeRequired: `PT${post.readingTime}M` } : {}),
    };

    const breadcrumb = {
      '@context': SCHEMA_CONTEXT,
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl(basePath) },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    };

    return [blogPosting, breadcrumb];
  };

  /** Blog JSON-LD for the index page. */
  const blogJsonLd = (
    posts: readonly PostSummaryForJsonLd[],
    opts: { name: string; description: string },
  ): Record<string, unknown> => ({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(basePath),
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      url: absoluteUrl(`${basePath}/${post.slug}`),
      ...(post.publishedAt !== null
        ? { datePublished: new Date(post.publishedAt).toISOString() }
        : {}),
    })),
  });

  return { absoluteUrl, postJsonLd, blogJsonLd };
};
