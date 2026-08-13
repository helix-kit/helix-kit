'use client';

import { useEffect, useState } from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';

const sections = [
  { id: 'home', label: 'Home' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'layers', label: 'Layers' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'open-source', label: 'Open Source' },
  { id: 'get-started', label: 'Get Started' },
] as const;

const FIRST = sections[0].id;
const LAST = sections[sections.length - 1]?.id ?? FIRST;

export const SectionRail = () => {
  const [active, setActive] = useState<string>(FIRST);

  useEffect(() => {
    let frame = 0;

    const compute = () => {
      // Active section = the last one whose top has scrolled above 42% of the viewport (always exactly one winner).
      const line = window.innerHeight * 0.42;
      let current: string = FIRST;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el !== null && el.getBoundingClientRect().top <= line) {
          current = s.id;
        }
      }
      // Snap to the final section once the page is scrolled to the very bottom.
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        current = LAST;
      }
      setActive(current);
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav
      aria-label="Section navigation"
      className="pointer-events-none fixed top-1/2 left-4 z-40 hidden -translate-y-1/2 lg:block"
    >
      <ol className="relative flex flex-col gap-5">
        <span aria-hidden className="bg-border/50 absolute top-2 bottom-2 left-[3px] w-px" />
        {sections.map((s, i) => {
          const isActive = active === s.id;
          return (
            <li key={s.id} className="pointer-events-auto relative flex items-center">
              <a
                aria-current={isActive ? 'true' : undefined}
                className="group flex items-center gap-3"
                href={`#${s.id}`}
              >
                <span
                  className={cn(
                    'relative z-10 rounded-full transition-all duration-300',
                    isActive
                      ? 'bg-brand size-2 shadow-[0_0_12px_3px_var(--color-brand)]'
                      : 'bg-muted-foreground/40 group-hover:bg-muted-foreground size-[7px]',
                  )}
                />
                <span
                  className={cn(
                    'flex items-center font-mono text-[10px] tracking-widest tabular-nums transition-colors',
                    isActive
                      ? 'text-brand'
                      : 'text-muted-foreground/50 group-hover:text-muted-foreground',
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                  <span
                    className={cn(
                      'ml-2 overflow-hidden uppercase transition-all duration-300',
                      isActive
                        ? 'max-w-[7rem] opacity-100'
                        : 'max-w-0 opacity-0 group-hover:max-w-[7rem] group-hover:opacity-70',
                    )}
                  >
                    {s.label}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
