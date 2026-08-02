'use client';

import { useState } from 'react';

/** Copies a URL and flashes a confirmation. Silent where the clipboard is unavailable. */
export const useCopyLink = () => {
  const [copied, setCopied] = useState(false);

  const copy = (url: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        return;
      }
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    })();
  };

  return { copied, copy };
};
