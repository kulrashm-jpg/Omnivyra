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
import { describeGeo } from './visitorContext';

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
    // WS-2 M2: name the assets when the tracker reported them. This ENRICHES
    // the existing evidence — no additional points, because download volume is
    // already scored here and scoring it twice would inflate the signal.
    const named = behavior.downloadedAssets.slice(0, 3).join(', ');
    contributions.push({
      signal: 'downloads',
      label: 'Downloads',
      points,
      evidence: named
        ? `${plural(behavior.downloadCount, 'download interaction')} — ${named}${behavior.downloadedAssets.length > 3 ? ' …' : ''}`
        : `${plural(behavior.downloadCount, 'download interaction')}`,
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

  // 3b. WS-2 M1 (5): durable loyalty — the persisted visit ordinal, which
  // survives beyond the sessions loaded into this snapshot. Scored separately
  // from observed sessions above so neither restates the other's evidence.
  if (behavior.visitCount !== null && behavior.visitCount > 1) {
    const beyondFirst = behavior.visitCount - 1;
    const points = Math.min(
      beyondFirst * intentCfg.loyaltyPoints.pointsPerVisitBeyondFirst,
      intentCfg.loyaltyPoints.cap,
    );
    contributions.push({
      signal: 'visitor_loyalty',
      label: 'Returning Visitor',
      points,
      evidence: `Visit #${behavior.visitCount} for this visitor`,
    });
  }

  // 3c. WS-2 M1 (5): return cadence — how quickly they came back.
  if (behavior.minTimeBetweenSessionsMs !== null) {
    const gapDays = behavior.minTimeBetweenSessionsMs / 86_400_000;
    const tier = intentCfg.cadence.find((t) => gapDays <= t.withinDays);
    if (tier) {
      contributions.push({
        signal: 'return_cadence',
        label: 'Return Cadence',
        points: tier.points,
        evidence: tier.label,
      });
    }
  }

  // 3d. WS-2 M2 — ON-SITE SEARCH. A typed query is the visitor stating intent
  // in their own words. Scored per DISTINCT query: searching the same term
  // five times is one interest, not five.
  if (behavior.searchQueries.length > 0) {
    const points = Math.min(
      behavior.searchQueries.length * intentCfg.search.pointsPerDistinctQuery,
      intentCfg.search.cap,
    );
    const shown = behavior.searchQueries.slice(0, 3).map((q) => `"${q}"`).join(', ');
    contributions.push({
      signal: 'search_intent',
      label: 'On-site Search',
      points,
      evidence: `Searched ${plural(behavior.searchQueries.length, 'distinct term')}: ${shown}${behavior.searchQueries.length > 3 ? ' …' : ''}`,
    });
  }

  // 3e. WS-2 M2 — VIDEO ENGAGEMENT. Completion is the strong signal; a start is
  // a click. Only the highest tier reached is scored, so one video cannot be
  // counted three times through its start/progress/complete events.
  const videoCfg = intentCfg.video;
  if (behavior.videoCompleteCount > 0) {
    contributions.push({
      signal: 'video_engagement',
      label: 'Video Completed',
      points: Math.min(behavior.videoCompleteCount * videoCfg.completedPoints, videoCfg.cap),
      evidence: `Watched ${plural(behavior.videoCompleteCount, 'video')} to completion`,
    });
  } else if (behavior.maxVideoProgressPct !== null && behavior.maxVideoProgressPct >= videoCfg.substantialProgressPct) {
    contributions.push({
      signal: 'video_engagement',
      label: 'Video Watched',
      points: Math.min(videoCfg.substantialPoints, videoCfg.cap),
      evidence: `Watched ${Math.round(behavior.maxVideoProgressPct)}% of a video`,
    });
  } else if (behavior.videoStartCount > 0) {
    contributions.push({
      signal: 'video_engagement',
      label: 'Video Started',
      points: Math.min(behavior.videoStartCount * videoCfg.startedPoints, videoCfg.cap),
      evidence: `Started ${plural(behavior.videoStartCount, 'video')}`,
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

  /**
   * 8. WS-2 M2 — CONFIDENCE CONTEXT.
   *
   * Device and geography describe HOW RELIABLE the reading above is, not how
   * interested the visitor is. A visitor on one device from one country is a
   * cleaner signal than one who looks like three different people — but that
   * is not itself buying intent, so these contribute ZERO points and never
   * move the score. They are emitted as contributions so the explanation
   * surface stays a single list an operator can read top to bottom, with the
   * same signal/label/evidence contract as every scoring entry.
   */
  if (behavior.primaryDeviceCategory) {
    contributions.push({
      signal: 'device_confidence',
      label: 'Device Context',
      points: 0,
      evidence:
        behavior.multiDevice === true
          ? `Seen on ${behavior.deviceCategories.join(' and ')} — mostly ${behavior.primaryDeviceCategory}${behavior.browsers.length > 0 ? ` (${behavior.browsers.join(', ')})` : ''}`
          : `Consistently on ${behavior.primaryDeviceCategory}${behavior.browsers.length > 0 ? ` (${behavior.browsers.join(', ')})` : ''}`,
    });
  }
  if (behavior.geo) {
    const where = describeGeo(behavior.geo);
    contributions.push({
      signal: 'geo_confidence',
      label: 'Location Context',
      points: 0,
      evidence:
        behavior.geoConsistent === false
          ? `Sessions from ${behavior.countries.length} countries (${behavior.countries.join(', ')}) — location signal is mixed`
          : `Consistently from ${where ?? 'one location'}`,
    });
  }

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.min(Math.round(raw), intentCfg.maxScore);

  return { score, band: bandFor(score, intentCfg.bands), contributions };
}
