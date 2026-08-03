/**
 * INT-001 Phase 3 — Behavioral Fit Engine. Scores how much the visitor's
 * captured behaviour matches an evaluating buyer, independent of intent.
 */

import type { LeadCaptureSnapshot, BehavioralFitAssessment, SignalContribution } from './types';
import { extractSnapshotSignals, clampScore, clampConfidence } from './signals';

export function evaluateBehavioralFit(snapshot: LeadCaptureSnapshot): BehavioralFitAssessment {
  const signals = extractSnapshotSignals(snapshot);
  const contributions: SignalContribution[] = [];
  const add = (signal: string, points: number, evidence: string) => {
    contributions.push({ signal, points, evidence });
  };

  if (signals.pageViewCount >= 8) add('page_depth', 20, `${signals.pageViewCount} pages viewed`);
  else if (signals.pageViewCount >= 3) add('page_depth', 12, `${signals.pageViewCount} pages viewed`);
  else if (signals.pageViewCount >= 1) add('page_depth', 5, `${signals.pageViewCount} page(s) viewed`);

  if (signals.repeatVisitor) add('return_behaviour', 15, `${signals.sessionCount} sessions`);
  if (signals.formEngaged) add('form_engagement', 15, 'Interacted with a capture form');

  const counts = signals.pageSignalCounts;
  if ((counts.documentation ?? 0) > 0) add('documentation_depth', 10, `${counts.documentation} documentation visit(s)`);
  if ((counts.case_study ?? 0) > 0) add('case_study_review', 10, `${counts.case_study} case-study visit(s)`);
  if ((counts.pricing ?? 0) > 0) add('evaluation_pages', 10, 'Reviewed commercial pages');
  if (signals.eventCount >= 15) add('sustained_engagement', 10, `${signals.eventCount} events over the journey`);

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = clampScore(raw);
  const confidence = clampConfidence(0.15 + Math.min(signals.eventCount, 12) * 0.05 + (signals.sessionCount > 0 ? 0.15 : 0));

  const explanation = contributions.length === 0
    ? 'No behavioural evidence captured.'
    : `Behavioural fit from: ${contributions.slice(0, 3).map((c) => c.evidence).join('; ')}.`;

  return { score, confidence, explanation, signals: contributions };
}
