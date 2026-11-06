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

/**
 * The materialization MODEL version, stamped into every score this file
 * produces.
 *
 * `bi-1` was the original rule: `lead_captured` (+15, "Submitted a lead form")
 * was granted by DISPLAY-SOURCE membership of `buyingIntent.CAPTURE_SOURCES`.
 * `bi-2` grants it only on recorded `inbound_form` evidence (Prompt 2B, owner
 * decision). The two models therefore score the same lead 15 points apart,
 * before clamping - which is precisely why the stamp has to exist.
 *
 * BUMP THIS whenever a change alters the score a given view produces. Not for
 * a refactor, and not for new EVIDENCE: more behaviour accruing to a lead is
 * monotonic accrual the model already intends. It is for a change to the
 * RULES, because that is what makes two stored numbers incomparable.
 */
export const LEAD_SCORE_MODEL_VERSION = 'bi-2';

/**
 * The governed transition (Prompt 2B).
 *
 * Absent - the default, and the safe one - means stored scores from an earlier
 * model are PRESERVED. Set `LEAD_SCORE_MODEL_TRANSITION` to the current
 * version to authorize recomputation of those rows as they are next written.
 *
 * It is an explicit, named version rather than a boolean on purpose: a boolean
 * would stay switched on and silently authorize the NEXT model transition too,
 * which is the same class of defect as a default that overwrites.
 *
 * This authorizes nothing retroactively. It does not backfill, recalculate or
 * touch a row nothing else was already writing; it only decides what happens
 * to a row that is being rewritten anyway.
 */
export function authorizedScoreModelTransition(): string | null {
  const v = (typeof process !== 'undefined' ? process.env?.LEAD_SCORE_MODEL_TRANSITION : undefined);
  const t = String(v ?? '').trim();
  return t.length > 0 ? t : null;
}

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
    // THE WRITE PATH'S MISSING HALF (Prompt 2B).
    //
    // `buildBuyingIntentProfile` decides `lead_captured` from
    // `view.origin.category`. This projection did not copy `origin` - the word
    // appeared nowhere in this file - so on the write path the category was
    // ALWAYS undefined, and a fail-closed evidence rule would have been
    // fail-closed for EVERY lead: correct by accident, and for the wrong
    // reason. The read path gets the category from the originating
    // contribution; the write path has to get it from the lead being written.
    origin: lead.origin ?? null,
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
    // Stamped so a later reader can tell WHICH rule produced this number.
    modelVersion: LEAD_SCORE_MODEL_VERSION,
  };
}

/** What a write should do about a score the database already holds. */
export type ScoreWriteDecision =
  | {
    action: 'write';
    scores: CanonicalLeadScores;
    reason: 'no_stored_score' | 'same_model' | 'transition_authorized';
    storedVersion: string | null;
  }
  | {
    action: 'preserve';
    scores: CanonicalLeadScores;
    reason: 'earlier_model';
    storedVersion: string | null;
  };

/**
 * PROTECT AN EXISTING CUSTOMER SCORE FROM SILENT RECALCULATION (Prompt 2B).
 *
 * The defect this closes is not that scores are recomputed - recomputation is
 * this file's job. It is that the write path could not SEE the stored value,
 * so it always overwrote it.
 *
 * `hasRealScores` looked like protection and is not: on the write path it
 * inspects the INCOMING in-memory lead, never the stored row, and the
 * ingestion orchestrator never supplies `scores`. So materialization always
 * ran and the upsert (a full-row merge-duplicates upsert) always replaced what
 * was there. A routine CRM re-sync could therefore move a customer-visible
 * percentage by 15 points with no timeline event, no history row and nothing
 * to tell anyone it had happened.
 *
 * Pure, and separated from the read deliberately: the decision is testable on
 * its own, and the caller owns the one query.
 *
 * The rule, in full:
 *
 *   nothing stored                -> write. There is nothing to protect.
 *   stored, SAME model            -> write. Same rules, so the two numbers are
 *                                    comparable, and a difference is genuine
 *                                    new evidence the model means to reflect.
 *   stored, model differs/absent  -> PRESERVE, unless a transition to the
 *                                    current version is authorized.
 *
 * An ABSENT stored version is treated as an earlier model, not as a blank to
 * fill. It covers both a pre-stamp materialized score and a source-provided
 * System-B score, and neither may be silently replaced by this scorer's
 * output. Fail-closed: the error is a stale number, not a rewritten one.
 */
export function resolveScoreWrite(
  stored: CanonicalLeadScores | null | undefined,
  computed: CanonicalLeadScores,
): ScoreWriteDecision {
  const storedVersion = typeof stored?.modelVersion === 'string' && stored.modelVersion.trim()
    ? stored.modelVersion.trim()
    : null;
  if (!stored || !hasRealScores(stored)) {
    return { action: 'write', scores: computed, reason: 'no_stored_score', storedVersion };
  }
  if (storedVersion === LEAD_SCORE_MODEL_VERSION) {
    return { action: 'write', scores: computed, reason: 'same_model', storedVersion };
  }
  if (authorizedScoreModelTransition() === LEAD_SCORE_MODEL_VERSION) {
    return { action: 'write', scores: computed, reason: 'transition_authorized', storedVersion };
  }
  return { action: 'preserve', scores: stored, reason: 'earlier_model', storedVersion };
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
