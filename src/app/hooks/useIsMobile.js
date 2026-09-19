'use client';

import { useEffect, useState } from 'react';

// Tracks whether a media query currently matches, without ever touching
// `window` during render — the first client render must match the server's
// markup, so we start at `undefined` and only resolve after mount.
// Default breakpoint matches Tailwind's `md` (min-width: 768px).
export default function useIsMobile(query = '(max-width: 767px)') {
  const [isMobile, setIsMobile] = useState(undefined);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setIsMobile(mql.matches);
    const onChange = (e) => setIsMobile(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 fallback
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return isMobile;
}
