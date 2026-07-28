import { env } from '@/lib/env';

// Helix is self-hosted (appliance / local), not Vercel: the browser uses its own
// origin, and the server falls back to the configured public base URL.
export const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return env.NEXT_PUBLIC_BASE_URL;
};
