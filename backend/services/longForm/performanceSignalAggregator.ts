/**
 * Phase 4 — Performance signal aggregator.
 *
 * Reads the feedback registry and produces three indicator groups:
 *   strategicHealthIndicators       — acceptance + coherence + novelty trends
 *   governancePressureIndicators    — recovery / blocking / approval / conflict frequencies
 *   ecosystemEvolutionIndicators    — cannibalization recurrence, sequencing adoption, saturation
 *
 * Pure read; no LLM.
 */

import type {
  DiagnosticTrend,
  FeedbackEvent,
  PerformanceSignalAggregation,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 4): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

function pctOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function eventsInWindow(events: FeedbackEvent[], sinceISO: string | undefined): FeedbackEvent[] {
  if (!sinceISO) return events;
  return events.filter((e) => e.timestamp >= sinceISO);
}

export interface AggregatePerformanceSignalsInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  /** Window for trend math — defaults to all events. */
  windowSinceISO?: string;
}

export function aggregatePerformanceSignals(input: AggregatePerformanceSignalsInput): PerformanceSignalAggregation {
  const all = input.registry.list(input.companyId);
  const events = eventsInWindow(all, input.windowSinceISO);
  const total = events.length;

  // Counts by type.
  const counts = new Map<string, FeedbackEvent[]>();
  for (const e of events) {
    const arr = counts.get(e.eventType) ?? [];
    arr.push(e);
    counts.set(e.eventType, arr);
  }
  const c = (type: string): FeedbackEvent[] => counts.get(type) ?? [];

  // Strategic health.
  const accepted = c('recommendation_accepted').length;
  const rejected = c('recommendation_rejected').length;
  const recommendationAcceptanceRatePercent = pctOf(accepted, accepted + rejected);

  // Novelty / coherence trends — use scoreContext.coherence or .novelty if present.
  const novelties = events
    .map((e) => e.scoreContext?.novelty)
    .filter((v): v is number => typeof v === 'number');
  const coherences = events
    .map((e) => e.scoreContext?.coherence)
    .filter((v): v is number => typeof v === 'number');
  const mid = (arr: { length: number }) => Math.max(1, Math.floor(arr.length / 2));
  const noveltyDecayTrend: DiagnosticTrend = novelties.length < 4 ? 'unknown'
    : trendDirection(average(novelties.slice(0, mid(novelties))), average(novelties.slice(mid(novelties))));
  const portfolioCoherenceTrend: DiagnosticTrend = coherences.length < 4 ? 'unknown'
    : trendDirection(average(coherences.slice(0, mid(coherences))), average(coherences.slice(mid(coherences))));

  // Governance pressure.
  const recoveryFrequencyPercent = pctOf(c('generation_recovered').length + c('portfolio_recovery').length, total);
  const blockingFrequencyPercent = pctOf(c('generation_blocked').length + c('planner_rejected').length, total);
  const approvalBottleneckPercent = pctOf(c('approval_bottleneck').length, total);
  const revisionConflictPercent = pctOf(c('revision_rollback').length, total);

  // Ecosystem evolution.
  const cannibalizationRecurrencePercent = pctOf(c('cannibalization_recurrence').length, total);
  const seqAdopted = c('strategic_sequencing_adopted').length;
  const seqIgnored = c('strategic_sequencing_ignored').length;
  const sequencingAdoptionRatePercent = pctOf(seqAdopted, seqAdopted + seqIgnored);

  // Portfolio saturation trend — derive from cannibalization-recurrence frequency over time.
  const cannibalRecurrence = c('cannibalization_recurrence');
  const portfolioSaturationTrend: DiagnosticTrend = cannibalRecurrence.length < 4 ? 'unknown'
    : trendDirection(cannibalRecurrence.slice(mid(cannibalRecurrence)).length, cannibalRecurrence.slice(0, mid(cannibalRecurrence)).length);

  return {
    strategicHealthIndicators: {
      recommendationAcceptanceRatePercent,
      portfolioCoherenceTrend,
      noveltyDecayTrend,
    },
    governancePressureIndicators: {
      recoveryFrequencyPercent,
      blockingFrequencyPercent,
      approvalBottleneckPercent,
      revisionConflictPercent,
    },
    ecosystemEvolutionIndicators: {
      cannibalizationRecurrencePercent,
      sequencingAdoptionRatePercent,
      portfolioSaturationTrend,
    },
    sampleSize: total,
  };
}
