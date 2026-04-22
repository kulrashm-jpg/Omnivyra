import type { PlaywrightStorageState } from './rpaSessionStore';

/**
 * Converts a raw cookie + localStorage payload captured by the Chrome
 * extension's `chrome.cookies.getAll(...)` + page-scope `localStorage`
 * into a Playwright-compatible `storageState` blob.
 *
 * Input shape (as produced by the extension's capture handler):
 *   {
 *     cookies: [{ name, value, domain, path, expirationDate?, secure,
 *                 httpOnly, sameSite: 'no_restriction'|'lax'|'strict'|'none' }...],
 *     origins: [{ origin, localStorage: [{ name, value }], sessionStorage?: [...] }]
 *   }
 *
 * Playwright expects:
 *   cookies: { name, value, domain, path, expires, httpOnly, secure, sameSite: 'Strict'|'Lax'|'None' }
 *   origins: { origin, localStorage: [{ name, value }] }
 */

type RawCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number; // chrome.cookies format (unix seconds, float)
  expires?: number;        // alternate shape
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

type RawOrigin = {
  origin: string;
  localStorage?: Array<{ name: string; value: string }>;
};

export type RawSessionCapture = {
  cookies?: RawCookie[];
  origins?: RawOrigin[];
};

function normalizeSameSite(value: string | undefined): 'Strict' | 'Lax' | 'None' {
  const v = (value || 'lax').toString().toLowerCase().replace(/_/g, '');
  if (v.includes('strict')) return 'Strict';
  if (v === 'none' || v === 'norestriction' || v === 'nonerestriction') return 'None';
  return 'Lax';
}

function normalizeDomain(domain: string | undefined): string {
  if (!domain) return '';
  // Playwright accepts either ".example.com" (host-wide) or "example.com"
  // (exact). Chrome cookie API returns both; pass through as-is.
  return domain;
}

export function importSessionCapture(raw: RawSessionCapture): PlaywrightStorageState {
  const cookies = Array.isArray(raw.cookies) ? raw.cookies : [];
  const origins = Array.isArray(raw.origins) ? raw.origins : [];

  const pwCookies = cookies
    .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string')
    .map((c) => {
      const expires =
        typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate)
        : typeof c.expires === 'number' ? Math.floor(c.expires)
        : -1; // session cookie
      return {
        name: c.name,
        value: c.value,
        domain: normalizeDomain(c.domain),
        path: c.path || '/',
        expires,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: normalizeSameSite(c.sameSite),
      };
    });

  const pwOrigins = origins
    .filter((o) => o && typeof o.origin === 'string')
    .map((o) => ({
      origin: o.origin,
      localStorage: Array.isArray(o.localStorage)
        ? o.localStorage
            .filter((kv) => kv && typeof kv.name === 'string' && typeof kv.value === 'string')
            .map((kv) => ({ name: kv.name, value: kv.value }))
        : [],
    }));

  return { cookies: pwCookies, origins: pwOrigins };
}
