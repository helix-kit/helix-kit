'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type ThemeContextValue = {
  theme: Theme | undefined;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme | undefined;
  systemTheme: ResolvedTheme | undefined;
  themes: Theme[];
};

const MEDIA = '(prefers-color-scheme: dark)';
// Fires on same-tab setTheme so useSyncExternalStore re-reads (native `storage` is cross-tab only).
const THEME_CHANGE_EVENT = 'helix-theme-change';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Briefly kill CSS transitions across a theme switch so colors snap (next-themes disableTransitionOnChange parity).
const suppressTransitions = () => {
  const style = document.createElement('style');
  style.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'));
  document.head.appendChild(style);
  return () => {
    window.getComputedStyle(document.body);
    setTimeout(() => {
      document.head.removeChild(style);
    }, 1);
  };
};

export type ThemeProviderProps = Readonly<{
  children: ReactNode;
  defaultTheme?: Theme;
  enableSystem?: boolean;
  storageKey?: string;
  disableTransitionOnChange?: boolean;
}>;

/**
 * Framework-agnostic dark/light provider that renders NO inline <script> (avoids React 19's
 * script-tag warning); the host must inject a pre-paint bootstrap to prevent the hydration flash.
 */
export const ThemeProvider = ({
  children,
  defaultTheme = 'system',
  enableSystem = true,
  storageKey = 'theme',
  disableTransitionOnChange = false,
}: ThemeProviderProps) => {
  const subscribeStored = useCallback(
    (onChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) {
          onChange();
        }
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(THEME_CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(THEME_CHANGE_EVENT, onChange);
      };
    },
    [storageKey],
  );

  const readStored = useCallback((): Theme => {
    try {
      return (window.localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
    } catch {
      return defaultTheme;
    }
  }, [storageKey, defaultTheme]);

  const readServer = useCallback((): Theme => defaultTheme, [defaultTheme]);

  const theme = useSyncExternalStore(subscribeStored, readStored, readServer);

  const subscribeSystem = useCallback((onChange: () => void) => {
    const media = window.matchMedia(MEDIA);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  const readSystem = useCallback(
    (): ResolvedTheme => (window.matchMedia(MEDIA).matches ? 'dark' : 'light'),
    [],
  );

  const readSystemServer = useCallback((): ResolvedTheme | undefined => undefined, []);

  const systemTheme = useSyncExternalStore(subscribeSystem, readSystem, readSystemServer);

  let resolvedTheme: ResolvedTheme | undefined;
  if (theme === 'light' || theme === 'dark') {
    resolvedTheme = theme;
  } else {
    resolvedTheme = enableSystem ? systemTheme : 'light';
  }

  useEffect(() => {
    if (resolvedTheme === undefined) {
      return;
    }
    const root = document.documentElement;
    const restore = disableTransitionOnChange ? suppressTransitions() : undefined;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
    restore?.();
  }, [resolvedTheme, disableTransitionOnChange]);

  const setTheme = useCallback(
    (next: Theme) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Storage unavailable (private mode); the event below still re-reads, updating in-memory theme.
      }
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      systemTheme,
      themes: enableSystem ? ['light', 'dark', 'system'] : ['light', 'dark'],
    }),
    [theme, setTheme, resolvedTheme, systemTheme, enableSystem],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// Lenient like next-themes: a no-op shape when read outside a provider instead of throwing.
const FALLBACK: ThemeContextValue = {
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
  systemTheme: undefined,
  themes: [],
};

export const useTheme = (): ThemeContextValue => useContext(ThemeContext) ?? FALLBACK;
