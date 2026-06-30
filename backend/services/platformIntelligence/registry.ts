/**
 * Platform Intelligence Plugin Registry (Phase 21D, Phases L/M).
 *
 * The permanent backbone: every intelligence engine is added by REGISTRATION, not
 * implementation. A plugin declares its identity + supported reports/dashboards + its
 * impact config + a single deterministic `provide()` that READS its domain's existing
 * engines and emits modules + raw recommendation inputs. The registry composes everything
 * through the platform engines (business impact, recommendations, executive summary,
 * roadmap, confidence, freshness, presentation) — no domain owns any generic capability.
 */
import { buildBusinessImpact, aggregateBusinessImpact, type ImpactGraphConfig } from './businessImpact';
import { mergeRecommendations, type RawRecommendationInput, type PlatformRecommendation } from './recommendations';
import { buildExecutiveSummary, type ExecutiveSummary, type BusinessImpactAggregate, type HealthState } from './executiveSummary';
import { buildRoadmap, type RoadmapHorizon } from './roadmap';
import { aggregate, type CheckResult } from './confidence';
import { freshnessFrom } from './freshness';
import { statusToken, scoreToken, categoryToken, confidenceToken } from './styles';
import type { IntelligencePresentationModel, PMModule } from './presentationModel';
import { renderIntelligenceHtml } from './htmlRenderer';
import type { ModuleStatus } from './contract';

export interface PluginModule {
  key: string; label: string; status: ModuleStatus; available: boolean; source: string;
  lastUpdated: string | null; score: number | null; findings: string[];
}

export interface PluginData {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  overall?: HealthState;
  checks?: CheckResult[];
}

export interface IntelligencePlugin<D extends string = string> {
  id: string;
  displayName: string;
  domain: string;
  entityLabel: string;
  dependencies?: string[];
  supportedReports: string[];
  supportedDashboards: string[];
  impactConfig: ImpactGraphConfig<D>;
  lowEffortKeys?: Set<string>;
  highEffortKeys?: Set<string>;
  provide: (ctx: { companyId: string; nowMs: number; ctx?: CompositionContext }) => Promise<PluginData>;
}

export interface PluginSnapshot<D extends string = string> {
  id: string; domain: string; displayName: string;
  health: { overall: HealthState; score: number };
  modules: PluginModule[];
  recommendations: PlatformRecommendation<D>[];
  businessImpact: BusinessImpactAggregate<D>;
  executiveSummary: ExecutiveSummary<D>;
  roadmap: RoadmapHorizon[];
  confidence: number;
  freshness: { lastEvaluatedAt: string | null; stale: boolean };
}

/**
 * Request-scoped composition context (Phase 33). Created ONCE per request, never global,
 * never static, never cross-request — it is just a plain object the caller holds for the
 * duration of one request and then drops (GC'd). It memoizes in-flight composition Promises
 * so the same plugin composes once per request even when reports + Decision + Unified all
 * request it. No TTL, no persistence, no stale reads — freshness is unchanged (the request's
 * single deterministic `nowMs` is part of the key).
 */
export interface CompositionContext { memo: Map<string, Promise<PluginSnapshot<any>>> }
export const createCompositionContext = (): CompositionContext => ({ memo: new Map() });

// ---- registry --------------------------------------------------------------
const REGISTRY = new Map<string, IntelligencePlugin<any>>();
export function registerPlugin<D extends string>(plugin: IntelligencePlugin<D>): void { REGISTRY.set(plugin.id, plugin as IntelligencePlugin<any>); }
export function unregisterPlugin(id: string): void { REGISTRY.delete(id); }
export function getPlugins(): IntelligencePlugin[] { return [...REGISTRY.values()]; }
export function getPlugin(id: string): IntelligencePlugin | null { return REGISTRY.get(id) ?? null; }
export function getPluginsForReport(report: string): IntelligencePlugin[] { return getPlugins().filter((p) => p.supportedReports.includes(report)); }
export function getPluginsForDashboard(dashboard: string): IntelligencePlugin[] { return getPlugins().filter((p) => p.supportedDashboards.includes(dashboard)); }

// ---- composition (the single snapshot pipeline) ----------------------------
export async function composePluginSnapshot<D extends string>(plugin: IntelligencePlugin<D>, companyId: string, nowMs = Date.now(), ctx?: CompositionContext): Promise<PluginSnapshot<D>> {
  // ctx is passed to provide so registry-consuming plugins (decision/unified) reuse the same
  // memoized sub-compositions. Domain plugins ignore it. No behavioural change to outputs.
  const data = await plugin.provide({ companyId, nowMs, ctx });
  const buildImpact = (key: string, modules: string[], level: 'high' | 'medium' | 'low') => buildBusinessImpact<D>(key, modules, level, plugin.impactConfig);
  const recommendations = mergeRecommendations<D>(data.recommendationInputs, { buildImpact, lowEffortKeys: plugin.lowEffortKeys ?? new Set(), highEffortKeys: plugin.highEffortKeys ?? new Set() });
  const businessImpact = aggregateBusinessImpact<D>(recommendations.map((r) => r.impact), plugin.impactConfig.dimensionTail);
  const checks: CheckResult[] = data.checks ?? data.modules.map((m) => ({ key: m.key, label: m.label, status: m.available && m.score != null ? 'pass' : 'not_evaluable', score: m.score }));
  const confidence = aggregate(checks).confidence;
  const freshness = freshnessFrom(data.lastUpdated, nowMs);
  const overall: HealthState = data.overall ?? (data.score >= 75 ? 'healthy' : data.score > 0 ? 'warning' : 'disconnected');
  const executiveSummary = buildExecutiveSummary<D>({
    entityLabel: plugin.entityLabel, score: data.score, overallStatus: overall,
    modules: data.modules.map((m) => ({ label: m.label, status: m.status, available: m.available })),
    recommendations, businessImpact, confidence, lastIntelligenceUpdate: freshness.lastEvaluatedAt,
  });
  return {
    id: plugin.id, domain: plugin.domain, displayName: plugin.displayName,
    health: { overall, score: data.score }, modules: data.modules, recommendations, businessImpact,
    executiveSummary, roadmap: buildRoadmap<D>(recommendations), confidence,
    freshness: { lastEvaluatedAt: freshness.lastEvaluatedAt, stale: freshness.stale },
  };
}

/**
 * Phase 33 — request-scoped memoized composition. Same (plugin, company, nowMs) within one
 * request composes ONCE. The in-flight Promise is stored synchronously BEFORE awaiting, so
 * concurrent callers (reports + Decision + Unified) share the same Promise (no duplicate
 * concurrent composition, no duplicate repository reads). Without ctx it is a pass-through —
 * byte-identical to composePluginSnapshot.
 */
export function composePluginSnapshotMemoized<D extends string>(plugin: IntelligencePlugin<D>, companyId: string, nowMs: number, ctx?: CompositionContext): Promise<PluginSnapshot<D>> {
  if (!ctx) return composePluginSnapshot(plugin, companyId, nowMs);
  const key = `${plugin.id}|${companyId}|${nowMs}`;
  const existing = ctx.memo.get(key);
  if (existing) return existing as Promise<PluginSnapshot<D>>;
  const promise = composePluginSnapshot(plugin, companyId, nowMs, ctx);
  ctx.memo.set(key, promise); // store the Promise immediately — dedupes concurrent calls
  return promise;
}

/** Phase H — the single snapshot → IntelligencePresentationModel adapter for ALL plugins. */
export function toPresentationModel<D extends string>(snapshot: PluginSnapshot<D>): IntelligencePresentationModel {
  const es = snapshot.executiveSummary;
  const modules: PMModule[] = snapshot.modules.map((m) => ({
    key: m.key, label: m.label, score: m.score, scoreToken: scoreToken(m.score), status: m.status, statusToken: statusToken(m.status),
    confidencePct: Math.round(snapshot.confidence * 100), findings: m.findings.slice(0, 3), updatedAt: m.lastUpdated,
  }));
  const ROADMAP_LABEL: Record<string, string> = { '30_day': '30 days', '60_day': '60 days', '90_day': '90 days' };
  return {
    executiveSummary: {
      status: es.overallStatus, statusToken: statusToken(es.overallStatus), score: Math.round(es.overallScore), scoreToken: scoreToken(es.overallScore),
      headline: es.headline, strengths: es.strengths, weaknesses: es.weaknesses, priorityFocus: es.priorityFocus,
      businessImpactSummary: es.businessImpact.summary, confidencePct: Math.round(es.confidence * 100), updatedAt: es.freshness.lastIntelligenceUpdate,
    },
    health: { overall: snapshot.health.overall, statusToken: statusToken(snapshot.health.overall), score: snapshot.health.score, scoreToken: scoreToken(snapshot.health.score), trackingActive: snapshot.health.score > 0, trackingAt: snapshot.freshness.lastEvaluatedAt },
    modules,
    recommendations: snapshot.recommendations.map((r) => ({ recommendation: r.recommendation, category: r.category, categoryToken: categoryToken(r.category), businessImpact: r.businessImpact, effort: r.estimatedEffort, roi: r.estimatedROI, originEngine: r.originEngine, affectedModules: r.affectedModules, impactSummary: r.impact?.summary ?? '', priority: r.priority })),
    roadmap: snapshot.roadmap.map((h) => ({ horizon: h.horizon, label: ROADMAP_LABEL[h.horizon] ?? h.horizon, items: h.items })),
    businessImpact: {
      dimensions: (Object.entries(snapshot.businessImpact.dimensions) as Array<[string, number]>).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: Math.round(value) })),
      summary: snapshot.businessImpact.summary,
    },
    confidence: { pct: Math.round(snapshot.confidence * 100), fresh: !snapshot.freshness.stale, updatedAt: snapshot.freshness.lastEvaluatedAt, token: confidenceToken(snapshot.confidence) },
  };
}

/** Render any registered plugin through the platform HTML renderer (one renderer for all). */
export async function renderPluginHtml(plugin: IntelligencePlugin, companyId: string, nowMs = Date.now(), ctx?: CompositionContext): Promise<string> {
  return renderIntelligenceHtml(toPresentationModel(await composePluginSnapshotMemoized(plugin, companyId, nowMs, ctx)));
}
