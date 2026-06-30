/**
 * Cross-Domain Correlation & Unified Business Intelligence (Phase 30). The orchestration
 * brain — pure aggregation over already-composed Platform plugin snapshots (no domain
 * repositories, no new framework). Deterministic. No LLM. Unknown stays Unknown. Influence
 * STRUCTURE is architectural (which domain feeds which); influence STRENGTH/sign is derived
 * from evidence (the composed scores) — nothing about the outcome is hardcoded.
 */
import type { PluginSnapshot } from '../platformIntelligence/registry';
import type { HealthState } from '../platformIntelligence/executiveSummary';

/** Architectural forward-influence structure (who feeds whom). Strength/sign come from scores. */
const INFLUENCE: Record<string, string[]> = {
  website: ['lead', 'marketing_growth'],
  readiness: ['lead', 'marketing_growth', 'revenue_operations'],
  lead: ['commercial', 'revenue_operations'],
  marketing_growth: ['lead', 'commercial', 'growth'],
  commercial: ['revenue_operations', 'customer', 'growth'],
  revenue_operations: ['commercial', 'customer', 'growth'],
  customer: ['growth'],
  growth: [],
};

export type Influence = 'supporting' | 'blocking' | 'neutral';
export interface CorrelationEdge { from: string; to: string; influence: Influence; strength: number }
type HealthCell = { score: number | null; status: HealthState; explanation: string };
export interface BusinessRisk { id: string; label: string; risk: number; rootCause: string; affectedDomains: string[]; businessImpact: string; dependencies: string[] }
export interface UnifiedBusinessIntelligence {
  generatedAt: string;
  domains: Array<{ id: string; domain: string; score: number; status: HealthState }>;
  correlations: CorrelationEdge[];
  health: Record<'business' | 'digital' | 'marketing' | 'commercial' | 'customer' | 'revenue' | 'operational' | 'growth' | 'organizational', HealthCell>;
  risks: BusinessRisk[];
  opportunities: Array<{ type: string; recommendation: string; domain: string; roi: string; businessImpact: string }>;
  execution: { sequence: string[]; parallel: string[][]; blockedBy: Record<string, string[]> };
  maturity: { overall: number; byCategory: Record<string, number> };
  optimizer: { weakest: string | null; strongest: string | null; bottleneck: string | null; largestOpportunity: string | null; fastestImprovement: string | null };
}

const cell = (score: number | null, explanation: string): HealthCell => ({ score, status: score == null ? 'disconnected' : score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'disconnected', explanation });
const avg = (ns: number[]): number | null => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null);
const levelFor = (s: number | null): number => (s == null ? 1 : s >= 80 ? 5 : s >= 60 ? 4 : s >= 40 ? 3 : s >= 20 ? 2 : 1);

export function buildUnifiedBusinessIntelligence(snapshots: PluginSnapshot[], nowIso: string): UnifiedBusinessIntelligence {
  const byDomain = new Map<string, PluginSnapshot>();
  for (const s of snapshots) byDomain.set(s.domain, s);
  const present = new Set(snapshots.map((s) => s.domain));
  const scoreOf = (d: string): number | null => (byDomain.has(d) ? Number(byDomain.get(d)!.health.score) : null);

  // --- Phase B: correlations (evidence-derived sign/strength over architectural edges) ---
  const correlations: CorrelationEdge[] = [];
  for (const [from, tos] of Object.entries(INFLUENCE)) if (present.has(from)) for (const to of tos) if (present.has(to)) {
    const s = scoreOf(from)!;
    correlations.push({ from, to, influence: s >= 60 ? 'supporting' : s < 45 ? 'blocking' : 'neutral', strength: s });
  }

  // --- Phase C: business health (explained) ---
  const businessScore = avg(snapshots.map((s) => Number(s.health.score)));
  const operational = avg([scoreOf('revenue_operations'), scoreOf('readiness')].filter((x): x is number => x != null));
  const health = {
    business: cell(businessScore, `Mean of ${snapshots.length} registered domains`),
    digital: cell(scoreOf('website'), 'From the website plugin'),
    marketing: cell(scoreOf('marketing_growth'), 'From the marketing & growth plugin'),
    commercial: cell(scoreOf('commercial'), 'From the commercial plugin'),
    customer: cell(scoreOf('customer'), 'From the customer plugin'),
    revenue: cell(scoreOf('revenue_operations') ?? scoreOf('commercial'), 'RevOps efficiency / commercial revenue'),
    operational: cell(operational, 'RevOps + readiness'),
    growth: cell(scoreOf('growth'), 'From the growth plugin'),
    organizational: cell(scoreOf('readiness'), 'From the readiness plugin'),
  };

  // --- Phase D: risks (root cause + affected domains via influence) ---
  const downstreamOf = (d: string): string[] => (INFLUENCE[d] ?? []).filter((x) => present.has(x));
  const weakestContributor = (cands: string[]): string => cands.filter((d) => present.has(d)).sort((a, b) => (scoreOf(a) ?? 100) - (scoreOf(b) ?? 100))[0] ?? cands[0]!;
  const riskOf = (s: number | null): number => (s == null ? 50 : Math.max(0, Math.min(100, 100 - s)));
  const mkRisk = (id: string, label: string, score: number | null, causeCands: string[]): BusinessRisk => {
    const cause = weakestContributor(causeCands);
    return { id, label, risk: riskOf(score), rootCause: cause, affectedDomains: downstreamOf(cause), businessImpact: score == null ? 'Unknown' : score < 45 ? 'high' : score < 60 ? 'medium' : 'low', dependencies: (INFLUENCE[cause] ? [] : []) };
  };
  const risks: BusinessRisk[] = [
    mkRisk('strategic', 'Strategic Risk', businessScore, ['website', 'lead', 'marketing_growth', 'commercial', 'customer']),
    mkRisk('operational', 'Operational Risk', operational, ['revenue_operations', 'readiness']),
    mkRisk('revenue', 'Revenue Risk', scoreOf('commercial'), ['commercial', 'revenue_operations']),
    mkRisk('customer', 'Customer Risk', scoreOf('customer'), ['customer']),
    mkRisk('marketing', 'Marketing Risk', scoreOf('marketing_growth'), ['marketing_growth', 'website']),
    mkRisk('execution', 'Execution Risk', avg([scoreOf('marketing_growth'), scoreOf('commercial')].filter((x): x is number => x != null)), ['marketing_growth', 'commercial']),
    mkRisk('growth', 'Growth Risk', scoreOf('growth'), ['growth', 'marketing_growth']),
  ];

  // --- Phase E: opportunities (aggregate plugin recs — no new recommendation logic) ---
  const allRecs = snapshots.flatMap((s) => s.recommendations.map((r) => ({ ...r, domain: s.domain })));
  const opportunities = allRecs
    .filter((r) => r.estimatedROI === 'high' || r.category === 'quick_win')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8)
    .map((r) => ({ type: r.category === 'quick_win' ? 'quick_win' : 'high_roi', recommendation: r.recommendation, domain: r.domain, roi: r.estimatedROI, businessImpact: r.businessImpact }));

  // --- Phase F: execution sequence (topological by influence, weakest first) ---
  const blockedBy: Record<string, string[]> = {};
  for (const d of present) blockedBy[d] = Object.entries(INFLUENCE).filter(([from, tos]) => present.has(from) && tos.includes(d)).map(([from]) => from);
  const sequence = [...present].sort((a, b) => (blockedBy[a]!.length - blockedBy[b]!.length) || ((scoreOf(a) ?? 100) - (scoreOf(b) ?? 100)));
  const parallel = [[...present].filter((d) => blockedBy[d]!.length === 0)];

  // --- Phase G: maturity ---
  const maturity = { overall: levelFor(businessScore), byCategory: Object.fromEntries((Object.entries(health) as Array<[string, HealthCell]>).map(([k, v]) => [k, levelFor(v.score)])) };

  // --- Phase H: optimizer ---
  const ranked = [...snapshots].sort((a, b) => Number(a.health.score) - Number(b.health.score));
  const bottleneck = correlations.filter((e) => e.influence === 'blocking').sort((a, b) => a.strength - b.strength)[0]?.from ?? null;
  const optimizer = {
    weakest: ranked[0]?.domain ?? null,
    strongest: ranked[ranked.length - 1]?.domain ?? null,
    bottleneck,
    largestOpportunity: opportunities[0]?.recommendation ?? null,
    fastestImprovement: opportunities.find((o) => o.type === 'quick_win')?.recommendation ?? opportunities[0]?.recommendation ?? null,
  };

  return {
    generatedAt: nowIso,
    domains: snapshots.map((s) => ({ id: s.id, domain: s.domain, score: Number(s.health.score), status: s.health.overall })),
    correlations, health, risks, opportunities, execution: { sequence, parallel, blockedBy }, maturity, optimizer,
  };
}
