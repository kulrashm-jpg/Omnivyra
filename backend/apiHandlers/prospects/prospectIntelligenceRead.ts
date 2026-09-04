/**
 * WS-10 — the Prospect Intelligence READ surface.
 *
 * Every PI capability now has a service seam, and none of them has a consumer:
 * `readProspectEngagementIntelligence`, `aggregateAccountIntelligence`,
 * `buildProspectIntelligenceContext`, `assessOutreachReadiness` and
 * `readProspectOutcomeCorpus` are all reachable only from tests. This module is
 * the composition the API needs, and deliberately nothing more.
 *
 * ─── IT DECIDES NOTHING ───────────────────────────────────────────────────
 * No score, no threshold, no weight, no channel rule, no action vocabulary, no
 * suppression evaluation. It calls seams and reshapes what they return. Every
 * value below is traceable to the service that produced it, and a test asserts
 * this file contains no scoring or decision primitive — because an API layer
 * that starts deciding is a second business-logic layer, and then two answers
 * exist for one question.
 *
 * ─── UNAVAILABLE IS A VALUE, NOT AN ABSENCE ───────────────────────────────
 * The frozen model distinguishes null, unavailable, not-evaluated, conflicting,
 * stale, failed, suppressed and abstained. Collapsing any of them into `0`,
 * `false` or an empty 200 is how a UI comes to show "0% fit" for a prospect
 * nobody has evaluated. So every dimension is wrapped: it carries a `state`
 * alongside its value, and the four dimensions the platform has not implemented
 * report `not_implemented` rather than a number.
 *
 * ─── THE FOUR MISSING DIMENSIONS ARE NAMED, NOT FILLED ────────────────────
 * Problem Fit, Account Potential, Buying Role and Relationship Strength are not
 * in `SCORE_DIMENSIONS` and have no defined representation or weight. They are
 * emitted with `state: 'not_implemented'` and a reason, so a UI can show why a
 * panel is empty instead of showing a fabricated zero. Buying Role as an
 * OBSERVED ATTRIBUTE is a different thing and IS available — it comes from
 * WS-7's roster and is reported separately.
 *
 * ─── PARTIAL FAILURE IS REPORTED, NOT SWALLOWED ───────────────────────────
 * A prospect detail composes five independent seams. One of them failing does
 * not make the others unknowable, so each section is attempted separately and a
 * failure becomes `state: 'failed'` with its reason. What is NOT done is
 * turning a failure into an empty success — a caller must be able to tell "we
 * looked and there is nothing" from "we could not look".
 */

import { ownedDbTable } from '../../db/writeOwner';
import { readProspectEngagementIntelligence } from '../../services/engagement/prospectEngagementIntelligence';
import { aggregateAccountIntelligence } from '../../services/prospectIdentity/accountIntelligence';
import { buildProspectIntelligenceContext } from '../../services/leadUnderstanding/prospectContext';
import { assembleLeadUnderstanding } from '../../services/leadUnderstanding/engines/assembly';
import { assessOutreachReadiness } from '../../services/prospectOutreach/readiness';
import { readProspectOutcomeCorpus } from '../../services/prospectOutcomes/corpus';
import { planProspectEnrichment } from '../../services/enrichment/service';
import { ingestionEnrichmentCoverage } from '../../services/leadIngestion/enrichmentCoverage';
import { SCORE_DIMENSIONS } from '../../services/leadUnderstanding/types';
import type { TenantIntegrationRow } from '../../services/integrations/dataSourceCatalogue';

/** Bumped when the API shape changes, so a client can pin what it parsed. */
export const PROSPECT_API_VERSION = 'ws10.1';

/** Bound so one request cannot be used to exhaust the platform. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * The semantic states the API preserves. Each one means something a client must
 * be able to act on differently, which is exactly why they are not collapsed.
 */
export type SectionState =
  | 'available'        // the seam answered and there is data
  | 'empty'            // the seam answered and there is genuinely nothing
  | 'not_evaluated'    // the seam abstained — insufficient evidence
  | 'not_implemented'  // the platform has no implementation for this
  | 'failed';          // the seam could not be reached; NOT the same as empty

export interface Section<T> {
  readonly state: SectionState;
  readonly reason: string;
  readonly data: T | null;
}

const section = <T, >(state: SectionState, reason: string, data: T | null = null): Section<T> =>
  ({ state, reason, data });

/**
 * Run one seam and turn a throw into `failed` rather than letting it collapse
 * the whole response. The reason travels with it — a section that failed
 * silently is indistinguishable from one that found nothing.
 */
async function attempt<T>(
  label: string,
  run: () => Promise<Section<T>>,
): Promise<Section<T>> {
  try {
    return await run();
  } catch (e) {
    return section<T>('failed', `${label} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────

export interface ProspectListRow {
  readonly prospectId: string;
  readonly personId: string | null;
  readonly source: string | null;
  readonly externalLeadKey: string | null;
  readonly createdAt: string | null;
  /**
   * `canonical_leads.qualification_score`. Reported VERBATIM, including its
   * column default of 0 — WS-1 never writes it, so a 0 here means "no scoring
   * authority has written a score", which `scored` states explicitly rather
   * than leaving a reader to infer a bad prospect.
   */
  readonly qualificationScore: number | null;
  readonly scored: boolean;
}

export interface ProspectListResult {
  readonly version: string;
  readonly organizationId: string;
  readonly rows: readonly ProspectListRow[];
  readonly page: { readonly limit: number; readonly offset: number; readonly returned: number };
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * List the tenant's canonical Prospects.
 *
 * A plain tenant-scoped, ordered page over `canonical_leads`. It applies no
 * qualification rule, no ranking and no filter the caller did not ask for —
 * ordering by `created_at` is a stable presentation choice, not a judgement
 * about which prospects matter.
 */
export async function listProspects(input: {
  organizationId: string; limit?: number; offset?: number;
}): Promise<ProspectListResult> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to list prospects');
  }
  const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));

  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id, unified_person_id, source, external_lead_key, created_at, qualification_score')
    .eq('company_id', input.organizationId)          // tenant boundary — never optional
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`canonical_leads read failed: ${error.message}`);

  const rows: ProspectListRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const score = numberOrNull(r.qualification_score);
    return {
      prospectId: String(r.id),
      personId: text(r.unified_person_id),
      source: text(r.source),
      externalLeadKey: text(r.external_lead_key),
      createdAt: text(r.created_at),
      qualificationScore: score,
      // WS-1's resolver deliberately never writes this column, and WS-6's
      // scoring runtime is dark. A stored 0 is therefore the column default,
      // not a verdict.
      scored: score !== null && score > 0,
    };
  });

  return {
    version: PROSPECT_API_VERSION,
    organizationId: input.organizationId,
    rows,
    page: { limit, offset, returned: rows.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL
// ─────────────────────────────────────────────────────────────────────────────

/** One score dimension as the combiner produced it, or why it has no value. */
export interface DimensionView {
  readonly dimension: string;
  readonly state: SectionState;
  readonly value: number | null;
  readonly confidence: number | null;
  readonly contributors: readonly string[];
  readonly reason: string;
}

/**
 * The Playbook dimensions with no implementation. Named here so the API can
 * report them as absent WITH A REASON; they are not added to `SCORE_DIMENSIONS`
 * and no value is ever produced for them.
 */
export const UNIMPLEMENTED_DIMENSIONS: readonly string[] = [
  'problem_fit', 'account_potential', 'buying_role', 'relationship_strength',
];

export interface ProspectDetail {
  readonly version: string;
  readonly organizationId: string;
  readonly prospectId: string;
  readonly personId: string | null;
  readonly accountId: string | null;

  readonly engagement: Section<unknown>;
  readonly account: Section<unknown>;
  readonly enrichment: Section<unknown>;
  readonly scoring: Section<{
    readonly dimensions: readonly DimensionView[];
    readonly overall: number | null;
    readonly confidence: number;
    readonly reasoning: unknown;
    readonly facets: unknown;
    readonly contextGaps: unknown;
    readonly builtAt: string;
  }>;
  readonly recommendation: Section<unknown>;
  readonly readiness: Section<unknown>;
  readonly outcomes: Section<unknown>;
}

export interface ProspectDetailInput {
  readonly organizationId: string;
  readonly prospectId: string;
  /** Injected. The deterministic instant every seam is anchored to. */
  readonly now: string;
  /** Caller freshness policy, forwarded verbatim. WS-10 invents none. */
  readonly stalenessDays?: number;
}

/**
 * Compose everything the platform can say about one Prospect.
 *
 * Returns null when the Prospect is not readable in this tenant — an identity
 * fact the route turns into a 404, never an empty 200.
 */
export async function getProspectDetail(
  input: ProspectDetailInput,
): Promise<ProspectDetail | null> {
  if (!input.organizationId?.trim()) throw new Error('organizationId is required');
  if (!input.prospectId?.trim()) throw new Error('prospectId is required');
  if (!input.now?.trim()) throw new Error('now is required — the API never anchors a read to ambient time');

  const common = {
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    now: input.now,
    stalenessDays: input.stalenessDays,
  };

  // WS-5 first: it is the only seam that also answers "does this prospect exist
  // in this tenant", and its null is the 404.
  const engagement = await readProspectEngagementIntelligence(common);
  if (!engagement) return null;

  const personId = engagement.personId;

  // WS-6 builds the context every downstream seam needs. It is attempted once
  // and shared, so the engines see exactly one view of the evidence.
  let built: Awaited<ReturnType<typeof buildProspectIntelligenceContext>> = null;
  let contextError: string | null = null;
  try {
    built = await buildProspectIntelligenceContext({
      organizationId: input.organizationId, prospectId: input.prospectId, asOf: input.now,
    });
  } catch (e) {
    contextError = e instanceof Error ? e.message : String(e);
  }
  const accountId = built?.context.companyId ?? null;

  const accountSection = await attempt('account intelligence', async () => {
    if (!accountId) {
      return section('empty', personId
        ? 'this person is not attached to an account'
        : 'this prospect has no resolved person, so no account can be reached');
    }
    const account = await aggregateAccountIntelligence({
      organizationId: input.organizationId, accountId, now: input.now,
      stalenessDays: input.stalenessDays,
    });
    return account
      ? section('available', account.reason, account as unknown)
      : section('empty', `account ${accountId} is not readable in this tenant`);
  });

  const enrichmentSection = await attempt('enrichment plan', async () => {
    if (!personId) return section('empty', 'no resolved person, so there is nothing to enrich');
    const { plan } = await planProspectEnrichment({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      // WS-4's derived coverage, reused. WS-10 declares no coverage of its own —
      // that would be a provider claim the catalogue does not support.
      coverage: ingestionEnrichmentCoverage(),
      stalenessDays: input.stalenessDays,
      now: input.now,
    }, defaultEnrichmentPorts());
    return section('available',
      `${plan.toEnrich.length} field(s) planned for enrichment`, plan as unknown);
  });

  const scoringSection = await attempt('scoring', async () => {
    if (!built) {
      return section<never>('failed',
        contextError ?? 'the intelligence context could not be built');
    }
    const { understanding } = assembleLeadUnderstanding(built.context);

    const implemented: DimensionView[] = SCORE_DIMENSIONS.map((d) => {
      const dim = understanding.score.dimensions[d];
      return {
        dimension: d,
        // An abstained dimension is NOT_EVALUATED, never zero. The combiner
        // already refuses to invent a value; this preserves that refusal.
        state: dim.abstained ? 'not_evaluated' as const : 'available' as const,
        value: dim.value,
        confidence: dim.confidence,
        contributors: dim.contributors,
        reason: dim.abstained
          ? 'no engine produced a usable contribution for this dimension'
          : `blended from ${dim.contributors.length} contributor(s)`,
      };
    });

    const missing: DimensionView[] = UNIMPLEMENTED_DIMENSIONS.map((d) => ({
      dimension: d,
      state: 'not_implemented' as const,
      value: null,
      confidence: null,
      contributors: [],
      reason: 'no representation or weight is defined for this dimension; it is an open product decision',
    }));

    return section('available', built.gaps.length
      ? `${built.gaps.length} evidence gap(s) recorded`
      : 'scored from the available evidence', {
      dimensions: [...implemented, ...missing],
      overall: understanding.score.overall,
      confidence: understanding.score.confidence,
      reasoning: understanding.reasoning,
      facets: understanding.facets,
      contextGaps: built.gaps,
      builtAt: understanding.builtAt,
    });
  });

  // WS-8 owns BOTH the recommendation reshaping and the eligibility verdict, so
  // one call produces both rather than the API composing a second opinion.
  const readinessSection = await attempt('outreach readiness', async () => {
    if (!built) {
      return section<never>('failed',
        contextError ?? 'the intelligence context could not be built');
    }
    const readiness = await assessOutreachReadiness({ built, now: input.now });
    return section('available', readiness.reason, readiness as unknown);
  });

  const recommendationSection: Section<unknown> = readinessSection.state === 'available'
    ? (() => {
      const nba = (readinessSection.data as { nextBestAction: { abstained: boolean; reason: string | null } }).nextBestAction;
      return nba.abstained
        // Abstention is preserved end to end: the canonical engine had nothing
        // to reason over, and that is reported as such rather than as no action.
        ? section('not_evaluated', 'the canonical recommendation engine abstained', nba as unknown)
        : section('available', nba.reason ?? 'recommendation produced', nba as unknown);
    })()
    : section(readinessSection.state, readinessSection.reason);

  const outcomesSection = await attempt('outcome corpus', async () => {
    const corpus = await readProspectOutcomeCorpus(common);
    if (!corpus) return section('empty', 'prospect not readable');
    return corpus.completeness.outcomes > 0
      ? section('available', corpus.reason, corpus as unknown)
      : section('empty', corpus.reason, corpus as unknown);
  });

  return {
    version: PROSPECT_API_VERSION,
    organizationId: input.organizationId,
    prospectId: engagement.prospectId,
    personId,
    accountId,
    engagement: engagement.completeness.messages > 0 || engagement.completeness.signals > 0
      ? section('available', engagement.reason, engagement as unknown)
      : section('empty', engagement.reason, engagement as unknown),
    account: accountSection,
    enrichment: enrichmentSection,
    scoring: scoringSection,
    recommendation: recommendationSection,
    readiness: readinessSection,
    outcomes: outcomesSection,
  };
}

/**
 * WS-2's ports, bound to the canonical spine.
 *
 * The enrichment seam takes ports because it must be testable without a
 * database; nothing in the repository binds them for production use yet, so the
 * binding lives here — at the API boundary that needs it — rather than being
 * pushed into WS-2, whose contract is frozen.
 */
function defaultEnrichmentPorts() {
  return {
    async loadSnapshot(organizationId: string, prospectId: string) {
      const lead = await ownedDbTable('canonical_leads')
        .select('unified_person_id')
        .eq('id', prospectId)
        .eq('company_id', organizationId)          // tenant boundary — never optional
        .maybeSingle();
      if (lead.error) throw new Error(`canonical_leads read failed: ${lead.error.message}`);
      if (!lead.data) return null;

      const personId = text((lead.data as { unified_person_id?: unknown }).unified_person_id);
      if (!personId) return { personId: null, accountId: null, person: null, account: null };

      const person = await ownedDbTable('unified_persons')
        .select('*')
        .eq('id', personId)
        .eq('company_id', organizationId)          // tenant boundary — never optional
        .maybeSingle();
      if (person.error) throw new Error(`unified_persons read failed: ${person.error.message}`);

      const personRow = (person.data ?? null) as Record<string, unknown> | null;
      const accountId = text(personRow?.account_id);
      if (!accountId) return { personId, accountId: null, person: personRow, account: null };

      const account = await ownedDbTable('prospect_accounts')
        .select('*')
        .eq('id', accountId)
        .eq('organization_id', organizationId)     // tenant boundary — never optional
        .maybeSingle();
      if (account.error) throw new Error(`prospect_accounts read failed: ${account.error.message}`);

      return {
        personId,
        accountId,
        person: personRow,
        account: (account.data ?? null) as Record<string, unknown> | null,
      };
    },

    async loadIntegrations(organizationId: string) {
      // `company_integrations`, read exactly as `/api/integrations/data-sources`
      // already reads it — same table, same three columns, same tenant column.
      // Inventing a different source of integration state would be a second
      // answer to "what is this tenant connected to".
      const { data, error } = await ownedDbTable('company_integrations')
        .select('id, type, status')
        .eq('company_id', organizationId);         // tenant boundary — never optional
      // An unreadable integration table means we cannot know what is connected.
      // Reporting NONE is the safe direction: the planner then answers
      // `no_available_source` rather than selecting a provider we cannot verify.
      if (error) return [];
      return (data ?? []) as TenantIntegrationRow[];
    },

    async loadConflicts() {
      // LI-2's disagreement verdict is not yet exposed as a per-attribute read.
      // Reporting none is honest: the planner then treats fields as missing or
      // stale rather than as conflicting, which understates rather than
      // overstates what we know.
      return [];
    },

    async persist(): Promise<{ canonicalWithheld: readonly { attribute: string; reason: string }[] }> {
      // The READ surface never writes an enrichment result. `applyEnrichmentResult`
      // is the sanctioned path and it is not reachable from a GET.
      throw new Error('the prospect read surface does not persist enrichment results');
    },
  };
}
