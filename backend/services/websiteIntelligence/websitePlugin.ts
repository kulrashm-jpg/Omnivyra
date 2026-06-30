/**
 * Website Intelligence plugin (Phase 27) — Plugin #1. Website now flows through the Platform
 * Registry exactly like every other domain: provide() reads the canonical website snapshot
 * and emits modules + raw recommendation inputs; the registry composes executive summary,
 * business impact, recommendations, roadmap, confidence, freshness, presentation and HTML.
 * Reuses the existing website impact config (no duplication). The byte-identical
 * getWebsiteReportSafe path remains only as a thin compatibility alias for reports.
 */
import { getWebsiteSnapshot } from './websiteIntelligenceRepository';
import { WEBSITE_IMPACT_CONFIG, type ImpactDimension } from './businessImpactGraph';
import { registerPlugin, type IntelligencePlugin, type PluginData, type PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export const websitePlugin: IntelligencePlugin<ImpactDimension> = {
  id: 'website',
  displayName: 'Website Intelligence',
  domain: 'website',
  entityLabel: 'Website',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['website-health', 'command-center', 'executive'],
  impactConfig: WEBSITE_IMPACT_CONFIG,
  async provide({ companyId }): Promise<PluginData> {
    const snap = await getWebsiteSnapshot(companyId).catch(() => null);
    if (!snap) return { modules: [], recommendationInputs: [], score: 0, lastUpdated: null };
    const i: any = snap.intelligence ?? {};
    const updatedAt = snap.health?.computedAt ?? null;
    const mod = (key: string, label: string, score: number | null, findings: string[]): PluginModule =>
      ({ key, label, source: 'websiteIntelligenceRepository', score, status: statusFromScore(score), available: score != null, findings: (findings ?? []).slice(0, 3), lastUpdated: updatedAt });

    const modules: PluginModule[] = [
      mod('website_health', 'Website Health', snap.health?.compositeScore ?? null, [`Composite ${Math.round(snap.health?.compositeScore ?? 0)}/100`, `Overall ${snap.health?.overall ?? 'unknown'}`]),
      mod('content', 'Content Intelligence', i.content?.contentScore ?? null, i.content?.contentWeaknesses ?? []),
      mod('technical', 'Technical Intelligence', i.technical?.technicalScore ?? null, [...(i.technical?.criticalIssues ?? []), ...(i.technical?.warnings ?? [])]),
      mod('accessibility', 'Accessibility Intelligence', i.accessibility?.accessibilityScore ?? null, [...(i.accessibility?.criticalIssues ?? []), `WCAG ${i.accessibility?.wcagLevel ?? '—'}`]),
      mod('brand', 'Brand Intelligence', i.brand?.brandScore ?? null, i.brand?.brandWeaknesses ?? []),
    ];

    const recommendationInputs: RawRecommendationInput[] = (snap.recommendations ?? []).slice(0, 12).map((r: any) => ({
      key: r.key, text: r.recommendation, source: r.originEngine ?? r.source ?? 'websiteIntelligenceRepository',
      module: r.affectedModules?.[0] ?? 'website_health', impactLevel: r.businessImpact ?? 'medium', confidence: r.confidence ?? 0.7,
    }));

    return { modules, recommendationInputs, score: Math.round(snap.health?.compositeScore ?? 0), lastUpdated: updatedAt, overall: snap.health?.overall ?? 'disconnected' };
  },
};

registerPlugin(websitePlugin);
