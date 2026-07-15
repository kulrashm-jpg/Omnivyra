/**
 * Canonical Website Intelligence Repository (Phase 18).
 *
 * The SINGLE repository-backed read surface for every website-facing intelligence
 * capability. It COMPOSES existing services — it computes no scores, builds no
 * reports, and duplicates no readiness/health/recommendation logic. Every source
 * read is fail-open (a failing source degrades to null/[]; the snapshot still returns).
 *
 * Composed sources (all pre-existing, canonical owners):
 *   websiteHealthScoreService.computeWebsiteHealthScore   — composite + category scores, issues, recommendations
 *   integrationHealthService.getWebsiteHealthSummary       — connections, tracking_last_seen_at, failed_publish_count
 *   integrationHealthService.deriveIntegrationHealth       — per-connection health derivation (pure)
 *   activationReadinessService.buildActivationReadiness    — cms / analytics / leads readiness + next actions
 *   websiteIntelligenceService.getWebsiteIntelligenceSignals — website signals + recommendations
 *   integrationService.getIntegrations                     — CMS + webhook integrations
 *   domainRecordService.getCompanyDomainVerification       — domain verification state
 *   websiteService.getWebsites                             — website resolution
 *
 * Engines that exist but are generated on demand via their own surfaces (SEO,
 * Performance, Competitive) are reported as AVAILABLE here (never "unavailable");
 * modules with no website-scope implementation (content/technical/accessibility/
 * brand) are reported honestly as unavailable.
 */
import { computeWebsiteHealthScore } from '../websiteHealthScoreService';
// W4-2 (Batch D cache stack)
import { registerCacheNamespace } from '../../../lib/platform/cacheCore';
import { createCache } from '../../../lib/platform/cacheClient';
import { defineRolloutFlag, resolveRolloutSync } from '../../../lib/platform/rollout';
import { getWebsiteHealthSummary, deriveIntegrationHealth } from '../integrationHealthService';
import { buildActivationReadiness } from '../activationReadinessService';
import { getWebsiteIntelligenceSignals } from '../websiteIntelligenceService';
import { getIntegrations } from '../integrationService';
import { getCompanyDomainVerification } from '../domainRecordService';
import { getWebsites } from '../websiteService';
import { evaluateContentIntelligence, type ContentIntelligence } from './contentIntelligenceEngine';
import { evaluateTechnicalIntelligence, type TechnicalIntelligence } from './technicalIntelligenceEngine';
import { evaluateAccessibilityIntelligence, type AccessibilityIntelligence } from './accessibilityIntelligenceEngine';
import { evaluateBrandIntelligence, type BrandIntelligence } from './brandIntelligenceEngine';
import { buildBusinessImpact, estimateROI, aggregateBusinessImpact, type BusinessImpact, type ImpactDimension } from './businessImpactGraph';
// Platform Intelligence Framework (Phase 21B) — Website is Consumer #1.
import { mergeRecommendations, type RawRecommendationInput, type PlatformRecommendation, type RecommendationCategory } from '../platformIntelligence/recommendations';
import { buildExecutiveSummary as platformBuildExecutiveSummary, type ExecutiveSummary, type BusinessImpactAggregate as PlatformBusinessImpactAggregate, type HealthState as PlatformHealthState } from '../platformIntelligence/executiveSummary';
import { buildRoadmap as platformBuildRoadmap } from '../platformIntelligence/roadmap';
import type { ModuleStatus as PlatformModuleStatus, IntelligenceModule as PlatformIntelligenceModule } from '../platformIntelligence/contract';

export type ModuleStatus = PlatformModuleStatus;
export type HealthState = PlatformHealthState;
export type IntelligenceModule = PlatformIntelligenceModule;
export type { RecommendationCategory };
/** Website recommendation = the platform recommendation bound to website impact dimensions. */
export type WebsiteRecommendation = PlatformRecommendation<ImpactDimension>;
export interface ValidationCheck { key: string; label: string; ok: boolean; source: string; detail?: string }
export interface SummarySection { key: string; label: string; status: ModuleStatus; source: string; lastUpdated: string | null }

export interface WebsiteIntelligenceSnapshot {
  companyId: string;
  websiteId: string | null;
  website: { id: string; name: string; canonical_url: string; status?: string } | null;
  generatedAt: string;
  health: {
    compositeScore: number;
    overall: HealthState;
    categoryScores: Record<string, number>;
    connections: any[];
    trackingLastSeenAt: string | null;
    failedPublishCount: number;
    issues: Array<{ key: string; severity: string }>;
    improvementPriorities: Array<{ category: string; score: number }>;
    computedAt: string | null;
  } | null;
  readiness: { activated: boolean; generatedAt: string | null; checks: any[] } | null;
  tracking: { installed: boolean; active: boolean; lastSeenAt: string | null; status: HealthState };
  signals: Array<{ signalKey: string; type: string; severity: string; confidence: number; recommendation: string; generatedAt: string | null }>;
  integrations: Array<{ id: string; type: string; name: string; status: string; healthState: string; healthScore: number; lastSuccessAt: string | null; lastError: string | null }>;
  diagnostics: Array<{ id: string; name: string; type: string; status: string; healthState: string; reasons: string[]; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null }>;
  domain: { finalDomain: string | null; verificationStatus: string | null; verified: boolean; verifiedAt: string | null } | null;
  modules: IntelligenceModule[];
  intelligence: {
    content: ContentIntelligence;
    technical: TechnicalIntelligence;
    accessibility: AccessibilityIntelligence;
    brand: BrandIntelligence;
  };
  recommendations: WebsiteRecommendation[];
  validation: { checks: ValidationCheck[]; passed: number; total: number };
  summary: {
    overallScore: number;
    executiveSummary: string;
    sections: SummarySection[];
    topRisks: Array<{ key: string; severity: string }>;
    topOpportunities: Array<{ category: string; score: number }>;
    recommendedActions: WebsiteRecommendation[];
    lastCrawl: string | null;
    lastScan: string | null;
    lastIntelligenceUpdate: string | null;
  };
  /** Structured executive summary (Phase B) — repository-owned, reports only display it. */
  executiveSummary: WebsiteExecutiveSummary;
  report: WebsiteReport;
}

export type BusinessImpactAggregate = PlatformBusinessImpactAggregate<ImpactDimension>;
/** Website executive summary = the platform executive summary bound to website dimensions. */
export type WebsiteExecutiveSummary = ExecutiveSummary<ImpactDimension>;

export interface WebsiteReport {
  executiveSummary: string;
  executive: WebsiteExecutiveSummary;
  businessImpact: BusinessImpactAggregate;
  overallScore: number;
  overallHealth: HealthState;
  overallReadiness: 'ready' | 'partial' | 'not_ready';
  activation: boolean;
  sections: Array<{ key: string; label: string; status: ModuleStatus; score?: number | null; source: string; lastUpdated: string | null; confidence?: number }>;
  recommendations: WebsiteRecommendation[];
  priorities: WebsiteRecommendation[];
  quickWins: WebsiteRecommendation[];
  criticalIssues: WebsiteRecommendation[];
  roadmap: Array<{ horizon: '30_day' | '60_day' | '90_day'; items: string[] }>;
  confidence: number;
  freshness: { lastIntelligenceUpdate: string | null; stale: boolean };
}

// ---- internal source bundle (single fetch, fail-open) ------------------------
interface Sources {
  website: any | null;
  score: any | null;
  healthSummary: any | null;
  readiness: any | null;
  signals: any[];
  integrations: any[];
  domain: any | null;
  leadsReady: boolean;
  content: ContentIntelligence;
  technical: TechnicalIntelligence;
  accessibility: AccessibilityIntelligence;
  brand: BrandIntelligence;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

async function resolveWebsiteId(companyId: string, websiteId?: string | null): Promise<{ id: string | null; website: any | null }> {
  const sites = await safe(getWebsites(companyId), [] as any[]);
  if (websiteId) return { id: websiteId, website: sites.find((w) => w.id === websiteId) ?? null };
  const first = sites[0] ?? null;
  return { id: first?.id ?? null, website: first };
}

// ── W4-2 (audit B-12): shared snapshot sources ───────────────────────────────
// loadSources runs a 10-way fan-out (health scoring, readiness, signals,
// integrations, 4 intelligence evaluators). Every granular accessor called
// it again, so one report page multiplied the fan-out per panel. Under the
// 'website-snapshot-cache' flag the assembled Sources are shared:
//   1. request-scoped (memoRequest) — all accessors within one request use
//      ONE fan-out (zero staleness: same-request snapshot identity),
//   2. short Redis TTL (default 120 s, env WEBSITE_SNAPSHOT_TTL_SECONDS) —
//      panels arriving as separate requests reuse it briefly.
// Everything cached is deterministic company/website evaluation state — no
// mutable user state. Kill: CACHE_KILL_OMNIVYRA_WI_SOURCES; invalidation:
// version bump or invalidateWebsiteSnapshotCache(companyId).
const WI_SOURCES_FLAG = defineRolloutFlag({
  key: 'website-snapshot-cache',
  description: 'W4-2: share the website-intelligence sources fan-out across accessors (audit B-12)',
});
const WI_SOURCES_NS = registerCacheNamespace({
  prefix: 'omnivyra:wi_sources',
  description: 'W4-2 website intelligence sources (deterministic evaluation state)',
  version: 1,
  defaultTtlSeconds: Math.max(30, Number(process.env.WEBSITE_SNAPSHOT_TTL_SECONDS) || 120),
  requireTenant: true,
});
const wiSourcesCache = createCache(WI_SOURCES_NS);

/** Explicit invalidation for crawl/refresh flows. */
export async function invalidateWebsiteSnapshotCache(companyId: string, websiteId?: string | null): Promise<void> {
  await wiSourcesCache.invalidate({ tenantId: companyId, parts: [websiteId ?? 'default'], reason: 'refresh' });
}

async function loadSources(companyId: string, websiteId?: string | null): Promise<Sources> {
  if (resolveRolloutSync(WI_SOURCES_FLAG, { tenantId: companyId }).mode !== 'off') {
    return wiSourcesCache.getOrLoad<Sources>({
      tenantId: companyId,
      parts: [websiteId ?? 'default'],
      load: () => loadSourcesUncached(companyId, websiteId),
    });
  }
  return loadSourcesUncached(companyId, websiteId);
}

async function loadSourcesUncached(companyId: string, websiteId?: string | null): Promise<Sources> {
  const { id, website } = await resolveWebsiteId(companyId, websiteId);
  const [score, healthSummary, readiness, signals, integrations, domain, content, technical, accessibility, brand] = await Promise.all([
    id ? safe(computeWebsiteHealthScore({ companyId, websiteId: id }), null) : Promise.resolve(null),
    id ? safe(getWebsiteHealthSummary(companyId, id), null) : Promise.resolve(null),
    safe(buildActivationReadiness(companyId), null),
    id ? safe(getWebsiteIntelligenceSignals({ companyId, websiteId: id }), [] as any[]) : Promise.resolve([] as any[]),
    safe(getIntegrations(companyId), [] as any[]),
    safe(getCompanyDomainVerification(companyId), null),
    evaluateContentIntelligence(companyId),
    evaluateTechnicalIntelligence(companyId),
    evaluateAccessibilityIntelligence(companyId),
    evaluateBrandIntelligence(companyId),
  ]);
  const leadsReady = !!readiness?.checks?.find((c: any) => c.id === 'leads')?.done;
  return { website: website ? { id: website.id, name: website.name, canonical_url: website.canonical_url, status: website.status } : (id ? { id, name: '', canonical_url: '' } : null), score, healthSummary, readiness, signals, integrations, domain, leadsReady, content, technical, accessibility, brand };
}

// ---- pure derivations --------------------------------------------------------
const catStatus = (v: unknown): ModuleStatus => (typeof v === 'number' ? (v >= 75 ? 'ready' : v >= 50 ? 'partial' : 'unavailable') : 'unavailable');
const boolStatus = (b: boolean): ModuleStatus => (b ? 'ready' : 'partial');

function buildHealth(s: Sources): WebsiteIntelligenceSnapshot['health'] {
  if (!s.score && !s.healthSummary) return null;
  const cats = s.score?.category_scores ?? {};
  const trackingActive = !!s.healthSummary?.tracking_last_seen_at;
  const verified = !!s.domain?.verified;
  const composite = Number(s.score?.composite_score ?? 0);
  let overall: HealthState = 'warning';
  if (!trackingActive && !s.leadsReady) overall = 'disconnected';
  else if (composite >= 75 && verified && trackingActive) overall = 'healthy';
  return {
    compositeScore: composite,
    overall,
    categoryScores: cats,
    connections: s.healthSummary?.connections ?? [],
    trackingLastSeenAt: s.healthSummary?.tracking_last_seen_at ?? null,
    failedPublishCount: Number(s.healthSummary?.failed_publish_count ?? 0),
    issues: Array.isArray(s.score?.issues) ? s.score.issues.map((i: any) => ({ key: i.key, severity: i.severity })) : [],
    improvementPriorities: Array.isArray(s.score?.improvement_priorities) ? s.score.improvement_priorities : [],
    computedAt: s.score?.computed_at ?? null,
  };
}

function buildTracking(s: Sources): WebsiteIntelligenceSnapshot['tracking'] {
  const lastSeenAt = s.healthSummary?.tracking_last_seen_at ?? null;
  const active = !!lastSeenAt;
  return { installed: active, active, lastSeenAt, status: active ? 'healthy' : 'disconnected' };
}

function buildIntegrations(s: Sources): WebsiteIntelligenceSnapshot['integrations'] {
  return s.integrations.map((x: any) => {
    const h = (() => { try { return deriveIntegrationHealth(x); } catch { return null; } })();
    return {
      id: x.id, type: x.type, name: x.name || x.type, status: x.status,
      healthState: h?.state ?? 'unknown', healthScore: Number(h?.score ?? 0),
      lastSuccessAt: h?.last_success_at ?? x.last_tested_at ?? null, lastError: x.last_error ?? h?.last_error_message ?? null,
    };
  });
}

function buildDiagnostics(s: Sources): WebsiteIntelligenceSnapshot['diagnostics'] {
  return s.integrations.map((x: any) => {
    const h = (() => { try { return deriveIntegrationHealth(x); } catch { return null; } })();
    return {
      id: x.id, name: x.name || x.type, type: x.type, status: x.status,
      healthState: h?.state ?? 'unknown', reasons: h?.reasons ?? [],
      lastSuccessAt: h?.last_success_at ?? null, lastFailureAt: h?.last_failure_at ?? null,
      lastError: x.last_error ?? h?.last_error_message ?? null,
    };
  });
}

function buildModules(s: Sources): IntelligenceModule[] {
  const cats = s.score?.category_scores ?? {};
  const scoreAt = s.score?.computed_at ?? null;
  const leadAt = s.readiness?.generatedAt ?? null;
  const sigAt = s.signals.length ? (s.signals[0]?.generated_at ?? null) : null;
  const liStatus: ModuleStatus = s.leadsReady ? 'ready' : 'partial';
  const m = (key: string, label: string, status: ModuleStatus, available: boolean, source: string, lastUpdated: string | null, detail?: string): IntelligenceModule =>
    ({ key, label, status, available, source, lastUpdated, detail });
  return [
    m('website_intelligence', 'Website Intelligence', s.score ? 'ready' : 'unavailable', !!s.score, 'websiteHealthScoreService', scoreAt),
    m('tracking', 'Tracking Readiness', catStatus(cats.tracking_health), true, 'websiteHealthScoreService', scoreAt),
    m('attribution', 'Attribution', catStatus(cats.attribution_readiness), true, 'attributionReportingService', scoreAt),
    m('conversion', 'Conversion Intelligence', catStatus(cats.conversion_readiness), true, 'websiteHealthScoreService', scoreAt),
    m('forms', 'Form Intelligence', catStatus(cats.form_health), true, 'formIntelligenceService', scoreAt),
    m('cms', 'CMS Health', catStatus(cats.cms_health), true, 'integrationHealthService', scoreAt),
    m('publishing', 'Publishing', catStatus(cats.publishing_reliability), true, 'integrationHealthService', scoreAt),
    m('integration', 'Integration Reliability', catStatus(cats.integration_reliability), true, 'integrationHealthService', scoreAt),
    m('domain', 'Domain Verification', catStatus(cats.domain_verification), true, 'domainRecordService', s.domain?.verified_at ?? null),
    m('lead_readiness', 'Lead Readiness', boolStatus(s.leadsReady), true, 'activationReadinessService', leadAt),
    m('campaign_readiness', 'Campaign Readiness', boolStatus(!!s.readiness?.checks?.find((c: any) => c.id === 'cms')?.done), true, 'activationReadinessService', leadAt),
    m('marketing_readiness', 'Marketing / GA Readiness', boolStatus(!!s.readiness?.checks?.find((c: any) => c.id === 'analytics')?.done), true, 'activationReadinessService', leadAt),
    m('content_readiness', 'Content Readiness', 'partial', true, 'websiteDashboardService', null),
    m('marketpulse', 'MarketPulse Signals', s.signals.length ? 'ready' : 'partial', true, 'websiteIntelligenceService', sigAt),
    m('repository', 'Repository Status', liStatus, true, 'leadIntelligenceRepository', leadAt),
    m('lead_intelligence', 'Lead Intelligence', liStatus, true, 'leadIntelligenceReadService', leadAt),
    m('buying_intent', 'Buying Intent', liStatus, true, 'leadIntelligenceReadService', leadAt),
    m('company_intelligence', 'Company Intelligence', liStatus, true, 'leadIntelligenceReadService', leadAt),
    m('action_plan', 'Action Plan', liStatus, true, 'leadIntelligenceReadService', leadAt),
    m('journey', 'Journey Intelligence', liStatus, true, 'leadIntelligenceReadService', leadAt),
    m('identity', 'Identity Resolution', liStatus, true, 'leadIntelligenceReadService', leadAt),
    // Engines that exist but are generated on demand via their own surfaces — AVAILABLE, never "unavailable".
    m('seo', 'SEO Intelligence', 'ready', true, 'seoIntelligenceService', null, 'Generated on demand'),
    m('performance', 'Performance Intelligence', 'ready', true, 'performanceReportService', null, 'Generated on demand'),
    m('competitive', 'Competitive Position', 'ready', true, 'unifiedCompetitorIntelligenceService', null, 'Generated on demand'),
    // Phase 18 deterministic engines — real status from the engine score + confidence.
    moduleFromEngine('content_analysis', 'Content Intelligence', s.content.contentScore, s.content.confidence, s.content.freshness.lastEvaluatedAt, 'contentIntelligenceEngine'),
    moduleFromEngine('technical', 'Technical Intelligence', s.technical.technicalScore, s.technical.confidence, s.technical.freshness.lastEvaluatedAt, 'technicalIntelligenceEngine'),
    moduleFromEngine('accessibility', 'Accessibility Intelligence', s.accessibility.accessibilityScore, s.accessibility.confidence, s.accessibility.freshness.lastEvaluatedAt, 'accessibilityIntelligenceEngine'),
    moduleFromEngine('brand', 'Brand Intelligence', s.brand.brandScore, s.brand.confidence, s.brand.freshness.lastEvaluatedAt, 'brandIntelligenceEngine'),
  ];
}

/** Map a deterministic engine score (0..100|null) + confidence into a module registry entry. */
function moduleFromEngine(key: string, label: string, score: number | null, confidence: number, lastUpdated: string | null, source: string): IntelligenceModule {
  const status: ModuleStatus = score == null ? 'unavailable' : score >= 75 ? 'ready' : score >= 45 ? 'partial' : 'partial';
  return { key, label, status, available: score != null, source, lastUpdated, detail: score == null ? 'Run the website scan to populate' : `score ${Math.round(score)} · confidence ${(confidence * 100).toFixed(0)}%` };
}

const SEV_IMPACT = (sev?: string): 'high' | 'medium' | 'low' => (sev === 'high' || sev === 'critical' ? 'high' : sev === 'low' ? 'low' : 'medium');
const LOW_EFFORT = new Set(['meta_tags', 'duplicate_titles', 'duplicate_descriptions', 'headline_clarity', 'conversion_copy', 'link_text', 'viewport', 'language_declaration', 'cta_quality', 'open_graph', 'twitter_cards', 'contact_info', 'faq']);
const HIGH_EFFORT = new Set(['content_depth', 'blog_coverage', 'case_studies', 'brand_assets', 'logo_consistency', 'typography', 'tone_voice', 'https', 'broken_links']);

/**
 * Phase 21B — delegates to the Platform Recommendation Engine. Website composes raw inputs
 * from its sources + supplies its impact builder + effort classification; the platform
 * engine merges/dedupes/prioritises/categorises identically (byte-identical output).
 */
function buildRecommendations(s: Sources): WebsiteRecommendation[] {
  const inputs: RawRecommendationInput[] = [];
  const push = (key: string, text: string, source: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number, severity?: string) =>
    inputs.push({ key, text, source, module, impactLevel, confidence, severity });
  for (const rec of (s.score?.recommendations ?? [])) push(rec.key ?? 'health', rec.recommendation ?? '', 'websiteHealthScoreService', 'website_intelligence', 'medium', 0.85);
  for (const sig of s.signals) push(sig.signal_key ?? 'signal', sig.recommendation ?? '', 'websiteIntelligenceService', 'marketpulse', SEV_IMPACT(sig.severity), Number(sig.confidence ?? 0.7), sig.severity);
  for (const c of (s.readiness?.checks ?? [])) if (!c.done) push(c.id ?? 'readiness', c.nextActionLabel ?? '', 'activationReadinessService', 'lead_readiness', 'high', 0.9);
  for (const r of s.content.recommendations) push(r.key, r.recommendation, 'contentIntelligenceEngine', 'content_analysis', 'medium', s.content.confidence);
  for (const r of s.technical.recommendations) push(r.key, r.recommendation, 'technicalIntelligenceEngine', 'technical', SEV_IMPACT(s.technical.criticalIssues.length && ['https', 'broken_links', 'crawlability'].includes(r.key) ? 'high' : 'medium'), s.technical.confidence);
  for (const r of s.accessibility.recommendations) push(r.key, r.recommendation, 'accessibilityIntelligenceEngine', 'accessibility', 'medium', s.accessibility.confidence);
  for (const r of s.brand.recommendations) push(r.key, r.recommendation, 'brandIntelligenceEngine', 'brand', 'medium', s.brand.confidence);
  return mergeRecommendations<ImpactDimension>(inputs, { buildImpact: buildBusinessImpact, lowEffortKeys: LOW_EFFORT, highEffortKeys: HIGH_EFFORT });
}

function buildValidation(s: Sources, modules: IntelligenceModule[]): WebsiteIntelligenceSnapshot['validation'] {
  const cats = s.score?.category_scores ?? {};
  const trackingActive = !!s.healthSummary?.tracking_last_seen_at;
  const verified = !!s.domain?.verified;
  const hasWebhook = s.integrations.some((x: any) => x.type === 'lead_webhook');
  const hasCms = s.integrations.some((x: any) => x.type !== 'lead_webhook') || !!s.readiness?.checks?.find((c: any) => c.id === 'cms')?.done;
  const https = (s.website?.canonical_url || '').startsWith('https://');
  const fresh = !!s.score?.computed_at;
  const c = (key: string, label: string, ok: boolean, source: string, detail?: string): ValidationCheck => ({ key, label, ok, source, detail });
  const checks: ValidationCheck[] = [
    c('website_reachable', 'Website reachable', !!s.website, 'websiteService'),
    c('domain_verified', 'Domain verified', verified, 'domainRecordService', s.domain?.final_domain ?? undefined),
    c('dns_healthy', 'DNS healthy', verified, 'domainRecordService'),
    c('ssl', 'SSL', https, 'websiteService'),
    c('tracker_installed', 'Tracker installed', trackingActive, 'integrationHealthService'),
    c('tracker_active', 'Tracker active', trackingActive, 'integrationHealthService'),
    c('session_creation', 'Session creation', trackingActive, 'integrationHealthService'),
    c('attribution_capture', 'Attribution capture', (cats.attribution_readiness ?? 0) >= 75 || s.leadsReady, 'websiteHealthScoreService'),
    c('event_collection', 'Event collection', trackingActive, 'integrationHealthService'),
    c('lead_capture', 'Lead Capture', s.leadsReady, 'activationReadinessService'),
    c('forms', 'Forms', (cats.form_health ?? 0) >= 50 || s.leadsReady, 'formIntelligenceService'),
    c('cms', 'CMS', hasCms, 'integrationService'),
    c('publishing', 'Publishing', Number(s.healthSummary?.failed_publish_count ?? 0) === 0, 'integrationHealthService'),
    c('webhooks', 'Webhooks', hasWebhook, 'integrationService'),
    c('repository', 'Repository', s.leadsReady, 'leadIntelligenceRepository'),
    c('lead_intelligence', 'Lead Intelligence', s.leadsReady, 'leadIntelligenceReadService'),
    c('website_intelligence', 'Website Intelligence', !!s.score, 'websiteHealthScoreService'),
    c('marketpulse', 'MarketPulse', s.signals.length >= 0, 'websiteIntelligenceService'),
    c('reports', 'Reports', !!s.score, 'websiteDashboardService'),
    c('intelligence_freshness', 'Intelligence freshness', fresh, 'websiteHealthScoreService'),
    c('recommendation_engine', 'Recommendation engine', modules.some((m) => m.key === 'website_intelligence' && m.available), 'websiteIntelligenceRepository'),
  ];
  return { checks, passed: checks.filter((x) => x.ok).length, total: checks.length };
}

function buildSummary(s: Sources, modules: IntelligenceModule[], recommendations: WebsiteRecommendation[]): WebsiteIntelligenceSnapshot['summary'] {
  const composite = Number(s.score?.composite_score ?? 0);
  const sigAt = s.signals.length ? (s.signals[0]?.generated_at ?? null) : null;
  const lastIntel = s.score?.computed_at ?? sigAt ?? s.readiness?.generatedAt ?? null;
  const sectionKeys = ['website_intelligence', 'seo', 'content_analysis', 'technical', 'performance', 'accessibility', 'brand', 'competitive', 'tracking', 'lead_capture', 'forms', 'cms', 'publishing', 'campaign_readiness', 'content_readiness', 'marketing_readiness', 'lead_readiness', 'repository'];
  const byKey = new Map(modules.map((mod) => [mod.key, mod]));
  const lead = byKey.get('lead_readiness');
  const sections: SummarySection[] = sectionKeys.map((k) => {
    const mod = byKey.get(k) ?? (k === 'lead_capture' ? lead : undefined);
    return { key: k, label: mod?.label ?? k, status: mod?.status ?? 'unavailable', source: mod?.source ?? '—', lastUpdated: mod?.lastUpdated ?? null };
  });
  return {
    overallScore: composite,
    executiveSummary: `Overall website score ${Math.round(composite)}/100 across ${modules.filter((mm) => mm.available).length} available intelligence modules.`,
    sections,
    topRisks: Array.isArray(s.score?.issues) ? s.score.issues.slice(0, 5).map((i: any) => ({ key: i.key, severity: i.severity })) : [],
    topOpportunities: Array.isArray(s.score?.improvement_priorities) ? s.score.improvement_priorities.slice(0, 5) : [],
    recommendedActions: recommendations.slice(0, 8),
    lastCrawl: null,
    lastScan: null,
    lastIntelligenceUpdate: lastIntel,
  };
}

function engineConfidence(s: Sources): number {
  const cs = [s.content.confidence, s.technical.confidence, s.accessibility.confidence, s.brand.confidence].filter((c) => c > 0);
  return cs.length ? Math.round((cs.reduce((a, b) => a + b, 0) / cs.length) * 100) / 100 : 0;
}

/**
 * Phase 21B — delegates to the Platform Executive Engine. Website supplies its modules +
 * recommendations + business-impact aggregate; the platform builds the summary identically.
 */
function buildExecutiveSummary(s: Sources, modules: IntelligenceModule[], recommendations: WebsiteRecommendation[], health: WebsiteIntelligenceSnapshot['health'], lastIntel: string | null): WebsiteExecutiveSummary {
  return platformBuildExecutiveSummary<ImpactDimension>({
    entityLabel: 'Website',
    score: Number(s.score?.composite_score ?? 0),
    overallStatus: health?.overall ?? 'disconnected',
    modules,
    recommendations,
    businessImpact: aggregateBusinessImpact(recommendations.map((r) => r.impact)),
    confidence: engineConfidence(s),
    lastIntelligenceUpdate: lastIntel,
  });
}

/**
 * Phase F — report projection. Pure projection of already-built modules + summary +
 * recommendations + executive summary + business impact. ZERO calculations of its own.
 */
function buildReport(s: Sources, modules: IntelligenceModule[], summary: WebsiteIntelligenceSnapshot['summary'], recommendations: WebsiteRecommendation[], health: WebsiteIntelligenceSnapshot['health'], executive: WebsiteExecutiveSummary): WebsiteReport {
  const sections = modules.map((m) => ({ key: m.key, label: m.label, status: m.status, source: m.source, lastUpdated: m.lastUpdated, confidence: undefined }));
  const quickWins = recommendations.filter((r) => r.category === 'quick_win');
  const criticalIssues = recommendations.filter((r) => r.category === 'critical');
  const overallReadiness: 'ready' | 'partial' | 'not_ready' = summary.overallScore >= 75 ? 'ready' : summary.overallScore >= 50 ? 'partial' : 'not_ready';
  // 30/60/90-day roadmap (Phase 21B) — delegated to the Platform Roadmap Engine.
  const roadmap = platformBuildRoadmap<ImpactDimension>(recommendations);
  return {
    executiveSummary: executive.headline,
    executive,
    businessImpact: executive.businessImpact,
    overallScore: summary.overallScore,
    overallHealth: health?.overall ?? 'disconnected',
    overallReadiness,
    activation: !!s.readiness?.activated,
    sections,
    recommendations,
    priorities: recommendations.slice(0, 8),
    quickWins,
    criticalIssues,
    roadmap,
    confidence: executive.confidence,
    freshness: { lastIntelligenceUpdate: summary.lastIntelligenceUpdate, stale: !summary.lastIntelligenceUpdate },
  };
}

// ---- public read surface -----------------------------------------------------
function assembleSnapshot(companyId: string, websiteId: string | null | undefined, s: Sources): WebsiteIntelligenceSnapshot {
  const modules = buildModules(s);
  const recommendations = buildRecommendations(s);
  const health = buildHealth(s);
  const summary = buildSummary(s, modules, recommendations);
  const executiveSummary = buildExecutiveSummary(s, modules, recommendations, health, summary.lastIntelligenceUpdate);
  return {
    companyId,
    websiteId: s.website?.id ?? (websiteId ?? null),
    website: s.website,
    generatedAt: new Date().toISOString(),
    health,
    readiness: s.readiness ? { activated: !!s.readiness.activated, generatedAt: s.readiness.generatedAt ?? null, checks: s.readiness.checks ?? [] } : null,
    tracking: buildTracking(s),
    signals: s.signals.map((sig: any) => ({ signalKey: sig.signal_key, type: sig.type, severity: sig.severity, confidence: Number(sig.confidence ?? 0), recommendation: sig.recommendation ?? '', generatedAt: sig.generated_at ?? null })),
    integrations: buildIntegrations(s),
    diagnostics: buildDiagnostics(s),
    domain: s.domain ? { finalDomain: s.domain.final_domain, verificationStatus: s.domain.verification_status, verified: !!s.domain.verified, verifiedAt: s.domain.verified_at } : null,
    modules,
    intelligence: { content: s.content, technical: s.technical, accessibility: s.accessibility, brand: s.brand },
    recommendations,
    validation: buildValidation(s, modules),
    summary,
    executiveSummary,
    report: buildReport(s, modules, summary, recommendations, health, executiveSummary),
  };
}

export async function getWebsiteSnapshot(companyId: string, websiteId?: string | null): Promise<WebsiteIntelligenceSnapshot> {
  return assembleSnapshot(companyId, websiteId, await loadSources(companyId, websiteId));
}

/**
 * Phase A — the single canonical website report snapshot every report consumes.
 * (Alias of getWebsiteSnapshot, named per the consolidation spec so the contract is explicit.)
 */
export async function buildCanonicalWebsiteReportSnapshot(companyId: string, websiteId?: string | null): Promise<WebsiteIntelligenceSnapshot> {
  return getWebsiteSnapshot(companyId, websiteId);
}

// Granular accessors (each reuses the same composed sources; UI should prefer the snapshot).
export async function getWebsiteHealth(companyId: string, websiteId?: string | null) { return buildHealth(await loadSources(companyId, websiteId)); }
export async function getWebsiteReadiness(companyId: string, websiteId?: string | null) { const s = await loadSources(companyId, websiteId); return s.readiness; }
export async function getWebsiteSignals(companyId: string, websiteId?: string | null) { const s = await loadSources(companyId, websiteId); return s.signals; }
export async function getWebsiteTracking(companyId: string, websiteId?: string | null) { return buildTracking(await loadSources(companyId, websiteId)); }
export async function getWebsiteIntegrations(companyId: string, websiteId?: string | null) { return buildIntegrations(await loadSources(companyId, websiteId)); }
export async function getWebsiteDiagnostics(companyId: string, websiteId?: string | null) { return buildDiagnostics(await loadSources(companyId, websiteId)); }
export async function getWebsiteIntelligence(companyId: string, websiteId?: string | null) { return buildModules(await loadSources(companyId, websiteId)); }
export async function getWebsiteRecommendations(companyId: string, websiteId?: string | null) { return buildRecommendations(await loadSources(companyId, websiteId)); }
export async function getWebsiteValidation(companyId: string, websiteId?: string | null) { const s = await loadSources(companyId, websiteId); return buildValidation(s, buildModules(s)); }
export async function getWebsiteSummary(companyId: string, websiteId?: string | null) { const s = await loadSources(companyId, websiteId); const m = buildModules(s); return buildSummary(s, m, buildRecommendations(s)); }
export async function getWebsiteContentIntelligence(companyId: string) { return evaluateContentIntelligence(companyId); }
export async function getWebsiteTechnicalIntelligence(companyId: string) { return evaluateTechnicalIntelligence(companyId); }
export async function getWebsiteAccessibilityIntelligence(companyId: string) { return evaluateAccessibilityIntelligence(companyId); }
export async function getWebsiteBrandIntelligence(companyId: string) { return evaluateBrandIntelligence(companyId); }
export async function getWebsiteReport(companyId: string, websiteId?: string | null): Promise<WebsiteReport> {
  const s = await loadSources(companyId, websiteId);
  const m = buildModules(s); const recs = buildRecommendations(s); const h = buildHealth(s);
  const summary = buildSummary(s, m, recs);
  const exec = buildExecutiveSummary(s, m, recs, h, summary.lastIntelligenceUpdate);
  return buildReport(s, m, summary, recs, h, exec);
}
export async function getWebsiteExecutiveSummary(companyId: string, websiteId?: string | null): Promise<WebsiteExecutiveSummary> {
  const s = await loadSources(companyId, websiteId);
  const m = buildModules(s); const recs = buildRecommendations(s);
  return buildExecutiveSummary(s, m, recs, buildHealth(s), buildSummary(s, m, recs).lastIntelligenceUpdate);
}

/** Fail-open report projection for report composers — never throws (returns null on error). */
export async function getWebsiteReportSafe(companyId: string, websiteId?: string | null): Promise<WebsiteReport | null> {
  try { return await getWebsiteReport(companyId, websiteId); } catch { return null; }
}

/** Phase 20 — the single presentation model (React + HTML both consume this). */
export async function getWebsitePresentationModel(companyId: string, websiteId?: string | null) {
  const { buildWebsitePresentationModel } = await import('./websitePresentationModel');
  return buildWebsitePresentationModel(await getWebsiteSnapshot(companyId, websiteId));
}

/** Phase 20 — thin HTML adapter for the legacy report generator; renders the same model. */
export async function getWebsiteIntelligenceHtml(companyId: string, websiteId?: string | null): Promise<string> {
  const { buildWebsitePresentationModel } = await import('./websitePresentationModel');
  const { renderWebsiteIntelligenceHtml } = await import('./websiteIntelligenceHtmlRenderer');
  return renderWebsiteIntelligenceHtml(buildWebsitePresentationModel(await getWebsiteSnapshot(companyId, websiteId)));
}
