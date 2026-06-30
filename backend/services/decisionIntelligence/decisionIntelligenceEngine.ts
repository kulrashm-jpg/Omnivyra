/**
 * Decision Intelligence — the strategic brain (Phase 24). It sits ABOVE every domain and
 * consumes ONLY composed Platform plugin snapshots (never domain repositories). It owns no
 * generic intelligence: it aggregates, prioritises, explains and orchestrates. Deterministic.
 * No LLM. Unknown stays Unknown. The Platform Recommendation Engine remains the owner of
 * recommendations — the decision layer only re-ranks across plugins and annotates dependencies.
 */
import type { PluginSnapshot } from '../platformIntelligence/registry';
import type { HealthState } from '../platformIntelligence/executiveSummary';

/** Deterministic cross-domain dependency graph (what must be healthy before what). */
const DEPENDENCY_GRAPH: Record<string, string[]> = {
  readiness: [],
  website: [],
  lead: ['readiness'],
  marketing_growth: ['readiness', 'website'],
  growth: ['marketing_growth', 'commercial'],
  commercial: ['lead', 'marketing_growth'],
};

type HealthCell = { score: number | null; status: HealthState };
const cell = (score: number | null): HealthCell => ({ score, status: score == null ? 'disconnected' : score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'disconnected' });
const avg = (ns: number[]): number | null => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null);
const levelFor = (score: number | null): number => (score == null ? 1 : score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1);

export interface DecisionPriority {
  recommendation: string; category: string; priority: number; domain: string; originEngine: string;
  businessImpact: string; effort: string; roi: string; prerequisites: string[]; reason: string;
}
export interface DecisionIntelligence {
  generatedAt: string;
  domains: Array<{ id: string; displayName: string; score: number; confidence: number; status: HealthState }>;
  health: { business: HealthCell; digital: HealthCell; marketing: HealthCell; sales: HealthCell; revenue: HealthCell; operational: HealthCell; readiness: HealthCell; risk: HealthCell };
  scores: { executiveDecision: number; businessReadiness: number; execution: number; growth: number; confidence: number };
  maturity: { overall: number; byDomain: Record<string, number> };
  priorities: DecisionPriority[];
  opportunities: Array<{ recommendation: string; domain: string; roi: string; businessImpact: string; quickWin: boolean }>;
  dependencyGraph: Array<{ node: string; dependsOn: string[]; unlocks: string[] }>;
  roadmap: Array<{ horizon: 'immediate' | '30_day' | '60_day' | '90_day' | '6_month' | '12_month'; items: string[] }>;
}

/** Pure aggregation over already-composed plugin snapshots. */
export function aggregateDecision(snapshots: PluginSnapshot[], nowIso: string): DecisionIntelligence {
  const byDomain = new Map<string, PluginSnapshot>();
  for (const s of snapshots) byDomain.set(s.domain, s);
  const scoreOf = (domain: string): number | null => (byDomain.has(domain) ? Number(byDomain.get(domain)!.health.score) : null);

  const allScores = snapshots.map((s) => Number(s.health.score));
  const businessScore = avg(allScores);
  const website = scoreOf('website');
  const marketing = scoreOf('marketing_growth');
  const commercial = scoreOf('commercial');
  const readiness = scoreOf('readiness');
  const growthScore = scoreOf('growth');

  // Digital health comes ONLY from the website plugin via the registry — no derived fallback,
  // no Website awareness. Unknown when the website plugin is not registered.
  const health = {
    business: cell(businessScore), digital: cell(website), marketing: cell(marketing),
    sales: cell(commercial), revenue: cell(commercial), operational: cell(readiness), readiness: cell(readiness),
    risk: cell(businessScore == null ? null : 100 - businessScore),
  };
  const confidence = avg(snapshots.map((s) => Math.round(s.confidence * 100))) ?? 0;
  const scores = {
    executiveDecision: businessScore ?? 0,
    businessReadiness: readiness ?? 0,
    execution: avg([marketing, commercial].filter((x): x is number => x != null)) ?? 0,
    growth: growthScore ?? 0,
    confidence,
  };
  const maturity = { overall: levelFor(businessScore), byDomain: Object.fromEntries(snapshots.map((s) => [s.domain, levelFor(Number(s.health.score))])) };

  // --- Executive priorities (Phase C): global re-rank of every plugin recommendation ---
  const priorities: DecisionPriority[] = snapshots.flatMap((s) => s.recommendations.map((r) => ({
    recommendation: r.recommendation, category: r.category, priority: r.priority, domain: s.domain, originEngine: r.originEngine,
    businessImpact: r.businessImpact, effort: r.estimatedEffort, roi: r.estimatedROI,
    prerequisites: DEPENDENCY_GRAPH[s.domain] ?? [], reason: r.impact?.summary ?? r.reason,
  }))).sort((a, b) => b.priority - a.priority);

  // --- Opportunities (Phase D): high-ROI / quick wins across domains ---
  const opportunities = priorities
    .filter((p) => p.roi === 'high' || p.category === 'quick_win')
    .slice(0, 10)
    .map((p) => ({ recommendation: p.recommendation, domain: p.domain, roi: p.roi, businessImpact: p.businessImpact, quickWin: p.category === 'quick_win' }));

  // --- Dependency graph (Phase E) ---
  const present = new Set(snapshots.map((s) => s.domain));
  const dependencyGraph = [...present].map((node) => ({
    node,
    dependsOn: (DEPENDENCY_GRAPH[node] ?? []).filter((d) => present.has(d)),
    unlocks: [...present].filter((other) => (DEPENDENCY_GRAPH[other] ?? []).includes(node)),
  }));

  // --- Executive roadmap (Phase F): 6 horizons by category, deterministic ---
  const pick = (...cats: string[]) => priorities.filter((p) => cats.includes(p.category)).slice(0, 6).map((p) => `[${p.domain}] ${p.recommendation}`);
  const roadmap = [
    { horizon: 'immediate' as const, items: pick('critical') },
    { horizon: '30_day' as const, items: pick('quick_win') },
    { horizon: '60_day' as const, items: pick('high') },
    { horizon: '90_day' as const, items: pick('medium') },
    { horizon: '6_month' as const, items: pick('strategic') },
    { horizon: '12_month' as const, items: pick('low') },
  ];

  return {
    generatedAt: nowIso,
    domains: snapshots.map((s) => ({ id: s.id, displayName: s.displayName, score: Number(s.health.score), confidence: s.confidence, status: s.health.overall })),
    health, scores, maturity, priorities, opportunities, dependencyGraph, roadmap,
  };
}
