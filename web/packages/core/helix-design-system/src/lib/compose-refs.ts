/* eslint-disable */

import * as React from 'react';

type PossibleRef<T> = React.Ref<T> | undefined;

/**
 * Set a given ref to a given value
 * This utility takes care of different types of refs: callback refs and RefObject(s)
 */
const setRef = <T>(ref: PossibleRef<T>, value: T) => {
  if (typeof ref === 'function') {
    return ref(value);
  }

  if (ref !== null && ref !== undefined) {
    ref.current = value;
  }
};

/**
 * Composes multiple refs into a single callback ref.
 *
 * Supports both object refs and callback refs, including React 19 callback-ref
 * cleanup functions when a consumer returns one.
 */
const composeRefs =
  <T>(...refs: PossibleRef<T>[]): React.RefCallback<T> =>
  (node) => {
    let hasCleanup = false;
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup === 'function') {
        hasCleanup = true;
      }
      return cleanup;
    });

    // React <19 will log an error to the console if a callback ref returns a
    // value. We don't use ref cleanups internally so this will only happen if a
    // user's ref callback returns a value, which we only expect if they are
    // using the cleanup functionality added in React 19.
    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i];
          if (typeof cleanup === 'function') {
            cleanup();
          } else {
            setRef(refs[i], null);
          }
        }
      };
    }
  };

/** Memoized hook form of `composeRefs` for use inside React components. */
const useComposedRefs = <T>(...refs: PossibleRef<T>[]): React.RefCallback<T> =>
  React.useCallback(composeRefs(...refs), refs);

export { composeRefs, useComposedRefs };
