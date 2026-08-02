/**
 * Canonical HTTP cache policies — the single source of truth (OPT-002).
 *
 * Every API response maps to exactly one of the five policies below
 * (docs/performance/HTTP-CACHE-POLICY.md is the reference matrix):
 *
 *   P1  Public immutable   — content-hashed static assets only. Next.js emits
 *                            this itself for /_next/static; no helper exists on
 *                            purpose: no API route may ever use it.
 *   P2  Public SWR         — setPublicSwr(). Tenant-free, identity-free
 *                            responses with written justification only.
 *   P3  Private browser    — setPrivateCache(). Guarded, read-only GETs.
 *                            `private` bars every shared cache (CDN included);
 *                            `Vary: Authorization, Cookie` keys entries by
 *                            principal for BOTH Bearer and cookie auth (legacy
 *                            super-admin and SSR-cookie principals send no
 *                            Authorization header, so Cookie must participate).
 *   P4  Private no-store   — setPrivateNoStore(). Sensitive per-user reads
 *                            that must never persist (sessions, billing
 *                            instruments, in-progress onboarding).
 *   P5  Never cache        — setNeverCache(). Machine/security endpoints:
 *                            auth flows, webhooks, cron, anything with secrets.
 *
 * Rules baked in:
 *  - setPrivateCache accepts ONLY the three canonical TTL tiers, so ad-hoc
 *    lifetimes cannot drift in route-by-route.
 *  - No helper emits `public` or `s-maxage` alongside tenant data (INV-6 of
 *    docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md): setPublicSwr is the only
 *    shared-cache emitter and exists solely for explicitly public routes.
 *  - Call a helper ONLY on the success (200) path. Error responses ship with
 *    no cache directives.
 */

import type { NextApiResponse } from 'next';

/** Canonical private-cache TTL tiers (seconds). No other values are valid. */
export const CACHE_TTL = {
  /** Near-live tenant reads: counts, notification lists, progress-adjacent lists. */
  NEAR_LIVE: 30,
  /** Standard tenant reads: settings, stats, connection lists. */
  STANDARD: 60,
  /** Stable reads: reference data, terminal-state payloads. */
  STABLE: 300,
} as const;

export type CacheTtlSeconds = (typeof CACHE_TTL)[keyof typeof CACHE_TTL];

/**
 * P3 — Private browser cache for guarded, read-only GET responses.
 * `Vary: Authorization, Cookie` is non-negotiable: it keys cache entries by
 * principal for Bearer AND cookie-authenticated callers.
 */
export function setPrivateCache(res: NextApiResponse, maxAgeSeconds: CacheTtlSeconds): void {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  res.setHeader('Vary', 'Authorization, Cookie');
}

/** P4 — Sensitive per-user response that must never be stored by any cache. */
export function setPrivateNoStore(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'private, no-store');
}

/** P5 — Machine/security endpoints (auth flows, webhooks, cron, secrets). */
export function setNeverCache(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * P2 — Public shared-cache with stale-while-revalidate.
 * ONLY for tenant-free, identity-free responses (e.g. blog RSS/sitemap) with a
 * written justification at the call site. Never valid after auth resolution.
 */
export function setPublicSwr(
  res: NextApiResponse,
  sMaxAgeSeconds = 300,
  staleWhileRevalidateSeconds = 600,
): void {
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
  );
}
