/**
 * WS-2 Milestone-2 — visitor device & location context.
 *
 * THE single parse point for both dimensions. Capture calls these once per
 * request and persists the result into `visitor_sessions.metadata` (exactly as
 * Milestone-1 does for `metadata.visitor`); the snapshot assembler maps it back
 * out. Nothing re-parses a user-agent downstream, and no engine performs I/O.
 *
 * Both functions are PURE and total: any input, including garbage, returns
 * either a value or `null` — never a throw, and never a guess presented as a
 * fact. An unrecognised browser is `null`, not `"Unknown"`, so a consumer can
 * tell "we don't know" from "we know it isn't".
 *
 * PRIVACY. Nothing here introduces new personal data:
 *  • the user-agent string is ALREADY stored on every `tracking_events` row;
 *    this only derives coarse categories from it and stores no new raw value.
 *  • geography is read from edge-provided request headers (country / region /
 *    city / timezone). The raw IP is never stored — the capture path already
 *    reduces it to `ip_hash` — and none of these fields identifies a person.
 *  • city is the finest granularity accepted, and it is dropped entirely when
 *    the edge does not provide it. No geo-IP lookup is performed, so there is
 *    no new third-party egress and no new PII processor.
 */

/** Coarse device classification derived from a user-agent string. */
export interface CapturedDeviceContext {
  /** Narrow device type: phone, tablet, desktop, tv, bot. */
  deviceType: string | null;
  /** Coarse grouping used for scoring: mobile | tablet | desktop | other. */
  deviceCategory: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  /** Vendor platform family: apple | android | windows | linux | other. */
  platform: string | null;
}

/** Coarse geography, sourced from edge headers only. */
export interface CapturedGeoContext {
  /** IANA timezone, e.g. `Europe/Berlin`. */
  timezone: string | null;
  /** ISO-3166-1 alpha-2, uppercased. */
  country: string | null;
  region: string | null;
  city: string | null;
}

const clean = (v: unknown, max = 80): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 512) return null;
  return t.slice(0, max);
};

/** First capture group of the first pattern that matches, else null. */
const firstMatch = (ua: string, patterns: RegExp[]): string | null => {
  for (const re of patterns) {
    const m = ua.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
};

/** Trim a version to at most `parts` dotted segments (`17.4.1` → `17.4`). */
const shortVersion = (raw: string | null, parts = 2): string | null => {
  if (!raw) return null;
  const norm = raw.replace(/_/g, '.').replace(/[^0-9.]/g, '');
  const segs = norm.split('.').filter(Boolean).slice(0, parts);
  return segs.length > 0 ? segs.join('.') : null;
};

/**
 * Order matters: several browsers embed other browsers' tokens (Edge and Opera
 * both claim "Chrome"; Chrome claims "Safari"), so the most specific token must
 * be tested first. Same for OS — Android carries "Linux".
 */
const BROWSERS: Array<{ name: string; test: RegExp; version: RegExp[] }> = [
  { name: 'Edge', test: /\bedg(?:e|a|ios)?\//i, version: [/\bedg(?:e|a|ios)?\/([\d.]+)/i] },
  { name: 'Opera', test: /\b(?:opr|opera)\//i, version: [/\b(?:opr|opera)\/([\d.]+)/i] },
  { name: 'Samsung Internet', test: /samsungbrowser\//i, version: [/samsungbrowser\/([\d.]+)/i] },
  { name: 'Firefox', test: /\b(?:firefox|fxios)\//i, version: [/\b(?:firefox|fxios)\/([\d.]+)/i] },
  { name: 'Chrome', test: /\b(?:chrome|crios|chromium)\//i, version: [/\b(?:chrome|crios|chromium)\/([\d.]+)/i] },
  { name: 'Safari', test: /\bsafari\//i, version: [/\bversion\/([\d.]+)/i] },
];

const BOT = /(bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse|pingdom|curl\/|wget\/|python-requests|axios\/|node-fetch)/i;

/**
 * Parse a user-agent into coarse device intelligence.
 *
 * Returns `null` for an empty/unusable string so callers persist nothing rather
 * than an object full of nulls — "no device context" and "device context we
 * could not read" stay distinguishable downstream.
 */
export function parseUserAgent(userAgent: unknown): CapturedDeviceContext | null {
  const ua = clean(userAgent, 512);
  if (!ua) return null;

  if (BOT.test(ua)) {
    return { deviceType: 'bot', deviceCategory: 'other', browser: null, browserVersion: null, os: null, osVersion: null, platform: 'other' };
  }

  // ── OS + platform ─────────────────────────────────────────────────────────
  let os: string | null = null;
  let osVersion: string | null = null;
  let platform: string | null = null;
  if (/\bandroid\b/i.test(ua)) {
    os = 'Android';
    osVersion = shortVersion(firstMatch(ua, [/android\s([\d._]+)/i]));
    platform = 'android';
  } else if (/\b(iphone|ipad|ipod)\b/i.test(ua)) {
    os = 'iOS';
    osVersion = shortVersion(firstMatch(ua, [/os\s([\d._]+)\slike\smac/i, /version\/([\d.]+)/i]));
    platform = 'apple';
  } else if (/windows nt/i.test(ua)) {
    os = 'Windows';
    // Windows NT kernel versions do not match the marketing name; 10.0 covers
    // both 10 and 11 and the UA cannot distinguish them, so it is left as-is.
    osVersion = shortVersion(firstMatch(ua, [/windows nt\s([\d.]+)/i]));
    platform = 'windows';
  } else if (/mac os x/i.test(ua)) {
    os = 'macOS';
    osVersion = shortVersion(firstMatch(ua, [/mac os x\s([\d._]+)/i]));
    platform = 'apple';
  } else if (/\bcros\b/i.test(ua)) {
    os = 'ChromeOS';
    platform = 'linux';
  } else if (/\blinux\b/i.test(ua)) {
    os = 'Linux';
    platform = 'linux';
  }

  // ── Device type + category ────────────────────────────────────────────────
  let deviceType: string | null = null;
  if (/\b(smart-?tv|appletv|googletv|hbbtv|crkey)\b/i.test(ua)) deviceType = 'tv';
  else if (/\bipad\b/i.test(ua) || (/\bandroid\b/i.test(ua) && !/\bmobile\b/i.test(ua)) || /\btablet\b/i.test(ua)) deviceType = 'tablet';
  else if (/\b(iphone|ipod)\b/i.test(ua) || /\bmobile\b/i.test(ua) || /\bwindows phone\b/i.test(ua)) deviceType = 'phone';
  else if (os) deviceType = 'desktop';

  const deviceCategory =
    deviceType === 'phone' ? 'mobile'
      : deviceType === 'tablet' ? 'tablet'
        : deviceType === 'desktop' ? 'desktop'
          : deviceType ? 'other' : null;

  // ── Browser ───────────────────────────────────────────────────────────────
  let browser: string | null = null;
  let browserVersion: string | null = null;
  for (const b of BROWSERS) {
    if (b.test.test(ua)) {
      browser = b.name;
      browserVersion = shortVersion(firstMatch(ua, b.version));
      break;
    }
  }

  // Nothing recognised at all — treat as unusable rather than inventing a shape.
  if (!browser && !os && !deviceType) return null;
  return { deviceType, deviceCategory, browser, browserVersion, os, osVersion, platform };
}

/** Header names carrying edge geography, in priority order per dimension. */
const GEO_HEADERS = {
  country: ['x-vercel-ip-country', 'cf-ipcountry', 'x-geo-country'],
  region: ['x-vercel-ip-country-region', 'cf-region', 'x-geo-region'],
  city: ['x-vercel-ip-city', 'cf-ipcity', 'x-geo-city'],
  timezone: ['x-vercel-ip-timezone', 'cf-timezone', 'x-geo-timezone'],
} as const;

const headerValue = (headers: Record<string, unknown>, names: readonly string[]): string | null => {
  for (const n of names) {
    const raw = headers[n] ?? headers[n.toLowerCase()];
    const v = clean(Array.isArray(raw) ? raw[0] : raw);
    // Edge headers URL-encode city names ("San%20Francisco").
    if (v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
};

const IANA_TZ = /^[A-Za-z]+(?:[_+-][A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*){1,2}$/;

/**
 * Read coarse geography from edge request headers. No IP lookup, no egress.
 * Absent or malformed values degrade to null; an all-null result returns
 * `null` so nothing is persisted when the edge provided nothing.
 *
 * `clientTimezone` is the browser-reported IANA zone (from the tracker), used
 * only when the edge did not supply one — it is self-declared, so it never
 * overrides the edge value.
 */
export function extractGeoContext(headers: Record<string, unknown> | null | undefined, clientTimezone?: unknown): CapturedGeoContext | null {
  const h = headers && typeof headers === 'object' ? (headers as Record<string, unknown>) : {};
  const rawCountry = headerValue(h, GEO_HEADERS.country);
  const country = rawCountry && /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : null;
  const edgeTz = headerValue(h, GEO_HEADERS.timezone);
  const declaredTz = clean(clientTimezone, 64);
  const tzCandidate = edgeTz ?? declaredTz;
  const timezone = tzCandidate && IANA_TZ.test(tzCandidate) ? tzCandidate : null;

  const geo: CapturedGeoContext = {
    timezone,
    country,
    region: headerValue(h, GEO_HEADERS.region),
    city: headerValue(h, GEO_HEADERS.city),
  };
  return geo.timezone || geo.country || geo.region || geo.city ? geo : null;
}

/**
 * UTC offset in hours for an IANA zone at a given instant, or null when the
 * runtime cannot resolve it. Uses `Intl` only — no timezone database ships
 * with this code, and an unknown zone degrades rather than throwing.
 */
export function utcOffsetHours(timezone: string | null, atIso: string): number | null {
  if (!timezone) return null;
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(at));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    if (!Number.isFinite(asUtc)) return null;
    return Math.round(((asUtc - at) / 3_600_000) * 2) / 2; // half-hour zones exist
  } catch {
    return null;
  }
}

/**
 * Human-readable geographic context, e.g. "Berlin, BE, DE (Europe/Berlin)".
 * Null when nothing is known. Used for explanation strings only.
 */
export function describeGeo(geo: CapturedGeoContext | null): string | null {
  if (!geo) return null;
  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
  if (place && geo.timezone) return `${place} (${geo.timezone})`;
  return place || geo.timezone || null;
}
