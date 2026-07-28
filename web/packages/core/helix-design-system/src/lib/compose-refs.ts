/* eslint-disable */

import * as React from 'react';

type PossibleRef<T> = React.Ref<T> | undefined;

const setRef = <T>(ref: PossibleRef<T>, value: T) => {
  if (typeof ref === 'function') {
    return ref(value);
  }

  if (ref !== null && ref !== undefined) {
    ref.current = value;
  }
};

/** Composes multiple refs (object and callback, incl. React 19 cleanup) into one callback ref. */
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

    // React <19 logs an error if a callback ref returns a value; only reached via a consumer's React 19 cleanup ref.
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
