import * as React from 'react';

/**
 * Returns a stable function identity that always calls the latest `callback`.
 * @see https://github.com/radix-ui/primitives/blob/main/packages/react/use-callback-ref/src/useCallbackRef.tsx
 */
const useCallbackRef =<T extends (...args: never[]) => unknown>(callback: T | undefined): T => {
  const callbackRef = React.useRef(callback);

  React.useEffect(() => {
    callbackRef.current = callback;
  });

  // https://github.com/facebook/react/issues/19240
  return React.useMemo(() => ((...args) => callbackRef.current?.(...args)) as T, []);
};

export { useCallbackRef };
