/**
 * PI-SCORE-PROVENANCE-001 — the evaluation store.
 *
 * The ONE writer and the ONE reader for `prospect_score_evaluations`. It records
 * what the canonical evaluator produced and reads it back; it computes no score,
 * applies no weight, and reinterprets nothing. If this module and the scoring
 * engine ever disagree, the engine is right.
 *
 * ─── THE DIGEST IS THE IDEMPOTENCY ────────────────────────────────────────
 * A background job re-runs on a schedule, and a schedule plus retries means the
 * same prospect is evaluated repeatedly with nothing having changed. Writing a
 * row per tick would turn a history into a log of the cron interval. The digest
 * covers the evaluation INPUTS — the subject ids, the ratified ICP version, the
 * rules version and the resulting dimension values — so an unchanged evaluation
 * collides with itself and inserts nothing, while any real change (new facts,
 * new ICP version, new rules) moves it and correctly produces a new historical
 * row.
 *
 * `asOf` is deliberately NOT in the digest. It moves on every tick by
 * construction, so including it would defeat the mechanism entirely and give
 * every run a fresh identity — the exact duplicate-history outcome the gate
 * forbids.
 *
 * ─── IT NEVER UPDATES ─────────────────────────────────────────────────────
 * The insert is ON CONFLICT DO NOTHING. It is never an upsert, because an upsert
 * would silently rewrite a historical evaluation — the one thing this table
 * exists to prevent. The database enforces the same rule independently with a
 * BEFORE UPDATE trigger, so a future caller cannot bypass this decision by
 * writing its own SQL.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import { SCORING_RULES_VERSION } from '../intelligence/canonical/scoring';
import { toScoreEvaluationRecord, type ScoreEvaluationRecord } from './persistence';
import type { LeadUnderstanding } from './types';

export const SCORE_EVALUATIONS_TABLE = 'prospect_score_evaluations';

export interface EvaluationSubjectIdentity {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly personId: string | null;
  readonly accountId: string | null;
  readonly icpId: string | null;
  readonly icpVersion: number | null;
  readonly asOf: string;
  readonly contextGaps: unknown;
}

/**
 * Deterministic digest of everything that makes this evaluation what it is.
 *
 * Stable ordering and JSON encoding, so the same inputs hash identically across
 * processes and restarts — a digest that varied by key order would make every
 * run look novel.
 */
export function evaluationInputDigest(
  u: LeadUnderstanding,
  subject: EvaluationSubjectIdentity,
): string {
  const d = u.score.dimensions;
  const material = [
    subject.organizationId,
    subject.prospectId,
    subject.personId ?? '',
    subject.accountId ?? '',
    subject.icpId ?? '',
    subject.icpVersion === null ? '' : String(subject.icpVersion),
    SCORING_RULES_VERSION,
    JSON.stringify([
      d.intent.value, d.icp.value, d.urgency.value,
      d.opportunity.value, d.priority.value, u.score.overall, u.score.confidence,
    ]),
  ].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

export interface PersistResult {
  /** true when a NEW historical row was created. */
  readonly written: boolean;
  /** true when an identical evaluation already existed — the idempotent path. */
  readonly duplicate: boolean;
  readonly digest: string;
  readonly error: string | null;
}

/**
 * Record one evaluation.
 *
 * Never throws: this runs inside a shared cron tick, and one prospect's write
 * failing must not end the cycle for the rest. A failure is reported so the job
 * can count it, and the score itself is unaffected — the evaluator already
 * produced it, and the API path does not depend on this row existing.
 */
export async function persistScoreEvaluation(
  u: LeadUnderstanding,
  subject: EvaluationSubjectIdentity,
): Promise<PersistResult> {
  const digest = evaluationInputDigest(u, subject);
  const record: ScoreEvaluationRecord = toScoreEvaluationRecord(u, {
    organizationId: subject.organizationId,
    prospectId: subject.prospectId,
    personId: subject.personId,
    accountId: subject.accountId,
    icpId: subject.icpId,
    icpVersion: subject.icpVersion,
    rulesVersion: SCORING_RULES_VERSION,
    asOf: subject.asOf,
    contextGaps: subject.contextGaps,
    inputDigest: digest,
  });

  try {
    const { data, error } = await ownedDbTable(SCORE_EVALUATIONS_TABLE)
      .upsert(record, {
        onConflict: 'organization_id,prospect_id,icp_version,rules_version,input_digest',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      logger.warn?.('score_evaluation_persist_failed', {
        organizationId: subject.organizationId,
        prospectId: subject.prospectId,
        code: error.code ?? null,
      });
      return { written: false, duplicate: false, digest, error: error.message };
    }
    // `ignoreDuplicates` returns no row when the identity already existed.
    const written = Array.isArray(data) && data.length > 0;
    return { written, duplicate: !written, digest, error: null };
  } catch (e) {
    return {
      written: false, duplicate: false, digest,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface StoredEvaluation {
  readonly id: string;
  readonly scoredAt: string;
  readonly evaluatedAt: string;
  readonly icpId: string | null;
  readonly icpVersion: number | null;
  readonly rulesVersion: string;
  readonly dimensions: Record<string, number | null>;
  readonly overall: number | null;
  readonly confidence: number;
}

/**
 * The latest recorded evaluation for one prospect, tenant-scoped.
 *
 * Read-only and ordered by the evaluator's own `scored_at`, not by insertion
 * time: a replay inserted later can describe an earlier instant, and ordering by
 * `created_at` would then present the older judgement as the newer one.
 */
export async function latestScoreEvaluation(
  organizationId: string,
  prospectId: string,
): Promise<StoredEvaluation | null> {
  const { data, error } = await ownedDbTable(SCORE_EVALUATIONS_TABLE)
    .select('id, scored_at, evaluated_at, icp_id, icp_version, rules_version, '
      + 'score_intent, score_icp, score_urgency, score_opportunity, score_priority, '
      + 'score_overall, confidence')
    .eq('organization_id', organizationId)     // tenant boundary — never optional
    .eq('prospect_id', prospectId)
    .order('scored_at', { ascending: false })
    // Tiebreaker. `scored_at` is the INJECTED evaluation instant, so two
    // evaluations can legitimately share one — a re-run at the same `asOf` after
    // a new ICP version is ratified does exactly that. Ordering on `scored_at`
    // alone then leaves "latest" to whatever the planner returns first, which
    // made an ICP-v2 read hand back the v1 row. `evaluated_at` is when the row
    // was actually written and is strictly increasing, so it breaks the tie the
    // only way that is always correct.
    .order('evaluated_at', { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as unknown as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

  return {
    id: String(r.id),
    scoredAt: String(r.scored_at),
    evaluatedAt: String(r.evaluated_at),
    icpId: r.icp_id === null || r.icp_id === undefined ? null : String(r.icp_id),
    icpVersion: num(r.icp_version),
    rulesVersion: String(r.rules_version),
    dimensions: {
      intent: num(r.score_intent),
      icp: num(r.score_icp),
      urgency: num(r.score_urgency),
      opportunity: num(r.score_opportunity),
      priority: num(r.score_priority),
    },
    overall: num(r.score_overall),
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
  };
}
