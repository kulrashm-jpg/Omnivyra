/**
 * G3 — Canonical Score Materialization (LC-102 / W1.2).
 *
 * THE single place website/capture leads receive a canonical score. It reuses the
 * ONE deterministic scorer (`buildBuyingIntentProfile`) — it does NOT introduce a
 * second scoring engine. The same helper is used by:
 *   • the write path (repository `toRow`) — persists scores into `lead_intelligence.scores`
 *   • the read path (read service `collectViews`) — materializes scores for any
 *     legacy/unbackfilled view so List, Detail, Filters and Sorting always agree.
 *
 * Because both surfaces derive intent from this ONE function, the list badge and
 * the detail buying-intent headline are guaranteed identical for a given view.
 *
 * Scale: `buildBuyingIntentProfile` returns 0–100; the canonical `scores` fields are
 * 0–1 (matching the System-B qualifier + the read model's `intent*100` rendering).
 *
 * Precedence: a lead that ALREADY carries real numeric scores (System-B social
 * listening via `qualifyLead`) is left untouched — materialization only fills the
 * gap (website/form/manual capture leads whose source rows have no score columns).
 */

import type { CanonicalLead, CanonicalLeadView, CanonicalLeadScores } from './types';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';
import { buildBuyingIntentProfile } from './buyingIntent';

/** Kill-switch (default ON). Set LEAD_SCORE_MATERIALIZATION_ENABLED=false to disable. */
export function isScoreMaterializationEnabled(): boolean {
  const v = (typeof process !== 'undefined' ? process.env?.LEAD_SCORE_MATERIALIZATION_ENABLED : undefined);
  return v !== 'false' && v !== '0';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** True when a scores object already carries a real (source-provided) numeric signal. */
export function hasRealScores(scores: CanonicalLeadScores | undefined | null): boolean {
  if (!scores) return false;
  return isNum(scores.intent) || isNum(scores.total) || isNum(scores.icp) || isNum(scores.urgency);
}

/** Pure projection: a canonical lead (write model) → the read-model view the scorer consumes. */
export function canonicalLeadToView(lead: CanonicalLead): CanonicalLeadView {
  const attribution = lead.attribution;
  return {
    organizationId: lead.organizationId,
    source: lead.source,
    sourceLabel: CANONICAL_LEAD_SOURCE_LABELS[lead.source] ?? String(lead.source),
    unifiedPersonId: lead.unifiedPersonId ?? lead.identity.unifiedPersonId ?? null,
    identity: lead.identity,
    scores: lead.scores ?? {},
    status: lead.status ?? null,
    campaign: attribution.campaign ?? null,
    content: attribution.content ?? null,
    referrer: attribution.referrer ?? null,
    utm: attribution.utm,
    occurredAt: lead.occurredAt ?? null,
    sourceRef: lead.sourceRef ?? null,
    attribution,
  };
}

/**
 * Map a view to canonical scores via the ONE scorer. View-only (no behavioural
 * hydration) — deterministic from the lead's own captured evidence. When behaviour
 * accrues, the read Detail may compute a richer score from the same engine; that is
 * additive evidence (monotonic), reconciled by re-adoption / backfill.
 */
export function materializeScoresFromView(view: CanonicalLeadView): CanonicalLeadScores {
  const existing = view.scores ?? {};
  if (hasRealScores(existing)) return existing; // never overwrite a source-provided score
  const bi = buildBuyingIntentProfile({ view });
  const norm = bi.score / 100;
  const conf = bi.confidence / 100;
  return {
    intent: norm,
    total: norm,
    confidence: conf,
    icp: existing.icp ?? null,
    urgency: existing.urgency ?? null,
  };
}

/** Write-path entry: compute the scores to persist for a canonical lead. */
export function materializeCanonicalScores(lead: CanonicalLead): CanonicalLeadScores {
  if (!isScoreMaterializationEnabled()) return lead.scores ?? {};
  if (hasRealScores(lead.scores)) return lead.scores ?? {};
  return materializeScoresFromView(canonicalLeadToView(lead));
}

/** Read-path entry: ensure a view carries canonical scores (no-op if it already does). */
export function ensureMaterializedScores(view: CanonicalLeadView): CanonicalLeadView {
  if (!isScoreMaterializationEnabled()) return view;
  if (hasRealScores(view.scores)) return view;
  return { ...view, scores: materializeScoresFromView(view) };
}
