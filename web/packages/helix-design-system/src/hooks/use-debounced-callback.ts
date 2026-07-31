import * as React from 'react';

import { useCallbackRef } from './use-callback-ref';

/** Stable callback that delays invoking `callback` until `delay` ms after the latest call; cleared on unmount. */
export const useDebouncedCallback = <T extends (...args: never[]) => unknown>(
  callback: T,
  delay: number,
) => {
  const handleCallback = useCallbackRef(callback);
  const debounceTimerRef = React.useRef(0);
  React.useEffect(
    () => () => {
      window.clearTimeout(debounceTimerRef.current);
    },
    [],
  );

  const setValue = React.useCallback(
    (...args: Parameters<T>) => {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => handleCallback(...args), delay);
    },
    [handleCallback, delay],
  );

  return setValue;
};
