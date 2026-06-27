/**
 * Design System Performance Intelligence — pure deterministic aggregation +
 * scoring (no AI, no DB). Rolls measured analytics (one row per published
 * asset, already produced by the existing analytics pipeline) up to the
 * Template, Collection, and Campaign Design System, and derives explained
 * performance scores. Reuses the existing analytics numbers — it never defines
 * a new analytics model.
 */

import type { DesignAttribution } from './designAttribution';

/** One measured asset's analytics + its attribution (from existing analytics). */
export interface AssetPerformance {
  attribution: DesignAttribution;
  /** The asset family (image|carousel|infographic) — for weak-family detection. */
  assetFamily?: string;
  platform: string;
  impressions: number;
  reach: number;
  engagement: number;   // likes + reactions + comments + shares (existing definition)
  clicks: number;
  saves: number;
  shares: number;
  comments: number;
  conversions: number;
}

export interface PlatformRollup {
  platform: string;
  impressions: number;
  clicks: number;
  engagement: number;
  ctr: number;
  engagementRate: number;
}

export interface PerfRollup {
  key: string;
  assetCount: number;
  impressions: number;
  reach: number;
  engagement: number;
  clicks: number;
  saves: number;
  shares: number;
  comments: number;
  conversions: number;
  engagementRate: number;
  ctr: number;
  saveRate: number;
  shareRate: number;
  conversionRate: number;
  byPlatform: PlatformRollup[];
}

function num(v: number): number { return Number.isFinite(v) ? v : 0; }
function rate(n: number, d: number): number { return d > 0 ? n / d : 0; }
function round(n: number, p = 4): number { const f = 10 ** p; return Math.round(n * f) / f; }

/** Group assets by an attribution key, then roll up + compute deterministic rates. */
function rollup(assets: AssetPerformance[], keyOf: (a: AssetPerformance) => string | null): PerfRollup[] {
  const groups = new Map<string, AssetPerformance[]>();
  for (const a of assets) {
    const k = keyOf(a);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  const out: PerfRollup[] = [];
  for (const [key, list] of groups) {
    const sum = (f: (a: AssetPerformance) => number) => list.reduce((s, a) => s + num(f(a)), 0);
    const impressions = sum((a) => a.impressions);
    const clicks = sum((a) => a.clicks);
    const engagement = sum((a) => a.engagement);
    const saves = sum((a) => a.saves);
    const shares = sum((a) => a.shares);
    const conversions = sum((a) => a.conversions);

    const platforms = new Map<string, AssetPerformance[]>();
    for (const a of list) (platforms.get(a.platform) ?? platforms.set(a.platform, []).get(a.platform)!).push(a);
    const byPlatform: PlatformRollup[] = Array.from(platforms.entries()).map(([platform, pl]) => {
      const pi = pl.reduce((s, a) => s + num(a.impressions), 0);
      const pc = pl.reduce((s, a) => s + num(a.clicks), 0);
      const pe = pl.reduce((s, a) => s + num(a.engagement), 0);
      return { platform, impressions: pi, clicks: pc, engagement: pe, ctr: round(rate(pc, pi)), engagementRate: round(rate(pe, pi)) };
    }).sort((a, b) => (b.ctr - a.ctr) || (a.platform < b.platform ? -1 : 1));

    out.push({
      key, assetCount: list.length, impressions, reach: sum((a) => a.reach), engagement, clicks, saves, shares,
      comments: sum((a) => a.comments), conversions,
      engagementRate: round(rate(engagement, impressions)),
      ctr: round(rate(clicks, impressions)),
      saveRate: round(rate(saves, impressions)),
      shareRate: round(rate(shares, impressions)),
      conversionRate: round(rate(conversions, clicks || impressions)),
      byPlatform,
    });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function aggregateTemplateMetrics(assets: AssetPerformance[]): PerfRollup[] {
  return rollup(assets, (a) => a.attribution.templateId);
}
export function aggregateCollectionMetrics(assets: AssetPerformance[]): PerfRollup[] {
  return rollup(assets, (a) => a.attribution.collectionId);
}
export function aggregateCampaignDesignMetrics(assets: AssetPerformance[]): PerfRollup[] {
  return rollup(assets, (a) => a.attribution.campaignDesignSystemId);
}
export function aggregateFamilyMetrics(assets: AssetPerformance[]): PerfRollup[] {
  return rollup(assets, (a) => a.assetFamily ?? null);
}
/**
 * Roll up performance by Story Blueprint. `blueprintOf` maps an asset's
 * template id → blueprint id (injected by the service, which resolves templates;
 * keeps this pure). Reuses Design Attribution + the same rollup/scoring — no new
 * analytics model.
 */
export function aggregateBlueprintMetrics(assets: AssetPerformance[], blueprintOf: (templateId: string | null) => string | null): PerfRollup[] {
  return rollup(assets, (a) => blueprintOf(a.attribution.templateId));
}

/* ── Deterministic performance score (explained composition) ───────────── */

export interface ScoreComponent { label: string; value: number; weight: number; contribution: number; }
export interface PerformanceScore {
  score: number;            // 0–100
  components: ScoreComponent[];
  explanation: string;
}

// Normalisation ceilings (a rate at/above the ceiling earns full marks).
const CEIL = { engagementRate: 0.06, ctr: 0.03, saveRate: 0.02, shareRate: 0.01, conversionRate: 0.05 };
const WEIGHTS = { engagementRate: 0.35, ctr: 0.25, saveRate: 0.12, shareRate: 0.10, conversionRate: 0.18 };

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

/**
 * Score a rollup deterministically. Each component = clamp(rate / ceiling) *
 * weight * 100; the score is their sum. Volume gates trust: a rollup with no
 * impressions scores 0. Same rollup → same score + composition.
 */
export function scorePerformance(r: PerfRollup): PerformanceScore {
  if (!r || r.impressions <= 0) {
    return { score: 0, components: [], explanation: 'No measured impressions yet — insufficient data to score.' };
  }
  const rows: Array<{ label: string; rate: number; ceil: number; weight: number }> = [
    { label: 'Engagement rate', rate: r.engagementRate, ceil: CEIL.engagementRate, weight: WEIGHTS.engagementRate },
    { label: 'Click-through rate', rate: r.ctr, ceil: CEIL.ctr, weight: WEIGHTS.ctr },
    { label: 'Save rate', rate: r.saveRate, ceil: CEIL.saveRate, weight: WEIGHTS.saveRate },
    { label: 'Share rate', rate: r.shareRate, ceil: CEIL.shareRate, weight: WEIGHTS.shareRate },
    { label: 'Conversion rate', rate: r.conversionRate, ceil: CEIL.conversionRate, weight: WEIGHTS.conversionRate },
  ];
  const components: ScoreComponent[] = rows.map((row) => {
    const norm = clamp01(row.rate / row.ceil);
    return { label: row.label, value: round(row.rate), weight: row.weight, contribution: round(norm * row.weight * 100, 2) };
  });
  const score = Math.round(components.reduce((s, c) => s + c.contribution, 0));
  const top = [...components].sort((a, b) => b.contribution - a.contribution)[0];
  return {
    score,
    components,
    explanation: `Score ${score}/100 across ${r.assetCount} asset(s); strongest driver: ${top ? top.label.toLowerCase() : 'n/a'}.`,
  };
}

/* ── Strategist feed: historical compatibility + measured reasons ──────── */

/** Map collection rollups → historical compatibility (0–20) for the strategist. */
export function toHistoricalCompatibility(collectionRollups: PerfRollup[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of collectionRollups) out[r.key] = round((scorePerformance(r).score / 100) * 20, 2);
  return out;
}

/**
 * Measured-analytics reasons for a collection rollup (deterministic; no AI):
 * "Best performing", "High CTR on LinkedIn", "Strong Executive engagement".
 */
export function performanceReasons(
  r: PerfRollup,
  opts: { isTopPerformer?: boolean; audience?: string | null } = {},
): string[] {
  const reasons: string[] = [];
  if (r.impressions <= 0) return reasons;
  if (opts.isTopPerformer) reasons.push('Best performing');
  const bestPlatform = r.byPlatform[0];
  if (bestPlatform && bestPlatform.ctr >= CEIL.ctr) {
    reasons.push(`High CTR on ${bestPlatform.platform[0]!.toUpperCase()}${bestPlatform.platform.slice(1)}`);
  }
  if (r.engagementRate >= CEIL.engagementRate && opts.audience) {
    const aud = opts.audience.replace(/[_-]+/g, ' ');
    reasons.push(`Strong ${aud[0]!.toUpperCase()}${aud.slice(1)} engagement`);
  } else if (r.engagementRate >= CEIL.engagementRate) {
    reasons.push('Strong audience engagement');
  }
  return reasons;
}

/**
 * Weak families = families measured (impressions > 0) but below the score floor,
 * PLUS required families entirely absent from the measured set.
 */
export function weakAssetFamilies(familyRollups: PerfRollup[], requiredFamilies: string[] = []): string[] {
  const measured = new Set(familyRollups.map((r) => r.key));
  const underperforming = familyRollups
    .filter((r) => r.impressions > 0 && scorePerformance(r).score < 40)
    .map((r) => r.key);
  const absent = requiredFamilies.filter((f) => !measured.has(f));
  return Array.from(new Set([...underperforming, ...absent])).sort();
}
