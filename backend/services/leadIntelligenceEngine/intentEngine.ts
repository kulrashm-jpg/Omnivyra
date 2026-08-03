/**
 * INT-001 Phase 2 — Intent Intelligence Engine.
 *
 * Computes an explainable 0–100 intent score from captured behaviour. Every
 * point on the score is backed by a contribution entry (signal, label, points,
 * evidence). No values are hardcoded here — all weights/caps come from config.
 */

import type { IntentBand, IntentContribution, IntentIntelligence, LeadCaptureSnapshot, PageCategory } from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

function bandFor(score: number, bands: { high: number; medium: number }): IntentBand {
  if (score >= bands.high) return 'high';
  if (score >= bands.medium) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

export function computeIntentIntelligence(
  snapshot: LeadCaptureSnapshot,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): IntentIntelligence {
  const config = resolveEngineConfig(configOverride);
  const intentCfg = config.intent;
  const behavior = precomputed ?? analyzeBehavior(snapshot, config);
  const contributions: IntentContribution[] = [];

  // 1. Page-category visits (distinct pages per category, capped per category).
  const categoryOrder = Object.keys(intentCfg.pageCategoryPoints) as PageCategory[];
  for (const category of categoryOrder) {
    const rule = intentCfg.pageCategoryPoints[category];
    if (!rule) continue;
    const pages = behavior.categoryPages.get(category);
    const count = pages ? pages.size : 0;
    if (count === 0) continue;
    const points = Math.min(count * rule.points, rule.cap);
    contributions.push({
      signal: `page:${category}`,
      label: rule.label,
      points,
      evidence: `Visited ${plural(count, `${rule.label.toLowerCase()} page`)}`,
    });
  }

  // 2. Downloads.
  if (behavior.downloadCount > 0) {
    const points = Math.min(behavior.downloadCount * intentCfg.downloadPoints.points, intentCfg.downloadPoints.cap);
    contributions.push({
      signal: 'downloads',
      label: 'Downloads',
      points,
      evidence: `${plural(behavior.downloadCount, 'download interaction')}`,
    });
  }

  // 3. Repeat visits (extra sessions beyond the first).
  const extraSessions = Math.max(0, behavior.sessionCount - 1);
  if (extraSessions > 0) {
    const points = Math.min(extraSessions * intentCfg.repeatVisitPoints.pointsPerExtraSession, intentCfg.repeatVisitPoints.cap);
    contributions.push({
      signal: 'repeat_visits',
      label: 'Repeat Visitor',
      points,
      evidence: `${plural(behavior.sessionCount, 'session')} recorded`,
    });
  }

  // 4. Visit frequency (distinct active days beyond the first).
  const extraDays = Math.max(0, behavior.activeDays.length - 1);
  if (extraDays > 0) {
    const points = Math.min(extraDays * intentCfg.frequency.pointsPerActiveDay, intentCfg.frequency.cap);
    contributions.push({
      signal: 'visit_frequency',
      label: 'Visit Frequency',
      points,
      evidence: `Active on ${plural(behavior.activeDays.length, 'distinct day')}`,
    });
  }

  // 5. Deep scroll engagement.
  if (behavior.deepScrollCount > 0) {
    const points = Math.min(behavior.deepScrollCount * intentCfg.deepScrollPoints.points, intentCfg.deepScrollPoints.cap);
    contributions.push({
      signal: 'scroll_depth',
      label: 'Deep Reading',
      points,
      evidence: `${plural(behavior.deepScrollCount, 'page')} scrolled ≥${intentCfg.deepScrollThreshold}%`,
    });
  }

  // 6. Dwell time.
  if (behavior.engagedDwellCount > 0) {
    const points = Math.min(behavior.engagedDwellCount * intentCfg.dwellPoints.points, intentCfg.dwellPoints.cap);
    contributions.push({
      signal: 'dwell_time',
      label: 'Dwell Time',
      points,
      evidence: `${plural(behavior.engagedDwellCount, 'page')} with ≥${intentCfg.dwellSecondsThreshold}s dwell`,
    });
  }

  // 7. Recency (first matching tier wins).
  if (behavior.daysSinceLastActivity !== null) {
    const tier = intentCfg.recency.find((t) => behavior.daysSinceLastActivity! <= t.withinDays);
    if (tier) {
      contributions.push({ signal: 'recency', label: 'Recency', points: tier.points, evidence: tier.label });
    }
  }

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.min(Math.round(raw), intentCfg.maxScore);

  return { score, band: bandFor(score, intentCfg.bands), contributions };
}
