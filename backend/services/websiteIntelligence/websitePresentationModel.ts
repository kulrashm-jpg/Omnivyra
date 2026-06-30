/**
 * Website → Presentation Model adapter (Phase 20 → Phase 21B).
 *
 * The presentation model TYPE is now platform-owned (IntelligencePresentationModel); this
 * file builds that model from the WEBSITE snapshot (Consumer #1's adapter). The renderers
 * (platform HTML + React) consume the model; formatting lives once, in the platform.
 */
import type { WebsiteIntelligenceSnapshot } from './websiteIntelligenceRepository';
import { statusToken, scoreToken, categoryToken, confidenceToken } from './presentationStyles';
import type { IntelligencePresentationModel, PMModule, PMRecommendation, PMRoadmap } from '../platformIntelligence/presentationModel';

export type { IntelligencePresentationModel, PMModule, PMRecommendation, PMRoadmap, PMDimension } from '../platformIntelligence/presentationModel';
/** Website alias of the platform presentation model (Consumer #1). */
export type WebsitePresentationModel = IntelligencePresentationModel;

const ROADMAP_LABEL: Record<string, string> = { '30_day': '30 days', '60_day': '60 days', '90_day': '90 days', now: 'Now', next: 'Next', later: 'Later' };
const accStatus = (score: number | null): string => (score == null ? 'unavailable' : score >= 80 ? 'healthy' : score >= 55 ? 'warning' : 'critical');
const mod = (key: string, label: string, score: number | null, status: string, confidence: number, findings: string[], updatedAt: string | null, badge?: string): PMModule =>
  ({ key, label, score, scoreToken: scoreToken(score), status, statusToken: statusToken(status), confidencePct: Math.round((confidence ?? 0) * 100), badge, findings: (findings ?? []).slice(0, 3), updatedAt });

export function buildWebsitePresentationModel(snapshot: WebsiteIntelligenceSnapshot): WebsitePresentationModel {
  const es = snapshot.executiveSummary;
  const i = snapshot.intelligence;
  const rep = snapshot.report;

  const executiveSummary = es ? {
    status: es.overallStatus, statusToken: statusToken(es.overallStatus), score: Math.round(es.overallScore ?? 0), scoreToken: scoreToken(es.overallScore),
    headline: es.headline, strengths: es.strengths ?? [], weaknesses: es.weaknesses ?? [], priorityFocus: es.priorityFocus ?? [],
    businessImpactSummary: es.businessImpact?.summary ?? '', confidencePct: Math.round((es.confidence ?? 0) * 100), updatedAt: es.freshness?.lastIntelligenceUpdate ?? null,
  } : null;

  const health = snapshot.health ? {
    overall: snapshot.health.overall, statusToken: statusToken(snapshot.health.overall),
    score: Math.round(snapshot.health.compositeScore ?? 0), scoreToken: scoreToken(snapshot.health.compositeScore),
    trackingActive: !!snapshot.tracking?.active, trackingAt: snapshot.tracking?.lastSeenAt ?? null,
  } : null;

  const modules: PMModule[] = [
    mod('content', 'Content Intelligence', i.content.contentScore, i.content.contentHealth, i.content.confidence, i.content.contentWeaknesses, i.content.freshness.lastEvaluatedAt),
    mod('technical', 'Technical Intelligence', i.technical.technicalScore, i.technical.technicalHealth, i.technical.confidence, [...(i.technical.criticalIssues ?? []), ...(i.technical.warnings ?? [])], i.technical.freshness.lastEvaluatedAt),
    mod('accessibility', 'Accessibility Intelligence', i.accessibility.accessibilityScore, accStatus(i.accessibility.accessibilityScore), i.accessibility.confidence, i.accessibility.criticalIssues, i.accessibility.freshness.lastEvaluatedAt, `WCAG ${i.accessibility.wcagLevel}`),
    mod('brand', 'Brand Intelligence', i.brand.brandScore, i.brand.brandHealth, i.brand.confidence, i.brand.brandWeaknesses, i.brand.freshness.lastEvaluatedAt),
  ];

  const recommendations: PMRecommendation[] = snapshot.recommendations.map((r) => ({
    recommendation: r.recommendation, category: r.category, categoryToken: categoryToken(r.category), businessImpact: r.businessImpact,
    effort: r.estimatedEffort, roi: r.estimatedROI, originEngine: r.originEngine, affectedModules: r.affectedModules, impactSummary: r.impact?.summary ?? '', priority: r.priority,
  }));

  const roadmap: PMRoadmap[] = (rep?.roadmap ?? []).map((h) => ({ horizon: h.horizon, label: ROADMAP_LABEL[h.horizon] ?? h.horizon, items: h.items ?? [] }));

  const dims = rep?.businessImpact?.dimensions ?? {};
  const businessImpact = {
    dimensions: (Object.entries(dims) as Array<[string, number]>).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: Math.round(value) })),
    summary: rep?.businessImpact?.summary ?? '',
  };

  const confidence = { pct: Math.round((rep?.confidence ?? 0) * 100), fresh: !(rep?.freshness?.stale ?? true), updatedAt: rep?.freshness?.lastIntelligenceUpdate ?? null, token: confidenceToken(rep?.confidence) };

  return { executiveSummary, health, modules, recommendations, roadmap, businessImpact, confidence };
}
