/**
 * COMPETITOR-TAXONOMY-P3-PROMOTION-INFRASTRUCTURE-001 — production promotion framework.
 *
 * This module is the ONLY place that decides WHICH qualification engine is authoritative in
 * production and MAPS a multi-signal qualification onto a live accept/reject decision. It does
 * NOT contain qualification logic, weights, or calibration — it consumes the existing
 * `evaluateMultiSignalQualification` verbatim. Discovery, scoring, tier assignment, and the
 * response schema are untouched: routing decides keep/drop only, on the already-scored,
 * already-tiered RankedCompetitor object.
 *
 * Controls (all env, all reversible, all defaulting to the LEGACY engine so nothing changes
 * until deliberately flipped):
 *   • COMPETITOR_QUALIFICATION_ENGINE          = live_taxonomy (default) | multisignal
 *   • COMPETITOR_MULTISIGNAL_BORDERLINE_POLICY = observe (default) | accept | reject
 *
 * Single-step rollback: set COMPETITOR_QUALIFICATION_ENGINE=live_taxonomy (or unset it). That
 * one change restores legacy qualification on the next call — no redeploy, no data change.
 */

import type { CompanyCompetitiveContext, CompetitorCandidate } from '../../competitorEngineServiceModel';
import { evaluateMultiSignalQualification } from './competitorQualificationModel';
import { recordRawCounter } from '../../../observability/metrics';
import { registry } from '../../../observability/registry';
import { logger } from '../../logger';

export type EngineAuthority = 'live_taxonomy' | 'multisignal';
export type BorderlinePolicy = 'accept' | 'reject' | 'observe';

// ── Configuration resolvers (no hardcoding; env-driven, legacy-default) ──────────
export function resolveQualificationAuthority(): EngineAuthority {
  const raw = (process.env.COMPETITOR_QUALIFICATION_ENGINE ?? '').toLowerCase().trim();
  return raw === 'multisignal' ? 'multisignal' : 'live_taxonomy';
}

export function multiSignalEngineAuthoritative(): boolean {
  return resolveQualificationAuthority() === 'multisignal';
}

export function resolveBorderlinePolicy(): BorderlinePolicy {
  const raw = (process.env.COMPETITOR_MULTISIGNAL_BORDERLINE_POLICY ?? '').toLowerCase().trim();
  return raw === 'accept' || raw === 'reject' ? raw : 'observe';
}

/** Snapshot of the live promotion configuration — for ops endpoints / structured logs. */
export function getPromotionRuntimeState(): {
  engine: EngineAuthority;
  authoritative: EngineAuthority;
  borderlinePolicy: BorderlinePolicy;
  rollbackState: 'legacy_active' | 'multisignal_active';
} {
  const engine = resolveQualificationAuthority();
  return {
    engine,
    authoritative: engine,
    borderlinePolicy: resolveBorderlinePolicy(),
    rollbackState: engine === 'multisignal' ? 'multisignal_active' : 'legacy_active',
  };
}

// ── Metrics ─────────────────────────────────────────────────────────────────────
export const ROUTER_METRICS = {
  decisions: 'competitor.qualification.decisions',
  agreement: 'competitor.qualification.agreement',
  disagreement: 'competitor.qualification.disagreement',
  promoted: 'competitor.qualification.promoted',
  rejected: 'competitor.qualification.rejected',
  borderline: 'competitor.qualification.borderline',
  unseenQualified: 'competitor.qualification.unseen_qualified',
  rollbackState: 'competitor.qualification.rollback_state', // gauge: 0 legacy, 1 multisignal
  fallback: 'competitor.qualification.fallback', // M1: authoritative qualification threw ⇒ legacy fallback
} as const;

/**
 * In-memory bounded mirror of the counters, so the promotion state is observable in tests and
 * lightweight debug endpoints without scraping the registry. Fail-safe; never throws.
 */
export interface RouterMetricsSnapshot {
  decisions: number;
  agreements: number;
  disagreements: number;
  promoted: number;
  rejected: number;
  borderline: number;
  borderlineAccept: number;
  borderlineReject: number;
  borderlineObserve: number;
  unseenQualified: number;
  fallbacks: number;
  engine: EngineAuthority;
}

let snapshot: Omit<RouterMetricsSnapshot, 'engine'> = freshSnapshot();
function freshSnapshot(): Omit<RouterMetricsSnapshot, 'engine'> {
  return {
    decisions: 0,
    agreements: 0,
    disagreements: 0,
    promoted: 0,
    rejected: 0,
    borderline: 0,
    borderlineAccept: 0,
    borderlineReject: 0,
    borderlineObserve: 0,
    unseenQualified: 0,
    fallbacks: 0,
  };
}

export function getRouterMetricsSnapshot(): RouterMetricsSnapshot {
  return { ...snapshot, engine: resolveQualificationAuthority() };
}
export function resetRouterMetrics(): void {
  snapshot = freshSnapshot();
}

/** Record the active engine as a gauge (rollback-state visibility). Fail-safe. */
export function recordAuthorityGauge(): void {
  try {
    registry.gauge(ROUTER_METRICS.rollbackState, multiSignalEngineAuthoritative() ? 1 : 0, {
      engine: resolveQualificationAuthority(),
    });
  } catch {
    /* metrics are best-effort; never affect the request */
  }
}

// ── Routing decision (the shadow→live map) ───────────────────────────────────────
export interface RouterDecision {
  engine: EngineAuthority;
  keep: boolean;
  decision: 'qualified' | 'borderline' | 'unqualified' | 'fallback';
  score: number;
  legacyKeep: boolean;
  agreesWithLegacy: boolean;
  kind: 'agreement' | 'promoted' | 'newly_rejected';
  borderlineHandling: 'n/a' | 'accept' | 'reject' | 'observe_defer_legacy';
  unseenIndustry: boolean;
  /** M1: true iff authoritative qualification threw and this decision fell back to legacy. */
  fallback: boolean;
}

function recordRouterMetrics(d: RouterDecision): void {
  try {
    snapshot.decisions += 1;
    recordRawCounter(ROUTER_METRICS.decisions, 1, { engine: d.engine, decision: d.decision, keep: String(d.keep) });
    if (d.fallback) {
      snapshot.fallbacks += 1;
      recordRawCounter(ROUTER_METRICS.fallback, 1);
    }
    if (d.agreesWithLegacy) {
      snapshot.agreements += 1;
      recordRawCounter(ROUTER_METRICS.agreement, 1);
    } else {
      snapshot.disagreements += 1;
      recordRawCounter(ROUTER_METRICS.disagreement, 1);
    }
    if (d.kind === 'promoted') {
      snapshot.promoted += 1;
      recordRawCounter(ROUTER_METRICS.promoted, 1);
    } else if (d.kind === 'newly_rejected') {
      snapshot.rejected += 1;
      recordRawCounter(ROUTER_METRICS.rejected, 1);
    }
    if (d.decision === 'borderline') {
      snapshot.borderline += 1;
      if (d.borderlineHandling === 'accept') snapshot.borderlineAccept += 1;
      else if (d.borderlineHandling === 'reject') snapshot.borderlineReject += 1;
      else snapshot.borderlineObserve += 1;
      recordRawCounter(ROUTER_METRICS.borderline, 1, { handling: d.borderlineHandling });
    }
    if (d.unseenIndustry && d.keep) {
      snapshot.unseenQualified += 1;
      recordRawCounter(ROUTER_METRICS.unseenQualified, 1);
    }
  } catch {
    /* metrics are best-effort; never affect the request */
  }
}

/**
 * Map the multi-signal qualification onto a keep/reject decision under the active borderline
 * policy, recording promotion metrics. `legacyKeep` is the decision the legacy engine would
 * have made for this same candidate — used for agreement tracking and for the OBSERVE policy,
 * which defers borderline candidates to the legacy decision (observe, don't act).
 *
 * PURE with respect to the candidate object (never mutates it); side effects are metrics only.
 */
/**
 * Project a (possibly already-ranked) competitor onto its INTRINSIC candidate identity for
 * qualification. This is critical: a live RankedCompetitor carries a synthesized `rationale`
 * (and other company-relative narrative) built from the SUBJECT company's own fit-signals —
 * `candidateSignalText` reads `rationale`, so scoring the raw ranked object would leak company
 * tokens into the candidate's text surface and inflate overlap. We whitelist only fields that
 * describe the candidate itself; company-relative narrative (rationale/reasoning/positioning/
 * fit_signals) is intentionally dropped. Qualification logic is unchanged — only its INPUT is
 * cleaned to match how the shadow was calibrated (on raw candidates).
 */
function toQualificationCandidate(competitor: CompetitorCandidate): CompetitorCandidate {
  return {
    name: competitor.name,
    domain: competitor.domain ?? null,
    source: competitor.source,
    category: competitor.category ?? null,
    tags: competitor.tags ?? null,
    description: competitor.description ?? null,
    targetCustomer: competitor.targetCustomer ?? null,
    useCase: competitor.useCase ?? null,
    geography: competitor.geography ?? null,
    businessModel: competitor.businessModel ?? null,
    revenueRange: competitor.revenueRange ?? null,
    productSignals: competitor.productSignals ?? null,
    productType: competitor.productType ?? null,
    scaleSignals: competitor.scaleSignals ?? null,
    confidenceScore: competitor.confidenceScore ?? null,
    enrichment: competitor.enrichment ?? null,
    discoverySources: competitor.discoverySources ?? null,
    capabilityVector: competitor.capabilityVector ?? null,
  };
}

/**
 * COMPETITOR-PRODUCTION-HARDENING-001 (M1) — deterministic legacy fallback. Produced when the
 * authoritative qualification throws: the candidate's decision defers to `legacyKeep`, the
 * response schema / scoring / tier / ranking are untouched (the candidate object is unmodified),
 * a dedicated `fallback` metric is emitted, and a structured diagnostic is logged. Same input ⇒
 * same fallback, so behaviour under failure is deterministic.
 */
function legacyFallbackDecision(legacyKeep: boolean, candidate: CompetitorCandidate, error: unknown): RouterDecision {
  try {
    logger.warn('competitor_qualification_fallback', {
      candidate: candidate.name,
      source: candidate.source,
      reason: error instanceof Error ? error.message : String(error),
    });
  } catch {
    /* logging must never itself fail the request */
  }
  const decision: RouterDecision = {
    engine: 'multisignal',
    keep: legacyKeep, // fall back to the legacy qualification decision
    decision: 'fallback',
    score: 0,
    legacyKeep,
    agreesWithLegacy: true, // by construction keep === legacyKeep
    kind: 'agreement',
    borderlineHandling: 'n/a',
    unseenIndustry: false,
    fallback: true,
  };
  recordRouterMetrics(decision);
  return decision;
}

export function routeQualificationKeep(params: {
  candidate: CompetitorCandidate;
  context: CompanyCompetitiveContext;
  legacyKeep: boolean;
  borderlinePolicy?: BorderlinePolicy;
}): RouterDecision {
  // M1 fail-safe boundary — an exception anywhere in the authoritative qualification must never
  // propagate. On failure we deterministically fall back to the legacy decision.
  try {
    const policy = params.borderlinePolicy ?? resolveBorderlinePolicy();
    const q = evaluateMultiSignalQualification(toQualificationCandidate(params.candidate), params.context);

    let keep: boolean;
    let borderlineHandling: RouterDecision['borderlineHandling'] = 'n/a';
    if (q.decision === 'qualified') {
      keep = true;
    } else if (q.decision === 'unqualified') {
      keep = false;
    } else {
      // borderline — configurable, never hardcoded.
      if (policy === 'accept') {
        keep = true;
        borderlineHandling = 'accept';
      } else if (policy === 'reject') {
        keep = false;
        borderlineHandling = 'reject';
      } else {
        keep = params.legacyKeep; // observe: defer to legacy for this candidate
        borderlineHandling = 'observe_defer_legacy';
      }
    }

    const agreesWithLegacy = keep === params.legacyKeep;
    const kind: RouterDecision['kind'] = agreesWithLegacy
      ? 'agreement'
      : keep && !params.legacyKeep
        ? 'promoted'
        : 'newly_rejected';

    const decision: RouterDecision = {
      engine: 'multisignal',
      keep,
      decision: q.decision,
      score: q.score,
      legacyKeep: params.legacyKeep,
      agreesWithLegacy,
      kind,
      borderlineHandling,
      unseenIndustry: q.taxonomyCoverage === 'out_of_coverage',
      fallback: false,
    };
    recordRouterMetrics(decision);
    return decision;
  } catch (error) {
    return legacyFallbackDecision(params.legacyKeep, params.candidate, error);
  }
}
