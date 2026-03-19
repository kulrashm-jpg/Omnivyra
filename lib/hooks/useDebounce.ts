/**
 * useDebounce — zero-dependency debounce hook.
 *
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * milliseconds of silence. Pending timer is cleared on unmount.
 *
 * Usage:
 *   const debouncedFreq = useDebounce(frequencyMultiplier, 120);
 *   // debouncedFreq lags the live value by up to 120ms
 *   // → safe to use as a useMemo dependency for expensive computations
 */

import { useEffect, useRef, useState } from 'react';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer from the last render
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setDebounced(value);
      timerRef.current = null;
    }, delayMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, delayMs]);

  return debounced;
}
