// lib/pageCache.ts
// A tiny in-memory "bookmark" for page data.
//   - First visit: fetch from the server (spinner shows).
//   - Revisit:     show the saved copy instantly, then refresh quietly.
// Lives only in the browser tab's memory, so it disappears on reload/logout.
// Keys are scoped per user so one account never sees another's data.

const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export const scopedKey = (userId: string, name: string) => `${userId}:${name}`;

export function peekCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCache<T>(key: string, data: T) {
  store.set(key, data);
}

/** Wipe everything. Call on login and logout. */
export function clearPageCache() {
  store.clear();
  inflight.clear();
}

/**
 * Runs `fetcher`, saves the result, and returns it.
 * If the same key is already loading, shares that request (no double fetch)
 * unless `force` is true (use after a create/delete so you never get old data).
 */
export function fetchAndCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  force = false
): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing && !force) return existing;

  const p: Promise<T> = fetcher()
    .then((data) => {
      store.set(key, data);
      return data;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}
