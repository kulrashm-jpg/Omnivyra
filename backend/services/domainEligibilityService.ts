import { ownedDbTable } from '../db/writeOwner';
/**
 * domainEligibilityService.ts
 *
 * Email-stage domain eligibility detection. Classifies an email domain into a
 * canonical DomainEligibilityResult (defined in lib/auth/domainEligibilityModel.ts —
 * the single source of result codes + messages).
 *
 * Detection order (UNCHANGED): override → whitelist → blocklist → pattern →
 * public provider → disposable → MX → forwarding → eligible.
 * Results cached in domain_eligibility_cache (TTL 24h).
 */

import dns from 'dns/promises';
import {
  type DomainEligibilityResult,
  eligibleResults,
  reviewableResults,
} from '../../lib/auth/domainEligibilityModel';
import { isPersonalEmailDomain } from '../../lib/auth/serverValidation';

// Known forwarding MX hostname fragments.
const FORWARDING_MX_PATTERNS = [
  'improvmx',
  'forwardemail',
  'mailgun',
  'sendgrid',
  'emailforwarding',
  'pobox',
  'yandex',
  'mxroute',
  'forwardmx',
  'simplelogin',
  'anonaddy',
];

export interface EligibilityResult {
  result: DomainEligibilityResult;
  eligible: boolean;
  domain: string;
  has_mx: boolean;
  mx_hosts: string[];
  is_forwarding: boolean;
  cached: boolean;
}

function extractDomain(email: string): string {
  return email.trim().toLowerCase().split('@').pop() ?? '';
}

async function checkMxRecords(domain: string): Promise<{ has_mx: boolean; mx_hosts: string[]; is_forwarding: boolean }> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) {
      return { has_mx: false, mx_hosts: [], is_forwarding: false };
    }
    const mx_hosts = records.map(r => r.exchange.toLowerCase());
    const is_forwarding = mx_hosts.some(host =>
      FORWARDING_MX_PATTERNS.some(pattern => host.includes(pattern)),
    );
    return { has_mx: true, mx_hosts, is_forwarding };
  } catch {
    return { has_mx: false, mx_hosts: [], is_forwarding: false };
  }
}

// ─── Cache compatibility ──────────────────────────────────────────────────────
// The cache's `reason` column now stores the canonical DomainEligibilityResult and
// `status` is derived from it. Rows written before this refactor stored legacy
// reason strings; normalizeStoredResult maps those on read (they expire within 24h).
const ALL_RESULTS = new Set<DomainEligibilityResult>([
  'DOMAIN_ELIGIBLE', 'PUBLIC_EMAIL', 'DISPOSABLE_EMAIL', 'NO_EMAIL_CAPABILITY',
  'NO_WEBSITE_FOUND', 'DOMAIN_MISMATCH',
  'FORWARDING_DOMAIN', 'DOMAIN_NOT_CANONICAL', 'CLAIMED_DOMAIN', 'BLOCKED',
]);
const LEGACY_REASON_TO_RESULT: Record<string, DomainEligibilityResult> = {
  valid_company: 'DOMAIN_ELIGIBLE',
  whitelisted: 'DOMAIN_ELIGIBLE',
  user_override: 'DOMAIN_ELIGIBLE',
  blocked_domain: 'BLOCKED',
  blocked_pattern: 'BLOCKED',
  public_provider: 'PUBLIC_EMAIL',
  disposable: 'DISPOSABLE_EMAIL',
  no_mx: 'NO_EMAIL_CAPABILITY',
  forwarding_domain: 'FORWARDING_DOMAIN',
};
function normalizeStoredResult(stored: string | null | undefined): DomainEligibilityResult {
  if (stored && ALL_RESULTS.has(stored as DomainEligibilityResult)) return stored as DomainEligibilityResult;
  if (stored && LEGACY_REASON_TO_RESULT[stored]) return LEGACY_REASON_TO_RESULT[stored];
  return 'BLOCKED';
}
function statusForCache(result: DomainEligibilityResult): 'eligible' | 'blocked' | 'pending_review' {
  if (eligibleResults.has(result)) return 'eligible';
  if (reviewableResults.has(result)) return 'pending_review';
  return 'blocked';
}
function asResult(
  result: DomainEligibilityResult,
  domain: string,
  extra?: { has_mx?: boolean; mx_hosts?: string[]; is_forwarding?: boolean; cached?: boolean },
): EligibilityResult {
  return {
    result,
    eligible: eligibleResults.has(result),
    domain,
    has_mx: extra?.has_mx ?? false,
    mx_hosts: extra?.mx_hosts ?? [],
    is_forwarding: extra?.is_forwarding ?? false,
    cached: extra?.cached ?? false,
  };
}

async function getCachedResult(domain: string): Promise<EligibilityResult | null> {
  const { data } = await ownedDbTable('domain_eligibility_cache')
    .select('*')
    .eq('domain', domain)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  return asResult(normalizeStoredResult(data.reason), data.domain, {
    has_mx: data.has_mx,
    mx_hosts: data.mx_hosts ?? [],
    is_forwarding: data.is_forwarding,
    cached: true,
  });
}

async function setCachedResult(r: EligibilityResult): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await ownedDbTable('domain_eligibility_cache').upsert({
    domain: r.domain,
    status: statusForCache(r.result),
    reason: r.result,
    has_mx: r.has_mx,
    mx_hosts: r.mx_hosts,
    is_forwarding: r.is_forwarding,
    expires_at: expiresAt,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'domain' });
}

/**
 * Core email-stage eligibility check. Detection order is unchanged; each branch
 * emits a canonical DomainEligibilityResult.
 */
export async function checkDomainEligibility(
  email: string,
  userId?: string,
): Promise<EligibilityResult> {
  const domain = extractDomain(email);
  if (!domain) return asResult('BLOCKED', '');

  // 1. User override (not cached)
  if (userId) {
    const { data: override } = await ownedDbTable('user_override')
      .select('is_eligible')
      .eq('user_id', userId)
      .maybeSingle();
    if (override) {
      return asResult(override.is_eligible ? 'DOMAIN_ELIGIBLE' : 'BLOCKED', domain, { has_mx: true });
    }
  }

  // 2. Domain whitelist (not cached)
  const { data: whitelisted } = await ownedDbTable('domain_whitelist')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();
  if (whitelisted) return asResult('DOMAIN_ELIGIBLE', domain, { has_mx: true });

  // 3–6: cache before DB lookups + DNS
  const cached = await getCachedResult(domain);
  if (cached) return cached;

  // 3. Blocked domains (exact)
  const { data: blocked } = await ownedDbTable('blocked_domains')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();
  if (blocked) {
    const r = asResult('BLOCKED', domain);
    await setCachedResult(r);
    return r;
  }

  // 4. Blocked domain patterns
  const { data: patterns } = await ownedDbTable('blocked_domain_patterns').select('pattern');
  if (patterns?.length) {
    const matchesPattern = patterns.some(({ pattern }) => {
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
      return regex.test(domain);
    });
    if (matchesPattern) {
      const r = asResult('BLOCKED', domain);
      await setCachedResult(r);
      return r;
    }
  }

  // 5. Public / personal email providers (hardcoded personal blocklist + table)
  let isPublicProvider = isPersonalEmailDomain(domain);
  if (!isPublicProvider) {
    const { data: publicProvider } = await ownedDbTable('public_email_providers')
      .select('domain')
      .eq('domain', domain)
      .maybeSingle();
    isPublicProvider = !!publicProvider;
  }
  if (isPublicProvider) {
    const r = asResult('PUBLIC_EMAIL', domain, { has_mx: true });
    await setCachedResult(r);
    return r;
  }

  // 6. Disposable domains
  const { data: disposable } = await ownedDbTable('disposable_domains')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();
  if (disposable) {
    const r = asResult('DISPOSABLE_EMAIL', domain);
    await setCachedResult(r);
    return r;
  }

  // 7–8. DNS MX check
  const { has_mx, mx_hosts, is_forwarding } = await checkMxRecords(domain);
  if (!has_mx) {
    const r = asResult('NO_EMAIL_CAPABILITY', domain);
    await setCachedResult(r);
    return r;
  }
  if (is_forwarding) {
    const r = asResult('FORWARDING_DOMAIN', domain, { has_mx: true, mx_hosts, is_forwarding: true });
    await setCachedResult(r);
    return r;
  }

  // 9. All checks passed → eligible
  const r = asResult('DOMAIN_ELIGIBLE', domain, { has_mx: true, mx_hosts });
  await setCachedResult(r);
  return r;
}

/**
 * Invite-path work-email gate. Returns true when `domain` is NOT a work email
 * for invitation purposes: a personal/free provider (static blocklist OR the
 * public_email_providers table) or a disposable domain.
 *
 * Unlike checkDomainEligibility, it deliberately does NOT require MX / a live
 * website — invitees join an already-validated company and may use any
 * legitimate work domain. Fail-open on DB errors: the static personal blocklist
 * (isPersonalEmailDomain) is the HARD guarantee that always runs; the two DB
 * lookups are best-effort hardening and must never let a transient DB blip
 * reject a legitimate invite. SUPER_ADMIN/backend callers bypass this entirely
 * (enforced at the route, not here).
 */
export async function isNonWorkEmailDomain(domain: string): Promise<boolean> {
  const d = (domain || '').trim().toLowerCase();
  if (!d) return false; // empty/malformed → caller handles format separately
  // Static + env personal blocklist — synchronous, authoritative, no network.
  if (isPersonalEmailDomain(d)) return true;
  // Best-effort DB hardening: DB-extended public providers + disposable list.
  try {
    const [pub, disp] = await Promise.all([
      ownedDbTable('public_email_providers').select('domain').eq('domain', d).maybeSingle(),
      ownedDbTable('disposable_domains').select('domain').eq('domain', d).maybeSingle(),
    ]);
    return !!(pub.data || disp.data);
  } catch {
    return false; // fail-open — never block a real invite on a DB hiccup
  }
}

/** Invalidate cache for a domain (call after admin approves/rejects/whitelists). */
export async function invalidateDomainCache(domain: string): Promise<void> {
  await ownedDbTable('domain_eligibility_cache').delete().eq('domain', domain);
}
