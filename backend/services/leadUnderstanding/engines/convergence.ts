/**
 * LI-D307 — Legacy Convergence (pure, deterministic). Compatibility adapters so legacy Lead
 * Intelligence consumers keep working while sourced from the canonical Understanding — they become
 * consumers, no longer owners. Provides a legacy-view adapter + parity validation vs legacy scores.
 */

import type { CanonicalLeadScores } from '../../../../lib/leadIntelligence/types';
import type { LeadUnderstanding } from '../types';
import { compareToLegacy } from '../shadowRuntime';
import { legacyScoresAdapter } from '../persistence';

export interface LegacyLeadView {
  company_id: string;
  lead_key: string;
  scores: CanonicalLeadScores;
  next_action: string | null;
  confidence: number;
}

/** Canonical → the legacy view/scores shape existing consumers read. */
export function toLegacyView(u: LeadUnderstanding): LegacyLeadView {
  const s = legacyScoresAdapter.fromUnderstanding(u);
  return {
    company_id: u.key.companyId,
    lead_key: u.key.leadKey,
    scores: { intent: s.intent ?? null, urgency: s.urgency ?? null, icp: s.icp ?? null, total: s.total ?? null, confidence: u.score.confidence },
    next_action: (u.facets.recommendations.value?.nextAction) ?? null,
    confidence: u.score.confidence,
  };
}

export interface ConvergenceResult { leadKey: string; parity: number; matches: boolean; }

/** Validate the canonical projection matches legacy within tolerance (adoption gate). */
export function validateConvergence(u: LeadUnderstanding, legacy: CanonicalLeadScores, tolerance = 0.1): ConvergenceResult {
  const cmp = compareToLegacy(u, legacy, { tolerance });
  return { leadKey: u.key.leadKey, parity: cmp.parity, matches: cmp.parity >= 0.999 };
}
