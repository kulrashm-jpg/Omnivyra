/**
 * INT-001 Phase 3 — Urgency Engine. Independent, deterministic, explainable.
 * Consumes captured signals only; never re-derives intent or persona.
 */

import type { LeadCaptureSnapshot, UrgencyAssessment, SignalContribution } from './types';
import { extractSnapshotSignals, clampScore, clampConfidence } from './signals';

export function evaluateUrgency(snapshot: LeadCaptureSnapshot): UrgencyAssessment {
  const signals = extractSnapshotSignals(snapshot);
  const contributions: SignalContribution[] = [];
  const add = (signal: string, points: number, evidence: string) => {
    contributions.push({ signal, points, evidence });
  };

  const counts = signals.pageSignalCounts;
  if (signals.demoRequested) add('demo_request', 30, 'Demo explicitly requested');
  if ((counts.pricing ?? 0) > 0) add('pricing_visits', Math.min(20, 10 + (counts.pricing - 1) * 5), `${counts.pricing} pricing visit(s)`);
  if ((counts.enterprise ?? 0) > 0) add('enterprise_pages', 12, `${counts.enterprise} enterprise page visit(s)`);
  if ((counts.comparison ?? 0) > 0) add('comparison_pages', 10, `${counts.comparison} comparison page visit(s)`);
  if ((counts.security ?? 0) > 0) add('security_pages', 8, `${counts.security} security/compliance visit(s)`);
  if (signals.repeatVisitor) add('repeat_visits', 10, `${signals.sessionCount} sessions recorded`);
  if (signals.sessionCount >= 3) add('multiple_sessions', 5, `${signals.sessionCount} distinct sessions`);
  if (signals.recency === 'immediate') add('recent_activity', 10, 'Active within the last hour');
  else if (signals.recency === 'same_day') add('recent_activity', 6, 'Active within the last day');
  else if (signals.recency === 'same_week') add('recent_activity', 2, 'Active within the last week');
  if (signals.emailClass === 'company') add('company_email', 8, 'Company email address');
  else if (signals.emailClass === 'free') add('free_email', -5, 'Free mailbox provider');
  else if (signals.emailClass === 'student') add('student_email', -10, 'Academic email address');
  if (signals.eventCount >= 10) add('engagement_depth', 7, `${signals.eventCount} captured events`);
  else if (signals.eventCount >= 4) add('engagement_depth', 4, `${signals.eventCount} captured events`);

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = clampScore(raw);

  // Confidence grows with the amount of behavioural evidence available.
  const evidenceUnits =
    Math.min(signals.eventCount, 10) + Math.min(signals.sessionCount * 2, 6) + (signals.emailClass !== 'unknown' ? 2 : 0);
  const confidence = clampConfidence(0.2 + evidenceUnits * 0.045);

  const top = [...contributions].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
  const explanation = contributions.length === 0
    ? 'No urgency signals captured.'
    : `Urgency driven by: ${top.map((c) => c.evidence).join('; ')}.`;

  return { score, confidence, explanation, signals: contributions };
}
