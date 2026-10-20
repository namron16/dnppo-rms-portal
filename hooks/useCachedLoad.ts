"use client";
// hooks/useCachedLoad.ts
//
// Load page data with a "bookmark":
//   1. If we saved this page's data before -> show it immediately (no spinner).
//   2. Always fetch fresh data in the background, then replace what's shown.
//   3. Only the very first visit shows the spinner (`loading` = true).
//
// Usage:
//   const { loading, reload } = useCachedLoad<MyData>(
//     user ? scopedKey(user.id, 'my-page') : null,   // null = "not ready yet"
//     async () => fetchEverythingInParallel(),        // returns the data
//     (data) => { setItems(data.items) },             // put it into your state
//     (err)  => toast.error('Could not load')         // optional
//   )

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAndCache, peekCache } from "@/lib/pageCache";

export function useCachedLoad<T>(
  key: string | null,
  loader: () => Promise<T>,
  onData: (data: T) => void,
  onError?: (error: unknown) => void
): { loading: boolean; reload: () => Promise<void> } {
  // Keep the latest functions without re-triggering the effect every render
  const loaderRef = useRef(loader);
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);
  loaderRef.current = loader;
  onDataRef.current = onData;
  onErrorRef.current = onError;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(
    () => key === null || peekCache<T>(key) === undefined
  );

  const run = useCallback(
    async (force = false) => {
      if (!key) return;
      try {
        const fresh = await fetchAndCache(
          key,
          () => loaderRef.current(),
          force
        );
        if (mounted.current) onDataRef.current(fresh);
      } catch (e) {
        console.error(`[useCachedLoad] "${key}" failed:`, e);
        if (mounted.current) onErrorRef.current?.(e);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    if (!key) return;
    const cached = peekCache<T>(key);
    if (cached !== undefined) {
      onDataRef.current(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void run();
  }, [key, run]);

  /** Force a fresh fetch (e.g. after creating or deleting something). */
  const reload = useCallback(() => run(true), [run]);

  return { loading, reload };
}
