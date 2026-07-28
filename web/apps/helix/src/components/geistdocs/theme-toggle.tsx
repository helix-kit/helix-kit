'use client';

import { Button } from '@helix/design-system/components/button';
import { MoonIcon, SunIcon } from 'lucide-react';

import { useTheme } from '@/components/theme-provider';
import { useHydrated } from '@/hooks/use-hydrated';

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const handleClick = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  if (!hydrated) {
    return (
      <Button size="icon-sm" type="button" variant="ghost">
        <div className="size-4" />
      </Button>
    );
  }

  const Icon = resolvedTheme === 'dark' ? MoonIcon : SunIcon;

  return (
    <Button size="icon-sm" type="button" variant="ghost" onClick={handleClick}>
      <Icon className="size-4" />
    </Button>
  );
};
