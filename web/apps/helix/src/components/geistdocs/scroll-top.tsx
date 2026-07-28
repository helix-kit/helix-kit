'use client';

import { useCallback } from 'react';

import { ArrowUpCircleIcon } from 'lucide-react';

export const ScrollTop = () => {
  const handleScrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <button
      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
      type="button"
      onClick={handleScrollToTop}
    >
      <ArrowUpCircleIcon className="size-3.5" />
      <span>Scroll to top</span>
    </button>
  );
};
