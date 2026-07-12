/**
 * CAMPAIGN-IMPL-006 — Campaign Strategy Optimization Engine (deterministic).
 *
 * Turns the advisory quality engine into a planning optimizer: a bounded,
 * deterministic hill-climbing loop that rebalances the PLAN's strategic METADATA
 * (theme, buyer-journey stage, CTA, audience, Master-Idea grouping) before AI
 * generation, keeping only changes that raise the quality score.
 *
 * HARD SAFETY BOUNDARY — the optimizer only ever rewrites metadata attributes.
 * It NEVER changes content_type, platform, week/date, or counts; never removes a
 * requested content type; never alters scheduling; never touches business-rule
 * inputs. So a campaign's structure, schedule, and format mix are invariant — only
 * the strategic framing metadata is refined.
 *
 * Determinism + termination: passes iterate in fixed index order with no
 * randomness; the loop stops when a full round yields no score improvement OR the
 * configurable pass budget is reached. It can never loop forever and never lowers
 * the score (a pass result is discarded unless it strictly improves overall).
 */

import {
  assessCampaignQuality,
  BUYER_JOURNEY_STAGES,
  type PlannedAsset,
  type CampaignQualityAssessment,
  type BuyerJourneyStage,
} from './campaignQuality';
import { fingerprint } from './masterIdea';

export interface OptimizationChange {
  pass: string;
  asset_index: number;
  field: 'funnel_stage' | 'cta' | 'theme' | 'audience' | 'master_idea_id';
  from: string;
  to: string;
  description: string;
}

export interface OptimizationResult {
  assets: PlannedAsset[];
  changes: OptimizationChange[];
  before: CampaignQualityAssessment;
  after: CampaignQualityAssessment;
  passes_run: number;
  improved: boolean;
  /** overall delta (after - before). */
  delta: number;
}

export const DEFAULT_MAX_OPTIMIZATION_PASSES = 4;

/** Safe, universally-valid CTA pool for diversifying a single-CTA campaign. */
const SAFE_CTA_POOL = ['Learn more', 'Get started', 'See how it works', 'Read the full story', 'Explore the details'];

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const clone = (a: PlannedAsset): PlannedAsset => ({ ...a });

function toStage(raw: unknown): BuyerJourneyStage {
  const v = norm(raw);
  if ((BUYER_JOURNEY_STAGES as readonly string[]).includes(v)) return v as BuyerJourneyStage;
  switch (v) {
    case 'education': case 'interest': return 'consideration';
    case 'trust': case 'conversion': case 'purchase': return 'decision';
    case 'onboarding': case 'adoption': return 'retention';
    case 'referral': case 'loyalty': return 'advocacy';
    default: return 'awareness';
  }
}

type Pass = (assets: PlannedAsset[]) => { assets: PlannedAsset[]; changes: OptimizationChange[] };

/** Buyer-journey balancing: fill missing canonical stages by re-labelling the surplus of the most over-represented stage. */
const buyerJourneyBalancing: Pass = (assets) => {
  const changes: OptimizationChange[] = [];
  const next = assets.map(clone);
  const counts = new Map<BuyerJourneyStage, number[]>(); // stage → asset indices
  next.forEach((a, i) => {
    const s = toStage(a.funnel_stage);
    if (!counts.has(s)) counts.set(s, []);
    counts.get(s)!.push(i);
  });
  const missing = BUYER_JOURNEY_STAGES.filter((s) => !counts.has(s)); // already in ascending rank order
  if (missing.length === 0) return { assets, changes };
  // Gather reassignable surplus (keep ≥1 asset in each donor stage) and assign the
  // missing stages to the LATEST-week assets in ascending rank order, so coverage
  // AND narrative progression improve together (later weeks → later stages).
  const reassignable: number[] = [];
  for (const [, idxs] of counts) {
    if (idxs.length <= 1) continue;
    reassignable.push(...idxs.slice(1)); // keep the first, free the rest
  }
  reassignable.sort((a, b) => (Number(next[a].week ?? 1) || 1) - (Number(next[b].week ?? 1) || 1));
  const targets = reassignable.slice(-missing.length); // latest weeks
  targets.forEach((idx, j) => {
    const from = toStage(next[idx].funnel_stage);
    const target = missing[j]; // ascending rank onto ascending week
    next[idx] = { ...next[idx], funnel_stage: target };
    changes.push({ pass: 'buyer_journey_balancing', asset_index: idx, field: 'funnel_stage', from, to: target, description: `Re-aimed one ${from} asset at the missing ${target} stage (placed in a later week for progression).` });
  });
  return { assets: next, changes };
};

/** CTA optimization: cut concentration by redistributing the dominant CTA's surplus across other CTAs (existing set, else a safe pool). */
const ctaOptimization: Pass = (assets) => {
  const changes: OptimizationChange[] = [];
  const next = assets.map(clone);
  const withCta = next.map((a, i) => ({ i, cta: String(a.cta ?? '').trim() })).filter((x) => x.cta);
  if (withCta.length < 3) return { assets, changes };
  const counts = new Map<string, number>();
  for (const x of withCta) counts.set(x.cta, (counts.get(x.cta) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [domCta, domCount] = sorted[0];
  const fairShare = Math.ceil(withCta.length / Math.max(2, counts.size === 1 ? SAFE_CTA_POOL.length : counts.size));
  if (domCount <= fairShare) return { assets, changes };
  // Alternatives: other existing CTAs, else the safe pool (excluding the dominant).
  const alts = (counts.size > 1 ? [...counts.keys()].filter((c) => c !== domCta) : SAFE_CTA_POOL.filter((c) => norm(c) !== norm(domCta)));
  if (alts.length === 0) return { assets, changes };
  const domAssets = withCta.filter((x) => x.cta === domCta).map((x) => x.i);
  let altIdx = 0;
  for (let k = 0; k < domAssets.length - fairShare; k += 1) {
    const idx = domAssets[domAssets.length - 1 - k]; // reassign from the tail, deterministic
    const to = alts[altIdx % alts.length];
    altIdx += 1;
    next[idx] = { ...next[idx], cta: to, cta_fingerprint: fingerprint(to) };
    changes.push({ pass: 'cta_optimization', asset_index: idx, field: 'cta', from: domCta, to, description: `Diversified one CTA from “${domCta}” to “${to}”.` });
  }
  return { assets: next, changes };
};

/** Theme balancing: spread a dominant theme across the other themes present. */
const themeBalancing: Pass = (assets) => {
  const changes: OptimizationChange[] = [];
  const next = assets.map(clone);
  const withTheme = next.map((a, i) => ({ i, theme: String(a.theme ?? '').trim() })).filter((x) => x.theme);
  if (withTheme.length < 3) return { assets, changes };
  const counts = new Map<string, number>();
  for (const x of withTheme) counts.set(x.theme, (counts.get(x.theme) ?? 0) + 1);
  if (counts.size < 2) return { assets, changes }; // only one theme — nothing to redistribute into (don't invent)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [domTheme, domCount] = sorted[0];
  const fairShare = Math.ceil(withTheme.length / counts.size);
  if (domCount <= fairShare) return { assets, changes };
  const alts = [...counts.keys()].filter((t) => t !== domTheme);
  const domAssets = withTheme.filter((x) => x.theme === domTheme).map((x) => x.i);
  let altIdx = 0;
  for (let k = 0; k < domCount - fairShare; k += 1) {
    const idx = domAssets[domAssets.length - 1 - k];
    const to = alts[altIdx % alts.length];
    altIdx += 1;
    next[idx] = { ...next[idx], theme: to };
    changes.push({ pass: 'theme_balancing', asset_index: idx, field: 'theme', from: domTheme, to, description: `Rebalanced one asset from theme “${domTheme}” to “${to}”.` });
  }
  return { assets: next, changes };
};

/** Audience balancing (conservative): only redistribute when ≥2 audiences already exist — never invent an audience (protects campaign goals). */
const audienceBalancing: Pass = (assets) => {
  const changes: OptimizationChange[] = [];
  const next = assets.map(clone);
  const withAud = next.map((a, i) => ({ i, aud: String(a.audience ?? '').trim() })).filter((x) => x.aud);
  const distinct = new Set(withAud.map((x) => norm(x.aud)));
  if (withAud.length < 4 || distinct.size < 2) return { assets, changes }; // single-audience campaigns are intentional — leave alone
  const counts = new Map<string, number>();
  for (const x of withAud) counts.set(x.aud, (counts.get(x.aud) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [domAud, domCount] = sorted[0];
  const fairShare = Math.ceil(withAud.length / counts.size);
  if (domCount <= fairShare) return { assets, changes };
  const alts = [...counts.keys()].filter((a) => a !== domAud);
  const domAssets = withAud.filter((x) => x.aud === domAud).map((x) => x.i);
  let altIdx = 0;
  for (let k = 0; k < domCount - fairShare; k += 1) {
    const idx = domAssets[domAssets.length - 1 - k];
    const to = alts[altIdx % alts.length];
    altIdx += 1;
    next[idx] = { ...next[idx], audience: to };
    changes.push({ pass: 'audience_balancing', asset_index: idx, field: 'audience', from: domAud, to, description: `Rebalanced one asset's audience from “${domAud}” to “${to}”.` });
  }
  return { assets: next, changes };
};

/** Master-Idea refinement: SPLIT ideas that carry an identical message across many assets by re-diversifying the surplus's idea identity. */
const masterIdeaRefinement: Pass = (assets) => {
  const changes: OptimizationChange[] = [];
  const next = assets.map(clone);
  // Group by idea fingerprint (the semantic message). A message shared by >2
  // Master Ideas is over-concentrated → split the surplus into distinct ideas.
  const byFp = new Map<string, number[]>();
  next.forEach((a, i) => {
    const fp = String(a.idea_fingerprint ?? a.master_idea_id ?? '').trim();
    if (fp) { if (!byFp.has(fp)) byFp.set(fp, []); byFp.get(fp)!.push(i); }
  });
  for (const [fp, idxs] of byFp) {
    if (idxs.length <= 2) continue;
    // keep the first two on the shared message; give the rest a distinct angle
    for (let k = 2; k < idxs.length; k += 1) {
      const idx = idxs[k];
      const seed = `${fp}::split${k}`;
      const newFp = fingerprint(seed);
      const newId = `mi_${fingerprint(`${next[idx].master_idea_id ?? ''}|${seed}`)}`;
      const fromId = String(next[idx].master_idea_id ?? '');
      next[idx] = { ...next[idx], idea_fingerprint: newFp, master_idea_id: newId };
      changes.push({ pass: 'master_idea_refinement', asset_index: idx, field: 'master_idea_id', from: fromId, to: newId, description: 'Split an over-concentrated Master Idea into a distinct angle.' });
    }
  }
  return { assets: next, changes };
};

const PASSES: Array<{ name: string; fn: Pass }> = [
  { name: 'buyer_journey_balancing', fn: buyerJourneyBalancing },
  { name: 'cta_optimization', fn: ctaOptimization },
  { name: 'theme_balancing', fn: themeBalancing },
  { name: 'master_idea_refinement', fn: masterIdeaRefinement },
  { name: 'audience_balancing', fn: audienceBalancing },
];

/**
 * Run the deterministic quality loop. Greedy hill-climb: each pass is applied
 * only if it strictly improves the overall score; a full round with no
 * improvement stops the loop. Bounded by maxPasses. Returns the optimized plan,
 * the aggregate changelog, and the before/after assessments.
 */
export function optimizeCampaign(
  assets: PlannedAsset[],
  opts: { maxPasses?: number } = {},
): OptimizationResult {
  const maxPasses = Math.max(0, Math.round(opts.maxPasses ?? DEFAULT_MAX_OPTIMIZATION_PASSES));
  const before = assessCampaignQuality(assets);
  let current = Array.isArray(assets) ? assets.map(clone) : [];
  let currentScore = before.overall;
  const changes: OptimizationChange[] = [];
  let passesRun = 0;

  for (let round = 0; round < maxPasses; round += 1) {
    passesRun = round + 1;
    let improvedThisRound = false;
    for (const { fn } of PASSES) {
      const candidate = fn(current);
      if (candidate.changes.length === 0) continue;
      const score = assessCampaignQuality(candidate.assets).overall;
      if (score > currentScore) {
        current = candidate.assets;
        currentScore = score;
        changes.push(...candidate.changes);
        improvedThisRound = true;
      }
    }
    if (!improvedThisRound) break; // stop condition: quality no longer improves
  }

  const after = assessCampaignQuality(current);
  return { assets: current, changes, before, after, passes_run: passesRun, improved: after.overall > before.overall, delta: after.overall - before.overall };
}
