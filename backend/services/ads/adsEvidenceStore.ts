/**
 * PO-3 — durable persistence for public advertising observations.
 *
 * Writes the EXISTING `report_evidence_history` table (`company_id`, `observed_at`, `scope jsonb`,
 * `evidence_count`, `evidence_sources jsonb`, `signal_summary jsonb`). It is already the canonical
 * per-company evidence store and already under the retention sweep, so this adds **no migration,
 * no schema change and no second store** — the row shape it defines is exactly what an advertising
 * observation needs.
 *
 * ─── TENANT AND DOMAIN BINDING ────────────────────────────────────────────
 * Every row carries `company_id` and `scope.domain_id`. Reads filter on both, so an observation
 * made for one company's domain can never be served for another's — and there is deliberately no
 * advertiser-keyed index anywhere: the same `AR…` legitimately appears against many subjects, and
 * a global `AR → company` mapping is the one structure this design forbids.
 */
import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';
import type { AdsObservationResult } from './adsTransparencyObservation';
import type { AdsEvidenceSink } from './adsAcquisitionScheduler';

const TABLE = 'report_evidence_history';
const SCOPE_KIND = 'ads_transparency';

/** The production sink. Failures propagate: the scheduler counts them rather than hiding them. */
export function createAdsEvidenceSink(): AdsEvidenceSink {
  return {
    async persist(params) {
      const { error } = await ownedDbTable(TABLE)
        .insert({
          id: globalThis.crypto.randomUUID(),
          company_id: params.companyId,
          observed_at: params.observedAt,
          scope: { kind: SCOPE_KIND, domain_id: params.domainId, vantage: params.vantage },
          // Advertiser ACCOUNTS observed — deliberately not an ad count. Conflating the two is
          // the failure this whole workstream exists to prevent.
          evidence_count: params.observation.advertisers.length,
          evidence_sources: ['ads_transparency'],
          signal_summary: params.observation as unknown as Record<string, unknown>,
        });
      if (error) throw new Error(`ads evidence persist failed: ${error.message}`);
    },
  };
}

/**
 * The most recent observation for this company AND this domain.
 *
 * Returns null when nothing is stored — which the composer turns into an absent advertising
 * section, never into "no advertising". Both filters are required: `company_id` alone would let a
 * company's previous domain's advertising evidence describe its current one, the exact defect
 * R1-OPEN-01 fixed for crawl evidence.
 */
export async function loadLatestAdsObservation(params: {
  companyId: string;
  domainId: string | null;
}): Promise<AdsObservationResult | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('scope, signal_summary, observed_at')
      .eq('company_id', params.companyId)
      .order('observed_at', { ascending: false })
      .limit(25);
    if (error || !Array.isArray(data)) return null;

    for (const row of data as Array<{ scope?: { kind?: string; domain_id?: string | null }; signal_summary?: unknown }>) {
      if (row.scope?.kind !== SCOPE_KIND) continue;
      // Domain scoping is a strict equality, including the null case: an observation stamped with
      // no domain is not evidence about a specific one.
      if ((row.scope?.domain_id ?? null) !== (params.domainId ?? null)) continue;
      const summary = row.signal_summary;
      if (summary && typeof summary === 'object') return summary as AdsObservationResult;
    }
    return null;
  } catch {
    return null;
  }
}
