'use client';

import { useEffect } from 'react';

import { useCookies } from 'next-client-cookies';

import { useTheme } from '@/components/theme-provider';
import { THEME_COOKIE } from '@/types';

const COOKIE_MAX_AGE_DAYS = 365;

const ThemeSetter = () => {
  const cookies = useCookies();
  const { theme, resolvedTheme } = useTheme();

  useEffect(() => {
    const currentTheme = resolvedTheme ?? theme ?? 'light';
    const existingCookie = cookies.get(THEME_COOKIE);

    if (existingCookie !== currentTheme) {
      cookies.set(THEME_COOKIE, currentTheme, { expires: COOKIE_MAX_AGE_DAYS, path: '/' });
    }
  }, [theme, resolvedTheme, cookies]);

  return null;
};

export default ThemeSetter;
