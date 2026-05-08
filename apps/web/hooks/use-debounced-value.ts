'use client';

import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value`. The returned value lags `value` by
 * `delayMs` after the last change — typical use is the search input on
 * a list page that fires a TanStack Query keyed off the debounced value
 * so each keystroke doesn't fire a request.
 *
 * The cleanup clears the pending timeout on unmount or when `value` /
 * `delayMs` change, so unmounted components don't leak a pending update.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
