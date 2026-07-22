/**
 * Wave 5 (item 6) — Explainable Predictive Optimization.
 *
 * Predicts how a piece of content is likely to perform BEFORE it ships, and does
 * so with ZERO opacity: every one of the three scores is a transparent, weighted
 * combination of named inputs, and every score carries the exact factors (with
 * their numeric contribution and the evidence behind them) that produced it.
 *
 * GUARANTEES
 *  - DETERMINISTIC + REPRODUCIBLE: no `Math.random`, no `Date.now` inside
 *    scoring. Given the same inputs the output is byte-identical (all scores are
 *    rounded to a fixed precision). The one non-pure value (`persist`'s
 *    timestamp) is set by the DB, never by scoring.
 *  - EXPLAINABLE / NEVER OPAQUE: `weighted()` is the ONLY scoring primitive, and
 *    it emits one explanation factor per component. Therefore every score has
 *    ≥1 explanation factor by construction — an opaque score cannot be produced.
 *  - FAIL-SAFE: `predict` never throws. On any internal error it returns a
 *    neutral (0.5) prediction that is STILL explainable (it carries a factor
 *    naming the failure).
 *  - COMPANY-SCOPED + APPEND-ONLY: `persistPrediction` writes one immutable
 *    `content_prediction` row scoped to the company; content is never mutated.
 *
 * The engine reuses the Wave-4 deterministic quality scorecard as its primary
 * signal (computing one internally when the caller doesn't pass one) and layers
 * learning-derived patterns (historically strong hooks, objective success) on
 * top — each contribution shown, none hidden.
 */

import { supabase } from '../../db/supabaseClient';
import { getPlatformProfile } from '../../../lib/content/platformAdaptationProfiles';
import { evaluate as evaluateQuality } from './qualityEngine';
import type { QualityScorecard } from '../../../lib/content/quality/types';

/** The deterministic model version. Bump ONLY on a formula change (reproducibility). */
export const PREDICTION_MODEL_VERSION = 1;

// ── learning inputs (structurally typed so this engine does not hard-depend on
//    the concurrently-authored learning module) ──────────────────────────────

/**
 * A single derived learning pattern (mirrors a `learning_intelligence` row).
 * Only the fields the engine reads are required; extra fields are ignored.
 */
export interface LearningPattern {
  /** 'hook' | 'cta' | 'structure' | 'length' | 'objective' | 'platform' | … */
  dimension: string;
  /** Canonical key within the dimension (e.g. the tokenized hook phrase). */
  patternKey: string;
  /** Nullable = cross-platform. */
  platform?: string | null;
  /** Structured pattern payload; `tokens` (string[]) is used when present. */
  pattern?: Record<string, unknown> | null;
  /** Effectiveness 0..1 (higher = historically stronger). */
  score?: number | null;
  sampleSize?: number | null;
}

/** A read-time view of the company learning rollup (subset the engine reads). */
export interface LearningMemoryView {
  /** Historical objective→outcome success rates, keyed by objective term/label. */
  objectiveSuccess?: Record<string, number> | null;
  /** Effective per-platform adaptations, keyed by platform. */
  platformAdaptations?: Record<string, unknown> | null;
  [key: string]: unknown;
}

// ── prediction contract ──────────────────────────────────────────────────────

/** One transparent reason behind a score. `contribution` is weight × value. */
export interface PredictionExplanationFactor {
  /** `${scoreKey}:${component}` — names which score and which input. */
  factor: string;
  /** The component's weighted contribution to its score (0..1 scale). */
  contribution: number;
  /** Human-readable evidence for the contribution. */
  evidence: string;
}

/** A concrete, ranked improvement lever with its expected lift. */
export interface ImprovementOpportunity {
  /** The area to improve (score key or dimension). */
  area: string;
  /** What to change. */
  suggestion: string;
  /** Deterministic estimated lift to the parent score if applied (0..1). */
  expectedLift: number;
}

/** The explainable, reproducible prediction. */
export interface Prediction {
  engagementPotential: number;
  platformSuitability: number;
  objectiveLikelihood: number;
  improvementOpportunities: ImprovementOpportunity[];
  explanation: PredictionExplanationFactor[];
  modelVersion: number;
}

export interface PredictInput {
  companyId: string;
  contentId?: string | null;
  text: string;
  contentType?: string;
  platform?: string | null;
  objective?: string | null;
  /** Pre-computed Wave-4 scorecard; computed internally when omitted. */
  scorecard?: QualityScorecard;
  /** Company learning rollup (read-time). */
  learningMemory?: LearningMemoryView | null;
  /** Derived learning patterns to match against (e.g. strong hooks). */
  intelligence?: LearningPattern[] | null;
}

export interface PersistPredictionInput {
  companyId: string;
  contentId?: string | null;
  platform?: string | null;
  prediction: Prediction;
}

// ── scoring precision (guarantees byte-identical reproducibility) ────────────

const PRECISION = 4;
function round(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** PRECISION;
  return Math.round(n * f) / f;
}
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** One named input to a weighted score. */
interface Component {
  component: string;
  weight: number;
  /** 0..1 input value. */
  value: number;
  evidence: string;
}

/**
 * THE scoring primitive — the ONLY way a score is produced. It computes the
 * normalized weighted mean of its components AND emits one explanation factor
 * per component. Because a score can only come from here, every score is
 * guaranteed to carry ≥1 explanation factor (never opaque).
 */
function weighted(scoreKey: string, components: Component[]): {
  score: number;
  factors: PredictionExplanationFactor[];
} {
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  let acc = 0;
  const factors: PredictionExplanationFactor[] = [];
  for (const c of components) {
    const value = clamp01(c.value);
    const norm = totalWeight > 0 ? c.weight / totalWeight : 0;
    const contribution = norm * value;
    acc += contribution;
    factors.push({
      factor: `${scoreKey}:${c.component}`,
      contribution: round(contribution),
      evidence: c.evidence,
    });
  }
  return { score: round(clamp01(acc)), factors };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'are', 'was',
  'from', 'have', 'has', 'our', 'out', 'not', 'but', 'all', 'can', 'how',
  'why', 'who', 'its', 'a', 'an', 'to', 'of', 'in', 'on', 'is', 'it',
]);

function tokens(value: string): string[] {
  const matches = String(value ?? '').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of matches) {
    if (STOPWORDS.has(t)) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let inter = 0;
  const setA = new Set(a);
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function firstNonEmptyLine(text: string): string {
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim().length > 0) return line.trim();
  }
  return '';
}

function patternTokens(p: LearningPattern): string[] {
  const raw = p.pattern && Array.isArray((p.pattern as Record<string, unknown>).tokens)
    ? ((p.pattern as Record<string, unknown>).tokens as unknown[]).map((t) => String(t))
    : tokens(p.patternKey);
  return tokens(raw.join(' '));
}

/** Does `platform` apply to a pattern? Null pattern platform = cross-platform. */
function platformApplies(patternPlatform: string | null | undefined, platform: string | undefined): boolean {
  if (patternPlatform == null || patternPlatform === '') return true;
  if (!platform) return true;
  return getPlatformProfile(patternPlatform).platform === getPlatformProfile(platform).platform;
}

/**
 * Best resemblance of the content's hook to any historically strong hook
 * pattern, weighted by that pattern's effectiveness. Deterministic; returns
 * `{ value, evidence }`. When there is no learning data, a neutral 0.5 baseline
 * is returned with evidence saying so (so the formula stays stable and honest).
 */
function hookResemblance(
  text: string,
  platform: string | undefined,
  intelligence: LearningPattern[] | null | undefined,
): { value: number; evidence: string } {
  const patterns = (intelligence ?? []).filter(
    (p) => p.dimension === 'hook' && platformApplies(p.platform, platform),
  );
  if (patterns.length === 0) {
    return { value: 0.5, evidence: 'no historical hook patterns — neutral 0.5 baseline' };
  }
  const hookTokens = tokens(firstNonEmptyLine(text));
  let best = 0;
  let bestKey = '';
  for (const p of patterns) {
    const sim = jaccard(hookTokens, patternTokens(p));
    const eff = clamp01(typeof p.score === 'number' ? p.score : 0.5);
    const weightedSim = sim * eff;
    if (weightedSim > best) {
      best = weightedSim;
      bestKey = p.patternKey;
    }
  }
  return {
    value: best,
    evidence: best > 0
      ? `hook resembles strong pattern "${bestKey}" (weighted similarity ${round(best)})`
      : `hook matched no strong pattern among ${patterns.length}`,
  };
}

/** Historical objective success (0..1) for this objective from learning memory. */
function objectiveHistory(
  objective: string | undefined,
  memory: LearningMemoryView | null | undefined,
): { value: number; evidence: string } {
  const table = memory?.objectiveSuccess;
  if (!table || typeof table !== 'object') {
    return { value: 0.5, evidence: 'no historical objective outcomes — neutral 0.5 baseline' };
  }
  const objTokens = tokens(objective ?? '');
  let best = 0;
  let bestKey = '';
  let matched = false;
  for (const [key, rate] of Object.entries(table)) {
    const r = clamp01(typeof rate === 'number' ? rate : 0);
    const sim = jaccard(objTokens, tokens(key));
    if (sim > 0 && r >= best) {
      best = r;
      bestKey = key;
      matched = true;
    }
  }
  if (!matched) {
    return { value: 0.5, evidence: 'objective unseen historically — neutral 0.5 baseline' };
  }
  return { value: best, evidence: `historical success ${round(best)} for objective "${bestKey}"` };
}

/** Platform length fit as 0..1 from the platform profile word range. */
function platformLengthFit(text: string, platform: string | undefined): { value: number; evidence: string } {
  const profile = getPlatformProfile(platform);
  const [minW, maxW] = profile.wordRange;
  const wc = String(text ?? '').split(/\s+/).filter(Boolean).length;
  if (wc >= minW && wc <= maxW) {
    return { value: 1, evidence: `within ${profile.platform} word range (${minW}-${maxW}); ${wc} words` };
  }
  const target = wc < minW ? minW : maxW;
  const distance = Math.abs(wc - target);
  const value = clamp01(1 - distance / Math.max(1, maxW));
  return {
    value,
    evidence: `outside ${profile.platform} word range (${minW}-${maxW}); ${wc} words`,
  };
}

function dimScore01(scorecard: QualityScorecard, key: keyof QualityScorecard['dimensions']): number {
  const d = scorecard.dimensions?.[key];
  return clamp01((d?.score ?? 0) / 100);
}

// ── the three score formulas (each fully explained) ──────────────────────────

/**
 * engagementPotential = weighted mean of:
 *   hook quality (0.35) · CTA quality (0.20) · readability (0.20) ·
 *   historical hook resemblance (0.25).
 */
function scoreEngagement(
  sc: QualityScorecard,
  text: string,
  platform: string | undefined,
  intelligence: LearningPattern[] | null | undefined,
) {
  const hook = hookResemblance(text, platform, intelligence);
  return weighted('engagementPotential', [
    { component: 'hookQuality', weight: 0.35, value: dimScore01(sc, 'hook'), evidence: `quality.hook = ${sc.dimensions.hook.score}/100 (${sc.dimensions.hook.signals.join('; ') || 'no signals'})` },
    { component: 'ctaQuality', weight: 0.20, value: dimScore01(sc, 'cta'), evidence: `quality.cta = ${sc.dimensions.cta.score}/100` },
    { component: 'readability', weight: 0.20, value: dimScore01(sc, 'readability'), evidence: `quality.readability = ${sc.dimensions.readability.score}/100` },
    { component: 'historicalHookMatch', weight: 0.25, value: hook.value, evidence: hook.evidence },
  ]);
}

/**
 * platformSuitability = weighted mean of:
 *   platformFit quality (0.55) · structure quality (0.20) · length fit (0.25).
 */
function scorePlatform(sc: QualityScorecard, text: string, platform: string | undefined) {
  const len = platformLengthFit(text, platform);
  const profile = getPlatformProfile(platform);
  return weighted('platformSuitability', [
    { component: 'platformFit', weight: 0.55, value: dimScore01(sc, 'platformFit'), evidence: `quality.platformFit = ${sc.dimensions.platformFit.score}/100 for ${profile.platform}` },
    { component: 'structure', weight: 0.20, value: dimScore01(sc, 'structure'), evidence: `quality.structure = ${sc.dimensions.structure.score}/100` },
    { component: 'lengthFit', weight: 0.25, value: len.value, evidence: len.evidence },
  ]);
}

/**
 * objectiveLikelihood = weighted mean of:
 *   objectiveAlignment quality (0.50) · SEO quality (0.20) ·
 *   historical objective success (0.30).
 */
function scoreObjective(
  sc: QualityScorecard,
  objective: string | undefined,
  memory: LearningMemoryView | null | undefined,
) {
  const hist = objectiveHistory(objective, memory);
  return weighted('objectiveLikelihood', [
    { component: 'objectiveAlignment', weight: 0.50, value: dimScore01(sc, 'objectiveAlignment'), evidence: `quality.objectiveAlignment = ${sc.dimensions.objectiveAlignment.score}/100` },
    { component: 'seo', weight: 0.20, value: dimScore01(sc, 'seo'), evidence: `quality.seo = ${sc.dimensions.seo.score}/100` },
    { component: 'historicalObjectiveSuccess', weight: 0.30, value: hist.value, evidence: hist.evidence },
  ]);
}

/**
 * Derive ranked improvement opportunities from the weakest components across
 * all three scores. `expectedLift` is deterministic: lifting that component to a
 * 0.85 target, scaled by its normalized weight, is the gain to the parent score.
 */
function deriveOpportunities(
  scores: Array<{ scoreKey: string; components: Component[] }>,
): ImprovementOpportunity[] {
  const TARGET = 0.85;
  const opps: ImprovementOpportunity[] = [];
  for (const { scoreKey, components } of scores) {
    const totalWeight = components.reduce((s, c) => s + c.weight, 0) || 1;
    for (const c of components) {
      const value = clamp01(c.value);
      if (value >= 0.7) continue; // only surface genuinely weak levers
      const norm = c.weight / totalWeight;
      const lift = round(norm * Math.max(0, TARGET - value));
      if (lift <= 0) continue;
      opps.push({
        area: `${scoreKey}:${c.component}`,
        suggestion: `Raise ${c.component} (currently ${round(value)}) toward ${TARGET}: ${c.evidence}`,
        expectedLift: lift,
      });
    }
  }
  // Deterministic order: biggest lift first, then stable by area name.
  opps.sort((a, b) => (b.expectedLift - a.expectedLift) || a.area.localeCompare(b.area));
  return opps;
}

/** A neutral, still-explainable prediction used as the fail-safe floor. */
function neutralPrediction(reason: string): Prediction {
  const factor = (scoreKey: string): PredictionExplanationFactor => ({
    factor: `${scoreKey}:failSafe`,
    contribution: 0.5,
    evidence: `fail-safe neutral prediction — ${reason}`,
  });
  return {
    engagementPotential: 0.5,
    platformSuitability: 0.5,
    objectiveLikelihood: 0.5,
    improvementOpportunities: [],
    explanation: [
      factor('engagementPotential'),
      factor('platformSuitability'),
      factor('objectiveLikelihood'),
    ],
    modelVersion: PREDICTION_MODEL_VERSION,
  };
}

/**
 * Produce an explainable, deterministic, reproducible prediction. Never throws.
 */
export async function predict(input: PredictInput): Promise<Prediction> {
  try {
    const text = typeof input?.text === 'string' ? input.text : '';
    const platform = input?.platform ?? undefined;
    const objective = input?.objective ?? undefined;
    const contentType = input?.contentType ?? 'unknown';

    // Reuse the caller's scorecard, or compute one deterministically.
    const scorecard: QualityScorecard = input?.scorecard ?? evaluateQuality({
      companyId: input?.companyId,
      contentType,
      platform: platform ?? undefined,
      text,
      objective: objective ?? undefined,
    });

    const eng = scoreEngagement(scorecard, text, platform, input?.intelligence);
    const plat = scorePlatform(scorecard, text, platform);
    const obj = scoreObjective(scorecard, objective, input?.learningMemory);

    // Rebuild the component lists for opportunity derivation (same inputs → same).
    const hook = hookResemblance(text, platform, input?.intelligence);
    const len = platformLengthFit(text, platform);
    const hist = objectiveHistory(objective, input?.learningMemory);
    const opportunities = deriveOpportunities([
      {
        scoreKey: 'engagementPotential',
        components: [
          { component: 'hookQuality', weight: 0.35, value: dimScore01(scorecard, 'hook'), evidence: `quality.hook = ${scorecard.dimensions.hook.score}/100` },
          { component: 'ctaQuality', weight: 0.20, value: dimScore01(scorecard, 'cta'), evidence: `quality.cta = ${scorecard.dimensions.cta.score}/100` },
          { component: 'readability', weight: 0.20, value: dimScore01(scorecard, 'readability'), evidence: `quality.readability = ${scorecard.dimensions.readability.score}/100` },
          { component: 'historicalHookMatch', weight: 0.25, value: hook.value, evidence: hook.evidence },
        ],
      },
      {
        scoreKey: 'platformSuitability',
        components: [
          { component: 'platformFit', weight: 0.55, value: dimScore01(scorecard, 'platformFit'), evidence: `quality.platformFit = ${scorecard.dimensions.platformFit.score}/100` },
          { component: 'structure', weight: 0.20, value: dimScore01(scorecard, 'structure'), evidence: `quality.structure = ${scorecard.dimensions.structure.score}/100` },
          { component: 'lengthFit', weight: 0.25, value: len.value, evidence: len.evidence },
        ],
      },
      {
        scoreKey: 'objectiveLikelihood',
        components: [
          { component: 'objectiveAlignment', weight: 0.50, value: dimScore01(scorecard, 'objectiveAlignment'), evidence: `quality.objectiveAlignment = ${scorecard.dimensions.objectiveAlignment.score}/100` },
          { component: 'seo', weight: 0.20, value: dimScore01(scorecard, 'seo'), evidence: `quality.seo = ${scorecard.dimensions.seo.score}/100` },
          { component: 'historicalObjectiveSuccess', weight: 0.30, value: hist.value, evidence: hist.evidence },
        ],
      },
    ]);

    return {
      engagementPotential: eng.score,
      platformSuitability: plat.score,
      objectiveLikelihood: obj.score,
      improvementOpportunities: opportunities,
      explanation: [...eng.factors, ...plat.factors, ...obj.factors],
      modelVersion: PREDICTION_MODEL_VERSION,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    return neutralPrediction(reason);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Project a persisted `content_prediction` row back to a `Prediction`. */
function mapPredictionRow(row: any): Prediction {
  const toNum = (v: unknown, d = 0.5): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;
  return {
    engagementPotential: toNum(row.engagement_potential),
    platformSuitability: toNum(row.platform_suitability),
    objectiveLikelihood: toNum(row.objective_likelihood),
    improvementOpportunities: Array.isArray(row.improvement_opportunities)
      ? (row.improvement_opportunities as ImprovementOpportunity[])
      : [],
    explanation: Array.isArray(row.explanation)
      ? (row.explanation as PredictionExplanationFactor[])
      : [],
    modelVersion: typeof row.model_version === 'number' ? row.model_version : PREDICTION_MODEL_VERSION,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Read the most recent persisted prediction for a content item (company-scoped).
 * Returns `null` when none exists or on error. Fail-safe; never throws.
 */
export async function getLatestPrediction(
  contentId: string,
  companyId: string,
): Promise<Prediction | null> {
  try {
    if (!contentId || !companyId) return null;
    const { data, error } = await supabase
      .from('content_prediction')
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapPredictionRow(data);
  } catch {
    return null;
  }
}

/**
 * Persist one prediction as an APPEND-ONLY, company-scoped `content_prediction`
 * row. Fail-safe: returns the inserted row id or `null`; never throws.
 */
export async function persistPrediction(input: PersistPredictionInput): Promise<string | null> {
  try {
    if (!input?.companyId || !input?.prediction) return null;
    const p = input.prediction;
    const { data, error } = await supabase
      .from('content_prediction')
      .insert({
        company_id: input.companyId,
        content_id: input.contentId ?? null,
        platform: input.platform ?? null,
        engagement_potential: p.engagementPotential,
        platform_suitability: p.platformSuitability,
        objective_likelihood: p.objectiveLikelihood,
        improvement_opportunities: p.improvementOpportunities ?? [],
        explanation: p.explanation ?? [],
        model_version: p.modelVersion ?? PREDICTION_MODEL_VERSION,
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}
