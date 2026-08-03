/**
 * INT-001 Phase 3 — Recommended Actions. Prioritized, explained, deterministic.
 * Recommendation only — nothing is assigned, scheduled, or sent here.
 */

import type {
  QualificationPlanningInput,
  QualificationResult,
  UrgencyAssessment,
  RecommendedAction,
  ActionPriority,
} from './types';
import { extractSnapshotSignals, clampConfidence } from './signals';

const PRIORITY_ORDER: Record<ActionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildRecommendedActions(
  input: QualificationPlanningInput,
  qualification: QualificationResult,
  urgency: UrgencyAssessment,
): RecommendedAction[] {
  const signals = extractSnapshotSignals(input.snapshot);
  const persona = input.persona.persona;
  const counts = signals.pageSignalCounts;
  const out: Array<Omit<RecommendedAction, 'rank'>> = [];
  const add = (action: string, priority: ActionPriority, confidence: number, explanation: string) => {
    out.push({ action, priority, confidence: clampConfidence(confidence), explanation });
  };

  if (qualification.band === 'hot') {
    // Human routing always leads the critical tier for a hot lead — floor the
    // confidence so no automated action can deterministically outrank it.
    add('Assign SDR', 'critical', Math.max(qualification.confidence, 0.95), `Hot lead (${qualification.totalScore}/100) — route to a human immediately.`);
  } else if (qualification.band === 'warm') {
    add('Assign SDR', 'high', qualification.confidence * 0.9, `Warm lead (${qualification.totalScore}/100) — assign within the working day.`);
  }

  if (signals.demoRequested) {
    add('Schedule follow-up', 'critical', 0.9, 'A demo was explicitly requested — schedule before interest cools.');
  } else if (urgency.score >= 50) {
    add('Schedule follow-up', 'high', 0.75, `Urgency ${urgency.score}/100 — follow up within 24 hours.`);
  } else {
    add('Schedule follow-up', 'medium', 0.6, 'Standard follow-up cadence applies.');
  }

  if ((counts.comparison ?? 0) > 0) {
    add('Send comparison guide', 'high', 0.8, `Visited ${counts.comparison} comparison page(s) — actively evaluating alternatives.`);
  }
  if ((counts.case_study ?? 0) > 0 || qualification.band === 'warm') {
    add('Share case study', 'medium', 0.65, (counts.case_study ?? 0) > 0
      ? 'Case-study interest observed — reinforce with the closest match.'
      : 'Warm lead — social proof advances the evaluation.');
  }
  if (persona === 'Developer' || persona === 'CTO') {
    add('Technical demo', 'high', 0.7 * (0.5 + input.persona.confidence / 2), `${persona} persona — a hands-on technical session outperforms sales decks.`);
    add('API documentation', 'medium', 0.65, 'Technical persona — send the API quick-start proactively.');
  }
  if ((persona === 'Founder' || persona === 'CEO') && qualification.totalScore >= 50) {
    add('Executive outreach', 'high', 0.7, `${persona} at score ${qualification.totalScore} — senior-to-senior outreach is warranted.`);
  }
  if (persona === 'Agency' || persona === 'Partner') {
    add('Partner program', 'high', 0.7, `${persona} persona — route into the partner track, not the sales pipeline.`);
  }
  if ((counts.security ?? 0) > 0 || persona === 'Procurement') {
    add('Security documentation', 'medium', 0.7, (counts.security ?? 0) > 0
      ? 'Security pages visited — send the compliance pack proactively.'
      : 'Procurement persona — compliance material unblocks the deal.');
  }
  if ((counts.documentation ?? 0) > 0 && persona !== 'Developer' && persona !== 'CTO') {
    add('API documentation', 'low', 0.5, 'Documentation interest observed — offer the developer material.');
  }

  // Deterministic ordering: priority, then confidence desc, then action name.
  const sorted = out.sort((a, b) => {
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.action.localeCompare(b.action);
  });

  // De-duplicate by action name (first = highest ranked wins), then rank.
  const seen = new Set<string>();
  const ranked: RecommendedAction[] = [];
  for (const action of sorted) {
    if (seen.has(action.action)) continue;
    seen.add(action.action);
    ranked.push({ ...action, rank: ranked.length + 1 });
  }
  return ranked;
}
