/**
 * Canonical Engine Registrations  (BETA-ARCH-001, Phase 5)
 *
 * Registers every in-scope Authority-platform intelligence engine (per BETA-AUDIT-004) with the
 * Evidence Registry. This is PURE METADATA — it imports no engine implementations and changes no
 * engine behaviour. `typicalMaturity` records each engine's honest default evidence classification
 * (from the BETA-AUDIT-004 findings), so consumers can reason about trust without re-deriving it.
 *
 * `registerAllEngines()` is idempotent and safe to call multiple times.
 */
import { registerEngine, type EngineRegistration } from './evidenceRegistry';

const REGISTRATIONS: EngineRegistration[] = [
  // ── Website Intelligence quartet (deterministic, crawl-based, honest-null) ──
  {
    engineId: 'website.technical', engineName: 'Technical Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'technical_score', label: 'Technical score', typicalMaturity: 'CALCULATED', unit: 'score_0_100' },
      { key: 'indexability', label: 'Indexability', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'meta_tags', label: 'Meta title + description', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'internal_linking', label: 'Internal linking', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'canonical_tags', label: 'Canonical tags', typicalMaturity: 'NOT_EVALUABLE' },
      { key: 'structured_data', label: 'Structured data', typicalMaturity: 'NOT_EVALUABLE' },
    ],
    capabilities: ['deterministic', 'crawl_based', 'honest_null', 'no_llm'],
    dependencies: ['canonical_pages', 'website_health_scores'],
    consumers: ['website.repository', 'snapshotReportService', 'engineEvidenceNarrative'],
  },
  {
    engineId: 'website.content', engineName: 'Content Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'content_score', label: 'Content score', typicalMaturity: 'CALCULATED', unit: 'score_0_100' },
      { key: 'readability', label: 'Readability', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'content_depth', label: 'Content depth', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'conversion_copy', label: 'Conversion copy', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
    ],
    capabilities: ['deterministic', 'crawl_based', 'honest_null', 'no_llm'],
    dependencies: ['canonical_pages', 'page_content'],
    consumers: ['website.repository', 'snapshotReportService', 'engineEvidenceNarrative'],
  },
  {
    engineId: 'website.accessibility', engineName: 'Accessibility Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'accessibility_score', label: 'Accessibility score', typicalMaturity: 'CALCULATED', unit: 'score_0_100' },
      { key: 'heading_hierarchy', label: 'Heading hierarchy', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
      { key: 'contrast', label: 'Colour contrast', typicalMaturity: 'NOT_EVALUABLE' },
      { key: 'alt_text', label: 'Image alt text', typicalMaturity: 'NOT_EVALUABLE' },
    ],
    capabilities: ['deterministic', 'crawl_based', 'honest_null', 'no_llm', 'coverage_limited'],
    dependencies: ['canonical_pages', 'page_content', 'page_links'],
    consumers: ['website.repository', 'snapshotReportService', 'engineEvidenceNarrative'],
  },
  {
    engineId: 'website.brand', engineName: 'Brand Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'brand_score', label: 'Brand score', typicalMaturity: 'CALCULATED', unit: 'score_0_100' },
      { key: 'brand_trust', label: 'Brand trust', typicalMaturity: 'INFERRED', unit: 'score_0_100' },
      { key: 'brand_authority', label: 'Brand authority', typicalMaturity: 'INFERRED', unit: 'score_0_100' },
      { key: 'messaging_consistency', label: 'Messaging consistency', typicalMaturity: 'MEASURED', unit: 'score_0_100' },
    ],
    capabilities: ['deterministic', 'honest_null', 'no_llm', 'sparse_community_dependent'],
    dependencies: ['brand_identity', 'community_signals', 'canonical_pages'],
    consumers: ['website.repository', 'snapshotReportService', 'engineEvidenceNarrative'],
  },
  {
    engineId: 'website.repository', engineName: 'Website Intelligence Repository', version: '1.0.0',
    supportedEvidence: [{ key: 'website_snapshot', label: 'Website intelligence snapshot', typicalMaturity: 'DERIVED' }],
    capabilities: ['orchestrator', 'deterministic'],
    dependencies: ['website.technical', 'website.content', 'website.accessibility', 'website.brand'],
    consumers: ['snapshotReportService'],
  },
  // ── Crawl / SEO / GEO decision engines ──
  {
    engineId: 'crawl.public_domain_audit', engineName: 'Public Domain Audit', version: '1.0.0',
    supportedEvidence: [
      { key: 'positioning_decisions', label: 'Positioning / structure decisions', typicalMaturity: 'DERIVED' },
      { key: 'geo_aeo_context', label: 'GEO/AEO context', typicalMaturity: 'INFERRED' },
    ],
    capabilities: ['deterministic', 'crawl_based', 'no_llm', 'hardcoded_confidence'],
    dependencies: ['canonical_pages', 'page_content', 'page_links'],
    consumers: ['decisionObjectService', 'snapshotReportService'],
  },
  {
    engineId: 'seo', engineName: 'SEO Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'impression_click_gap', label: 'Impression→click gap', typicalMaturity: 'MEASURED' },
      { key: 'ranking_opportunity', label: 'Ranking opportunity', typicalMaturity: 'MEASURED' },
      { key: 'keyword_decay', label: 'Keyword decay', typicalMaturity: 'CALCULATED' },
    ],
    capabilities: ['deterministic', 'gsc_backed', 'no_llm', 'hardcoded_confidence'],
    dependencies: ['canonical_keywords', 'keyword_metrics', 'google_search_console'],
    consumers: ['decisionObjectService', 'snapshotReportService'],
  },
  {
    engineId: 'geo', engineName: 'Geo Intelligence', version: '1.0.0',
    supportedEvidence: [{ key: 'geo_opportunity', label: 'Geo opportunity', typicalMaturity: 'MEASURED' }],
    capabilities: ['deterministic', 'analytics_backed', 'no_llm', 'hardcoded_confidence'],
    dependencies: ['canonical_sessions'],
    consumers: ['decisionObjectService'],
  },
  {
    engineId: 'geo.strategy', engineName: 'Geo Strategy Intelligence', version: '1.0.0',
    supportedEvidence: [{ key: 'geo_expansion_opportunity', label: 'Geo expansion', typicalMaturity: 'MEASURED' }],
    capabilities: ['deterministic', 'analytics_backed', 'gsc_backed', 'no_llm', 'hardcoded_confidence'],
    dependencies: ['canonical_sessions', 'keyword_metrics'],
    consumers: ['decisionObjectService'],
  },
  // ── Competitor Intelligence ──
  {
    engineId: 'competitor.engine', engineName: 'Competitor Engine', version: '1.0.0',
    supportedEvidence: [
      { key: 'relevance_score', label: 'Relevance score', typicalMaturity: 'CALCULATED' },
      { key: 'authority_score', label: 'Authority score', typicalMaturity: 'INFERRED' },
      { key: 'market_alternatives', label: 'Market alternatives', typicalMaturity: 'SYNTHETIC' },
    ],
    capabilities: ['deterministic', 'no_llm', 'fallback_flagged', 'hardcoded_confidence'],
    dependencies: ['company_profile', 'competitor_enrichment_knowledge'],
    consumers: ['reportCompetitorIntelligenceService', 'unifiedCompetitorIntelligenceService'],
  },
  {
    engineId: 'competitor.discovery', engineName: 'Competitor Discovery Engine', version: '1.0.0',
    supportedEvidence: [{ key: 'discovered_competitors', label: 'Discovered competitors', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'gsc_backed', 'no_llm', 'fallback_flagged'],
    dependencies: ['company_profile', 'google_search_console'],
    consumers: ['reportCompetitorIntelligenceService'],
  },
  {
    engineId: 'competitor.report', engineName: 'Report Competitor Intelligence', version: '1.0.0',
    supportedEvidence: [{ key: 'competitor_intelligence', label: 'Competitor intelligence', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'no_llm', 'fallback_flagged', 'sync_and_active_modes'],
    dependencies: ['competitor.engine', 'competitor.discovery', 'analytics_serp_results'],
    consumers: ['snapshotReportService'],
  },
  {
    engineId: 'competitor.unified', engineName: 'Unified Competitor Intelligence', version: '1.0.0',
    supportedEvidence: [{ key: 'unified_competitor_view', label: 'Unified competitor view', typicalMaturity: 'MEASURED' }],
    capabilities: ['deterministic', 'serp_backed', 'no_llm', 'honest_status'],
    dependencies: ['analytics_serp_results', 'company_profile'],
    consumers: ['analyticsEnterpriseSnapshotService'],
  },
  // ── Authority / Content / Decision ──
  {
    engineId: 'authority', engineName: 'Authority Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'backlink_gap', label: 'Backlink gap', typicalMaturity: 'INFERRED' },
      { key: 'authority_deficit', label: 'Authority deficit', typicalMaturity: 'INFERRED' },
    ],
    capabilities: ['deterministic', 'no_llm', 'inferred_authority', 'no_backlink_api', 'hardcoded_confidence'],
    dependencies: ['canonical_backlink_signals'],
    consumers: ['decisionObjectService', 'snapshotReportService'],
  },
  {
    engineId: 'authority.backlink', engineName: 'Backlink Authority Intelligence', version: '1.0.0',
    supportedEvidence: [
      { key: 'weak_backlink_profile', label: 'Weak backlink profile', typicalMaturity: 'INFERRED' },
      { key: 'anchor_diversity', label: 'Anchor diversity', typicalMaturity: 'MEASURED' },
    ],
    capabilities: ['deterministic', 'no_llm', 'inferred_authority', 'no_backlink_api', 'data_driven_impact'],
    dependencies: ['canonical_backlink_signals'],
    consumers: ['decisionObjectService', 'snapshotReportService'],
  },
  {
    engineId: 'authority.content', engineName: 'Content Authority', version: '1.0.0',
    supportedEvidence: [
      { key: 'weak_content_depth', label: 'Weak content depth', typicalMaturity: 'MEASURED' },
      { key: 'topic_gap', label: 'Topic gap', typicalMaturity: 'MEASURED' },
    ],
    capabilities: ['deterministic', 'crawl_based', 'no_llm', 'fully_measured', 'data_driven_impact'],
    dependencies: ['canonical_pages', 'page_content', 'page_links', 'canonical_keywords'],
    consumers: ['decisionObjectService', 'snapshotReportService'],
  },
  {
    engineId: 'content.cluster', engineName: 'Content Cluster', version: '1.0.0',
    supportedEvidence: [{ key: 'cluster_gap', label: 'Cluster gap', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'no_llm', 'external_signal_derived', 'hardcoded_confidence'],
    dependencies: ['intelligence_signals', 'signal_clusters'],
    consumers: ['decisionObjectService'],
  },
  {
    engineId: 'decision.object', engineName: 'Decision Object Service', version: '1.0.0',
    supportedEvidence: [{ key: 'persisted_decision', label: 'Persisted decision', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'persistence', 'no_llm'],
    dependencies: [],
    consumers: ['decision.composer', 'snapshotReportService'],
  },
  {
    engineId: 'decision.composer', engineName: 'Decision Composer', version: '1.0.0',
    supportedEvidence: [{ key: 'composed_intelligence', label: 'Composed decision intelligence', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'orchestrator', 'no_llm'],
    dependencies: ['decision.object'],
    consumers: ['snapshotReportService'],
  },
  {
    engineId: 'decision.intelligence', engineName: 'Decision Intelligence Engine', version: '1.0.0',
    supportedEvidence: [{ key: 'decision_intelligence', label: 'Cross-domain decision intelligence', typicalMaturity: 'DERIVED' }],
    capabilities: ['deterministic', 'orchestrator', 'no_llm'],
    dependencies: [],
    consumers: [],
  },
];

let registered = false;

/** Idempotently register every in-scope engine. Pure metadata; safe to call repeatedly. */
export function registerAllEngines(): EngineRegistration[] {
  if (!registered) {
    for (const reg of REGISTRATIONS) registerEngine(reg);
    registered = true;
  }
  return REGISTRATIONS;
}

/** The canonical registration list (for docs/inspection without mutating the registry). */
export const CANONICAL_ENGINE_REGISTRATIONS = REGISTRATIONS;
