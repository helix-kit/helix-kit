'use client';

import { useRef, useState, type ReactNode } from 'react';

import { useServerInsertedHTML } from 'next/navigation';

import { Toaster } from '@helix/design-system/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { ThemeProvider } from '@/components/theme-provider';
import ThemeSetter from '@/components/theme-setter';
import { THEME_COOKIE } from '@/types';

// Sets the `.light`/`.dark` class on <html> before the first paint so there is no
// theme flash. Injected via useServerInsertedHTML (below) so it ships in the
// streamed HTML only and is never part of the client React tree — the reason
// next-themes' own inline <script> tripped React 19's "script tag while rendering
// React component" warning, which this avoids.
const THEME_BOOTSTRAP = `(function(){try{var d=document.documentElement,k='${THEME_COOKIE}',s=localStorage.getItem(k)||'system',t=s==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s;d.classList.remove('light','dark');d.classList.add(t);d.style.colorScheme=t;}catch(e){}})();`;

const AppProviders = ({
  children,
}: Readonly<{
  children: ReactNode;
}>) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: false,
          },
        },
      }),
  );

  // useServerInsertedHTML fires on every stream flush; the ref keeps the bootstrap
  // to a single emission near the top of the document.
  const bootstrapInserted = useRef(false);
  useServerInsertedHTML(() => {
    if (bootstrapInserted.current) {
      return null;
    }
    bootstrapInserted.current = true;
    // eslint-disable-next-line react/no-danger -- static self-authored no-flash bootstrap (no user input); an inline script is the only way to set the theme class before first paint
    return <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} suppressHydrationWarning />;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <ThemeProvider defaultTheme="system" disableTransitionOnChange enableSystem>
          <ThemeSetter />
          {children}
        </ThemeProvider>
      </NuqsAdapter>
      <Toaster />
    </QueryClientProvider>
  );
};

export default AppProviders;
