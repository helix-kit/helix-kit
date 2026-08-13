'use client';

import { cn } from '@helix-hq/design-system/lib/utils';
import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/components/theme-provider';
import { useHydrated } from '@/hooks/use-hydrated';

const options = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

export const ThemeToggleSegmented = ({ className }: { className?: string }) => {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div
      aria-label="Theme"
      className={cn(
        'border-border/70 bg-card/50 inline-flex items-center gap-0.5 rounded-full border p-0.5 backdrop-blur-sm',
        className,
      )}
      role="radiogroup"
    >
      {options.map(({ value, label, Icon }) => {
        const active = hydrated && theme === value;
        return (
          <button
            key={value}
            aria-checked={active}
            aria-label={label}
            className={cn(
              'flex size-7 items-center justify-center rounded-full transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            role="radio"
            title={label}
            type="button"
            onClick={() => {
              setTheme(value);
            }}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
};
