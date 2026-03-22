'use client';

/**
 * BlogPerformanceTracker
 *
 * Invisible component. Mounted on each blog page.
 * Tracks: time on page, max scroll depth, completion (reached article bottom).
 * Sends data on unmount via sendBeacon (or fetch fallback).
 * Sends a periodic heartbeat every 30s to capture long reads.
 *
 * Session deduplication via sessionStorage — one record per browser tab per blog.
 * No user identifiers are stored. GDPR-safe.
 */

import { useEffect, useRef } from 'react';

interface Props {
  slug: string;
}

function generateSessionKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function BlogPerformanceTracker({ slug }: Props) {
  const startTimeRef    = useRef<number>(Date.now());
  const scrollDepthRef  = useRef<number>(0);
  const completedRef    = useRef<boolean>(false);
  const sessionKeyRef   = useRef<string>('');
  const flushedRef      = useRef<boolean>(false);

  // Initialise session key (one per tab per slug)
  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;

    const storageKey = `bpt_${slug}`;
    const existing   = sessionStorage.getItem(storageKey);

    if (existing) {
      sessionKeyRef.current = existing;
    } else {
      const key = generateSessionKey();
      sessionKeyRef.current = key;
      sessionStorage.setItem(storageKey, key);
    }

    startTimeRef.current = Date.now();
  }, [slug]);

  // Scroll depth tracking
  useEffect(() => {
    if (!slug) return;

    const onScroll = () => {
      const el     = document.documentElement;
      const total  = el.scrollHeight - el.clientHeight;
      if (total <= 0) return;
      const depth  = Math.round((window.scrollY / total) * 100);
      if (depth > scrollDepthRef.current) {
        scrollDepthRef.current = depth;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [slug]);

  // Completion detection — IntersectionObserver on a bottom sentinel
  useEffect(() => {
    if (!slug) return;

    const sentinel = document.getElementById('article-bottom-sentinel');
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          completedRef.current = true;
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [slug]);

  // Flush function — sends current data to the API
  const flush = (final: boolean = false) => {
    if (!sessionKeyRef.current || !slug) return;
    if (final && flushedRef.current) return;
    if (final) flushedRef.current = true;

    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const payload = JSON.stringify({
      session_key:  sessionKeyRef.current,
      time_seconds: elapsed,
      scroll_depth: scrollDepthRef.current,
      completed:    completedRef.current,
    });

    const url = `/api/blog/${encodeURIComponent(slug)}/track`;

    // Use sendBeacon for final flush (reliable on tab close)
    if (final && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        body:        payload,
        keepalive:   true,
      }).catch(() => {});
    }
  };

  // Periodic heartbeat (every 30s)
  useEffect(() => {
    if (!slug) return;
    const interval = setInterval(() => flush(false), 30_000);
    return () => clearInterval(interval);
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final flush on unmount and beforeunload
  useEffect(() => {
    if (!slug) return;

    const onBeforeUnload = () => flush(true);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush(true);
    };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
