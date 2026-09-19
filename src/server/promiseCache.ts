/**
 * Remembers the promise `compute` returns for each key, so later and concurrent calls with the key
 * share its answer. A promise that rejects is forgotten, so the next call tries again.
 */
export function promiseCache<T>() {
  const cache = new Map<string, Promise<T>>();
  return async (key: string, compute: () => Promise<T>): Promise<{ value: T; cached: boolean }> => {
    const cached = cache.has(key);
    if (!cached) {
      cache.set(
        key,
        compute().catch((error) => {
          cache.delete(key);
          throw error;
        }),
      );
    }
    return { value: await cache.get(key)!, cached };
  };
}
