import { config } from '@/config';

/**
 * Single canonical app URL resolver.
 *
 * Returns the validated `NEXT_PUBLIC_APP_URL` (Zod schema in
 * config/env.schema.ts defaults to `https://www.omnivyra.com`) with any
 * trailing slash stripped, so callers can safely append paths that begin
 * with `/`.
 *
 * Use this everywhere a user-facing URL is built — emailed links, share
 * helpers, internal worker→app fetches, OAuth redirect_uri builders,
 * sitemap/RSS, anywhere a stable canonical origin is needed.
 *
 * Replaces the scattered `process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'`
 * pattern that previously leaked localhost URLs into customer-facing emails
 * when the env was unset on the Railway worker (no NEXT_PUBLIC_* build
 * pipeline) or after a Vercel sensitive-env regression, and the
 * VERCEL_URL preview-hostname leak in sitemap/RSS that could poison Google
 * Search Console with preview-deploy URLs.
 */
export function getCanonicalAppUrl(): string {
  const raw = config.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com';
  return raw.replace(/\/+$/, '');
}
