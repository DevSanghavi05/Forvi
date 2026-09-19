import { useSyncExternalStore } from 'react';

const query = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export default function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = query();
      if (!mq) return () => {};
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => query()?.matches ?? false,
    () => false
  );
}
