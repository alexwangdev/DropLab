import { useEffect, useState } from 'react';

/**
 * Counts from 0 to `target` with requestAnimationFrame over `durationMs`, ease-out.
 * Cancels its frame on unmount or when the target changes. Under reduced motion it jumps straight to the target.
 * Returns the target immediately when the target is 0 or the user prefers reduced motion.
 */
export function useCountUp(target: number, durationMs = 400): number {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced || target === 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return value;
}
