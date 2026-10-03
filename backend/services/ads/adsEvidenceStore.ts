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
import {
  ADS_PLATFORM_GOOGLE,
  LEGACY_ADS_PLATFORM,
  isAdsPlatform,
  resolveObservedPlatform,
  type AdsObservationResult,
  type AdsPlatform,
} from './adsTransparencyObservation';
import type { AdsEvidenceSink } from './adsAcquisitionScheduler';

const TABLE = 'report_evidence_history';
/**
 * The evidence KIND. Unchanged on purpose: it is the key `adsDueSubjects` and
 * `evidenceProvenance` already read, and every row ever written carries it, so re-keying it
 * would orphan the production history. WP-1 adds the platform as a SECOND scope dimension
 * beside it rather than encoding a provider into this constant.
 */
const SCOPE_KIND = 'ads_transparency';

/**
 * ─── WHY NO MIGRATION ─────────────────────────────────────────────────────
 * `scope` is a JSONB column and is written whole by this file — the only writer of
 * `kind = 'ads_transparency'` rows. Adding a key to the object needs no DDL, no default and no
 * backfill, and the reads below tolerate its absence by an explicit rule. Verified against the
 * DDL in `supabase/migrations/20260601000000_canonical_intelligence_platform.sql`: `scope` is
 * `jsonb NOT NULL`, under no CHECK and no index — the table's only index is
 * `(company_id, observed_at DESC)`. So this change is code-only: no migration, and none deferred.
 */
export type AdsEvidenceScope = {
  kind: typeof SCOPE_KIND;
  /** WP-1. Absent on every row written before this field existed — see {@link adsRowPlatform}. */
  platform?: AdsPlatform;
  domain_id?: string | null;
  vantage?: string | null;
};

/**
 * The platform a stored row represents. PURE — exported so the legacy rule is tested directly
 * rather than through a database fake.
 *
 * A row with no `scope.platform` is a Google observation, for the reason stated once on
 * {@link LEGACY_ADS_PLATFORM}. A row naming a platform this build does not know returns `null`
 * and matches nothing: unknown is never coerced to Google.
 */
export function adsRowPlatform(scope: unknown): AdsPlatform | null {
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as { kind?: string; platform?: unknown };
  if (s.kind !== SCOPE_KIND) return null;
  return resolveObservedPlatform(s.platform);
}

/**
 * Stamp a stored observation with the platform its row was matched under.
 *
 * A legacy `signal_summary` has no `platform` key, so an observation read back from one would
 * otherwise reach the Report 1 surface with the field missing — the same silent assumption in a
 * new place. Stamping here means every observation leaving this module carries an explicit
 * platform, and the ONE place the legacy interpretation happens is this file.
 */
export function stampObservationPlatform(summary: unknown, platform: AdsPlatform): AdsObservationResult | null {
  if (!summary || typeof summary !== 'object') return null;
  const observation = summary as AdsObservationResult;
  // An observation that already names a platform it made itself keeps it; only a missing or
  // unrecognised value is replaced by the row's resolved platform.
  const declared = isAdsPlatform(observation.platform) ? observation.platform : null;
  return { ...observation, platform: declared ?? platform };
}

/** The production sink. Failures propagate: the scheduler counts them rather than hiding them. */
export function createAdsEvidenceSink(): AdsEvidenceSink {
  return {
    async persist(params) {
      const { error } = await ownedDbTable(TABLE)
        .insert({
          id: globalThis.crypto.randomUUID(),
          company_id: params.companyId,
          observed_at: params.observedAt,
          // WP-1 — the platform the observation DECLARED, never a constant chosen here. A row is
          // therefore self-describing: a reader does not have to know which client was deployed
          // when it was written to know which platform it is about.
          scope: {
            kind: SCOPE_KIND,
            platform: isAdsPlatform(params.observation?.platform)
              ? params.observation.platform
              : LEGACY_ADS_PLATFORM,
            domain_id: params.domainId,
            vantage: params.vantage,
          } satisfies AdsEvidenceScope,
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
  /**
   * WP-1 — which platform's observation to read. Defaults to Google, which is the only platform
   * acquired for, so the existing caller's behaviour is unchanged. Explicit because the row set is
   * no longer single-platform by construction: once a second platform is acquired, an unfiltered
   * read would let one platform's evidence answer for another's.
   */
  platform?: AdsPlatform;
}): Promise<AdsObservationResult | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('scope, signal_summary, observed_at')
      .eq('company_id', params.companyId)
      .order('observed_at', { ascending: false })
      .limit(25);
    if (error || !Array.isArray(data)) return null;

    const wanted: AdsPlatform = params.platform ?? ADS_PLATFORM_GOOGLE;
    for (const row of data as Array<{ scope?: AdsEvidenceScope; signal_summary?: unknown }>) {
      // `adsRowPlatform` applies BOTH the kind filter and the legacy-platform rule, so a row
      // written before the platform field is read as the Google observation it is, and a row
      // naming an unknown platform is skipped rather than mis-served.
      if (adsRowPlatform(row.scope) !== wanted) continue;
      // Domain scoping is a strict equality, including the null case: an observation stamped with
      // no domain is not evidence about a specific one.
      if ((row.scope?.domain_id ?? null) !== (params.domainId ?? null)) continue;
      const stamped = stampObservationPlatform(row.signal_summary, wanted);
      if (stamped) return stamped;
    }
    return null;
  } catch {
    return null;
  }
}
