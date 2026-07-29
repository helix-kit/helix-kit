import 'server-only';

import { site } from './site';

const STARS_REVALIDATE_SECONDS = 3600;
const THOUSAND = 1000;

const parseRepo = (url: string): { owner: string; repo: string } | null => {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match === null) return null;
  const [, owner, repo] = match;
  if (owner === undefined || repo === undefined) return null;
  return { owner, repo };
};

/** Format a star count the way GitHub does: exact under 1k, else "1.2k". */
export const formatStars = (count: number): string =>
  count < THOUSAND ? String(count) : `${(count / THOUSAND).toFixed(1).replace(/\.0$/, '')}k`;

/**
 * Live GitHub star count for the source repo, cached via ISR (one request per hour,
 * so we stay far under the unauthenticated rate limit). Returns null on any failure
 * so the header can degrade to just "Star".
 */
export const getGitHubStars = async (): Promise<number | null> => {
  const repo = parseRepo(site.sourceUrl);
  if (repo === null) return null;

  try {
    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: STARS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null;
  } catch {
    return null;
  }
};
