import { classifyBaseline, computeExpectedBaseline } from '../baselineClassificationService';
import { getLatestSnapshotsPerPlatform } from '../../db/platformMetricsSnapshotStore';

const PRIMARY_TYPE_PLATFORM_PREFERENCE: Record<string, string[]> = {
  lead_generation: ['linkedin'],
  authority_positioning: ['linkedin'],
  network_expansion: ['linkedin', 'facebook'],
  engagement_growth: ['instagram', 'tiktok'],
  product_promotion: ['instagram', 'linkedin'],
  brand_awareness: [],
};

export interface BaselineContext {
  stage: string;
  scope: string;
  expectedBaseline: number;
  actualFollowers: number;
  ratio: number;
  status: 'underdeveloped' | 'aligned' | 'strong';
  primaryPlatform: string;
}

export type BaselineContextResult = BaselineContext | { unavailable: true };

export async function resolveBaselineContext(input: {
  companyId: string;
  companyStage: string | null;
  marketScope: string | null;
  baselineOverride: Record<string, unknown> | null;
  primaryType: string;
  platformStrategies: { name: string }[];
}): Promise<BaselineContextResult> {
  const stage = input.companyStage ?? 'early_stage';
  const scope = input.marketScope ?? 'niche';
  const expectedBaseline = computeExpectedBaseline(stage, scope);

  if (input.baselineOverride && typeof input.baselineOverride === 'object') {
    const override = input.baselineOverride as { platform?: string; followers?: number };
    const actualFollowers = Math.max(0, Number(override.followers) ?? 0);
    const platform = String(override.platform || 'unknown');
    const classification = classifyBaseline(actualFollowers, expectedBaseline);
    return {
      stage,
      scope,
      expectedBaseline,
      actualFollowers,
      ratio: classification.ratio,
      status: classification.status,
      primaryPlatform: platform,
    };
  }

  const snapshots = await getLatestSnapshotsPerPlatform(input.companyId);
  if (snapshots.length === 0) return { unavailable: true };

  const pref = PRIMARY_TYPE_PLATFORM_PREFERENCE[input.primaryType] ?? [];
  const byPlatform = new Map(snapshots.map((s) => [s.platform.toLowerCase(), s]));
  const alias = (p: string) => (p === 'x' ? 'twitter' : p);
  const strategyNames = (input.platformStrategies || []).map((p) =>
    alias(
      String(p.name || '')
        .toLowerCase()
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/^\s+|\s+$/g, '')
    )
  );

  let chosen: { platform: string; followers: number } | null = null;
  for (const p of pref) {
    const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
    if (snap) {
      chosen = { platform: snap.platform, followers: snap.followers };
      break;
    }
  }
  if (!chosen) {
    for (const p of strategyNames) {
      const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
      if (snap) {
        chosen = { platform: snap.platform, followers: snap.followers };
        break;
      }
    }
  }
  if (!chosen) {
    const highest = snapshots.reduce((a, b) => (a.followers >= b.followers ? a : b));
    chosen = { platform: highest.platform, followers: highest.followers };
  }

  const classification = classifyBaseline(chosen.followers, expectedBaseline);
  return {
    stage,
    scope,
    expectedBaseline,
    actualFollowers: chosen.followers,
    ratio: classification.ratio,
    status: classification.status,
    primaryPlatform: chosen.platform,
  };
}
