/**
 * Phase 7 — Funnel coverage analyzer.
 *
 * Buckets every portfolio asset into TOFU / MOFU / BOFU (awareness → tofu;
 * consideration/evaluation → mofu; decision/expansion → bofu) and surfaces:
 *   - share by bucket
 *   - authority depth per bucket (avg authorityThemes count)
 *   - per-ICP progression gaps (which buckets are missing)
 *   - imbalance signal (any bucket < 15% or > 60% triggers)
 *   - weak conversion bridges (no MOFU article links to a BOFU article)
 *   - missing educational progression (TOFU exists but no MOFU follow-up)
 */

import type {
  ContentPortfolioAsset,
  FunnelCoverageResult,
} from './longFormRecommendationTypes';
import { FUNNEL_STAGE_TO_BUCKET } from './contentPortfolioRegistry';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export interface AnalyzeFunnelCoverageInput {
  assets: ContentPortfolioAsset[];
}

export function analyzeFunnelCoverage(input: AnalyzeFunnelCoverageInput): FunnelCoverageResult {
  const assets = input.assets;
  const total = assets.length || 1;
  const tofu = assets.filter((a) => FUNNEL_STAGE_TO_BUCKET[a.funnelStage] === 'tofu');
  const mofu = assets.filter((a) => FUNNEL_STAGE_TO_BUCKET[a.funnelStage] === 'mofu');
  const bofu = assets.filter((a) => FUNNEL_STAGE_TO_BUCKET[a.funnelStage] === 'bofu');

  const tofuShare = Number((tofu.length / total).toFixed(2));
  const mofuShare = Number((mofu.length / total).toFixed(2));
  const bofuShare = Number((bofu.length / total).toFixed(2));

  const authorityDepthByStage: FunnelCoverageResult['authorityDepthByStage'] = {
    tofu: Math.round(average(tofu.map((a) => a.authorityThemes.length))),
    mofu: Math.round(average(mofu.map((a) => a.authorityThemes.length))),
    bofu: Math.round(average(bofu.map((a) => a.authorityThemes.length))),
  };

  // Per-ICP progression gaps.
  const icpsByBucket = new Map<string, Set<'tofu' | 'mofu' | 'bofu'>>();
  for (const asset of assets) {
    const bucket = FUNNEL_STAGE_TO_BUCKET[asset.funnelStage];
    for (const icp of asset.icpFocus) {
      const key = icp.trim().toLowerCase();
      if (!key) continue;
      const set = icpsByBucket.get(key) ?? new Set();
      set.add(bucket);
      icpsByBucket.set(key, set);
    }
  }
  const icpProgressionGaps: FunnelCoverageResult['icpProgressionGaps'] = [];
  for (const [icp, set] of icpsByBucket) {
    const missing: Array<'tofu' | 'mofu' | 'bofu'> = [];
    if (!set.has('tofu')) missing.push('tofu');
    if (!set.has('mofu')) missing.push('mofu');
    if (!set.has('bofu')) missing.push('bofu');
    if (missing.length > 0) icpProgressionGaps.push({ icp, missingStages: missing });
  }

  const imbalanceDetected =
    tofuShare < 0.15 || tofuShare > 0.60
    || mofuShare < 0.15 || mofuShare > 0.60
    || bofuShare < 0.10 || bofuShare > 0.60;

  // Weak conversion bridges — MOFU presence without BOFU (or vice versa) per ICP.
  const weakConversionBridges: string[] = [];
  for (const [icp, set] of icpsByBucket) {
    if (set.has('mofu') && !set.has('bofu')) {
      weakConversionBridges.push(`ICP "${icp}" has MOFU coverage but no BOFU close.`);
    }
    if (set.has('tofu') && !set.has('mofu') && set.has('bofu')) {
      weakConversionBridges.push(`ICP "${icp}" jumps from TOFU directly to BOFU — missing MOFU bridge.`);
    }
  }

  // Missing educational progression — overall TOFU exists but no MOFU yet.
  const missingEducationalProgression: string[] = [];
  if (tofu.length > 0 && mofu.length === 0) missingEducationalProgression.push('Portfolio has TOFU coverage but zero MOFU follow-up.');
  if (mofu.length > 0 && bofu.length === 0) missingEducationalProgression.push('Portfolio has MOFU coverage but zero BOFU.');

  return {
    tofuCount: tofu.length,
    mofuCount: mofu.length,
    bofuCount: bofu.length,
    tofuShare,
    mofuShare,
    bofuShare,
    authorityDepthByStage,
    icpProgressionGaps,
    imbalanceDetected,
    weakConversionBridges,
    missingEducationalProgression,
  };
}
