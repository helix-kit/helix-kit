import { env } from '@/lib/env';

// Self-hosted: the browser uses its own origin; the server falls back to the public base URL.
export const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return env.NEXT_PUBLIC_BASE_URL;
};
