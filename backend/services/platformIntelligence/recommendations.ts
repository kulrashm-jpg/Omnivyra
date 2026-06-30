/**
 * Platform Recommendation Engine (Phase 21B, Phase F).
 *
 * The ONE merge/deduplicate/categorise/prioritise pipeline for every domain. Each domain
 * feeds raw recommendation inputs + its own impact builder + effort classification; the
 * engine produces the unified, deduped, prioritised collection. No domain merges
 * recommendations independently. Website Intelligence is Consumer #1 (byte-identical).
 */
import { estimateROI, type BusinessImpact } from './businessImpact';

export type RecommendationCategory = 'critical' | 'high' | 'medium' | 'low' | 'quick_win' | 'strategic';

export interface PlatformRecommendation<D extends string = string> {
  key: string;
  recommendation: string;
  source: string;
  originEngine: string;
  severity?: string;
  category: RecommendationCategory;
  priority: number;
  reason: string;
  affectedModules: string[];
  estimatedImpact: 'high' | 'medium' | 'low';
  businessImpact: 'high' | 'medium' | 'low';
  estimatedEffort: 'high' | 'medium' | 'low';
  estimatedROI: 'high' | 'medium' | 'low';
  impact: BusinessImpact<D>;
  dependencies: string[];
  confidence: number;
}

export interface RawRecommendationInput {
  key: string;
  text: string;
  source: string;
  module: string;
  impactLevel: 'high' | 'medium' | 'low';
  confidence: number;
  severity?: string;
}

export interface MergeConfig<D extends string> {
  buildImpact: (key: string, modules: string[], level: 'high' | 'medium' | 'low') => BusinessImpact<D>;
  lowEffortKeys: Set<string>;
  highEffortKeys: Set<string>;
}

const clampNum = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export const normRec = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

export function mergeRecommendations<D extends string>(inputs: RawRecommendationInput[], cfg: MergeConfig<D>): PlatformRecommendation<D>[] {
  const byText = new Map<string, PlatformRecommendation<D>>();
  for (const inp of inputs) {
    const r = (inp.text || '').trim();
    if (!r) continue;
    const k = normRec(r);
    const effort: 'high' | 'medium' | 'low' = cfg.highEffortKeys.has(inp.key) ? 'high' : cfg.lowEffortKeys.has(inp.key) ? 'low' : 'medium';
    const existing = byText.get(k);
    if (existing) { if (!existing.affectedModules.includes(inp.module)) existing.affectedModules.push(inp.module); continue; }
    const impact = inp.impactLevel;
    const impactW = impact === 'high' ? 70 : impact === 'medium' ? 45 : 20;
    const effortW = effort === 'low' ? 0 : effort === 'medium' ? 12 : 25;
    const priority = clampNum(impactW - effortW + Math.round(inp.confidence * 15));
    let category: RecommendationCategory;
    if (impact === 'high' && effort === 'low') category = 'quick_win';
    else if (impact === 'high') category = effort === 'high' ? 'strategic' : 'critical';
    else if (impact === 'medium') category = effort === 'low' ? 'quick_win' : 'medium';
    else category = 'low';
    const biz = cfg.buildImpact(inp.key, [inp.module], impact);
    byText.set(k, {
      key: inp.key, recommendation: r, source: inp.source, originEngine: inp.source, severity: inp.severity, category, priority,
      reason: biz.summary, affectedModules: [inp.module], estimatedImpact: impact, businessImpact: impact, estimatedEffort: effort,
      estimatedROI: estimateROI(biz.score, effort), impact: biz, dependencies: biz.cascade, confidence: inp.confidence,
    });
  }
  return Array.from(byText.values()).sort((a, b) => b.priority - a.priority);
}
