/**
 * CAMPAIGN-IMPL-005 — Campaign Quality Intelligence Engine (advisory only).
 *
 * Evaluates a PLANNED campaign BEFORE any AI content generation and produces a
 * measurable quality assessment + actionable recommendations. It is purely
 * diagnostic: it NEVER rejects a campaign, changes generation, scheduling, or
 * publishing, and implements NO historical uniqueness. It reads the plan (Master
 * Ideas, fingerprints, themes, funnel stages, CTAs, audiences, format/platform
 * pairs) already produced by the planner and scores nine strategic dimensions.
 *
 * The engine executes server-side; the platform-fit check reuses the ONE
 * canonical eligibility authority (contentPlatformAssignment). UI consumers
 * import only the result TYPES (erased at runtime), so no server dependency
 * leaks into the client bundle.
 */

import { isValidPlatformFormatPair } from '../bolt/contentPlatformAssignment';

/** One planned asset, as known BEFORE content generation. All fields optional for resilience. */
export interface PlannedAsset {
  content_type: string;
  platform?: string | null;
  week?: number;
  theme?: string | null;
  /** funnel/buyer-journey stage in any known vocabulary. */
  funnel_stage?: string | null;
  cta?: string | null;
  audience?: string | null;
  master_idea_id?: string | null;
  idea_fingerprint?: string | null;
  narrative_fingerprint?: string | null;
  cta_fingerprint?: string | null;
  topic_fingerprint?: string | null;
  topic_title?: string | null;
  hook?: string | null;
  progression_index?: number | null;
}

export type QualityDimensionKey =
  | 'theme_diversity'
  | 'narrative_progression'
  | 'buyer_journey_coverage'
  | 'cta_diversity'
  | 'platform_fit'
  | 'content_type_balance'
  | 'master_idea_diversity'
  | 'audience_balance'
  | 'fatigue_risk';

export interface QualityDimensionScore {
  key: QualityDimensionKey;
  label: string;
  /** 0–100; for fatigue_risk a HIGH score means LOW fatigue (healthier). */
  score: number;
  detail: string;
}

export interface QualityRecommendation {
  dimension: QualityDimensionKey;
  severity: 'info' | 'suggestion' | 'warning';
  message: string;
}

export type QualityGrade = 'excellent' | 'good' | 'fair' | 'needs_attention';

export interface CampaignQualityAssessment {
  /** 0–100 weighted overall. */
  overall: number;
  grade: QualityGrade;
  dimensions: QualityDimensionScore[];
  recommendations: QualityRecommendation[];
  asset_count: number;
}

/** Canonical buyer-journey stages the coverage dimension checks for. */
export const BUYER_JOURNEY_STAGES = ['awareness', 'consideration', 'decision', 'retention', 'advocacy'] as const;
export type BuyerJourneyStage = (typeof BUYER_JOURNEY_STAGES)[number];

/** Map the various funnel vocabularies onto the canonical buyer-journey stages. */
function toBuyerStage(raw: unknown): BuyerJourneyStage {
  const v = String(raw ?? '').trim().toLowerCase();
  switch (v) {
    case 'awareness': return 'awareness';
    case 'education':
    case 'consideration':
    case 'interest': return 'consideration';
    case 'trust':
    case 'conversion':
    case 'decision':
    case 'purchase': return 'decision';
    case 'retention':
    case 'onboarding':
    case 'adoption': return 'retention';
    case 'advocacy':
    case 'referral':
    case 'loyalty': return 'advocacy';
    default: return 'awareness';
  }
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Variety score 0–100 over a list of category values: all-identical → 0, fully
 * varied → 100. Normalized Shannon entropy against campaign size (rewards
 * variety relative to how many assets there are). Trivially small sets → 100.
 */
function varietyScore(values: string[]): number {
  const vals = values.map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean);
  const n = vals.length;
  if (n <= 1) return 100;
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === 1) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log(p);
  }
  return clamp((h / Math.log(n)) * 100);
}

/** The dominant category + its share, for recommendation messaging. */
function dominant(values: string[]): { value: string; count: number; share: number; total: number } {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '', bestC = 0;
  for (const [k, c] of counts) if (c > bestC) { best = k; bestC = c; }
  const total = vals.length || 1;
  return { value: best, count: bestC, share: bestC / total, total };
}

/** Repetition rate 0–1 over a fingerprint/text list (1 = every item identical). */
function repetitionRate(values: Array<string | null | undefined>): number {
  const vals = values.map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean);
  if (vals.length <= 1) return 0;
  const distinct = new Set(vals).size;
  return 1 - distinct / vals.length;
}

const WEIGHTS: Record<QualityDimensionKey, number> = {
  theme_diversity: 1,
  narrative_progression: 1,
  buyer_journey_coverage: 1,
  cta_diversity: 1,
  platform_fit: 1.5,
  content_type_balance: 1,
  master_idea_diversity: 1.5,
  audience_balance: 0.75,
  fatigue_risk: 1.5,
};

/** Assess a planned campaign. Pure + deterministic; never throws on odd input. */
export function assessCampaignQuality(assets: PlannedAsset[]): CampaignQualityAssessment {
  const list = Array.isArray(assets) ? assets.filter(Boolean) : [];
  const n = list.length;
  const dimensions: QualityDimensionScore[] = [];
  const recommendations: QualityRecommendation[] = [];

  // 1. Strategic Theme Diversity
  const themes = list.map((a) => a.theme ?? '').filter(Boolean) as string[];
  const themeScore = themes.length ? varietyScore(themes) : 100;
  const distinctThemes = new Set(themes.map((t) => t.toLowerCase())).size;
  dimensions.push({ key: 'theme_diversity', label: 'Strategic Theme Diversity', score: themeScore, detail: `${distinctThemes} distinct theme(s) across ${n} assets.` });
  if (themeScore < 55 && themes.length > 2) recommendations.push({ dimension: 'theme_diversity', severity: 'suggestion', message: `Strategic themes repeat — only ${distinctThemes} distinct theme(s) across ${n} assets. Vary the weekly angle.` });

  // 2. Narrative Progression — do buyer stages build across weeks?
  const narrativeScore = scoreNarrativeProgression(list);
  dimensions.push({ key: 'narrative_progression', label: 'Narrative Progression', score: narrativeScore, detail: narrativeScore >= 70 ? 'Ideas build in a logical sequence.' : 'Buyer-journey stages appear out of order across weeks.' });
  if (narrativeScore < 55) recommendations.push({ dimension: 'narrative_progression', severity: 'suggestion', message: 'Ideas don’t build in sequence — order assets so earlier weeks skew awareness and later weeks skew decision/retention.' });

  // 3. Buyer Journey Coverage
  const stagesPresent = new Set(list.map((a) => toBuyerStage(a.funnel_stage)));
  const coverageScore = clamp((stagesPresent.size / BUYER_JOURNEY_STAGES.length) * 100);
  const missing = BUYER_JOURNEY_STAGES.filter((s) => !stagesPresent.has(s));
  dimensions.push({ key: 'buyer_journey_coverage', label: 'Buyer Journey Coverage', score: coverageScore, detail: `${stagesPresent.size}/${BUYER_JOURNEY_STAGES.length} stages present${missing.length ? ` (missing: ${missing.join(', ')})` : ''}.` });
  if (missing.length > 0 && n >= 3) {
    const target = missing.includes('consideration') ? 'consideration' : missing[0];
    recommendations.push({ dimension: 'buyer_journey_coverage', severity: 'suggestion', message: `Increase ${target}-stage content — the campaign has no ${target} assets (e.g. replace one awareness post with a case study).` });
  }

  // 4. CTA Diversity
  const ctas = list.map((a) => a.cta ?? '').filter(Boolean) as string[];
  const ctaScore = ctas.length ? varietyScore(ctas) : 100;
  dimensions.push({ key: 'cta_diversity', label: 'CTA Diversity', score: ctaScore, detail: `${new Set(ctas.map((c) => c.toLowerCase())).size} distinct CTA(s).` });
  if (ctaScore < 55 && ctas.length > 2) {
    const d = dominant(ctas);
    recommendations.push({ dimension: 'cta_diversity', severity: 'warning', message: `Reduce CTA repetition — ${d.count}/${d.total} assets use “${d.value}”. Recommend a healthier CTA distribution.` });
  }

  // 5. Platform Fit — reuse the canonical eligibility authority
  const pairs = list.filter((a) => a.platform);
  let fitOk = 0;
  const misfits: string[] = [];
  for (const a of pairs) {
    if (isValidPlatformFormatPair(a.platform, a.content_type)) fitOk += 1;
    else if (misfits.length < 3) misfits.push(`${a.content_type}→${a.platform}`);
  }
  const fitScore = pairs.length ? clamp((fitOk / pairs.length) * 100) : 100;
  dimensions.push({ key: 'platform_fit', label: 'Platform Fit', score: fitScore, detail: pairs.length ? `${fitOk}/${pairs.length} format/platform pairings fit.` : 'No platform assignments to check.' });
  if (fitScore < 100 && misfits.length) recommendations.push({ dimension: 'platform_fit', severity: 'warning', message: `${pairs.length - fitOk} format/platform pairing(s) are a poor fit (e.g. ${misfits.join(', ')}). Reassign to a supported platform.` });

  // 6. Content-Type Balance — penalize overuse of one format
  const types = list.map((a) => String(a.content_type ?? '').toLowerCase()).filter(Boolean);
  const typeScore = types.length ? varietyScore(types) : 100;
  const dt = dominant(types);
  dimensions.push({ key: 'content_type_balance', label: 'Content-Type Balance', score: typeScore, detail: `${new Set(types).size} distinct format(s); most-used: ${dt.value || 'n/a'} (${Math.round(dt.share * 100)}%).` });
  if (dt.share > 0.6 && n >= 3) recommendations.push({ dimension: 'content_type_balance', severity: 'suggestion', message: `${dt.value} is ${Math.round(dt.share * 100)}% of the campaign — diversify formats (e.g. move one ${dt.value} to a later week and add an article or post).` });

  // 7. Master-Idea Diversity — distinct idea messages across Master Ideas
  const ideaByMaster = new Map<string, string>();
  for (const a of list) {
    const id = String(a.master_idea_id ?? '').trim();
    if (id) ideaByMaster.set(id, String(a.idea_fingerprint ?? id));
  }
  const masterCount = ideaByMaster.size;
  const distinctIdeaFp = new Set(ideaByMaster.values()).size;
  const miScore = masterCount <= 1 ? 100 : clamp((distinctIdeaFp / masterCount) * 100);
  dimensions.push({ key: 'master_idea_diversity', label: 'Master-Idea Diversity', score: miScore, detail: `${distinctIdeaFp}/${masterCount} Master Idea(s) carry a distinct message.` });
  if (miScore < 70 && masterCount > 1) recommendations.push({ dimension: 'master_idea_diversity', severity: 'warning', message: `${masterCount - distinctIdeaFp} Master Idea(s) communicate the same business message — differentiate their angle before generating.` });

  // 8. Audience Balance (advisory — a single audience is often intentional)
  const audiences = list.map((a) => a.audience ?? '').filter(Boolean) as string[];
  const distinctAud = new Set(audiences.map((x) => x.toLowerCase())).size;
  const audScore = audiences.length <= 1 ? 100 : distinctAud <= 1 ? 60 : varietyScore(audiences);
  dimensions.push({ key: 'audience_balance', label: 'Audience Balance', score: audScore, detail: `${distinctAud} distinct audience segment(s).` });
  if (distinctAud <= 1 && n >= 4 && audiences.length > 0) recommendations.push({ dimension: 'audience_balance', severity: 'info', message: `Every asset targets “${audiences[0]}” — consider a secondary audience segment for reach.` });

  // 9. Campaign Fatigue — repetition of positioning / promises / hooks / headlines / CTA
  const signals: Array<{ label: string; rate: number }> = [
    { label: 'positioning', rate: repetitionRate(list.map((a) => a.idea_fingerprint)) },
    { label: 'promises', rate: repetitionRate(list.map((a) => a.narrative_fingerprint)) },
    { label: 'hooks', rate: repetitionRate(list.map((a) => a.hook ?? a.topic_fingerprint)) },
    { label: 'headlines', rate: repetitionRate(list.map((a) => a.topic_title ?? a.topic_fingerprint)) },
    { label: 'CTA', rate: repetitionRate(list.map((a) => a.cta_fingerprint ?? a.cta)) },
  ].filter((x) => Number.isFinite(x.rate));
  const avgRep = signals.length ? signals.reduce((s, x) => s + x.rate, 0) / signals.length : 0;
  const fatigueScore = clamp((1 - avgRep) * 100);
  const worst = signals.slice().sort((a, b) => b.rate - a.rate)[0];
  dimensions.push({ key: 'fatigue_risk', label: 'Fatigue Risk (higher = healthier)', score: fatigueScore, detail: worst && worst.rate > 0 ? `Highest repetition: ${worst.label} (${Math.round(worst.rate * 100)}%).` : 'Low repetition across the campaign.' });
  if (fatigueScore < 60 && n >= 3 && worst) recommendations.push({ dimension: 'fatigue_risk', severity: 'warning', message: `High repetition risk — ${Math.round(worst.rate * 100)}% of assets share near-identical ${worst.label}. Vary hooks, headlines, and CTAs.` });

  // Weighted overall
  let wSum = 0, sSum = 0;
  for (const d of dimensions) { const w = WEIGHTS[d.key] ?? 1; wSum += w; sSum += w * d.score; }
  const overall = clamp(wSum ? sSum / wSum : 100);
  const grade: QualityGrade = overall >= 85 ? 'excellent' : overall >= 70 ? 'good' : overall >= 55 ? 'fair' : 'needs_attention';

  return { overall, grade, dimensions, recommendations, asset_count: n };
}

/** Narrative progression: do per-week average buyer-stage ranks trend upward? */
function scoreNarrativeProgression(list: PlannedAsset[]): number {
  const byWeek = new Map<number, number[]>();
  for (const a of list) {
    const w = Number(a.week ?? 1) || 1;
    const rank = BUYER_JOURNEY_STAGES.indexOf(toBuyerStage(a.funnel_stage));
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(rank);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  if (weeks.length < 2) return 70; // single week — neutral, nothing to progress
  const avgs = weeks.map((w) => {
    const arr = byWeek.get(w)!;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  });
  let nonDecreasing = 0;
  for (let i = 1; i < avgs.length; i += 1) if (avgs[i] >= avgs[i - 1] - 0.001) nonDecreasing += 1;
  return clamp((nonDecreasing / (avgs.length - 1)) * 100);
}
