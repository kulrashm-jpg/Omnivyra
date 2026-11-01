/**
 * RPA target-URL policy — the single source of truth for which URLs an RPA
 * task may navigate to, per platform, and which action types each platform
 * supports through RPA.
 *
 * Every RPA navigation MUST pass `validateRpaTarget` first. It is called by
 * `executeRpaTask` (before any queueing / environment work) and again by
 * `runRpaScript` immediately before `page.goto` (defence in depth: the
 * script's targetUrl must also be the validated task URL), and once more on
 * the URL the page landed on after `page.goto`, before any interaction.
 *
 * Rules (all must hold, else the task is refused and NOTHING is navigated):
 *   - the platform has a non-empty domain allowlist (missing/empty => refuse)
 *   - the action type is in the platform's supported set
 *   - the URL parses (WHATWG URL) and uses `https:`
 *   - no credentials (`user:pass@`), no explicit port
 *   - hostname is not an IP literal (v4 or v6)
 *   - hostname === d, or hostname ends with '.' + d, for some allowlisted d
 *     (rejects lookalikes such as `facebook.com.evil.com`, `evilfacebook.com`)
 *   - a URL that belongs to a DIFFERENT platform's allowlist is reported as
 *     cross-platform (it is refused either way).
 *
 * Refusals are pre-request: they are provably-not-acted outcomes.
 */

export type RpaActionType = 'reply' | 'like' | 'share' | 'follow' | 'schedule';

export type RpaPlatformUrlPolicy = {
  /** Registrable domains. Subdomains are allowed; lookalikes are not. */
  domains: readonly string[];
  /** Action types this platform supports through RPA. */
  actions: readonly RpaActionType[];
};

export const RPA_PLATFORM_URL_POLICY: Readonly<Record<string, RpaPlatformUrlPolicy>> = Object.freeze({
  linkedin:  { domains: ['linkedin.com'],             actions: ['reply', 'like'] },
  facebook:  { domains: ['facebook.com'],             actions: ['reply', 'like'] },
  instagram: { domains: ['instagram.com'],            actions: ['reply', 'like'] },
  twitter:   { domains: ['twitter.com', 'x.com'],     actions: ['reply', 'like'] },
  reddit:    { domains: ['reddit.com'],               actions: ['reply', 'like'] },
});

export type RpaTargetValidation =
  | { ok: true; url: string; host: string }
  | { ok: false; error: RpaTargetUrlError };

export type RpaTargetUrlError =
  | 'RPA_PLATFORM_NOT_ALLOWLISTED'
  | 'RPA_ACTION_NOT_SUPPORTED_FOR_PLATFORM'
  | 'RPA_TARGET_URL_MALFORMED'
  | 'RPA_TARGET_URL_NOT_HTTPS'
  | 'RPA_TARGET_URL_HAS_CREDENTIALS'
  | 'RPA_TARGET_URL_HAS_PORT'
  | 'RPA_TARGET_URL_IP_LITERAL'
  | 'RPA_TARGET_URL_CROSS_PLATFORM'
  | 'RPA_TARGET_URL_HOST_NOT_ALLOWED';

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeDomain(d: unknown): string | null {
  if (typeof d !== 'string') return null;
  const v = d.trim().toLowerCase();
  if (!v || v.startsWith('.') || v.endsWith('.') || v.includes('/') || v.includes(':')) return null;
  return v;
}

export function hostMatchesDomains(host: string, domains: readonly string[] | null | undefined): boolean {
  if (!host || !Array.isArray(domains) || domains.length === 0) return false;
  const h = host.toLowerCase();
  for (const raw of domains) {
    const d = normalizeDomain(raw);
    if (!d) continue;
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

export function validateRpaTarget(
  input: { platform: string | null | undefined; action_type: string | null | undefined; target_url: string | null | undefined },
  policy: Readonly<Record<string, RpaPlatformUrlPolicy>> = RPA_PLATFORM_URL_POLICY,
): RpaTargetValidation {
  const platform = String(input.platform ?? '').trim().toLowerCase();
  const entry = platform ? policy[platform] : undefined;
  const domains = entry?.domains ?? [];
  if (!entry || !Array.isArray(domains) || domains.filter((d) => normalizeDomain(d)).length === 0) {
    return { ok: false, error: 'RPA_PLATFORM_NOT_ALLOWLISTED' };
  }
  const actionType = String(input.action_type ?? '').trim().toLowerCase();
  if (!Array.isArray(entry.actions) || !(entry.actions as readonly string[]).includes(actionType)) {
    return { ok: false, error: 'RPA_ACTION_NOT_SUPPORTED_FOR_PLATFORM' };
  }

  const raw = typeof input.target_url === 'string' ? input.target_url.trim() : '';
  if (!raw) return { ok: false, error: 'RPA_TARGET_URL_MALFORMED' };
  // Whitespace / control characters inside the URL are never legitimate.
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return { ok: false, error: 'RPA_TARGET_URL_MALFORMED' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'RPA_TARGET_URL_MALFORMED' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'RPA_TARGET_URL_NOT_HTTPS' };
  const afterScheme = raw.slice(raw.indexOf('//') >= 0 ? raw.indexOf('//') + 2 : 0);
  const authority = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  if (url.username || url.password || authority.includes('@')) {
    return { ok: false, error: 'RPA_TARGET_URL_HAS_CREDENTIALS' };
  }
  if (url.port) return { ok: false, error: 'RPA_TARGET_URL_HAS_PORT' };

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, error: 'RPA_TARGET_URL_MALFORMED' };
  if (host.startsWith('[') || host.includes(':') || IPV4_RE.test(host)) {
    return { ok: false, error: 'RPA_TARGET_URL_IP_LITERAL' };
  }

  if (!hostMatchesDomains(host, domains)) {
    for (const [other, otherEntry] of Object.entries(policy)) {
      if (other !== platform && hostMatchesDomains(host, otherEntry?.domains)) {
        return { ok: false, error: 'RPA_TARGET_URL_CROSS_PLATFORM' };
      }
    }
    return { ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' };
  }
  return { ok: true, url: url.toString(), host };
}
