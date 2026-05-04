/**
 * domainVerificationService.ts
 *
 * Confirms domain ownership by checking that the per-domain verification
 * token has been published via either:
 *
 *   A) DNS TXT record:  omnivira-verification=TOKEN  (on the canonical apex)
 *   B) HTTP file:       https://<final_domain>/.well-known/omnivira.txt
 *                       body == TOKEN (trimmed)
 *
 * The token is generated at company_domains row INSERT time by saveDomainRecord
 * for user-flow rows (created_via='user'). admin/system rows do not carry a
 * token and are not subject to this gate.
 *
 * Pure utility — does NOT mutate the DB. The caller (POST /api/domain/verify)
 * stamps verification_status='verified' / verification_method / verified_at
 * after this service returns { verified: true }.
 */

import dns from 'dns/promises';
import { logger } from './logger';
import {
  normalizeDomain,
  safeDispatcher,
} from './domainCanonicalService';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { hashVerificationToken, constantTimeEqualHex } from './verificationSecret';
import { logDomainEvent } from './domainEventLogger';

const TXT_PREFIX = 'omnivira-verification=';
const HTTP_PATH = '/.well-known/omnivira.txt';
const PER_HOP_TIMEOUT_MS = 3_000;
const MAX_HTTP_BODY_BYTES = 10_240; // 10 KB

export type VerificationMethod = 'dns' | 'http';

export interface VerifyDomainOutcome {
  verified: boolean;
  method?: VerificationMethod;
  /** Reason for the latest failure, surfaced when verified=false. */
  failure_reason?: string;
  /** Per-method outcomes — useful for debugging from the UI. */
  attempted: {
    dns:  { matched: boolean; detail: string };
    http: { matched: boolean; detail: string };
  };
}

export interface DomainRowForVerify {
  id: string;
  company_id: string;
  final_domain: string;
  verification_token: string | null;
  verification_status: string;
  created_via: string;
}

/**
 * DNS check — looks for a TXT record like `omnivira-verification=<published>`.
 * Hashes the published value and compares to the stored HMAC.
 *
 * @param expectedHmac  HMAC-SHA-256 of the raw token, as stored in
 *                      company_domains.verification_token.
 */
async function checkDnsTxt(
  domain: string,
  expectedHmac: string,
): Promise<{ matched: boolean; detail: string }> {
  try {
    const records = await dns.resolveTxt(domain);
    for (const chunks of records) {
      const joined = chunks.join('');
      if (!joined.startsWith(TXT_PREFIX)) continue;
      const published = joined.slice(TXT_PREFIX.length);
      if (constantTimeEqualHex(hashVerificationToken(published), expectedHmac)) {
        return { matched: true, detail: 'token_matched' };
      }
    }
    return { matched: false, detail: 'no_matching_txt_record' };
  } catch (err) {
    return {
      matched: false,
      detail: `dns_error:${(err as Error)?.message ?? 'unknown'}`,
    };
  }
}

/**
 * HTTP check — fetches /.well-known/omnivira.txt, treats the trimmed body as
 * the published raw token, hashes it, compares to the stored HMAC.
 *
 * @param expectedHmac  HMAC-SHA-256 of the raw token, as stored in
 *                      company_domains.verification_token.
 */
async function checkHttpFile(
  domain: string,
  expectedHmac: string,
): Promise<{ matched: boolean; detail: string }> {
  const url = `https://${domain}${HTTP_PATH}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_HOP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      // @ts-expect-error — undici extension; SSRF + rebind protection.
      dispatcher: safeDispatcher,
    });
    if (!res.ok) {
      return { matched: false, detail: `http_status:${res.status}` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { matched: false, detail: 'no_body' };
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > MAX_HTTP_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { matched: false, detail: 'body_too_large' };
      }
      if (value) chunks.push(value);
    }
    const published = Buffer.concat(chunks).toString('utf8').trim();
    if (constantTimeEqualHex(hashVerificationToken(published), expectedHmac)) {
      return { matched: true, detail: 'token_matched' };
    }
    return { matched: false, detail: 'token_mismatch' };
  } catch (err) {
    return {
      matched: false,
      detail: `fetch_error:${(err as Error)?.message ?? 'unknown'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a company_domains row by canonical (final_domain). Caller passes
 * the result into verifyDomainRow; we keep the DB lookup separate so the
 * verify endpoint can skip the lookup when it already has the row.
 */
export async function fetchDomainForVerify(finalDomain: string): Promise<{
  ok: true;
  row: DomainRowForVerify;
} | { ok: false; error: 'NOT_FOUND' | 'DB_ERROR'; details?: string }> {
  const fd = normalizeDomain(finalDomain);
  if (!fd) return { ok: false, error: 'NOT_FOUND' };
  const { data, error } = await supabase
    .from('company_domains')
    .select('id, company_id, final_domain, verification_token, verification_status, created_via')
    .eq('final_domain', fd)
    .maybeSingle();
  if (error) {
    logger.error('domain_verify_lookup_failed', { domain: fd, message: error.message });
    return { ok: false, error: 'DB_ERROR', details: error.message };
  }
  if (!data) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, row: data as DomainRowForVerify };
}

/**
 * Run the DNS + HTTP token checks against an already-loaded domain row.
 *
 * Returns { verified: false } without throwing on any failure path.
 * Does NOT mutate the row.
 */
export async function verifyDomainRow(
  row: DomainRowForVerify,
): Promise<VerifyDomainOutcome> {
  if (!row.verification_token) {
    return {
      verified: false,
      failure_reason: 'NO_TOKEN_AVAILABLE',
      attempted: {
        dns:  { matched: false, detail: 'no_token' },
        http: { matched: false, detail: 'no_token' },
      },
    };
  }

  const dnsResult = await checkDnsTxt(row.final_domain, row.verification_token);
  if (dnsResult.matched) {
    return {
      verified: true,
      method: 'dns',
      attempted: {
        dns:  dnsResult,
        http: { matched: false, detail: 'not_attempted' },
      },
    };
  }

  const httpResult = await checkHttpFile(row.final_domain, row.verification_token);
  if (httpResult.matched) {
    return {
      verified: true,
      method: 'http',
      attempted: { dns: dnsResult, http: httpResult },
    };
  }

  return {
    verified: false,
    failure_reason: 'TOKEN_NOT_PUBLISHED',
    attempted: { dns: dnsResult, http: httpResult },
  };
}

/**
 * Convenience entry point: lookup + verify in one call.
 * Used by POST /api/domain/verify.
 */
export async function verifyDomain(finalDomain: string): Promise<{
  ok: true;
  row: DomainRowForVerify;
  outcome: VerifyDomainOutcome;
} | { ok: false; error: 'NOT_FOUND' | 'DB_ERROR'; details?: string }> {
  const lookup = await fetchDomainForVerify(finalDomain);
  if (lookup.ok === false) return lookup;
  const outcome = await verifyDomainRow(lookup.row);
  return { ok: true, row: lookup.row, outcome };
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft-enforcement helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a `domain_unverified_usage` log event when a sensitive operation is
 * being performed on behalf of a company whose domain is not yet 'verified'
 * or 'admin_override'. Soft enforcement only — no blocking.
 *
 * Callers pass the operation name and any additional context. Dashboards
 * can aggregate by company_id / operation to drive a verified-vs-unverified
 * adoption metric.
 */
export function logDomainUnverifiedUsage(input: {
  company_id: string;
  final_domain: string;
  verification_status: string;
  operation: string;
  metadata?: Record<string, unknown>;
}): void {
  if (
    input.verification_status === 'verified'
    || input.verification_status === 'admin_override'
  ) {
    return;
  }
  logger.info('domain_unverified_usage', {
    event: 'domain_unverified_usage',
    company_id: input.company_id,
    final_domain: input.final_domain,
    verification_status: input.verification_status,
    operation: input.operation,
    timestamp: new Date().toISOString(),
    ...(input.metadata ?? {}),
  });
  // Mirror to the analytics table — fire-and-forget; never throws.
  void logDomainEvent({
    event_type:   'DOMAIN_UNVERIFIED_USAGE',
    company_id:   input.company_id,
    final_domain: input.final_domain,
    metadata:     {
      verification_status: input.verification_status,
      operation:           input.operation,
      ...(input.metadata ?? {}),
    },
  });
}

/**
 * Convenience wrapper for callers that have a company_id but no domain row
 * in hand. Looks up the company's primary domain and emits the soft-enforcement
 * log if its status is not verified/admin_override.
 *
 * Never throws; emits no log on companies with zero domain rows.
 */
export async function logDomainUnverifiedUsageForCompany(input: {
  company_id: string;
  operation: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.company_id) return;
  const { data, error } = await supabase
    .from('company_domains')
    .select('final_domain, verification_status, is_primary')
    .eq('company_id', input.company_id)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return;
  logDomainUnverifiedUsage({
    company_id:          input.company_id,
    final_domain:        (data as any).final_domain,
    verification_status: (data as any).verification_status,
    operation:           input.operation,
    metadata:            input.metadata,
  });
}
