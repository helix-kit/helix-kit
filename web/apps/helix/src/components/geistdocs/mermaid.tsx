'use client';

import { use, useId } from 'react';

import { useTheme } from '@/components/theme-provider';
import { useHydrated } from '@/hooks/use-hydrated';

export const Mermaid = ({ chart }: { chart: string }) => {
  const hydrated = useHydrated();

  if (!hydrated) {
    return null;
  }

  return <MermaidContent chart={chart} />;
};

const cache = new Map<string, Promise<unknown>>();

const cachePromise = <T,>(key: string, setPromise: () => Promise<T>): Promise<T> => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as Promise<T>;
  }

  const promise = setPromise();
  cache.set(key, promise);
  return promise;
};

const MermaidContent = ({ chart }: { chart: string }) => {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(cachePromise('mermaid', () => import('mermaid')));

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    fontFamily: 'inherit',
    themeCSS: 'margin: 0 auto;',
    theme: resolvedTheme === 'dark' ? 'dark' : 'default',
  });

  const { svg, bindFunctions } = use(
    cachePromise(`${chart}-${resolvedTheme}`, () =>
      mermaid.render(id, chart.replaceAll('\\n', '\n')),
    ),
  );

  return (
    <div className="not-prose border-border/60 from-muted/50 to-muted/10 dark:from-muted/30 dark:to-background/0 my-6 flex justify-center overflow-x-auto rounded-xl border bg-gradient-to-b p-6">
      <div
        ref={(container) => {
          if (container === null) {
            return;
          }

          const parsedSvg = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
          container.replaceChildren(parsedSvg);

          if (typeof bindFunctions === 'function') {
            bindFunctions(container);
          }
        }}
        className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      />
    </div>
  );
};
