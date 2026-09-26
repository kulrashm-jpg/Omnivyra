/**
 * PO-3 — which companies are due for a public advertising observation.
 *
 * ─── NO NEW ELIGIBILITY MODEL ─────────────────────────────────────────────
 * Eligibility is `canonical_domains`: a company with a canonical domain row is exactly a company
 * Report 1 can describe, because `resolveReportDomainScope` resolves that same row and a report
 * with no resolvable domain reads nothing. Reusing it means there is no second notion of "active"
 * to drift out of step with the report's own.
 *
 * ─── DUE IS SCOPED BY COMPANY **AND** DOMAIN ──────────────────────────────
 * A company can change domain. An observation of the previous one must not satisfy the current
 * one's due condition, or the report would keep serving advertising evidence about a site the
 * customer no longer runs — the R1-OPEN-01 defect, in a new place. Both filters are applied.
 *
 * ─── BOUNDED RETRY, NO RETRY SUBSYSTEM ────────────────────────────────────
 * Two independent gaps, from the evidence history that already exists:
 *   • a SUCCESSFUL observation within 24h  ⇒ not due (the daily cadence)
 *   • ANY attempt within the retry gap     ⇒ not due (bounds failure retries)
 * A blocked provider therefore retries a few times a day rather than every cycle, and no separate
 * retry table, backoff column or scheduler state is introduced.
 */
import { supabase } from '../../db/supabaseClient';
import type { AdsAcquisitionSubject } from './adsAcquisitionScheduler';

const SUCCESS_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Minimum gap between ATTEMPTS, successful or not.
 *
 * Six hours caps a persistently blocked provider at ~4 attempts a day per subject instead of one
 * per cycle. It is deliberately shorter than the success interval: a transient block should not
 * cost a full day of evidence, and a permanent one is still bounded.
 */
const RETRY_GAP_MS = 6 * 60 * 60 * 1000;
/** Eligible domains scanned per cycle. Bounds the query, not the fan-out — the cycle caps that. */
const SCAN_LIMIT = 200;

type EvidenceRow = {
  observed_at: string;
  scope?: { kind?: string; domain_id?: string | null } | null;
  signal_summary?: { accessState?: string } | null;
};

/** Pure. Exported so the due rule is tested directly rather than through two database fakes. */
export function isDue(params: {
  now: number;
  history: ReadonlyArray<{ observedAt: string; accessState: string | null }>;
}): boolean {
  let lastAttempt = -Infinity;
  let lastSuccess = -Infinity;
  for (const row of params.history) {
    const at = Date.parse(row.observedAt);
    if (!Number.isFinite(at)) continue;
    if (at > lastAttempt) lastAttempt = at;
    // Only `observed` counts as success. `blocked`, `restricted`, `requires_auth`, `unreachable`
    // and `unavailable` are attempts that established nothing — treating any of them as success
    // would suppress re-acquisition and leave the report permanently unable to look.
    if (row.accessState === 'observed' && at > lastSuccess) lastSuccess = at;
  }
  if (params.now - lastSuccess < SUCCESS_INTERVAL_MS) return false;
  if (params.now - lastAttempt < RETRY_GAP_MS) return false;
  return true;
}

/**
 * Production `listDueSubjects`.
 *
 * Returns at most `limit` subject/domain pairs, each appearing at most once. Never throws: the
 * scheduler counts a failure rather than crashing the cron tick.
 */
export async function listDueAdsSubjects(limit: number): Promise<AdsAcquisitionSubject[]> {
  const now = Date.now();
  try {
    const { data: domains, error } = await supabase
      .from('canonical_domains')
      .select('id, company_id, primary_domain')
      .order('updated_at', { ascending: true })
      .limit(SCAN_LIMIT);
    if (error || !Array.isArray(domains)) return [];

    const out: AdsAcquisitionSubject[] = [];
    // De-duplication key is company + domain, so the same pair cannot be enqueued twice even if
    // the table somehow holds two rows for it.
    const seen = new Set<string>();

    for (const row of domains as Array<{ id?: string; company_id?: string; primary_domain?: string }>) {
      if (out.length >= limit) break;
      const companyId = String(row.company_id ?? '').trim();
      const domainId = String(row.id ?? '').trim();
      const domain = String(row.primary_domain ?? '').trim().toLowerCase();
      // A subject with no usable public domain is not acquired for at all: there would be nothing
      // to scope the evidence to, and nothing to run a secondary domain query against.
      if (!companyId || !domainId || !domain) continue;
      const key = `${companyId}|${domainId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const history = await loadHistory(companyId, domainId);
      if (!isDue({ now, history })) continue;

      const identity = await loadSubjectIdentity(companyId, domainId);
      out.push({
        companyId,
        domainId,
        destinationDomain: domain,
        subject: identity,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Recent `ads_transparency` rows for THIS company and THIS domain. */
async function loadHistory(
  companyId: string,
  domainId: string,
): Promise<Array<{ observedAt: string; accessState: string | null }>> {
  try {
    const { data, error } = await supabase
      .from('report_evidence_history')
      .select('observed_at, scope, signal_summary')
      .eq('company_id', companyId)
      .order('observed_at', { ascending: false })
      .limit(25);
    if (error || !Array.isArray(data)) return [];
    return (data as EvidenceRow[])
      .filter((r) => r.scope?.kind === 'ads_transparency' && (r.scope?.domain_id ?? null) === domainId)
      .map((r) => ({ observedAt: r.observed_at, accessState: r.signal_summary?.accessState ?? null }));
  } catch {
    return [];
  }
}

/**
 * The subject's public identity anchors, from evidence the crawl already stored for THIS domain.
 *
 * `declaredLegalName` is the only anchor that can reach `MATCHED`, and it is read from the site's
 * own Organization JSON-LD — never from the company profile, which is the customer's assertion and
 * cannot corroborate a provider-verified name. A subject without one still gets acquired: its
 * advertisers are reportable as candidates and third parties, which is a real finding.
 */
async function loadSubjectIdentity(companyId: string, domainId: string): Promise<AdsAcquisitionSubject['subject']> {
  let declaredLegalName: string | null = null;
  let jurisdiction: string | null = null;
  try {
    const { data } = await supabase
      .from('canonical_pages')
      .select('crawl_metadata')
      .eq('company_id', companyId)
      .eq('domain_id', domainId)
      .limit(50);
    for (const row of (data ?? []) as Array<{ crawl_metadata?: { signals?: { legal_name?: string | null; address_country?: string | null } } | null }>) {
      const signals = row.crawl_metadata?.signals;
      if (!declaredLegalName && typeof signals?.legal_name === 'string' && signals.legal_name.trim()) {
        declaredLegalName = signals.legal_name.trim();
      }
      if (!jurisdiction && typeof signals?.address_country === 'string' && signals.address_country.trim()) {
        jurisdiction = signals.address_country.trim();
      }
      if (declaredLegalName && jurisdiction) break;
    }
  } catch { /* identity stays null; the resolver then cannot reach MATCHED, which is correct */ }

  let brandName: string | null = null;
  try {
    const { data } = await supabase.from('companies').select('name').eq('id', companyId).limit(1);
    const first = (data ?? [])[0] as { name?: string } | undefined;
    if (typeof first?.name === 'string' && first.name.trim()) brandName = first.name.trim();
  } catch { /* brand name is supporting evidence only */ }

  return {
    declaredLegalName,
    brandName,
    jurisdiction,
    // Not verified on this path. It is supporting evidence and cannot affect MATCHED, so claiming
    // it without having checked P856 here would be an unearned assertion.
    wikidataDomainVerified: false,
  };
}
