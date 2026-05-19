/**
 * Recommendation effectiveness + lineage graph (READ-ONLY, deterministic).
 *
 * Aggregates the existing append-only recommendation feedback
 * (audit_events resource_type='recommendation_feedback') into per-category
 * effectiveness, a lineage graph (recommendation → verdicts → outcome), and
 * optimization-confidence evolution. Pure analysis over real outcomes — no ML,
 * no fabrication, no writes.
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface CategoryEffectiveness {
  category: string;
  total: number;
  accepted: number;
  actioned: number;
  dismissed: number;
  ineffective: number;
  effectivenessScore: number; // 0..100
  confidenceTrend: 'improving' | 'declining' | 'flat' | 'insufficient';
}

export interface RecommendationLineageNode {
  recommendationId: string;
  category: string;
  verdicts: string[];
  lastAt: string | null;
  terminalOutcome: 'effective' | 'ineffective' | 'pending';
}

export interface EffectivenessReport {
  companyId: string;
  generatedAt: string;
  available: boolean;
  byCategory: CategoryEffectiveness[];
  lineage: RecommendationLineageNode[];
  overallEffectiveness: number;
  /** Time-bucketed optimization evolution (deterministic, additive). */
  evolution?: Array<{ bucket: string; samples: number; acceptanceRate: number }>;
  /** Recency-decayed acceptance + stability control (deterministic). */
  decay?: { decayWeightedAcceptance: number; halfLifeDays: number; stabilityBound: number };
  /** Bounded per-category ranking weights (deterministic, rollback-safe). */
  stabilizedCategoryWeights?: Record<string, number>;
  /** Volatility-governed weights: max deviation from neutral 1.0 capped per
   * cycle so ranking cannot swing sharply (deterministic, explainable). */
  volatilityGovernor?: { maxStep: number; governedCategoryWeights: Record<string, number> };
  capabilityNote: string;
}

function scoreOf(c: { accepted: number; actioned: number; ineffective: number; total: number }): number {
  if (c.total === 0) return 0;
  return Math.round((((c.accepted + c.actioned) - c.ineffective) / c.total) * 50 + 50);
}

export async function buildEffectivenessReport(
  companyId: string,
  limit = 500,
): Promise<EffectivenessReport> {
  let rows: any[] = [];
  let available = false;
  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('action, resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'recommendation_feedback')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && Array.isArray(data)) { rows = data; available = true; }
  } catch {
    available = false;
  }

  const cat = new Map<string, CategoryEffectiveness>();
  const node = new Map<string, RecommendationLineageNode>();
  // Oldest→newest for trend.
  const ordered = [...rows].reverse();
  const half = Math.floor(ordered.length / 2);
  const firstHalfAccept = { acc: 0, n: 0 };
  const secondHalfAccept = { acc: 0, n: 0 };

  ordered.forEach((r, idx) => {
    const m = (r.metadata ?? {}) as Record<string, any>;
    const category = String(m.category ?? 'unknown');
    const verdict = String(m.verdict ?? '');
    const recId = String(r.resource_id ?? '');

    if (!cat.has(category)) {
      cat.set(category, { category, total: 0, accepted: 0, actioned: 0, dismissed: 0, ineffective: 0, effectivenessScore: 0, confidenceTrend: 'insufficient' });
    }
    const c = cat.get(category)!;
    c.total += 1;
    if (verdict === 'accepted') c.accepted += 1;
    else if (verdict === 'actioned') c.actioned += 1;
    else if (verdict === 'dismissed') c.dismissed += 1;
    else if (verdict === 'ineffective') c.ineffective += 1;

    const positive = verdict === 'accepted' || verdict === 'actioned' ? 1 : 0;
    if (idx < half) { firstHalfAccept.acc += positive; firstHalfAccept.n += 1; }
    else { secondHalfAccept.acc += positive; secondHalfAccept.n += 1; }

    if (!node.has(recId)) {
      node.set(recId, { recommendationId: recId, category, verdicts: [], lastAt: null, terminalOutcome: 'pending' });
    }
    const n = node.get(recId)!;
    n.verdicts.push(verdict);
    n.lastAt = r.created_at;
    if (verdict === 'ineffective') n.terminalOutcome = 'ineffective';
    else if ((verdict === 'accepted' || verdict === 'actioned') && n.terminalOutcome !== 'ineffective') n.terminalOutcome = 'effective';
  });

  const r1 = firstHalfAccept.n ? firstHalfAccept.acc / firstHalfAccept.n : 0;
  const r2 = secondHalfAccept.n ? secondHalfAccept.acc / secondHalfAccept.n : 0;
  const trend: CategoryEffectiveness['confidenceTrend'] =
    ordered.length < 6 ? 'insufficient' : r2 - r1 > 0.1 ? 'improving' : r1 - r2 > 0.1 ? 'declining' : 'flat';

  const byCategory = Array.from(cat.values()).map((c) => ({
    ...c,
    effectivenessScore: scoreOf(c),
    confidenceTrend: trend,
  }));
  const overallEffectiveness =
    byCategory.length === 0 ? 0 : Math.round(byCategory.reduce((a, c) => a + c.effectivenessScore, 0) / byCategory.length);

  // Time-bucketed evolution (UTC day buckets) — deterministic, explainable.
  const buckets = new Map<string, { pos: number; n: number }>();
  for (const r of ordered) {
    const day = String(r.created_at ?? '').slice(0, 10) || 'unknown';
    const verdict = String((r.metadata ?? {}).verdict ?? '');
    const b = buckets.get(day) ?? { pos: 0, n: 0 };
    b.n += 1;
    if (verdict === 'accepted' || verdict === 'actioned') b.pos += 1;
    buckets.set(day, b);
  }
  const evolution = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([bucket, v]) => ({ bucket, samples: v.n, acceptanceRate: v.n ? Number((v.pos / v.n).toFixed(3)) : 0 }));

  // Recency-decayed acceptance (newer feedback weighted higher; 14-day half
  // life) with a stability bound so a single recent burst can't swing it.
  const HALF_LIFE_DAYS = 14;
  const nowMs = Date.now();
  let wSum = 0;
  let wPos = 0;
  for (const r of ordered) {
    const ageDays = Math.max(0, (nowMs - (Date.parse(r.created_at) || nowMs)) / 86_400_000);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const verdict = String((r.metadata ?? {}).verdict ?? '');
    wSum += w;
    if (verdict === 'accepted' || verdict === 'actioned') wPos += w;
  }
  const raw = wSum > 0 ? wPos / wSum : 0;
  const STABILITY_BOUND = 0.2; // max move from the unweighted mean
  const meanAccept =
    ordered.length > 0
      ? ordered.filter((r) => ['accepted', 'actioned'].includes(String((r.metadata ?? {}).verdict ?? ''))).length / ordered.length
      : 0;
  const decayWeightedAcceptance = Number(
    Math.max(meanAccept - STABILITY_BOUND, Math.min(meanAccept + STABILITY_BOUND, raw)).toFixed(3),
  );

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    available,
    byCategory,
    lineage: Array.from(node.values()).slice(0, 100),
    overallEffectiveness,
    evolution,
    decay: { decayWeightedAcceptance, halfLifeDays: HALF_LIFE_DAYS, stabilityBound: STABILITY_BOUND },
    // Per-category ranking weight: effectiveness mapped to a bounded
    // [0.5, 1.5] multiplier (clamped → no category can be zeroed or
    // dominate; deterministic, rollback-safe).
    stabilizedCategoryWeights: byCategory.reduce<Record<string, number>>((acc, c) => {
      acc[c.category] = Number(Math.max(0.5, Math.min(1.5, 0.5 + c.effectivenessScore / 100)).toFixed(3));
      return acc;
    }, {}),
    // Volatility governor: pull each stabilized weight toward neutral 1.0 so
    // its deviation never exceeds MAX_STEP in a single cycle — caps ranking
    // volatility deterministically (rollback-safe: pure transform).
    volatilityGovernor: (() => {
      const MAX_STEP = 0.25;
      const governed: Record<string, number> = {};
      for (const c of byCategory) {
        const w = Math.max(0.5, Math.min(1.5, 0.5 + c.effectivenessScore / 100));
        const dev = w - 1;
        const capped = 1 + Math.max(-MAX_STEP, Math.min(MAX_STEP, dev));
        governed[c.category] = Number(capped.toFixed(3));
      }
      return { maxStep: MAX_STEP, governedCategoryWeights: governed };
    })(),
    capabilityNote:
      'Deterministic effectiveness/lineage analytics over real append-only feedback outcomes. No ML/predictive modelling.',
  };
}
