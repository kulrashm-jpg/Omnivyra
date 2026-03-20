/**
 * domainEligibilityService.ts
 *
 * Validates whether an email domain qualifies for free credit access.
 * Checks (in order): blocklist → public provider → disposable → MX → forwarding → eligible
 * Results are cached in domain_eligibility_cache (TTL 24h).
 */

import dns from 'dns/promises';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Known forwarding MX hostname fragments
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

export type EligibilityStatus = 'eligible' | 'blocked' | 'pending_review';
export type EligibilityReason =
  | 'valid_company'
  | 'whitelisted'
  | 'user_override'
  | 'blocked_domain'
  | 'blocked_pattern'
  | 'public_provider'
  | 'disposable'
  | 'no_mx'
  | 'forwarding_domain';

export interface EligibilityResult {
  status: EligibilityStatus;
  reason: EligibilityReason;
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

async function getCachedResult(domain: string): Promise<EligibilityResult | null> {
  const { data } = await supabase
    .from('domain_eligibility_cache')
    .select('*')
    .eq('domain', domain)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!data) return null;

  return {
    status: data.status as EligibilityStatus,
    reason: data.reason as EligibilityReason,
    domain: data.domain,
    has_mx: data.has_mx,
    mx_hosts: data.mx_hosts ?? [],
    is_forwarding: data.is_forwarding,
    cached: true,
  };
}

async function setCachedResult(result: Omit<EligibilityResult, 'cached'>): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('domain_eligibility_cache').upsert({
    domain: result.domain,
    status: result.status,
    reason: result.reason,
    has_mx: result.has_mx,
    mx_hosts: result.mx_hosts,
    is_forwarding: result.is_forwarding,
    expires_at: expiresAt,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'domain' });
}

/**
 * Core eligibility check. Order of operations:
 * 1. User-level override (always eligible if set)
 * 2. Domain whitelist
 * 3. Blocked domains (exact)
 * 4. Blocked domain patterns (LIKE)
 * 5. Public email providers
 * 6. Disposable domains
 * 7. MX record check (no MX → blocked)
 * 8. Forwarding detection (forwarding → pending_review)
 * 9. Passes all → eligible
 */
export async function checkDomainEligibility(
  email: string,
  userId?: string,
): Promise<EligibilityResult> {
  const domain = extractDomain(email);
  if (!domain) {
    return { status: 'blocked', reason: 'blocked_domain', domain: '', has_mx: false, mx_hosts: [], is_forwarding: false, cached: false };
  }

  // 1. User override
  if (userId) {
    const { data: override } = await supabase
      .from('user_override')
      .select('is_eligible')
      .eq('user_id', userId)
      .maybeSingle();

    if (override) {
      return {
        status: override.is_eligible ? 'eligible' : 'blocked',
        reason: override.is_eligible ? 'user_override' : 'blocked_domain',
        domain,
        has_mx: true,
        mx_hosts: [],
        is_forwarding: false,
        cached: false,
      };
    }
  }

  // 2. Domain whitelist
  const { data: whitelisted } = await supabase
    .from('domain_whitelist')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();

  if (whitelisted) {
    return { status: 'eligible', reason: 'whitelisted', domain, has_mx: true, mx_hosts: [], is_forwarding: false, cached: false };
  }

  // 3–6: Check cache before DB lookups + DNS
  const cached = await getCachedResult(domain);
  if (cached) return cached;

  // 3. Blocked domains (exact)
  const { data: blocked } = await supabase
    .from('blocked_domains')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();

  if (blocked) {
    const result: Omit<EligibilityResult, 'cached'> = { status: 'blocked', reason: 'blocked_domain', domain, has_mx: false, mx_hosts: [], is_forwarding: false };
    await setCachedResult(result);
    return { ...result, cached: false };
  }

  // 4. Blocked domain patterns
  const { data: patterns } = await supabase
    .from('blocked_domain_patterns')
    .select('pattern');

  if (patterns?.length) {
    const matchesPattern = patterns.some(({ pattern }) => {
      // Convert SQL LIKE pattern to regex
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
      return regex.test(domain);
    });
    if (matchesPattern) {
      const result: Omit<EligibilityResult, 'cached'> = { status: 'blocked', reason: 'blocked_pattern', domain, has_mx: false, mx_hosts: [], is_forwarding: false };
      await setCachedResult(result);
      return { ...result, cached: false };
    }
  }

  // 5. Public email providers
  const { data: publicProvider } = await supabase
    .from('public_email_providers')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();

  if (publicProvider) {
    const result: Omit<EligibilityResult, 'cached'> = { status: 'pending_review', reason: 'public_provider', domain, has_mx: true, mx_hosts: [], is_forwarding: false };
    await setCachedResult(result);
    return { ...result, cached: false };
  }

  // 6. Disposable domains
  const { data: disposable } = await supabase
    .from('disposable_domains')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();

  if (disposable) {
    const result: Omit<EligibilityResult, 'cached'> = { status: 'blocked', reason: 'disposable', domain, has_mx: false, mx_hosts: [], is_forwarding: false };
    await setCachedResult(result);
    return { ...result, cached: false };
  }

  // 7–8. DNS MX check
  const { has_mx, mx_hosts, is_forwarding } = await checkMxRecords(domain);

  if (!has_mx) {
    const result: Omit<EligibilityResult, 'cached'> = { status: 'blocked', reason: 'no_mx', domain, has_mx: false, mx_hosts: [], is_forwarding: false };
    await setCachedResult(result);
    return { ...result, cached: false };
  }

  if (is_forwarding) {
    const result: Omit<EligibilityResult, 'cached'> = { status: 'pending_review', reason: 'forwarding_domain', domain, has_mx: true, mx_hosts, is_forwarding: true };
    await setCachedResult(result);
    return { ...result, cached: false };
  }

  // 9. All checks passed → eligible
  const result: Omit<EligibilityResult, 'cached'> = { status: 'eligible', reason: 'valid_company', domain, has_mx: true, mx_hosts, is_forwarding: false };
  await setCachedResult(result);
  return { ...result, cached: false };
}

/**
 * Invalidate cache for a domain (call after admin approves/rejects/whitelists).
 */
export async function invalidateDomainCache(domain: string): Promise<void> {
  await supabase.from('domain_eligibility_cache').delete().eq('domain', domain);
}
