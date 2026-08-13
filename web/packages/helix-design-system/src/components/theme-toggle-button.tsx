'use client';

import { Button, type ButtonProps } from '@helix-hq/design-system/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helix-hq/design-system/components/dropdown-menu';
import { useTheme } from '@helix-hq/design-system/components/theme-provider';
import { cn } from '@helix-hq/design-system/lib/utils';
import { MoonIcon, SunIcon } from 'lucide-react';

type ThemeToggleButtonProps = Readonly<{
  className?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
}>;

export const ThemeToggleButton = ({
  className,
  size = 'icon-sm',
  variant = 'outline',
}: ThemeToggleButtonProps = {}) => {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn('relative shrink-0', className)}
          data-slot="theme-toggle-button"
          size={size}
          variant={variant}
        >
          <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            setTheme('light');
          }}
        >
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme('dark');
          }}
        >
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme('system');
          }}
        >
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
