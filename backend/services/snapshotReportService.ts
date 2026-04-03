import {
  composeDecisionIntelligence,
  type ComposedDecisionInsight,
} from './decisionComposerService';
import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import type { ReportReadinessResult } from './reportReadinessService';
import type { ResolvedReportInput } from './reportInputResolver';
import { impactScore, rankByImpactConfidence } from './reportDecisionUtils';
import {
  buildCompetitorIntelligence,
  buildCompetitorIntelligenceActive,
  competitorGapsToDecisions,
  type CompetitorIntelligenceResult,
} from './reportCompetitorIntelligenceService';
import { buildPublicDomainAuditDecisions } from './publicDomainAuditService';
import {
  synthesizePrimaryNarrative,
  type PrimaryNarrative,
} from './primaryNarrativeService';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';
import {
  buildExpectedUpside,
  classifyPriorityType,
  comparePriorityType,
  type PriorityType,
} from './actionPriorityService';
import { buildReportScoreModel } from './reportScoreModelService';

const SNAPSHOT_MIN_INSIGHTS = 3;
const SNAPSHOT_MIN_ACTIONS = 2;

type SignalAvailabilityLevel = 'NO_DATA' | 'LOW_DATA' | 'NORMAL';
type SnapshotSignalKey =
  | 'content_coverage'
  | 'seo_structure'
  | 'authority'
  | 'competitor'
  | 'geo_relevance';

type SnapshotInsight = {
  decision_id: string;
  title: string;
  description: string;
  why_it_matters: string;
  business_impact: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
};

type SnapshotOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

type SnapshotAction = {
  decision_id: string;
  title: string;
  recommendation: string;
  steps: string[];
  expected_outcome: string;
  expected_upside: string;
  effort_level: 'low' | 'medium' | 'high';
  priority_type: PriorityType;
  impact_score: number;
  confidence_score: number;
  action_type: string;
  action_payload: Record<string, unknown>;
};

type SnapshotTopPriority = {
  title: string;
  why_now: string;
  expected_outcome: string;
  expected_upside: string;
  effort_level: 'low' | 'medium' | 'high';
  priority_type: PriorityType;
  impact_score: number;
  confidence_score: number;
};

export interface SnapshotReportSection {
  section_name: string;
  IU_ids: string[];
  insights: SnapshotInsight[];
  opportunities: SnapshotOpportunity[];
  actions: SnapshotAction[];
}

export interface SnapshotReport {
  report_type: 'snapshot';
  score: ReturnType<typeof buildReportScoreModel>;
  diagnosis: string;
  summary: string;
  primary_problem: string;
  secondary_problems: string[];
  seo_executive_summary: {
    overall_health_score: number;
    primary_problem: {
      title: string;
      impacted_area: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linked_visual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    growth_opportunity: {
      title: string;
      estimated_upside: string;
      based_on: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  geo_aeo_visuals: {
    ai_answer_presence_radar: {
      answer_coverage_score: number | null;
      entity_clarity_score: number | null;
      topical_authority_score: number | null;
      citation_readiness_score: number | null;
      content_structure_score: number | null;
      freshness_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength: 'strong' | 'inferred' | 'weak' | 'missing';
      source_tags: string[] | null;
    };
    query_answer_coverage_map: {
      queries: Array<{
        query: string;
        coverage: 'full' | 'partial' | 'missing';
        answer_quality_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
    answer_extraction_funnel: {
      total_queries: number | null;
      answerable_content_pct: number | null;
      structured_content_pct: number | null;
      citation_ready_pct: number | null;
      confidence: 'high' | 'medium' | 'low';
      drop_off_reason_distribution: {
        answer_gap_pct: number | null;
        structure_gap_pct: number | null;
        citation_gap_pct: number | null;
      };
    };
    entity_authority_map: {
      entities: Array<{
        entity: string;
        relevance_score: number;
        coverage_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
  };
  geo_aeo_executive_summary: {
    overall_ai_visibility_score: number;
    primary_gap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linked_visual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    visibility_opportunity: {
      title: string;
      estimated_ai_exposure: string;
      based_on: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  unified_intelligence_summary: {
    unified_score: number;
    market_context_summary: string;
    dominant_growth_channel: 'seo' | 'geo_aeo' | 'balanced';
    primary_constraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_unified_actions: Array<{
      action_title: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    growth_direction: {
      short_term_focus: string;
      long_term_focus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
  competitor_visuals: {
    competitor_positioning_radar: {
      competitors: Array<{
        name: string;
        domain: string;
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      }>;
      user: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      confidence: 'high' | 'medium' | 'low';
    };
    keyword_gap_analysis: {
      missing_keywords: string[];
      weak_keywords: string[];
      strong_keywords: string[];
      confidence: 'high' | 'medium' | 'low';
    };
    ai_answer_gap_analysis: {
      missing_answers: string[];
      weak_answers: string[];
      strong_answers: string[];
      confidence: 'high' | 'medium' | 'low';
    };
  };
  competitor_intelligence_summary: {
    top_competitor: string;
    competitor_explanation: string;
    primary_gap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    competitive_position: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  visual_intelligence: {
    seo_capability_radar: {
      technical_seo_score: number | null;
      keyword_research_score: number | null;
      rank_tracking_score: number | null;
      backlinks_score: number | null;
      competitor_intelligence_score: number | null;
      content_quality_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength: {
        technical_seo_score: 'strong' | 'inferred' | 'weak' | 'missing';
        keyword_research_score: 'strong' | 'inferred' | 'weak' | 'missing';
        rank_tracking_score: 'strong' | 'inferred' | 'weak' | 'missing';
        backlinks_score: 'strong' | 'inferred' | 'weak' | 'missing';
        competitor_intelligence_score: 'strong' | 'inferred' | 'weak' | 'missing';
        content_quality_score: 'strong' | 'inferred' | 'weak' | 'missing';
      };
      source_tags: {
        technical_seo_score: string[] | null;
        keyword_research_score: string[] | null;
        rank_tracking_score: string[] | null;
        backlinks_score: string[] | null;
        competitor_intelligence_score: string[] | null;
        content_quality_score: string[] | null;
      };
    };
    opportunity_coverage_matrix: {
      opportunities: Array<{
        keyword: string;
        opportunity_score: number;
        coverage_score: number;
        opportunity_value_score: number | null;
        priority_bucket: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence: 'high' | 'medium' | 'low';
      }>;
      confidence: 'high' | 'medium' | 'low';
      opportunity_reasoning: string;
    };
    search_visibility_funnel: {
      impressions: number | null;
      clicks: number | null;
      ctr: number | null;
      estimated_lost_clicks: number | null;
      confidence: 'high' | 'medium' | 'low';
      drop_off_reason_distribution: {
        ranking_issue_pct: number | null;
        ctr_issue_pct: number | null;
        intent_mismatch_pct: number | null;
      };
    };
    crawl_health_breakdown: {
      metadata_issues: number | null;
      structure_issues: number | null;
      internal_link_issues: number | null;
      crawl_depth_issues: number | null;
      confidence: 'high' | 'medium' | 'low';
      severity_split: {
        critical: number | null;
        moderate: number | null;
        low: number | null;
        classification: 'classified' | 'unclassified';
      };
    };
  };
  signal_availability: Record<SnapshotSignalKey, SignalAvailabilityLevel>;
  company_context: {
    company_name: string | null;
    domain: string | null;
    homepage_headline: string | null;
    tagline: string | null;
    primary_offering: string | null;
    positioning: string | null;
    market_context: string | null;
    positioning_strength: PositioningStrength;
    positioning_narrative: string;
    positioning_gap: string | null;
    market_type: MarketType;
    market_narrative: string;
    strategy_alignment: string;
    market_position: 'below market' | 'at parity' | 'ahead';
    market_position_statement: string;
    position_implication: string;
    execution_risk: string;
    resilience_guidance: string;
  };
  competitor_intelligence: CompetitorIntelligenceResult;
  decision_snapshot: {
    primary_focus_area: string;
    whats_broken: string;
    what_to_fix_first: string;
    what_to_delay: string;
    if_ignored: string;
    execution_sequence: string[];
    if_executed_well: string;
    when_to_expect_impact: {
      short_term: string;
      mid_term: string;
      long_term: string;
    };
    impact_scale: 'high_impact' | 'medium_impact' | 'foundational_impact';
    current_state: string;
    expected_state: string;
    outcome_confidence: 'high' | 'medium' | 'low';
  };
  top_priorities: SnapshotTopPriority[];
  pipeline_audit: {
    resolver_inputs_present: number;
    snapshot_decisions: number;
    supplemental_growth_decisions: number;
    competitor_gap_decisions_added: number;
    fallback_decisions_added: number;
    final_decisions: number;
    final_insights: number;
    final_actions: number;
  };
  sections: SnapshotReportSection[];
}

type SnapshotReportOptions = {
  resolvedInput?: ResolvedReportInput | null;
  readiness?: ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
};

type SnapshotSectionDefinition = {
  key: 'visibility' | 'content_strength' | 'authority';
  section_name: string;
  IU_ids: string[];
  matches: (decision: PersistedDecisionObject) => boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function averageNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const NARRATIVE_INTENT = {
  unified: 'overall_market_direction',
  competitor: 'why_competitor_wins',
  opportunity: 'why_gap_exists',
} as const;

const SIGNAL_BUCKETS = {
  unified: ['authority_gap', 'visibility_loss', 'content_coverage'],
  competitor: ['authority_comparison', 'content_depth', 'positioning'],
  opportunity: ['keyword_gap', 'missing_pages', 'intent_mismatch'],
} as const;

type NarrativeSection = keyof typeof NARRATIVE_INTENT;
type NarrativeSignal = {
  key: string;
  text: string;
};
type NarrativeContext = {
  usedSignals: Set<string>;
  usedTemplateIds: Set<string>;
};

function createNarrativeContext(): NarrativeContext {
  return {
    usedSignals: new Set<string>(),
    usedTemplateIds: new Set<string>(),
  };
}

const UNIFIED_TEMPLATES = [
  'You are currently {impact} due to {primary_signal}, with additional pressure from {secondary_signal}.',
  '{primary_signal} is driving your current performance, further affected by {secondary_signal}.',
  'Your visibility is being shaped by {primary_signal}, with noticeable influence from {secondary_signal}.',
] as const;

const COMPETITOR_TEMPLATES = [
  '{competitor} is ahead due to stronger {primary_signal}, particularly in {specific_area}.',
  '{competitor} maintains an advantage through better {primary_signal}, especially across {specific_area}.',
  '{competitor} outperforms by leading in {primary_signal}, with clear strength in {specific_area}.',
] as const;

const OPPORTUNITY_TEMPLATES = [
  'This gap exists because {primary_signal}, limiting your ability to capture {intent_type} traffic.',
  '{primary_signal} is creating this gap, reducing your visibility for {intent_type} queries.',
  'The absence of {primary_signal} is restricting your ability to capture {intent_type} demand.',
] as const;

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickTemplate(params: {
  section: NarrativeSection;
  templates: readonly string[];
  context: NarrativeContext;
  seed: string;
}): string {
  if (params.templates.length === 0) return '';
  const startIndex = hashString(params.seed) % params.templates.length;
  for (let offset = 0; offset < params.templates.length; offset += 1) {
    const idx = (startIndex + offset) % params.templates.length;
    const templateId = `${params.section}:${idx}`;
    if (params.context.usedTemplateIds.has(templateId)) continue;
    params.context.usedTemplateIds.add(templateId);
    return params.templates[idx];
  }
  return params.templates[startIndex];
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function compactNarrative(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  const trimmedSecondary = normalized.replace(/,\s*(with|further|especially).*?\.$/i, '.');
  return trimmedSecondary || normalized;
}

function dedupeSentences(text: string): string {
  const fragments = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(fragment);
  }
  return unique.join(' ');
}

function clampNarrativeLength(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  if (normalized.length <= maxChars) return normalized;

  const sentences = normalized
    .split(/[.!?]+\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`));

  const selected: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...selected, sentence].join(' ').trim();
    if (candidate.length > maxChars && selected.length > 0) break;
    if (candidate.length > maxChars && selected.length === 0) {
      selected.push(sentence);
      break;
    }
    selected.push(sentence);
  }

  return selected.join(' ').trim();
}

function hasConcreteSignal(text: string): boolean {
  const measurablePattern = /(\d+\/100|\d+\s*point|\d+%|score|gap|coverage|missing|authority|visibility|pages|intent)/i;
  return measurablePattern.test(text);
}

function validateNarrative(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    text.length < 200 &&
    !normalized.includes('improve seo') &&
    !normalized.includes('optimize') &&
    !normalized.includes('enhance performance') &&
    hasConcreteSignal(text)
  );
}

function getTone(severity: 'critical' | 'moderate' | 'low'): 'strong' | 'balanced' | 'positive' {
  if (severity === 'critical') return 'strong';
  if (severity === 'moderate') return 'balanced';
  return 'positive';
}

function toneImpactWord(tone: 'strong' | 'balanced' | 'positive'): string {
  if (tone === 'strong') return 'losing visibility and falling behind';
  if (tone === 'balanced') return 'experiencing gaps';
  return 'seeing room to improve';
}

function pickNarrativeSignals(params: {
  section: NarrativeSection;
  candidates: NarrativeSignal[];
  context: NarrativeContext;
}): { primary: NarrativeSignal | null; secondary: NarrativeSignal | null } {
  const intent = NARRATIVE_INTENT[params.section];
  const maxSignals = intent ? 2 : 2;
  const preferredKeys = SIGNAL_BUCKETS[params.section];
  const byKey = new Map(params.candidates.map((signal) => [signal.key, signal]));
  const picked: NarrativeSignal[] = [];

  for (const key of preferredKeys) {
    if (picked.length >= maxSignals) break;
    const signal = byKey.get(key);
    if (!signal) continue;
    if (params.context.usedSignals.has(signal.key)) continue;
    picked.push(signal);
  }

  if (picked.length === 0) {
    for (const signal of params.candidates) {
      if (params.context.usedSignals.has(signal.key)) continue;
      picked.push(signal);
      break;
    }
  }

  if (picked.length === 1) {
    for (const signal of params.candidates) {
      if (picked[0]?.key === signal.key) continue;
      if (params.context.usedSignals.has(signal.key)) continue;
      picked.push(signal);
      break;
    }
  }

  if (picked[0]) params.context.usedSignals.add(picked[0].key);
  if (picked[1]) params.context.usedSignals.add(picked[1].key);

  return {
    primary: picked[0] ?? null,
    secondary: picked[1] ?? null,
  };
}

function inferDataSourceStrength(params: {
  available: boolean;
  sourceTags: string[] | null;
  confidence: 'high' | 'medium' | 'low';
  inferred?: boolean;
}): 'strong' | 'inferred' | 'weak' | 'missing' {
  if (!params.available) return 'missing';
  if (params.inferred) return 'inferred';
  if ((params.sourceTags?.includes('GSC') || params.sourceTags?.includes('crawler')) && params.confidence === 'high') {
    return 'strong';
  }
  if (params.confidence === 'low') return 'weak';
  return 'inferred';
}

function uniqueById(decisions: PersistedDecisionObject[]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const decision of decisions) {
    byId.set(decision.id, decision);
  }
  return [...byId.values()];
}

function toInsight(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
): SnapshotInsight {
  return {
    decision_id: decision.id,
    title: personalizeEntityReferences(decision.title, companyContext),
    description: personalizeEntityReferences(decision.description, companyContext),
    why_it_matters: personalizeEntityReferences(buildWhyItMatters(decision), companyContext),
    business_impact: personalizeEntityReferences(buildDecisionBusinessImpact(decision), companyContext),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function toOpportunity(decision: PersistedDecisionObject): SnapshotOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

type CompanyNarrativeContext = {
  companyName: string | null;
  domain: string | null;
  homepageHeadline: string | null;
  tagline: string | null;
  primaryOffering: string | null;
  positioning: string | null;
  marketContext: string | null;
};

type PositioningStrength = 'strong' | 'moderate' | 'weak';
type MarketType = 'competitive' | 'saturated' | 'emerging' | 'niche';
type StrategicContext = {
  positioningStrength: PositioningStrength;
  positioningNarrative: string;
  positioningGap: string | null;
  marketType: MarketType;
  marketNarrative: string;
  keySuccessFactor: string;
  strategyAlignment: string;
  marketPosition: 'below market' | 'at parity' | 'ahead';
  marketPositionStatement: string;
  positionImplication: string;
  executionRisk: string;
  resilienceGuidance: string;
};

function splitCandidates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitCandidates(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const candidates = splitCandidates(value);
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

function extractCompanyNarrativeContext(params: {
  resolvedInput?: ResolvedReportInput | null;
}): CompanyNarrativeContext {
  const profile = params.resolvedInput?.profile;
  const companyName = firstNonEmpty(params.resolvedInput?.resolved.companyName, profile?.name) || null;
  const domain = firstNonEmpty(params.resolvedInput?.resolved.websiteDomain, profile?.website_url)
    ?.replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase() || null;
  const positioning = firstNonEmpty(profile?.brand_positioning, profile?.competitive_advantages);
  const tagline = firstNonEmpty(profile?.unique_value);
  const homepageHeadline = firstNonEmpty(profile?.key_messages, profile?.campaign_focus);
  const primaryOffering = firstNonEmpty(profile?.products_services, profile?.products_services_list);
  const businessType = firstNonEmpty(params.resolvedInput?.resolved.businessType, profile?.category, profile?.industry);
  const geography = firstNonEmpty(params.resolvedInput?.resolved.geography, profile?.geography);
  const marketContext = businessType && geography
    ? `${businessType} in ${geography}`
    : businessType || geography || null;
  return {
    companyName,
    domain,
    homepageHeadline,
    tagline,
    primaryOffering,
    positioning,
    marketContext,
  };
}

function personalizeEntityReferences(text: string, context?: CompanyNarrativeContext): string {
  if (!text || !context) return text;
  let next = text;
  if (context.companyName) {
    next = next.replace(/\bthe business\b/gi, context.companyName);
    next = next.replace(/\bthe brand\b/gi, context.companyName);
  }
  if (context.domain) {
    next = next.replace(/\bthe site\b/gi, context.domain);
    next = next.replace(/\byour site\b/gi, context.domain);
  }
  return next.replace(/\s+/g, ' ').trim();
}

function assessPositioningAndMarket(params: {
  companyContext: CompanyNarrativeContext;
  competitorIntelligence: CompetitorIntelligenceResult;
  decisions: PersistedDecisionObject[];
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
}): StrategicContext {
  const companyName = params.companyContext.companyName || params.companyContext.domain || 'The company';
  const positioningLabel = params.companyContext.positioning || params.companyContext.tagline || params.companyContext.homepageHeadline || 'its core market promise';
  const claritySignals = [
    params.companyContext.positioning,
    params.companyContext.tagline,
    params.companyContext.homepageHeadline,
    params.companyContext.primaryOffering,
  ].filter(Boolean).length;
  const consistencyPenalties = params.decisions.filter((decision) =>
    /(content_gap|weak_content_depth|missing_supporting_content|trust_gap|weak_brand_presence|competitor_dominance)/.test(decision.issue_type),
  ).length;
  const competitorPressure = average(
    (params.competitorIntelligence.generated_gaps ?? []).slice(0, 3).map((gap) => Number(gap.impact_score ?? 0)),
  );
  const fallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const differentiationPenalty = fallbackUsed ? 8 : competitorPressure >= 70 ? 22 : competitorPressure >= 50 ? 14 : 6;
  const rawStrengthScore = clamp((claritySignals * 22) + (40 - Math.min(consistencyPenalties * 5, 25)) - differentiationPenalty, 0, 100);
  const positioningStrength: PositioningStrength =
    rawStrengthScore >= 70 ? 'strong' : rawStrengthScore >= 45 ? 'moderate' : 'weak';

  const positioningNarrative =
    `${companyName}'s positioning as ${positioningLabel} is currently ${positioningStrength}, because clarity signals ${claritySignals >= 3 ? 'are visible' : 'are limited'} and cross-page reinforcement is ${consistencyPenalties <= 2 ? 'mostly consistent' : 'fragmented'}.`;
  const positioningGap = positioningStrength === 'weak'
    ? 'This positioning is not consistently reinforced in buyer-stage content and proof-led decision pages.'
    : positioningStrength === 'moderate'
      ? 'Positioning exists but is inconsistently reinforced in comparison and decision-stage content.'
      : null;

  const competitorCount = params.competitorIntelligence.detected_competitors.length;
  const marketType: MarketType =
    competitorCount >= 3 && competitorPressure >= 68
      ? 'saturated'
      : competitorCount >= 2
        ? 'competitive'
        : params.publicAudit?.site_structure.blog_pages.length
          ? 'niche'
          : 'emerging';

  const keySuccessFactor =
    marketType === 'saturated'
      ? 'differentiated proof and authority depth'
      : marketType === 'competitive'
        ? 'consistent positioning plus stronger comparison-page coverage'
        : marketType === 'niche'
          ? 'focused relevance in core intent clusters'
          : 'early category ownership through clear positioning and coverage';
  const marketNarrative = `This market is ${marketType}, where ${keySuccessFactor} determines visibility.`;

  const strategyAlignment =
    positioningStrength === 'weak' && (marketType === 'saturated' || marketType === 'competitive')
      ? `Prioritize positioning clarity and proof architecture for ${companyName} before broad expansion.`
      : positioningStrength === 'strong' && (marketType === 'emerging' || marketType === 'niche')
        ? `Leverage ${companyName}'s clear positioning to expand coverage faster in core demand clusters.`
        : `Sequence positioning reinforcement with demand-capture execution so ${companyName} improves visibility without diluting differentiation.`;

  const competitorDeltas = (params.competitorIntelligence.comparison?.competitors ?? [])
    .map((item) => item.deltas_vs_company)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((delta) => average([
      Number(delta.authority_score ?? 0),
      Number(delta.seo_coverage ?? 0),
      Number(delta.content_depth ?? 0),
    ]));
  const avgDelta = competitorDeltas.length > 0 ? average(competitorDeltas) : competitorPressure - 50;
  const marketPosition: 'below market' | 'at parity' | 'ahead' =
    avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity';
  const marketPositionStatement = `${companyName} is currently ${marketPosition} relative to competitors in this market.`;
  const positionImplication =
    marketPosition === 'below market'
      ? 'If unchanged, this position will limit ability to compete for high-intent queries and reduce qualified demand capture.'
      : marketPosition === 'at parity'
        ? 'If unchanged, this position will maintain baseline visibility but make it hard to outpace stronger competitors in decision-stage queries.'
        : 'If unchanged, this position can hold near-term advantage, but weak reinforcement could erode lead as competitors increase depth.';
  const executionRisk =
    positioningStrength === 'weak'
      ? 'If content depth is not expanded alongside authority work, improvements may remain limited.'
      : marketType === 'saturated'
        ? 'If execution is fragmented across channels, gains will dilute and competitor pressure will outpace progress.'
        : 'If sequencing is inconsistent, visibility gains may appear but conversion lift can remain constrained.';
  const resilienceGuidance =
    'What ensures success: consistent content, authority, and structure alignment executed in the same priority sequence.';

  return {
    positioningStrength,
    positioningNarrative,
    positioningGap,
    marketType,
    marketNarrative,
    keySuccessFactor,
    strategyAlignment,
    marketPosition,
    marketPositionStatement,
    positionImplication,
    executionRisk,
    resilienceGuidance,
  };
}

function toAction(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
  strategicContext?: StrategicContext,
): SnapshotAction {
  const plan = buildActionPlan(decision, companyContext, strategicContext);
  const impact = impactScore(decision);
  const priorityType = classifyPriorityType({
    impactScore: impact,
    effortLevel: plan.effortLevel,
  });
  return {
    decision_id: decision.id,
    title: plan.title,
    recommendation: plan.recommendation,
    steps: plan.steps,
    expected_outcome: plan.expectedOutcome,
    expected_upside: buildExpectedUpside({
      priorityType,
      impactScore: impact,
      actionType: decision.action_type,
      expectedOutcome: plan.expectedOutcome,
    }),
    effort_level: plan.effortLevel,
    priority_type: priorityType,
    impact_score: impact,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}

function resolverInputsPresent(resolvedInput?: ResolvedReportInput | null): number {
  if (!resolvedInput) return 0;

  let count = 0;
  if (resolvedInput.resolved.websiteDomain) count += 1;
  if (resolvedInput.resolved.businessType) count += 1;
  if (resolvedInput.resolved.geography) count += 1;
  if (resolvedInput.resolved.socialLinks.length > 0) count += 1;
  if (resolvedInput.resolved.competitors.length > 0) count += 1;
  return count;
}

function isSeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'seo_gap',
    'ranking_gap',
    'ranking_opportunity',
    'keyword_decay',
    'keyword_opportunity',
    'impression_click_gap',
  ].includes(decision.issue_type);
}

function isContentDecision(decision: PersistedDecisionObject): boolean {
  return [
    'content_gap',
    'topic_gap',
    'weak_content_depth',
    'weak_cluster_depth',
    'missing_cluster_support',
    'missing_supporting_content',
    'competitor_content_gap',
    'competitor_dominance',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'content_strategy';
}

function isAuthorityDecision(decision: PersistedDecisionObject): boolean {
  return [
    'authority_deficit',
    'authority_gap',
    'backlink_gap',
    'weak_backlink_profile',
    'trust_gap',
    'credibility_gap',
    'brand_trust_gap',
    'weak_brand_presence',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type) || ['authority', 'trust'].includes(classifyDecisionType(decision.issue_type));
}

function isGeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'geo_gap',
    'geo_mismatch',
    'geo_opportunity',
    'regional_mismatch',
    'wrong_geo_traffic',
    'localized_content_gap',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'geo';
}

function isCompetitorDecision(decision: PersistedDecisionObject): boolean {
  return [
    'competitor_gap',
    'competitor_dominance',
    'competitor_content_gap',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type);
}

function isOpportunityCandidate(decision: PersistedDecisionObject): boolean {
  const category = classifyDecisionType(decision.issue_type);
  if (category === 'opportunity' || category === 'market' || category === 'authority') return true;
  return impactScore(decision) >= 35 || Number(decision.priority_score ?? 0) >= 50;
}

function describeBusinessContext(resolvedInput?: ResolvedReportInput | null): string {
  const businessType = resolvedInput?.resolved.businessType?.trim();
  const geography = resolvedInput?.resolved.geography?.trim();

  if (businessType && geography) return `${businessType} in ${geography}`;
  if (businessType) return businessType;
  if (geography) return `teams targeting ${geography}`;
  return 'the business';
}

function inferPrimarySurface(decision: PersistedDecisionObject, resolvedInput?: ResolvedReportInput | null): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const keyword = typeof payload.keyword === 'string' ? payload.keyword : null;
  const theme = typeof payload.keyword_theme === 'string' ? payload.keyword_theme : null;
  const domain = resolvedInput?.resolved.websiteDomain || 'your site';

  if (keyword) return `"${keyword}"`;
  if (theme) return `"${theme}"`;
  if (isAuthorityDecision(decision)) return `${domain}'s trust surface`;
  if (isContentDecision(decision)) return `${domain}'s core content coverage`;
  return domain;
}

function signalKeyFromIssueType(issueType: string): string {
  const category = classifyDecisionType(issueType);
  if (category === 'authority' || category === 'trust') return 'authority_signal';
  if (category === 'content_strategy' || category === 'market') return 'content_coverage_signal';
  if (category === 'geo' || category === 'distribution') return 'geo_relevance_signal';
  if (category === 'opportunity') return 'opportunity_gap_signal';
  if (/(keyword|ranking|impression_click_gap|visibility|search)/.test(issueType)) return 'visibility_signal';
  return 'technical_signal';
}

function evidenceSignalFromDecision(decision: PersistedDecisionObject): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
  const keyword =
    (typeof payload.keyword === 'string' && payload.keyword.trim()) ||
    (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) ||
    null;
  const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
  const mentionCount = typeof evidence.mention_count === 'number' ? evidence.mention_count : null;
  const baseSignal = signalKeyFromIssueType(decision.issue_type).replace(/_/g, ' ');

  if (keyword && avgPosition != null) return `${baseSignal}; ${keyword} avg position ${avgPosition.toFixed(1)}`;
  if (keyword && mentionCount != null) return `${baseSignal}; ${keyword} mentions ${mentionCount}`;
  if (keyword) return `${baseSignal}; keyword theme ${keyword}`;
  if (avgPosition != null) return `${baseSignal}; avg position ${avgPosition.toFixed(1)}`;
  if (mentionCount != null) return `${baseSignal}; mention count ${mentionCount}`;
  return baseSignal;
}

function withEvidence(text: string, signal: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return `${compact} This is supported by ${signal}.`;
}

function buildWhyItMatters(decision: PersistedDecisionObject): string {
  const category = classifyDecisionType(decision.issue_type);
  const evidenceSignal = evidenceSignalFromDecision(decision);
  if (category === 'authority' || category === 'trust') {
    return withEvidence(
      'This directly affects whether buyers trust the brand enough to continue toward action.',
      evidenceSignal,
    );
  }
  if (category === 'content_strategy' || category === 'market') {
    return withEvidence(
      'This limits how often the business shows up for high-intent questions and comparison moments.',
      evidenceSignal,
    );
  }
  if (category === 'geo' || category === 'distribution') {
    return withEvidence(
      'This can cause the right audience to miss the offer or see it in the wrong context.',
      evidenceSignal,
    );
  }
  if (category === 'opportunity') {
    return withEvidence(
      'This is one of the clearest near-term gains available without requiring a full strategy reset.',
      evidenceSignal,
    );
  }
  return withEvidence(
    'This is shaping discoverability, buyer confidence, or conversion quality in the near term.',
    evidenceSignal,
  );
}

function inferEffortLevel(decision: PersistedDecisionObject): 'low' | 'medium' | 'high' {
  const effort = Number(decision.effort_score ?? 0);
  if (effort <= 25) return 'low';
  if (effort <= 55) return 'medium';
  return 'high';
}

function buildActionPlan(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
  strategicContext?: StrategicContext,
): {
  title: string;
  recommendation: string;
  steps: string[];
  expectedOutcome: string;
  effortLevel: 'low' | 'medium' | 'high';
} {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const focus =
    (typeof payload.keyword === 'string' && payload.keyword) ||
    (typeof payload.keyword_theme === 'string' && payload.keyword_theme) ||
    decision.title;
  const effortLevel = inferEffortLevel(decision);
  const alignmentStep = strategicContext?.positioningStrength === 'weak'
    ? 'Ensure each buyer-stage page reinforces your differentiation with proof before scaling broader distribution.'
    : strategicContext
      ? `Tune this execution for a ${strategicContext.marketType} market by prioritizing ${strategicContext.keySuccessFactor}.`
      : null;

  if (decision.action_type === 'fix_cta') {
    return {
      title: `Rebuild the CTA flow on ${focus} for high-intent conversion`,
      recommendation: decision.recommendation,
      steps: [
        'Audit the current CTA on the highest-intent page and identify the single next action you want visitors to take.',
        'Rewrite the CTA copy so the value promise and next step are explicit and low-friction.',
        alignmentStep || 'Align supporting proof near the CTA so visitors have a reason to trust the click.',
      ],
      expectedOutcome: companyContext?.companyName
        ? `More of ${companyContext.companyName}'s existing traffic should progress into meaningful action instead of stalling.`
        : 'More of the traffic you already have should progress into meaningful action instead of stalling.',
      effortLevel,
    };
  }

  if (decision.action_type === 'fix_distribution') {
    return {
      title: companyContext?.marketContext
        ? `Reallocate distribution to the highest-fit segment in ${companyContext.marketContext}`
        : 'Reallocate distribution to the highest-fit market segment',
      recommendation: decision.recommendation,
      steps: [
        'Define the primary geography or channel segment that should be prioritized first.',
        'Adjust messaging examples, proof, and landing experience so they match that audience more closely.',
        alignmentStep || 'Shift distribution effort toward the channels where that audience is already showing intent.',
      ],
      expectedOutcome: companyContext?.companyName
        ? `Traffic quality for ${companyContext.companyName} should improve because the right message is reaching the right audience.`
        : 'Traffic quality should improve because the right message is reaching the right audience.',
      effortLevel,
    };
  }

  if (decision.action_type === 'adjust_strategy') {
    return {
      title: companyContext?.positioning
        ? `Strengthen proof for ${companyContext.positioning} around ${focus} to recover trust`
        : `Strengthen positioning proof around ${focus} to recover trust`,
      recommendation: decision.recommendation,
      steps: [
        'Define the main promise the brand should own and the proof required to support it.',
        'Update the homepage or key landing page so the value proposition and credibility are obvious within seconds.',
        alignmentStep || 'Publish at least one supporting proof asset, such as a case study, testimonial block, or expert perspective.',
      ],
      expectedOutcome: companyContext?.companyName
        ? `Buyers should understand faster why ${companyContext.companyName} is credible and different, improving trust and conversion readiness.`
        : 'Buyers should understand faster why this business is credible and different, improving trust and conversion readiness.',
      effortLevel,
    };
  }

  return {
    title: companyContext?.companyName && companyContext.marketContext
      ? `Build comparison and decision pages aligned with ${companyContext.companyName}'s positioning in ${companyContext.marketContext}`
      : `Build comparison and decision pages targeting ${focus} intent gaps`,
    recommendation: decision.recommendation,
    steps: [
      'Identify the primary page or topic cluster that should carry this intent.',
      'Rewrite or expand the page so it answers the real buyer question with more specificity and proof.',
      alignmentStep || 'Add one supporting asset or internal link that strengthens topical depth and next-step clarity.',
    ],
    expectedOutcome: companyContext?.companyName
      ? `${companyContext.companyName} should become easier to discover and easier to trust for this demand area${strategicContext ? ` in a ${strategicContext.marketType} market.` : '.'}`
      : 'The business should become easier to discover and easier to trust for this demand area.',
    effortLevel,
  };
}

function signalAvailabilityFromDecisions(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): Record<SnapshotSignalKey, SignalAvailabilityLevel> {
  const { decisions, resolvedInput } = params;
  const seoCount = decisions.filter(isSeoDecision).length;
  const contentCount = decisions.filter(isContentDecision).length;
  const authorityCount = decisions.filter(isAuthorityDecision).length;
  const geoCount = decisions.filter(isGeoDecision).length;
  const competitorCount = decisions.filter(isCompetitorDecision).length;

  const domainPresent = Boolean(resolvedInput?.resolved.websiteDomain);
  const socialPresent = (resolvedInput?.resolved.socialLinks.length ?? 0) > 0;
  const geographyPresent = Boolean(resolvedInput?.resolved.geography);
  const competitorPresent = (resolvedInput?.resolved.competitors.length ?? 0) > 0;

  return {
    seo_structure: seoCount >= 2 ? 'NORMAL' : seoCount === 1 || domainPresent ? 'LOW_DATA' : 'NO_DATA',
    content_coverage:
      contentCount >= 2
        ? 'NORMAL'
        : contentCount === 1 || domainPresent || socialPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    authority:
      authorityCount >= 1
        ? 'NORMAL'
        : socialPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    competitor:
      competitorCount >= 1 || competitorPresent
        ? 'NORMAL'
        : domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    geo_relevance:
      geoCount >= 1
        ? 'NORMAL'
        : geographyPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
  };
}

function syntheticDecision(params: {
  companyId: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  actionType: PersistedDecisionObject['action_type'];
  actionPayload: Record<string, unknown>;
  impactTraffic: number;
  impactConversion: number;
  impactRevenue: number;
  priorityScore: number;
  confidenceScore: number;
}): PersistedDecisionObject {
  const now = nowIso();
  return {
    id: `synthetic_${params.issueType}_${Math.random().toString(36).slice(2, 10)}`,
    company_id: params.companyId,
    report_tier: 'snapshot',
    source_service: 'snapshotFallbackService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: {
      synthetic: true,
      generated_at: now,
    },
    impact_traffic: params.impactTraffic,
    impact_conversion: params.impactConversion,
    impact_revenue: params.impactRevenue,
    priority_score: params.priorityScore,
    effort_score: 24,
    execution_score: clamp(
      params.priorityScore * 0.62 + Math.max(params.impactTraffic, params.impactConversion, params.impactRevenue) * 0.38,
      0,
      100,
    ),
    confidence_score: params.confidenceScore,
    recommendation: params.recommendation,
    action_type: params.actionType,
    action_payload: params.actionPayload,
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

export function buildSnapshotBaselineDecisions(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): PersistedDecisionObject[] {
  const signalAvailability = signalAvailabilityFromDecisions(params);
  const fallbacks: PersistedDecisionObject[] = [];
  const domain = params.resolvedInput?.resolved.websiteDomain ?? 'your site';
  const contextLabel = describeBusinessContext(params.resolvedInput);
  const geography = params.resolvedInput?.resolved.geography ?? 'your highest-value market';

  if (!params.decisions.some(isSeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'seo_gap',
        title: `${domain} is not yet visible enough to generate dependable discovery`,
        description: `We do not yet have enough durable SEO signal around ${domain} for ${contextLabel}, which usually means discoverability is being left to chance rather than engineered through search coverage.`,
        recommendation: `Build a simple search foundation for ${domain}: one sharpened homepage promise, one core service page, and one high-intent educational page tied to ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_seo_baseline', domain },
        impactTraffic: 62,
        impactConversion: 34,
        impactRevenue: 28,
        priorityScore: signalAvailability.seo_structure === 'NO_DATA' ? 68 : 58,
        confidenceScore: signalAvailability.seo_structure === 'NO_DATA' ? 0.74 : 0.68,
      }),
    );
  }

  if (!params.decisions.some(isContentDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'content_gap',
        title: `${domain} does not yet cover enough of the questions buyers ask before choosing`,
        description: `The current signal set suggests there is not enough topic coverage, depth, or supporting content for ${contextLabel} to turn interest into repeat discovery and trust.`,
        recommendation: `Prioritize a small content spine for ${domain}: one authority page, one comparison/problem page, and one proof-driven article tied to buyer intent in ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_content_coverage' },
        impactTraffic: 54,
        impactConversion: 42,
        impactRevenue: 32,
        priorityScore: 63,
        confidenceScore: 0.76,
      }),
    );
  }

  if (!params.decisions.some(isAuthorityDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'authority_deficit',
        title: `${domain} lacks enough proof to reinforce buyer confidence`,
        description: `Even if people discover ${domain}, there are not enough visible proof signals, trust markers, or authority assets to consistently convert interest into action for ${contextLabel}.`,
        recommendation: `Add proof assets that compress trust quickly for ${domain}: case studies, testimonials, founder/expert credibility, and visible outcome claims.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_authority_baseline' },
        impactTraffic: 34,
        impactConversion: 56,
        impactRevenue: 46,
        priorityScore: 61,
        confidenceScore: 0.73,
      }),
    );
  }

  if (
    signalAvailability.competitor !== 'NORMAL' &&
    !params.decisions.some(isCompetitorDecision)
  ) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'competitor_gap',
        title: `Competitive positioning for ${domain} is unclear because no baseline is being tracked`,
        description: `Without a visible competitor set for ${contextLabel}, it is difficult to tell whether weak performance is a market problem, a messaging problem, or simply a positioning gap.`,
        recommendation: `Track 3 direct competitors serving ${geography} and compare offers, messaging promises, and search topics so the next report can show concrete positioning gaps.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_competitor_tracking' },
        impactTraffic: 28,
        impactConversion: 38,
        impactRevenue: 34,
        priorityScore: signalAvailability.competitor === 'NO_DATA' ? 57 : 49,
        confidenceScore: 0.66,
      }),
    );
  }

  if (signalAvailability.geo_relevance === 'NO_DATA' && !params.decisions.some(isGeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'geo_gap',
        title: `Regional relevance for ${domain} is unclear, which can hide demand-quality problems`,
        description: `We do not yet have enough geographic signal to tell whether the current positioning for ${contextLabel} matches the market you most want to win.`,
        recommendation: `Define ${geography} as the first market to win and align messaging, examples, and proof so ${domain} reads as locally relevant there.`,
        actionType: 'fix_distribution',
        actionPayload: { optimization_focus: 'snapshot_geo_clarity' },
        impactTraffic: 31,
        impactConversion: 33,
        impactRevenue: 29,
        priorityScore: 46,
        confidenceScore: 0.61,
      }),
    );
  }

  return fallbacks;
}

export function ensureSnapshotDecisionFloor(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): { decisions: PersistedDecisionObject[]; fallbackAdded: number } {
  const uniqueDecisions = uniqueById(params.decisions);
  const baseline = buildSnapshotBaselineDecisions({
    companyId: params.companyId,
    decisions: uniqueDecisions,
    resolvedInput: params.resolvedInput,
  });

  const needed = Math.max(0, SNAPSHOT_MIN_INSIGHTS - uniqueDecisions.length);
  const selectedBaseline = baseline.slice(0, Math.max(needed, Math.min(3, baseline.length)));
  const finalDecisions = uniqueById([...uniqueDecisions, ...selectedBaseline]).sort(rankByImpactConfidence);

  return {
    decisions: finalDecisions,
    fallbackAdded: selectedBaseline.length,
  };
}

const SNAPSHOT_SECTION_DEFINITIONS: SnapshotSectionDefinition[] = [
  {
    key: 'visibility',
    section_name: 'Visibility',
    IU_ids: ['SNAPSHOT-VISIBILITY'],
    matches: (decision) => isSeoDecision(decision) || isGeoDecision(decision) || classifyDecisionType(decision.issue_type) === 'distribution',
  },
  {
    key: 'content_strength',
    section_name: 'Content Strength',
    IU_ids: ['SNAPSHOT-CONTENT'],
    matches: (decision) => isContentDecision(decision) || isCompetitorDecision(decision) || classifyDecisionType(decision.issue_type) === 'market',
  },
  {
    key: 'authority',
    section_name: 'Authority',
    IU_ids: ['SNAPSHOT-AUTHORITY'],
    matches: (decision) => isAuthorityDecision(decision),
  },
];

function sectionSeedDecision(
  sectionKey: SnapshotSectionDefinition['key'],
  decisions: PersistedDecisionObject[],
): PersistedDecisionObject[] {
  if (decisions.length > 0) return decisions;

  if (sectionKey === 'visibility') {
    return decisions;
  }

  return decisions;
}

function ensureSectionFloor(
  section: SnapshotReportSection,
  fallbackPool: PersistedDecisionObject[],
  sectionDefinition: SnapshotSectionDefinition,
  companyContext?: CompanyNarrativeContext,
  strategicContext?: StrategicContext,
): SnapshotReportSection {
  const seeded = sectionSeedDecision(
    sectionDefinition.key,
    fallbackPool.filter(sectionDefinition.matches),
  );

  if (seeded.length === 0) return section;

  const existingIds = new Set(section.insights.map((item) => item.decision_id));
  const nextInsights = [...section.insights];
  const nextOpportunities = [...section.opportunities];
  const nextActions = [...section.actions];

  for (const decision of seeded) {
    if (!existingIds.has(decision.id)) {
      nextInsights.push(toInsight(decision, companyContext));
      existingIds.add(decision.id);
    }
    if (nextActions.length < 2) {
      nextActions.push(toAction(decision, companyContext, strategicContext));
    }
    if (nextOpportunities.length < 1 && isOpportunityCandidate(decision)) {
      nextOpportunities.push(toOpportunity(decision));
    }
  }

  return {
    ...section,
    insights: nextInsights.slice(0, 4),
    opportunities: nextOpportunities.slice(0, 2),
    actions: nextActions.slice(0, 3),
  };
}

function capSignalReuseAcrossSections(
  sections: SnapshotReportSection[],
  maxPerSignal = 2,
): SnapshotReportSection[] {
  const signalCounts = new Map<string, number>();

  const canUseSignal = (signal: string): boolean => {
    const current = signalCounts.get(signal) ?? 0;
    if (current >= maxPerSignal) return false;
    signalCounts.set(signal, current + 1);
    return true;
  };

  return sections.map((section) => {
    const nextInsights = section.insights.filter((insight) =>
      canUseSignal(signalKeyFromIssueType(insight.issue_type)),
    );

    const nextActions = section.actions.filter((action) => {
      const signal = `${action.action_type || 'generic_action_signal'}_action`;
      return canUseSignal(signal);
    });

    const nextOpportunities = section.opportunities.filter((opportunity) => {
      const signal = `${opportunity.action_type || 'generic_opportunity_signal'}_opportunity`;
      return canUseSignal(signal);
    });

    return {
      ...section,
      insights: nextInsights,
      opportunities: nextOpportunities,
      actions: nextActions,
    };
  });
}

function capActionMentionsAcrossSections(
  sections: SnapshotReportSection[],
  maxMentionsPerActionTitle = 1,
): SnapshotReportSection[] {
  const titleCounts = new Map<string, number>();
  return sections.map((section) => {
    const nextActions = section.actions.filter((action) => {
      const key = action.title.toLowerCase().trim();
      const current = titleCounts.get(key) ?? 0;
      if (current >= maxMentionsPerActionTitle) return false;
      titleCounts.set(key, current + 1);
      return true;
    });
    return {
      ...section,
      actions: nextActions,
    };
  });
}

function normalizeCoreProblem(problem: string): string {
  const compact = problem.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'limited authority and visibility coverage';
  return compact.toLowerCase().startsWith('your growth is currently constrained by')
    ? compact.replace(/^your growth is currently constrained by\s+/i, '').trim()
    : compact;
}

function buildDiagnosis(params: {
  narrative: PrimaryNarrative;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
}): string {
  const coreProblem = normalizeCoreProblem(params.narrative.primary_problem);
  const companyName = params.companyContext?.companyName;
  const positioning = params.companyContext?.positioning || params.companyContext?.tagline || params.companyContext?.homepageHeadline;
  const positioningLine =
    companyName && positioning
      ? `${companyName} positions itself as ${positioning}, but current visibility and content signals are not consistently reinforcing that promise in high-intent buyer journeys.`
      : null;
  const diagnosis = [
    positioningLine,
    params.strategicContext?.positioningNarrative,
    params.strategicContext?.positioningGap,
    params.strategicContext?.marketNarrative,
    params.strategicContext?.marketPositionStatement,
    params.strategicContext?.positionImplication,
    `Your growth is currently constrained by ${coreProblem}.`,
    'Impact appears in high-intent search visibility, qualified traffic capture, and conversion readiness on core decision pages.',
    'Priority evidence comes from authority, coverage, and demand-capture signal clusters.',
  ].filter(Boolean).join(' ');
  return clampNarrativeLength(dedupeSentences(diagnosis), 320);
}

function buildSummary(params: {
  sections: SnapshotReportSection[];
  signalAvailability: Record<SnapshotSignalKey, SignalAvailabilityLevel>;
  competitorIntelligence: CompetitorIntelligenceResult;
  narrative: PrimaryNarrative;
  readiness?: ReportReadinessResult | null;
  topPriorityTitle?: string | null;
  coreProblem?: string | null;
  companyContext?: CompanyNarrativeContext;
}): string {
  const insightCount = params.sections.reduce((sum, section) => sum + section.insights.length, 0);
  const actionCount = params.sections.reduce((sum, section) => sum + section.actions.length, 0);
  const coreProblem = normalizeCoreProblem(params.coreProblem ?? params.narrative.primary_problem);
  const missingSignals = Object.entries(params.signalAvailability)
    .filter(([, status]) => status !== 'NORMAL')
    .map(([key]) => key.replace(/_/g, ' '));
  const competitorCount = params.competitorIntelligence.detected_competitors.length;
  const competitorFallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const entityLabel = params.companyContext?.companyName || 'the business';
  const competitorNote =
    competitorCount > 0
      ? competitorFallbackUsed
        ? ` Competitor context is inferred from partial market signals across ${competitorCount} benchmark peer${competitorCount === 1 ? '' : 's'}, so directional conclusions are lower confidence.`
        : ` It benchmarks ${entityLabel} against ${competitorCount} market peer${competitorCount === 1 ? '' : 's'} to surface where competitors are likely ahead.`
      : ' Competitor benchmarking was limited in this run, so market-relative claims are intentionally conservative.';

  const readinessNote =
    params.readiness?.missing_requirements?.length
      ? ` Some inputs were sparse, so this snapshot used baseline intelligence to keep the report actionable.`
      : '';

  const supportingProblems =
    params.narrative.secondary_problems.length > 0
      ? ` Supporting issues include ${params.narrative.secondary_problems
          .slice(0, 2)
          .map((problem) => problem.replace(/\.$/, '').trim())
          .filter(Boolean)
          .join(' and ')}.`
      : '';

  const baseSummary =
    `Signal coverage currently supports ${insightCount} insights and ${actionCount} prioritized actions focused on ${coreProblem}.`;

  if (missingSignals.length > 0) {
    const priorityLine = params.topPriorityTitle
      ? ` Priority now: ${params.topPriorityTitle}.`
      : '';
    return clampNarrativeLength(
      dedupeSentences(
        `${baseSummary}${supportingProblems} Weaker areas include ${missingSignals.slice(0, 2).join(' and ')}.${competitorNote}${readinessNote}${priorityLine}`,
      ).replace(/\s+/g, ' ').trim(),
      420,
    );
  }

  const priorityLine = params.topPriorityTitle
    ? ` Priority now: ${params.topPriorityTitle}.`
    : '';
  return clampNarrativeLength(
    dedupeSentences(
      `${baseSummary}${supportingProblems} Evidence is anchored in visibility, content, and authority signals.${competitorNote}${priorityLine}`,
    ).replace(/\s+/g, ' ').trim(),
    420,
  );
}

function topPriorityScore(action: SnapshotAction): number {
  return action.impact_score * 0.58 + action.confidence_score * 100 * 0.42;
}

function sortSectionActions(actions: SnapshotAction[]): SnapshotAction[] {
  return [...actions].sort((left, right) => {
    const priorityOrder = comparePriorityType(
      { priorityType: left.priority_type, impactScore: left.impact_score },
      { priorityType: right.priority_type, impactScore: right.impact_score },
    );
    if (priorityOrder !== 0) return priorityOrder;
    return topPriorityScore(right) - topPriorityScore(left);
  });
}

function buildTopPriorities(sections: SnapshotReportSection[]): SnapshotTopPriority[] {
  const actions = sections.flatMap((section) => section.actions);
  const deduped = new Map<string, SnapshotAction>();
  for (const action of actions) {
    const key = `${action.title}|${action.action_type}`;
    if (!deduped.has(key)) deduped.set(key, action);
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const priorityOrder = comparePriorityType(
        { priorityType: a.priority_type, impactScore: a.impact_score },
        { priorityType: b.priority_type, impactScore: b.impact_score },
      );
      if (priorityOrder !== 0) return priorityOrder;
      return topPriorityScore(b) - topPriorityScore(a);
    })
    .slice(0, 3)
    .map((action) => ({
      title: action.title,
      why_now:
        action.impact_score >= 55
          ? 'This has immediate leverage on visibility, trust, or conversion quality.'
          : 'This is a practical foundation step that unlocks stronger performance later.',
      expected_outcome: action.expected_outcome,
      expected_upside: action.expected_upside,
      effort_level: action.effort_level,
      priority_type: classifyPriorityType({
        impactScore: action.impact_score,
        effortLevel: action.effort_level,
      }),
      impact_score: action.impact_score,
      confidence_score: action.confidence_score,
    }));
}

function buildDecisionSnapshot(params: {
  diagnosis: string;
  coreProblem: string;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
  signalAvailability: Record<SnapshotSignalKey, SignalAvailabilityLevel>;
  unifiedSummary: SnapshotReport['unified_intelligence_summary'];
  seoSummary: SnapshotReport['seo_executive_summary'];
  geoAeoSummary: SnapshotReport['geo_aeo_executive_summary'];
  competitorSummary: SnapshotReport['competitor_intelligence_summary'];
  competitorIntelligence: CompetitorIntelligenceResult;
  topPriorities: SnapshotTopPriority[];
}): SnapshotReport['decision_snapshot'] {
  const primaryFocusArea = normalizeCoreProblem(params.coreProblem);
  const firstPriority = params.topPriorities[0]?.title ?? params.seoSummary.top_3_actions[0]?.action_title ?? 'Stabilize authority and visibility foundations';
  const firstPriorityImpact = params.topPriorities[0]?.impact_score ?? 0;
  const firstPriorityEffort = params.topPriorities[0]?.effort_level ?? 'medium';
  const competitorFallback =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const competitorGapTitle = params.competitorSummary?.primary_gap.title;

  const whatToDelay = params.strategicContext?.positioningStrength === 'weak'
    ? 'Do not prioritize broad channel expansion until positioning clarity and proof consistency are fixed on buyer-stage pages.'
    : params.unifiedSummary.dominant_growth_channel === 'seo'
    ? 'Do not prioritize GEO/AEO expansion until authority and search visibility constraints are reduced.'
    : params.unifiedSummary.dominant_growth_channel === 'geo_aeo'
      ? 'Do not prioritize broad keyword expansion until answer extraction and citation readiness improve.'
      : 'Do not split effort across all channels at once; sequence the top 3 actions first.';

  const ifIgnored = params.unifiedSummary.primary_constraint.if_not_addressed;
  const competitorClause = competitorFallback
    ? 'Competitor comparisons are directional because discovery used fallback peer inference.'
    : competitorGapTitle
      ? `Competitor benchmarks reinforce this through ${competitorGapTitle.toLowerCase()}.`
      : 'Competitor benchmarks indicate the same constraint in live market conditions.';

  const executionSequence = params.unifiedSummary.primary_constraint.source === 'seo'
    ? [
        'Step 1: Strengthen trust proof and authority cues on the highest-intent pages.',
        'Step 2: Expand comparison and decision content where demand exceeds current coverage.',
        'Step 3: Tighten metadata and internal linking on those priority pages to improve capture efficiency.',
      ]
    : [
        'Step 1: Add direct-answer blocks and structured summaries on key buyer query pages.',
        'Step 2: Improve entity clarity and citation-ready proof on strategic pages.',
        'Step 3: Align search-facing content depth so SEO and AI-answer visibility improve together.',
      ];

  const impactScale: 'high_impact' | 'medium_impact' | 'foundational_impact' =
    firstPriorityImpact >= 72 || params.unifiedSummary.primary_constraint.severity === 'critical'
      ? 'high_impact'
      : firstPriorityImpact >= 48 || params.unifiedSummary.primary_constraint.severity === 'moderate'
        ? 'medium_impact'
        : 'foundational_impact';

  const shortTerm =
    firstPriorityEffort === 'low'
      ? '2-4 weeks: first movement in visibility efficiency and conversion readiness should appear.'
      : '2-4 weeks: early stabilization in core visibility constraints should appear.';
  const midTerm =
    '1-3 months: authority and content-depth improvements should begin lifting traffic quality and query coverage.';
  const longTerm =
    '3-6 months: sustained execution should shift market position toward stronger competitive visibility and AI answer presence.';

  const constraintArea = params.unifiedSummary.primary_constraint.source === 'seo' ? 'search visibility and authority' : 'AI answer visibility and entity clarity';
  const ifExecutedWell =
    params.companyContext?.companyName && params.companyContext?.marketContext
      ? `If executed well, ${params.companyContext.companyName} should become more visible in ${params.companyContext.marketContext}, with impact visible in commercial-query impressions, organic landing-page CTR, and conversion progression on decision pages.`
      : `If executed well, ${constraintArea} should improve first, with impact visible in commercial-query impressions, organic landing-page CTR, and conversion progression on decision pages.`;

  const lowSignalCount = Object.values(params.signalAvailability).filter((value) => value !== 'NORMAL').length;
  let outcomeConfidence: 'high' | 'medium' | 'low' =
    params.unifiedSummary.confidence === 'high' && params.seoSummary.confidence === 'high'
      ? 'high'
      : params.unifiedSummary.confidence === 'low' || params.seoSummary.confidence === 'low'
        ? 'low'
        : 'medium';
  if (competitorFallback && outcomeConfidence === 'high') outcomeConfidence = 'medium';
  if (lowSignalCount >= 3) outcomeConfidence = 'low';

  const currentState =
    params.unifiedSummary.primary_constraint.source === 'seo'
      ? 'Constrained authority visibility across core commercial queries'
      : 'Constrained AI answer presence across key buyer query clusters';
  const expectedState =
    params.unifiedSummary.primary_constraint.source === 'seo'
      ? 'Competitive authority presence with stronger high-intent query capture and better conversion flow from organic landing pages'
      : 'Competitive answer extraction readiness with stronger citation presence across AI answer surfaces and high-intent query clusters';

  return {
    primary_focus_area: primaryFocusArea,
    whats_broken: [params.diagnosis, params.strategicContext?.marketPositionStatement].filter(Boolean).join(' '),
    what_to_fix_first: params.strategicContext?.strategyAlignment
      ? `${params.strategicContext.strategyAlignment} Then fix ${primaryFocusArea} through highest-leverage authority and coverage work. Execution risk: ${params.strategicContext.executionRisk}`
      : `Fix ${primaryFocusArea} first by concentrating effort on highest-leverage authority and coverage work before channel expansion.`,
    what_to_delay: whatToDelay,
    if_ignored: `${ifIgnored} ${competitorClause} ${params.strategicContext?.positionImplication || ''}`.replace(/\s+/g, ' ').trim(),
    execution_sequence: executionSequence,
    if_executed_well: `${ifExecutedWell} ${params.strategicContext?.resilienceGuidance || ''}`.replace(/\s+/g, ' ').trim(),
    when_to_expect_impact: {
      short_term: shortTerm,
      mid_term: midTerm,
      long_term: longTerm,
    },
    impact_scale: impactScale,
    current_state: currentState,
    expected_state: expectedState,
    outcome_confidence: outcomeConfidence,
  };
}

function mapIssueToExecutiveArea(issueType: string): 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility' {
  if (/(backlink|authority)/.test(issueType)) return 'backlinks';
  if (/(keyword|ranking|impression_click_gap)/.test(issueType)) return 'keywords';
  if (/(content|topic|cluster|weak_content_depth)/.test(issueType)) return 'content';
  if (/(geo|distribution|search|seo_gap)/.test(issueType)) return 'visibility';
  return 'technical_seo';
}

function severityLabel(score: number): 'critical' | 'moderate' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'moderate';
  return 'low';
}

function impactBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function executivePriorityBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 72) return 'high';
  if (score >= 48) return 'medium';
  return 'low';
}

function expectedCtrByPosition(avgPosition: number): number {
  if (avgPosition <= 3) return 0.18;
  if (avgPosition <= 5) return 0.11;
  if (avgPosition <= 10) return 0.07;
  if (avgPosition <= 20) return 0.035;
  return 0.015;
}

function buildSnapshotVisualIntelligence(params: {
  decisions: PersistedDecisionObject[];
  score: ReturnType<typeof buildReportScoreModel>;
  competitorIntelligence: CompetitorIntelligenceResult;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
  narrativeContext?: NarrativeContext;
}): SnapshotReport['visual_intelligence'] {
  const scoreByKey = new Map(params.score.dimensions.map((dimension) => [dimension.key, dimension.value]));
  const keywordDecisions = params.decisions.filter((decision) => {
    const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
    return typeof payload.keyword === 'string' || typeof payload.keyword_theme === 'string';
  });
  const keywordTopics = new Map<string, PersistedDecisionObject>();
  for (const decision of keywordDecisions) {
    const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
    const keyword =
      (typeof payload.keyword === 'string' && payload.keyword.trim()) ||
      (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) ||
      '';
    if (!keyword) continue;
    const existing = keywordTopics.get(keyword);
    if (!existing || impactScore(decision) > impactScore(existing)) {
      keywordTopics.set(keyword, decision);
    }
  }

  const opportunityCoverage = [...keywordTopics.entries()]
    .map(([keyword, decision]) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
      const avgRelevance = typeof evidence.avg_relevance === 'number' ? evidence.avg_relevance : null;
      const mentionCount = typeof evidence.mention_count === 'number' ? evidence.mention_count : null;
      let coverageScore: number | null = null;
      if (typeof avgPosition === 'number') {
        coverageScore = clamp(Math.round(100 - Math.max(avgPosition - 1, 0) * 4.2), 0, 100);
      } else if (typeof avgRelevance === 'number') {
        coverageScore = clamp(Math.round(avgRelevance * 100), 0, 100);
      } else if (typeof mentionCount === 'number') {
        coverageScore = clamp(mentionCount * 18, 0, 100);
      }
      if (coverageScore == null) return null;
      const confidence: 'high' | 'medium' | 'low' =
        typeof avgPosition === 'number' ? 'high' : typeof avgRelevance === 'number' ? 'medium' : 'low';
      return {
        keyword,
        opportunity_score: clamp(Math.round(impactScore(decision)), 0, 100),
        coverage_score: coverageScore,
        confidence,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.opportunity_score - left.opportunity_score)
    .slice(0, 8);

  const searchKeywordRows = [...keywordTopics.values()]
    .map((decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      const keyword =
        typeof evidence.keyword === 'string'
          ? evidence.keyword
          : typeof (decision.action_payload as Record<string, unknown> | undefined)?.keyword === 'string'
            ? String((decision.action_payload as Record<string, unknown>).keyword)
            : null;
      const impressions = typeof evidence.impressions === 'number'
        ? evidence.impressions
        : typeof evidence.recent_impressions === 'number'
          ? evidence.recent_impressions
          : null;
      const clicks = typeof evidence.clicks === 'number'
        ? evidence.clicks
        : typeof evidence.recent_clicks === 'number'
          ? evidence.recent_clicks
          : null;
      const ctr = typeof evidence.ctr === 'number' ? evidence.ctr : null;
      const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
      if (!keyword || impressions == null || clicks == null) return null;
      return { keyword, impressions, clicks, ctr, avgPosition };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const searchVisibilityFunnel = searchKeywordRows.length > 0
    ? (() => {
        const impressions = searchKeywordRows.reduce((sum, row) => sum + row.impressions, 0);
        const clicks = searchKeywordRows.reduce((sum, row) => sum + row.clicks, 0);
        const ctr = impressions > 0 ? clicks / impressions : null;
        const estimatedLostClicks = Math.max(0, Math.round(searchKeywordRows.reduce((sum, row) => {
          const expectedCtr = row.avgPosition != null ? expectedCtrByPosition(row.avgPosition) : 0.04;
          const expectedClicks = row.impressions * expectedCtr;
          return sum + Math.max(0, expectedClicks - row.clicks);
        }, 0)));
        return {
          impressions,
          clicks,
          ctr: ctr != null ? Number(ctr.toFixed(4)) : null,
          estimated_lost_clicks: estimatedLostClicks,
          confidence: 'high' as const,
          drop_off_reason_distribution: {
            ranking_issue_pct: null,
            ctr_issue_pct: null,
            intent_mismatch_pct: null,
          },
        };
      })()
    : {
        impressions: null,
        clicks: null,
        ctr: null,
        estimated_lost_clicks: null,
        confidence: 'low' as const,
        drop_off_reason_distribution: {
          ranking_issue_pct: null,
          ctr_issue_pct: null,
          intent_mismatch_pct: null,
        },
      };

  const metadataIssues = params.publicAudit?.decisions
    .filter((decision) => decision.title === 'Metadata coverage is too weak to support strong search visibility')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum +
        Number(evidence.missing_title_count ?? 0) +
        Number(evidence.missing_meta_count ?? 0) +
        Number(evidence.thin_meta_count ?? 0) +
        Number(evidence.duplicate_meta_title_count ?? 0);
    }, 0);
  const structureIssues = params.publicAudit?.decisions
    .filter((decision) =>
      decision.issue_type === 'weak_content_depth' ||
      decision.title === 'Core pages are too thin or weakly structured to perform well in search')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum + Number(evidence.thin_page_count ?? 0) + Number(evidence.pages_without_h1_count ?? 0);
    }, 0);
  const internalLinkIssues = params.publicAudit?.decisions
    .filter((decision) => decision.title === 'Technical crawlability and internal linking are leaving pages under-supported')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum + Number(evidence.orphan_like_page_count ?? 0);
    }, 0);
  const crawlDepthIssues = params.publicAudit?.site_structure
    ? (params.publicAudit.decisions
        .filter((decision) => decision.title === 'Technical crawlability and internal linking are leaving pages under-supported')
        .reduce((sum, decision) => {
          const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
          return sum + Number(evidence.status_error_count ?? 0);
        }, 0))
    : null;

  const competitorStandingValues = params.competitorIntelligence.comparison?.competitors?.map((entry) => {
    const deltas = entry.deltas_vs_company;
    if (!deltas) return null;
    const avgDelta = averageNumber([
      Number(deltas.content_depth ?? 0),
      Number(deltas.authority_score ?? 0),
      Number(deltas.seo_coverage ?? 0),
      Number(deltas.geo_presence ?? 0),
      Number(deltas.aeo_readiness ?? 0),
    ].filter((value) => Number.isFinite(value)));
    if (avgDelta == null) return null;
    if (avgDelta >= 8) return 35;
    if (avgDelta <= -6) return 80;
    return 60;
  }).filter((value) => value != null) as number[];

  const technicalPenalty = metadataIssues != null || structureIssues != null || internalLinkIssues != null || crawlDepthIssues != null
    ? ((metadataIssues ?? 0) * 2.5 + (structureIssues ?? 0) * 4 + (internalLinkIssues ?? 0) * 5 + (crawlDepthIssues ?? 0) * 6)
    : null;
  const technicalSeoScore = technicalPenalty != null
    ? clamp(Math.round(((scoreByKey.get('coverage') ?? 65) * 0.45) + ((scoreByKey.get('aeo') ?? 60) * 0.25) + ((scoreByKey.get('content_quality') ?? 60) * 0.2) + 10 - technicalPenalty), 0, 100)
    : null;
  const keywordResearchScore = opportunityCoverage.length > 0
    ? clamp(Math.round(((scoreByKey.get('coverage') ?? 0) * 0.6) + ((scoreByKey.get('reach') ?? 0) * 0.4)), 0, 100)
    : null;
  const rankTrackingScore = searchVisibilityFunnel.impressions != null && searchVisibilityFunnel.ctr != null
    ? clamp(Math.round(((scoreByKey.get('reach') ?? 0) * 0.55) + (Math.min(searchVisibilityFunnel.ctr * 100 * 3, 100) * 0.45)), 0, 100)
    : null;
  const backlinksScore = typeof scoreByKey.get('authority') === 'number' ? scoreByKey.get('authority') ?? null : null;
  const competitorIntelligenceScore = competitorStandingValues.length > 0
    ? Math.round(competitorStandingValues.reduce((sum, value) => sum + value, 0) / competitorStandingValues.length)
    : null;
  const contentQualityScore = scoreByKey.get('content_quality') ?? null;

  const radarConfidence: 'high' | 'medium' | 'low' =
    technicalSeoScore != null && rankTrackingScore != null ? 'high' :
    contentQualityScore != null || backlinksScore != null ? 'medium' : 'low';
  const opportunityConfidence: 'high' | 'medium' | 'low' =
    opportunityCoverage.some((item) => item.confidence === 'high') ? 'high' :
    opportunityCoverage.length > 0 ? 'medium' : 'low';
  const crawlConfidence: 'high' | 'medium' | 'low' =
    technicalPenalty != null ? 'high' : 'low';
  const technicalSourceTags = technicalPenalty != null ? ['crawler'] : null;
  const keywordSourceTags = opportunityCoverage.length > 0 ? ['GSC', 'heuristic'] : null;
  const rankSourceTags = searchKeywordRows.length > 0 ? ['GSC'] : null;
  const backlinksSourceTags = backlinksScore != null
    ? params.decisions.some((decision) => isAuthorityDecision(decision)) ? ['backlink_signals', 'heuristic'] : ['heuristic']
    : null;
  const competitorSourceTags = competitorStandingValues.length > 0 ? ['competitor_intelligence', 'heuristic'] : null;
  const contentSourceTags = contentQualityScore != null
    ? params.publicAudit?.decisions?.length ? ['crawler', 'heuristic'] : ['heuristic']
    : null;
  const searchRowCount = searchKeywordRows.length;
  const rankingIssueWeight = searchKeywordRows.reduce((sum, row) => {
    if (row.avgPosition == null) return sum;
    return sum + Math.max(0, Math.min((row.avgPosition - 5) / 20, 1)) * row.impressions;
  }, 0);
  const ctrIssueWeight = searchKeywordRows.reduce((sum, row) => {
    if (row.ctr == null) return sum;
    const expectedCtr = row.avgPosition != null ? expectedCtrByPosition(row.avgPosition) : 0.04;
    return sum + Math.max(0, expectedCtr - row.ctr) * row.impressions;
  }, 0);
  const intentMismatchWeight = keywordDecisions.reduce((sum, decision) => {
    if (decision.issue_type === 'impression_click_gap') return sum + impactScore(decision);
    if (decision.issue_type === 'ranking_gap') return sum + impactScore(decision) * 0.35;
    return sum;
  }, 0);
  const totalDropOffWeight = rankingIssueWeight + ctrIssueWeight + intentMismatchWeight;
  const dropOffReasonDistribution = totalDropOffWeight > 0
    ? {
        ranking_issue_pct: Math.round((rankingIssueWeight / totalDropOffWeight) * 100),
        ctr_issue_pct: Math.round((ctrIssueWeight / totalDropOffWeight) * 100),
        intent_mismatch_pct: Math.max(0, 100 - Math.round((rankingIssueWeight / totalDropOffWeight) * 100) - Math.round((ctrIssueWeight / totalDropOffWeight) * 100)),
      }
    : {
        ranking_issue_pct: null,
        ctr_issue_pct: null,
        intent_mismatch_pct: null,
      };
  const issueCounts = [
    metadataIssues ?? 0,
    structureIssues ?? 0,
    internalLinkIssues ?? 0,
    crawlDepthIssues ?? 0,
  ];
  const severitySplit = technicalPenalty != null
    ? {
        critical: issueCounts.reduce((sum, value) => sum + (value >= 5 ? value : 0), 0),
        moderate: issueCounts.reduce((sum, value) => sum + (value >= 2 && value < 5 ? value : 0), 0),
        low: issueCounts.reduce((sum, value) => sum + (value > 0 && value < 2 ? value : 0), 0),
        classification: 'classified' as const,
      }
    : {
        critical: null,
        moderate: null,
        low: null,
        classification: 'unclassified' as const,
      };
  const topOpportunity = [...opportunityCoverage]
    .sort((left, right) => (right.opportunity_score - right.coverage_score) - (left.opportunity_score - left.coverage_score))[0];
  const opportunitySignals: NarrativeSignal[] = [];
  if (topOpportunity) {
    opportunitySignals.push({
      key: 'keyword_gap',
      text: `${topOpportunity.keyword} has a ${Math.max(0, topOpportunity.opportunity_score - topOpportunity.coverage_score)}-point keyword gap (${topOpportunity.opportunity_score}/100 demand vs ${topOpportunity.coverage_score}/100 coverage)`,
    });
  }
  if (opportunityCoverage.some((item) => item.coverage_score <= 45)) {
    opportunitySignals.push({
      key: 'missing_pages',
      text: `${opportunityCoverage.filter((item) => item.coverage_score <= 45).length} high-opportunity themes still map to thin or missing pages`,
    });
  }
  if (typeof dropOffReasonDistribution.intent_mismatch_pct === 'number' && dropOffReasonDistribution.intent_mismatch_pct > 0) {
    opportunitySignals.push({
      key: 'intent_mismatch',
      text: `${dropOffReasonDistribution.intent_mismatch_pct}% of funnel drop-off links to intent mismatch`,
    });
  }
  const opportunityContext = params.narrativeContext ?? createNarrativeContext();
  const selectedOpportunitySignals = pickNarrativeSignals({
    section: 'opportunity',
    candidates: opportunitySignals,
    context: opportunityContext,
  });
  const opportunityTemplate = pickTemplate({
    section: 'opportunity',
    templates: OPPORTUNITY_TEMPLATES,
    context: opportunityContext,
    seed: `${selectedOpportunitySignals.primary?.key ?? 'fallback'}|${selectedOpportunitySignals.secondary?.key ?? 'none'}|${NARRATIVE_INTENT.opportunity}`,
  });
  const opportunityReasoningDraft = selectedOpportunitySignals.primary
    ? renderTemplate(opportunityTemplate, {
        primary_signal: selectedOpportunitySignals.primary.text,
        intent_type:
          typeof dropOffReasonDistribution.intent_mismatch_pct === 'number' && dropOffReasonDistribution.intent_mismatch_pct >= 35
            ? 'high-intent mismatch'
            : 'high-intent',
      })
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';
  const compactOpportunityReasoning = compactNarrative(opportunityReasoningDraft);
  const opportunityEvidence = topOpportunity
    ? `keyword ${topOpportunity.keyword} demand ${topOpportunity.opportunity_score}/100 vs coverage ${topOpportunity.coverage_score}/100`
    : typeof dropOffReasonDistribution.intent_mismatch_pct === 'number'
      ? `intent mismatch ${dropOffReasonDistribution.intent_mismatch_pct}%`
      : 'opportunity signal coverage is limited';
  const opportunityReasoningWithEvidence = compactNarrative(
    withEvidence(
      compactOpportunityReasoning.includes('gap') ? compactOpportunityReasoning : `Opportunity gap: ${compactOpportunityReasoning}`,
      opportunityEvidence,
    ),
  );
  const opportunityReasoning = validateNarrative(opportunityReasoningWithEvidence)
    ? opportunityReasoningWithEvidence
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';

  return {
    seo_capability_radar: {
      technical_seo_score: technicalSeoScore,
      keyword_research_score: keywordResearchScore,
      rank_tracking_score: rankTrackingScore,
      backlinks_score: backlinksScore,
      competitor_intelligence_score: competitorIntelligenceScore,
      content_quality_score: contentQualityScore,
      confidence: radarConfidence,
      data_source_strength: {
        technical_seo_score: inferDataSourceStrength({ available: technicalSeoScore != null, sourceTags: technicalSourceTags, confidence: crawlConfidence }),
        keyword_research_score: inferDataSourceStrength({ available: keywordResearchScore != null, sourceTags: keywordSourceTags, confidence: opportunityConfidence, inferred: true }),
        rank_tracking_score: inferDataSourceStrength({ available: rankTrackingScore != null, sourceTags: rankSourceTags, confidence: searchVisibilityFunnel.confidence }),
        backlinks_score: inferDataSourceStrength({ available: backlinksScore != null, sourceTags: backlinksSourceTags, confidence: backlinksSourceTags?.includes('backlink_signals') ? 'medium' : 'low', inferred: !backlinksSourceTags?.includes('backlink_signals') }),
        competitor_intelligence_score: inferDataSourceStrength({ available: competitorIntelligenceScore != null, sourceTags: competitorSourceTags, confidence: competitorStandingValues.length >= 2 ? 'medium' : 'low', inferred: true }),
        content_quality_score: inferDataSourceStrength({ available: contentQualityScore != null, sourceTags: contentSourceTags, confidence: params.publicAudit?.decisions?.length ? 'medium' : 'low', inferred: !params.publicAudit?.decisions?.length }),
      },
      source_tags: {
        technical_seo_score: technicalSourceTags,
        keyword_research_score: keywordSourceTags,
        rank_tracking_score: rankSourceTags,
        backlinks_score: backlinksSourceTags,
        competitor_intelligence_score: competitorSourceTags,
        content_quality_score: contentSourceTags,
      },
    },
    opportunity_coverage_matrix: {
      opportunities: opportunityCoverage.map((item) => {
        const valueScore = typeof searchVisibilityFunnel.estimated_lost_clicks === 'number'
          ? clamp(Math.round((item.opportunity_score * 0.55) + (Math.max(0, 100 - item.coverage_score) * 0.25) + Math.min(searchVisibilityFunnel.estimated_lost_clicks / Math.max(searchRowCount || 1, 1), 40)), 0, 100)
          : null;
        const priorityBucket =
          item.opportunity_score >= 70 && item.coverage_score <= 55
            ? 'quick_win'
            : item.opportunity_score >= 60
              ? 'strategic'
              : 'low_priority';
        return {
          ...item,
          opportunity_value_score: valueScore,
          priority_bucket: priorityBucket,
        };
      }),
      confidence: opportunityConfidence,
      opportunity_reasoning: opportunityReasoning,
    },
    search_visibility_funnel: {
      ...searchVisibilityFunnel,
      drop_off_reason_distribution: dropOffReasonDistribution,
    },
    crawl_health_breakdown: {
      metadata_issues: metadataIssues != null ? metadataIssues : null,
      structure_issues: structureIssues != null ? structureIssues : null,
      internal_link_issues: internalLinkIssues != null ? internalLinkIssues : null,
      crawl_depth_issues: crawlDepthIssues != null ? crawlDepthIssues : null,
      confidence: crawlConfidence,
      severity_split: severitySplit,
    },
  };
}

function buildSeoExecutiveSummary(params: {
  decisions: PersistedDecisionObject[];
  score: ReturnType<typeof buildReportScoreModel>;
  visualIntelligence: SnapshotReport['visual_intelligence'];
  topPriorities: SnapshotTopPriority[];
}): SnapshotReport['seo_executive_summary'] {
  const technicalScore = params.visualIntelligence.seo_capability_radar.technical_seo_score;
  const visibilityScore = params.visualIntelligence.seo_capability_radar.rank_tracking_score;
  const contentScore = params.visualIntelligence.seo_capability_radar.content_quality_score;
  const authorityScore = params.visualIntelligence.seo_capability_radar.backlinks_score;

  const healthComponents = [technicalScore, visibilityScore, contentScore, authorityScore]
    .filter((value): value is number => typeof value === 'number');
  const overallHealthScore = healthComponents.length > 0
    ? Math.round(
        healthComponents.reduce((sum, value, index) => {
          const weight = [0.28, 0.3, 0.24, 0.18][index] ?? 0.25;
          return sum + value * weight;
        }, 0) / ([0.28, 0.3, 0.24, 0.18].slice(0, healthComponents.length).reduce((sum, value) => sum + value, 0))
      )
    : params.score.value;

  const sortedDecisions = [...params.decisions].sort((left, right) => impactScore(right) - impactScore(left));
  const topDecision = sortedDecisions[0];
  const bestOpportunity = [...params.visualIntelligence.opportunity_coverage_matrix.opportunities]
    .sort((left, right) => {
      const leftValue = Number(left.opportunity_value_score ?? left.opportunity_score);
      const rightValue = Number(right.opportunity_value_score ?? right.opportunity_score);
      return rightValue - leftValue;
    })[0];
  const funnelLostClicks = params.visualIntelligence.search_visibility_funnel.estimated_lost_clicks;
  const crawlIssues = params.visualIntelligence.crawl_health_breakdown;

  const primaryProblem = topDecision
      ? {
        title: topDecision.title,
        impacted_area: mapIssueToExecutiveArea(topDecision.issue_type),
        severity: severityLabel(impactScore(topDecision)),
        reasoning: `${topDecision.description} Backlink, crawl, and intent signals indicate ${evidenceSignalFromDecision(topDecision)}.`,
        if_not_addressed: 'If not addressed, visibility gains from new pages will remain constrained and conversion efficiency will continue to underperform.',
      }
    : bestOpportunity
      ? {
          title: `Search opportunity around ${bestOpportunity.keyword} is being under-captured`,
          impacted_area: 'keywords' as const,
          severity: severityLabel(bestOpportunity.opportunity_score),
          reasoning: `Coverage is currently ${bestOpportunity.coverage_score}/100 while the opportunity score is ${bestOpportunity.opportunity_score}/100, which indicates upside is visible but not yet captured.`,
          if_not_addressed: 'If not addressed, high-intent demand will continue leaking to competitors and qualified traffic growth will stall.',
        }
      : {
          title: 'SEO performance needs stronger signal coverage before a sharper diagnosis is possible',
          impacted_area: 'visibility' as const,
          severity: 'low' as const,
          reasoning: 'The current snapshot is relying on limited evidence, so the first priority is improving crawl, search, and content signal coverage.',
          if_not_addressed: 'If not addressed, execution will stay reactive and each optimization cycle will produce inconsistent results.',
        };

  const usedAreas = new Set<string>();
  const linkedVisualForDecision = (decision: PersistedDecisionObject): 'radar' | 'matrix' | 'funnel' | 'crawl' => {
    if (/backlink|authority/.test(decision.issue_type)) return 'radar';
    if (/keyword|ranking/.test(decision.issue_type)) return 'matrix';
    if (/impression_click_gap|visibility|search/.test(decision.issue_type)) return 'funnel';
    if (/seo_gap|weak_content_depth|localized_content_gap/.test(decision.issue_type)) return 'crawl';
    return 'radar';
  };

  const topActions = sortedDecisions
    .map((decision) => {
      const area = mapIssueToExecutiveArea(decision.issue_type);
      if (usedAreas.has(area)) return null;
      usedAreas.add(area);
      return {
        action_title: buildActionPlan(decision).title,
        priority: executivePriorityBand(Number(decision.priority_score ?? impactScore(decision))),
        expected_impact: impactBand(impactScore(decision)),
        effort: inferEffortLevel(decision),
        linked_visual: linkedVisualForDecision(decision),
        reasoning: decision.recommendation,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);

  while (topActions.length < 3 && params.topPriorities[topActions.length]) {
    const item = params.topPriorities[topActions.length];
    topActions.push({
      action_title: item.title,
      priority: executivePriorityBand(item.impact_score),
      expected_impact: impactBand(item.impact_score),
      effort: item.effort_level,
      linked_visual: topActions.length === 0 ? 'crawl' : topActions.length === 1 ? 'matrix' : 'radar',
      reasoning: item.why_now,
    });
  }

  const growthOpportunity = bestOpportunity || typeof funnelLostClicks === 'number'
    ? {
        title: bestOpportunity
          ? `Win more traffic from ${bestOpportunity.keyword}`
          : 'Recover more search clicks from existing visibility',
        estimated_upside:
          bestOpportunity && typeof bestOpportunity.opportunity_value_score === 'number'
            ? `A higher-coverage push here could unlock a value score of ${bestOpportunity.opportunity_value_score}/100.`
            : typeof funnelLostClicks === 'number'
              ? `The current search funnel suggests roughly ${funnelLostClicks.toLocaleString()} additional clicks may be recoverable.`
              : 'Upside is visible but not yet quantifiable.',
        based_on: bestOpportunity && typeof funnelLostClicks === 'number'
          ? `Based on keyword opportunity coverage and an estimated ${funnelLostClicks.toLocaleString()} lost clicks in the search funnel.`
          : bestOpportunity
            ? 'Based on the highest-value gap in the opportunity coverage matrix.'
            : 'Based on lost-click pressure in the search visibility funnel.',
      }
    : null;

  let confidence: 'high' | 'medium' | 'low' = params.visualIntelligence.search_visibility_funnel.confidence === 'high' ||
    params.visualIntelligence.crawl_health_breakdown.confidence === 'high'
    ? 'high'
    : params.visualIntelligence.seo_capability_radar.confidence === 'medium'
      ? 'medium'
      : 'low';
  const missingCoreEvidence = [technicalScore, visibilityScore, contentScore].filter((value) => value == null).length;
  if (missingCoreEvidence >= 2) confidence = 'low';
  else if (missingCoreEvidence === 1 && confidence === 'high') confidence = 'medium';

  const causalReasons: string[] = [];
  if (typeof technicalScore === 'number' && technicalScore < 55) {
    causalReasons.push(`technical score at ${technicalScore}/100 is constraining crawl reliability`);
  }
  if (typeof visibilityScore === 'number' && visibilityScore < 55) {
    causalReasons.push(`visibility score at ${visibilityScore}/100 is suppressing qualified discovery`);
  }
  if (typeof contentScore === 'number' && contentScore < 55) {
    causalReasons.push(`content quality score at ${contentScore}/100 is weakening intent match`);
  }
  if (causalReasons.length > 0) {
    primaryProblem.reasoning = `Primary issue exists because ${causalReasons.slice(0, 2).join(' and ')}. Backlink and content-depth signals currently read technical ${technicalScore ?? 'n/a'}, visibility ${visibilityScore ?? 'n/a'}, content ${contentScore ?? 'n/a'}, authority ${authorityScore ?? 'n/a'}.`;
  }

  return {
    overall_health_score: overallHealthScore,
    primary_problem: primaryProblem,
    top_3_actions: topActions,
    growth_opportunity: growthOpportunity,
    confidence,
  };
}

function buildGeoAeoVisuals(params: {
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
}): SnapshotReport['geo_aeo_visuals'] {
  const context = params.publicAudit?.geo_aeo_context;
  const answerGap = context?.queries.filter((item) => item.coverage === 'missing').length ?? 0;
  const partialGap = context?.queries.filter((item) => item.coverage === 'partial').length ?? 0;
  const totalQueries = context?.queries.length ?? 0;
  const answerGapPct = totalQueries > 0 ? Math.round((answerGap / totalQueries) * 100) : null;
  const structureGapPct = typeof context?.structured_content_pct === 'number' ? Math.max(0, 100 - context.structured_content_pct) : null;
  const citationGapPct = typeof context?.citation_ready_pct === 'number' ? Math.max(0, 100 - context.citation_ready_pct) : null;
  const confidence: 'high' | 'medium' | 'low' =
    totalQueries >= 4 && typeof context?.structured_content_pct === 'number' ? 'high' :
    totalQueries > 0 ? 'medium' : 'low';

  return {
    ai_answer_presence_radar: {
      answer_coverage_score: context?.answer_coverage_score ?? null,
      entity_clarity_score: context?.entity_clarity_score ?? null,
      topical_authority_score: context?.topical_authority_score ?? null,
      citation_readiness_score: context?.citation_readiness_score ?? null,
      content_structure_score: context?.content_structure_score ?? null,
      freshness_score: context?.freshness_score ?? null,
      confidence,
      data_source_strength: context ? (confidence === 'high' ? 'strong' : confidence === 'medium' ? 'inferred' : 'weak') : 'missing',
      source_tags: context ? ['crawler', 'content', 'structure'] : null,
    },
    query_answer_coverage_map: {
      queries: context?.queries ?? [],
      confidence,
    },
    answer_extraction_funnel: {
      total_queries: totalQueries || null,
      answerable_content_pct: context?.answerable_content_pct ?? null,
      structured_content_pct: context?.structured_content_pct ?? null,
      citation_ready_pct: context?.citation_ready_pct ?? null,
      confidence,
      drop_off_reason_distribution: {
        answer_gap_pct: answerGapPct,
        structure_gap_pct: structureGapPct,
        citation_gap_pct: citationGapPct,
      },
    },
    entity_authority_map: {
      entities: context?.entities ?? [],
      confidence,
    },
  };
}

function buildGeoAeoExecutiveSummary(params: {
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
}): SnapshotReport['geo_aeo_executive_summary'] {
  const radar = params.geoAeoVisuals.ai_answer_presence_radar;
  const funnel = params.geoAeoVisuals.answer_extraction_funnel;
  const entities = params.geoAeoVisuals.entity_authority_map.entities;
  const missingQueries = params.geoAeoVisuals.query_answer_coverage_map.queries.filter((item) => item.coverage === 'missing');
  const overallAiVisibilityScore = Math.round(
    [
      radar.answer_coverage_score,
      radar.entity_clarity_score,
      radar.topical_authority_score,
      radar.citation_readiness_score,
      radar.content_structure_score,
    ].filter((value): value is number => typeof value === 'number')
      .reduce((sum, value, _, arr) => sum + value / arr.length, 0) || 0
  );

  const primaryGap =
    (funnel.drop_off_reason_distribution.answer_gap_pct ?? 0) >= Math.max(funnel.drop_off_reason_distribution.structure_gap_pct ?? 0, funnel.drop_off_reason_distribution.citation_gap_pct ?? 0)
      ? {
          title: missingQueries.length > 0 ? `Important answer queries are still missing coverage` : 'Answer coverage is too thin for AI visibility',
          type: 'answer_gap' as const,
          severity: severityLabel(funnel.drop_off_reason_distribution.answer_gap_pct ?? 0),
          reasoning: missingQueries.length > 0
            ? `${missingQueries.length} query clusters still lack full answer coverage, which makes the site harder to reuse in AI answer experiences.`
            : 'The current content does not answer enough likely user questions in a complete, reusable format.',
          if_not_addressed: 'If not addressed, AI answer visibility will remain constrained and citation-driven discovery will continue to underperform.',
        }
      : (funnel.drop_off_reason_distribution.structure_gap_pct ?? 0) >= (funnel.drop_off_reason_distribution.citation_gap_pct ?? 0)
        ? {
            title: 'Content structure is limiting answer extraction',
            type: 'structure_gap' as const,
            severity: severityLabel(funnel.drop_off_reason_distribution.structure_gap_pct ?? 0),
            reasoning: 'The current page structure does not make answers easy to extract, summarize, and cite consistently.',
            if_not_addressed: 'If not addressed, answer extraction quality will remain low and AI systems will keep deprioritizing these pages.',
          }
        : {
            title: 'Citation readiness is still below what AI visibility requires',
            type: 'structure_gap' as const,
            severity: severityLabel(funnel.drop_off_reason_distribution.citation_gap_pct ?? 0),
            reasoning: 'Clear summaries, evidence density, and citation-ready passages are still too uneven across important pages.',
            if_not_addressed: 'If not addressed, authority in AI answer surfaces will remain weak even if technical SEO improves.',
          };

  const top3Actions = [
    {
      action_title: 'Add direct-answer sections to the highest-value query pages',
      priority: 'high' as const,
      expected_impact: 'high' as const,
      effort: 'medium' as const,
      linked_visual: 'matrix' as const,
      reasoning: 'This closes the biggest answer coverage gaps shown in the query coverage map.',
    },
    {
      action_title: 'Improve page structure with stronger summaries, FAQs, and heading hierarchy',
      priority: 'high' as const,
      expected_impact: 'medium' as const,
      effort: 'medium' as const,
      linked_visual: 'funnel' as const,
      reasoning: 'This improves answer extraction and raises structured content coverage for AI visibility.',
    },
    {
      action_title: 'Strengthen entity mentions and proof around the core brand and service terms',
      priority: entities.length > 0 ? 'medium' as const : 'low' as const,
      expected_impact: 'medium' as const,
      effort: 'medium' as const,
      linked_visual: 'radar' as const,
      reasoning: 'This improves entity clarity and makes the site easier to interpret as an authoritative source.',
    },
  ];

  const topQuery = missingQueries[0] ?? params.geoAeoVisuals.query_answer_coverage_map.queries
    .sort((left, right) => right.answer_quality_score - left.answer_quality_score)[0];

  return {
    overall_ai_visibility_score: overallAiVisibilityScore,
    primary_gap: primaryGap,
    top_3_actions: top3Actions,
    visibility_opportunity: topQuery
      ? {
          title: `Improve AI answer visibility for "${topQuery.query}"`,
          estimated_ai_exposure: `Improving this query cluster could lift answer coverage quality from the current ${topQuery.answer_quality_score}/100 baseline.`,
          based_on: 'Based on query answer coverage plus answer extraction funnel drop-off.',
        }
      : null,
    confidence: radar.confidence,
  };
}

function severityWeight(value: 'critical' | 'moderate' | 'low'): number {
  if (value === 'critical') return 3;
  if (value === 'moderate') return 2;
  return 1;
}

function normalizeActionRoot(text: string): string {
  const lower = text.toLowerCase();
  if (/(query|answer|faq|summary|answerable)/.test(lower)) return 'answer_coverage';
  if (/(entity|brand|authority term)/.test(lower)) return 'entity_clarity';
  if (/(citation|proof|evidence|factual)/.test(lower)) return 'citation_readiness';
  if (/(crawl|metadata|internal link|structure|technical)/.test(lower)) return 'technical_structure';
  if (/(keyword|serp|ranking|search visibility|click)/.test(lower)) return 'search_capture';
  if (/(content|topic|coverage)/.test(lower)) return 'content_depth';
  return lower.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join('_') || 'general';
}

function buildUnifiedIntelligenceSummary(params: {
  coreProblem: string;
  seoSummary: SnapshotReport['seo_executive_summary'];
  geoAeoSummary: SnapshotReport['geo_aeo_executive_summary'];
  narrativeContext?: NarrativeContext;
}): SnapshotReport['unified_intelligence_summary'] {
  const seoScore = Number(params.seoSummary.overall_health_score ?? 0);
  const geoScore = Number(params.geoAeoSummary.overall_ai_visibility_score ?? 0);
  const seoAvailable = seoScore > 0;
  const geoAvailable = geoScore > 0;
  const weightedScore =
    seoAvailable && geoAvailable
      ? Math.round(seoScore * 0.5 + geoScore * 0.5)
      : seoAvailable
        ? seoScore
        : geoAvailable
          ? geoScore
          : 0;

  const channelDiff = seoScore - geoScore;
  const dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced' =
    channelDiff >= 12 ? 'seo' : channelDiff <= -12 ? 'geo_aeo' : 'balanced';

  const seoConstraint = params.seoSummary.primary_problem;
  const geoConstraint = params.geoAeoSummary.primary_gap;
  const primaryConstraint =
    severityWeight(seoConstraint.severity) >= severityWeight(geoConstraint.severity)
      ? {
          title: normalizeCoreProblem(params.coreProblem),
          source: 'seo' as const,
          severity: seoConstraint.severity,
          reasoning: seoConstraint.reasoning,
          if_not_addressed: seoConstraint.if_not_addressed,
        }
      : {
          title: normalizeCoreProblem(params.coreProblem),
          source: 'geo_aeo' as const,
          severity: geoConstraint.severity,
          reasoning: geoConstraint.reasoning,
          if_not_addressed: geoConstraint.if_not_addressed,
        };

  const mergedActions = [
    ...params.seoSummary.top_3_actions.map((action) => ({ ...action, source: 'seo' as const })),
    ...params.geoAeoSummary.top_3_actions.map((action) => ({ ...action, source: 'geo_aeo' as const })),
  ];

  const domainCount = { seo: 0, geo_aeo: 0 };
  const seenActionTitles = new Set<string>();
  const seenRoots = new Set<string>();
  const top3UnifiedActions: SnapshotReport['unified_intelligence_summary']['top_3_unified_actions'] = [];

  for (const action of mergedActions) {
    if (top3UnifiedActions.length >= 3) break;
    const normalizedTitle = action.action_title.toLowerCase().trim();
    if (seenActionTitles.has(normalizedTitle)) continue;
    const root = normalizeActionRoot(action.action_title);
    if (seenRoots.has(root)) continue;
    if (domainCount[action.source] >= 2) continue;

    seenActionTitles.add(normalizedTitle);
    seenRoots.add(root);
    domainCount[action.source] += 1;
    top3UnifiedActions.push({
      action_title: action.action_title,
      source: action.source,
      priority: action.priority,
      expected_impact: action.expected_impact,
      effort: action.effort,
      reasoning: action.reasoning,
    });
  }

  while (top3UnifiedActions.length < 3 && mergedActions[top3UnifiedActions.length]) {
    const fallback = mergedActions[top3UnifiedActions.length];
    top3UnifiedActions.push({
      action_title: fallback.action_title,
      source: fallback.source,
      priority: fallback.priority,
      expected_impact: fallback.expected_impact,
      effort: fallback.effort,
      reasoning: fallback.reasoning,
    });
  }

  const growthDirection = dominantGrowthChannel === 'seo'
    ? {
        short_term_focus: params.seoSummary.growth_opportunity?.title || 'Recover search visibility leaks and improve keyword capture.',
        long_term_focus: 'Build stronger AI-answer structure after search fundamentals are stable.',
      }
    : dominantGrowthChannel === 'geo_aeo'
      ? {
          short_term_focus: params.geoAeoSummary.visibility_opportunity?.title || 'Improve answer coverage for high-value query clusters.',
          long_term_focus: 'Scale entity authority and citation readiness across core commercial pages.',
        }
      : {
          short_term_focus: 'Run paired SEO + GEO/AEO quick wins to reduce technical and answer-extraction drop-offs in parallel.',
          long_term_focus: 'Build a balanced visibility engine where ranking strength and AI-answer reuse grow together.',
        };

  let confidence: 'high' | 'medium' | 'low' =
    params.seoSummary.confidence === 'high' && params.geoAeoSummary.confidence === 'high'
      ? 'high'
      : params.seoSummary.confidence === 'low' && params.geoAeoSummary.confidence === 'low'
        ? 'low'
        : 'medium';
  const weakChannelCount =
    (params.seoSummary.confidence === 'low' ? 1 : 0) +
    (params.geoAeoSummary.confidence === 'low' ? 1 : 0);
  if (weakChannelCount >= 1 && confidence === 'high') confidence = 'medium';
  if (weakChannelCount >= 2) confidence = 'low';
  const unifiedSignals: NarrativeSignal[] = [];
  if (seoScore <= 65 || dominantGrowthChannel === 'seo') {
    unifiedSignals.push({
      key: 'visibility_loss',
      text: `visibility loss with SEO health at ${seoScore}/100`,
    });
  }
  if ((params.seoSummary.primary_problem.impacted_area === 'backlinks' || /authority|trust|backlink/i.test(params.seoSummary.primary_problem.title))) {
    unifiedSignals.push({
      key: 'authority_gap',
      text: `authority gap signals around ${params.seoSummary.primary_problem.title.toLowerCase()}`,
    });
  }
  if (params.seoSummary.primary_problem.impacted_area === 'content' || /content|coverage|topic/i.test(params.seoSummary.primary_problem.title)) {
    unifiedSignals.push({
      key: 'content_coverage',
      text: `content coverage pressure linked to ${params.seoSummary.primary_problem.title.toLowerCase()}`,
    });
  }
  if (unifiedSignals.length === 0) {
    unifiedSignals.push({
      key: 'visibility_loss',
      text: `channel spread of ${Math.abs(channelDiff)} points between SEO (${seoScore}) and AI visibility (${geoScore})`,
    });
  }
  const unifiedContext = params.narrativeContext ?? createNarrativeContext();
  const selectedUnifiedSignals = pickNarrativeSignals({
    section: 'unified',
    candidates: unifiedSignals,
    context: unifiedContext,
  });
  const tone = getTone(primaryConstraint.severity);
  const unifiedTemplate = pickTemplate({
    section: 'unified',
    templates: UNIFIED_TEMPLATES,
    context: unifiedContext,
    seed: `${selectedUnifiedSignals.primary?.key ?? 'fallback'}|${selectedUnifiedSignals.secondary?.key ?? 'none'}|${NARRATIVE_INTENT.unified}`,
  });
  const marketContextSummaryDraft = selectedUnifiedSignals.primary
    ? renderTemplate(unifiedTemplate, {
        impact: toneImpactWord(tone),
        primary_signal: selectedUnifiedSignals.primary.text,
        secondary_signal: selectedUnifiedSignals.secondary?.text ?? 'secondary signal pressure',
      })
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';
  const compactMarketContextSummary = compactNarrative(marketContextSummaryDraft);
  const marketContextSummaryWithEvidence = compactNarrative(
    withEvidence(
      compactMarketContextSummary,
      `SEO ${seoScore}/100, GEO/AEO ${geoScore}/100, channel delta ${Math.abs(channelDiff)}`,
    ),
  );
  const marketContextSummary = validateNarrative(marketContextSummaryWithEvidence)
    ? clampNarrativeLength(dedupeSentences(marketContextSummaryWithEvidence), 195)
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';

  return {
    unified_score: weightedScore,
    market_context_summary: marketContextSummary,
    dominant_growth_channel: dominantGrowthChannel,
    primary_constraint: primaryConstraint,
    top_3_unified_actions: top3UnifiedActions,
    growth_direction: growthDirection,
    confidence,
  };
}

function averageCompetitorRadarScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  return average([
    item.content_score,
    item.keyword_coverage_score,
    item.authority_score,
    item.technical_score,
    item.ai_answer_presence_score,
  ]);
}

function buildCompetitorVisuals(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  visualIntelligence: SnapshotReport['visual_intelligence'];
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
  decisions: PersistedDecisionObject[];
}): SnapshotReport['competitor_visuals'] {
  const realCompetitors = params.competitorIntelligence.detected_competitors.filter(
    (item) => item.source !== 'inferred_keyword_peer' && item.source !== 'serp_unavailable_fallback',
  );
  const competitorsForRadar = realCompetitors.length > 0
    ? realCompetitors
    : params.competitorIntelligence.detected_competitors;
  const comparisonEntries = (params.competitorIntelligence.comparison?.competitors ?? []).filter((entry) => {
    const key = `${entry.competitor.domain ?? entry.competitor.name}`.toLowerCase();
    return competitorsForRadar.some((competitor) => `${competitor.domain ?? competitor.name}`.toLowerCase() === key);
  });

  const userRadar = {
    content_score: clamp(Math.round(params.visualIntelligence.seo_capability_radar.content_quality_score ?? 0), 0, 100),
    keyword_coverage_score: clamp(Math.round(params.visualIntelligence.seo_capability_radar.keyword_research_score ?? 0), 0, 100),
    authority_score: clamp(Math.round(params.visualIntelligence.seo_capability_radar.backlinks_score ?? 0), 0, 100),
    technical_score: clamp(Math.round(params.visualIntelligence.seo_capability_radar.technical_seo_score ?? 0), 0, 100),
    ai_answer_presence_score: clamp(Math.round(params.geoAeoVisuals.ai_answer_presence_radar.answer_coverage_score ?? 0), 0, 100),
  };

  const competitorRadar = comparisonEntries.slice(0, 4).map((entry) => ({
    name: entry.competitor.name,
    domain: entry.competitor.domain ?? '',
    content_score: clamp(Math.round(entry.metrics.content_depth), 0, 100),
    keyword_coverage_score: clamp(Math.round(entry.metrics.seo_coverage), 0, 100),
    authority_score: clamp(Math.round(entry.metrics.authority_score), 0, 100),
    technical_score: clamp(Math.round((entry.metrics.seo_coverage * 0.7) + (entry.metrics.publishing_frequency * 0.3)), 0, 100),
    ai_answer_presence_score: clamp(Math.round(entry.metrics.aeo_readiness), 0, 100),
  }));

  const matrixOpportunities = params.visualIntelligence.opportunity_coverage_matrix.opportunities ?? [];
  const competitorKeywordGap = params.competitorIntelligence.keyword_gap ?? null;
  const missingKeywords = (competitorKeywordGap?.missing_keywords ?? matrixOpportunities
    .filter((item) => item.opportunity_score >= 58 && item.coverage_score <= 45)
    .map((item) => item.keyword))
    .slice(0, 8);
  const weakKeywords = (competitorKeywordGap?.weak_keywords ?? matrixOpportunities
    .filter((item) => item.opportunity_score >= 52 && item.coverage_score > 45 && item.coverage_score <= 70)
    .map((item) => item.keyword))
    .slice(0, 8);
  const strongKeywords = (competitorKeywordGap?.strong_keywords ?? matrixOpportunities
    .filter((item) => item.coverage_score > 70)
    .map((item) => item.keyword))
    .slice(0, 8);

  if (missingKeywords.length === 0 && weakKeywords.length === 0 && strongKeywords.length === 0) {
    const keywordPayloads = params.decisions
      .map((decision) => decision.action_payload as Record<string, unknown> | null)
      .filter((payload): payload is Record<string, unknown> => Boolean(payload))
      .map((payload) => {
        if (typeof payload.keyword === 'string' && payload.keyword.trim()) return payload.keyword.trim();
        if (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) return payload.keyword_theme.trim();
        return null;
      })
      .filter((item): item is string => Boolean(item));
    weakKeywords.push(...keywordPayloads.slice(0, 6));
  }

  const coverageQueries = params.geoAeoVisuals.query_answer_coverage_map.queries ?? [];
  const competitorAnswerGap = params.competitorIntelligence.answer_gap ?? null;
  const missingAnswers = (competitorAnswerGap?.missing_answers ?? coverageQueries.filter((item) => item.coverage === 'missing').map((item) => item.query)).slice(0, 8);
  const weakAnswers = (competitorAnswerGap?.weak_answers ?? coverageQueries.filter((item) => item.coverage === 'partial').map((item) => item.query)).slice(0, 8);
  const strongAnswers = (competitorAnswerGap?.strong_answers ?? coverageQueries.filter((item) => item.coverage === 'full').map((item) => item.query)).slice(0, 8);

  const competitorConfidence: 'high' | 'medium' | 'low' =
    comparisonEntries.length >= 2 ? 'high' : comparisonEntries.length === 1 ? 'medium' : 'low';
  const keywordConfidence: 'high' | 'medium' | 'low' =
    matrixOpportunities.length >= 3 ? 'high' : matrixOpportunities.length > 0 ? 'medium' : 'low';
  const answerConfidence: 'high' | 'medium' | 'low' =
    coverageQueries.length >= 4 ? 'high' : coverageQueries.length > 0 ? 'medium' : 'low';

  return {
    competitor_positioning_radar: {
      competitors: competitorRadar,
      user: userRadar,
      confidence: competitorConfidence,
    },
    keyword_gap_analysis: {
      missing_keywords: [...new Set(missingKeywords)],
      weak_keywords: [...new Set(weakKeywords)],
      strong_keywords: [...new Set(strongKeywords)],
      confidence: keywordConfidence,
    },
    ai_answer_gap_analysis: {
      missing_answers: [...new Set(missingAnswers)],
      weak_answers: [...new Set(weakAnswers)],
      strong_answers: [...new Set(strongAnswers)],
      confidence: answerConfidence,
    },
  };
}

function buildCompetitorIntelligenceSummary(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  competitorVisuals: SnapshotReport['competitor_visuals'];
  narrativeContext?: NarrativeContext;
}): SnapshotReport['competitor_intelligence_summary'] {
  const radarCompetitors = params.competitorVisuals.competitor_positioning_radar.competitors;
  if (radarCompetitors.length === 0) {
    return null;
  }

  const user = params.competitorVisuals.competitor_positioning_radar.user;
  const topCompetitor = [...radarCompetitors].sort((left, right) => averageCompetitorRadarScore(right) - averageCompetitorRadarScore(left))[0];

  const keywordGap = clamp(topCompetitor.keyword_coverage_score - user.keyword_coverage_score, 0, 100);
  const authorityGap = clamp(topCompetitor.authority_score - user.authority_score, 0, 100);
  const answerGap = clamp(topCompetitor.ai_answer_presence_score - user.ai_answer_presence_score, 0, 100);

  const rankedGaps = [
    {
      type: 'keyword_gap' as const,
      score: keywordGap,
      title: `Keyword coverage trails ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} is currently stronger on commercially relevant keyword capture, constraining your qualified discovery share.`,
    },
    {
      type: 'authority_gap' as const,
      score: authorityGap,
      title: `Authority signals are behind ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} signals stronger trust and authority, which can influence both ranking resilience and conversion confidence.`,
    },
    {
      type: 'answer_gap' as const,
      score: answerGap,
      title: `AI answer presence is weaker than ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} is currently more answer-ready for AI retrieval patterns, reducing your visibility in answer-led discovery moments.`,
    },
  ].sort((left, right) => right.score - left.score);

  const strongestGap = rankedGaps[0];
  const strongestGapConsequence =
    strongestGap.type === 'authority_gap'
      ? 'If not addressed, trust constraints will keep conversion quality and ranking resilience below potential.'
      : strongestGap.type === 'answer_gap'
        ? 'If not addressed, AI answer visibility will remain constrained even if new content is published.'
        : 'If not addressed, high-intent keyword demand will continue to be captured by competitors.';
  const primaryGapSeverity: 'critical' | 'moderate' | 'low' =
    strongestGap.score >= 16 ? 'critical' : strongestGap.score >= 8 ? 'moderate' : 'low';

  const actionTemplates = {
    keyword_gap: [
      {
        action_title: 'Close high-intent keyword gaps against top competitors',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning: 'Expand and strengthen the pages where competitors consistently outrank you on commercial intent terms.',
      },
      {
        action_title: 'Improve SERP capture with stronger page intent and metadata',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'low' as const,
        reasoning: 'Tighter metadata and clearer intent mapping can recover click share before deeper content rewrites.',
      },
    ],
    authority_gap: [
      {
        action_title: 'Strengthen trust and authority signals on core pages',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning: 'Competitors are winning credibility moments earlier; improve proof blocks, case evidence, and authority cues.',
      },
      {
        action_title: 'Build authority assets that support rankings and conversion trust',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'high' as const,
        reasoning: 'Targeted authority assets can compound search strength and reduce buyer hesitation in evaluation phases.',
      },
    ],
    answer_gap: [
      {
        action_title: 'Upgrade pages with direct-answer blocks for key buyer queries',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning: 'Competitors appear more extractable by AI systems; structured answer sections improve citation and reuse likelihood.',
      },
      {
        action_title: 'Improve entity and citation readiness across strategic pages',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'medium' as const,
        reasoning: 'Clear entity framing and verifiable facts improve AI-answer inclusion quality over time.',
      },
    ],
  };

  const summaryActions = [
    ...actionTemplates[strongestGap.type],
    {
      action_title: `Run monthly competitor checkpoint vs ${topCompetitor.name}`,
      priority: 'medium' as const,
      expected_impact: 'medium' as const,
      effort: 'low' as const,
      reasoning: 'A recurring checkpoint keeps execution aligned with fast-moving competitor shifts.',
    },
  ].slice(0, 3);

  const userAverage = averageCompetitorRadarScore(user);
  const competitorAverage = average(radarCompetitors.map((item) => averageCompetitorRadarScore(item)));
  const competitivePosition: 'leader' | 'competitive' | 'lagging' =
    userAverage >= competitorAverage + 6
      ? 'leader'
      : userAverage >= competitorAverage - 5
        ? 'competitive'
        : 'lagging';

  const fallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  let confidence: 'high' | 'medium' | 'low' = params.competitorVisuals.competitor_positioning_radar.confidence;
  if (fallbackUsed && confidence === 'high') confidence = 'medium';
  if (fallbackUsed && radarCompetitors.length < 2) confidence = 'low';
  const contentDepthGap = clamp(topCompetitor.content_score - user.content_score, 0, 100);
  const positioningGap = clamp(
    Math.round(averageCompetitorRadarScore(topCompetitor) - averageCompetitorRadarScore(user)),
    0,
    100,
  );
  const competitorSignals: NarrativeSignal[] = [
    {
      key: 'authority_comparison',
      text: `authority comparison gap of ${Math.round(authorityGap)} points`,
    },
    {
      key: 'content_depth',
      text: `content depth gap of ${Math.round(contentDepthGap)} points`,
    },
    {
      key: 'positioning',
      text: `market positioning gap of ${Math.round(positioningGap)} points`,
    },
  ].filter((signal) => signal.text.includes('0 points') === false);
  if (competitorSignals.length === 0) {
    competitorSignals.push({
      key: 'positioning',
      text: `positioning lead visible in competitor radar averages`,
    });
  }
  const competitorContext = params.narrativeContext ?? createNarrativeContext();
  const selectedCompetitorSignals = pickNarrativeSignals({
    section: 'competitor',
    candidates: competitorSignals,
    context: competitorContext,
  });
  const specificArea =
    strongestGap.type === 'authority_gap'
      ? 'trust and proof signals'
      : strongestGap.type === 'answer_gap'
        ? 'answer-ready page structure'
        : 'commercial keyword coverage';
  const competitorTemplate = pickTemplate({
    section: 'competitor',
    templates: COMPETITOR_TEMPLATES,
    context: competitorContext,
    seed: `${selectedCompetitorSignals.primary?.key ?? 'fallback'}|${specificArea}|${NARRATIVE_INTENT.competitor}`,
  });
  const competitorExplanationDraft = selectedCompetitorSignals.primary
    ? renderTemplate(competitorTemplate, {
        competitor: topCompetitor.name,
        primary_signal: selectedCompetitorSignals.primary.text,
        specific_area: specificArea,
      })
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';
  const compactCompetitorExplanation = compactNarrative(competitorExplanationDraft);
  const fallbackTransparencyNote = 'Peer set is inferred because live SERP discovery was unavailable, so comparisons are directional.';
  const explanationWithTransparency = fallbackUsed
    ? compactNarrative(`${compactCompetitorExplanation} ${fallbackTransparencyNote}`)
    : compactCompetitorExplanation;
  const competitorEvidence = `keyword gap ${Math.round(keywordGap)} points, authority gap ${Math.round(authorityGap)} points, answer gap ${Math.round(answerGap)} points`;
  const competitorExplanationWithEvidence = compactNarrative(withEvidence(explanationWithTransparency, competitorEvidence));
  const competitorExplanation = validateNarrative(competitorExplanationWithEvidence)
    ? clampNarrativeLength(dedupeSentences(competitorExplanationWithEvidence), 195)
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';

  return {
    top_competitor: fallbackUsed ? `${topCompetitor.name} (benchmark)` : topCompetitor.name,
    competitor_explanation: competitorExplanation,
    primary_gap: {
      title: strongestGap.title,
      type: strongestGap.type,
      severity: primaryGapSeverity,
      reasoning: strongestGap.reasoning,
      if_not_addressed: strongestGapConsequence,
    },
    top_3_actions: summaryActions,
    competitive_position: competitivePosition,
    confidence,
  };
}

export function composeSnapshotReportFromDecisions(params: {
  companyId: string;
  snapshotDecisions: PersistedDecisionObject[];
  supplementalGrowthDecisions?: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
  readiness?: ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
  competitorIntelligenceOverride?: CompetitorIntelligenceResult | null;
}): SnapshotReport {
  const supplementalGrowthDecisions = params.supplementalGrowthDecisions ?? [];
  const baseCombined = uniqueById([...params.snapshotDecisions, ...supplementalGrowthDecisions]);
  const competitorIntelligence = params.competitorIntelligenceOverride ?? buildCompetitorIntelligence({
    decisions: baseCombined,
    resolvedInput: params.resolvedInput,
  });
  const competitorDecisions = competitorGapsToDecisions({
    companyId: params.companyId,
    gaps: competitorIntelligence.generated_gaps,
    reportTier: 'snapshot',
  });
  const combined = uniqueById([...baseCombined, ...competitorDecisions]);
  const floor = ensureSnapshotDecisionFloor({
    companyId: params.companyId,
    decisions: combined,
    resolvedInput: params.resolvedInput,
  });
  const finalDecisions = floor.decisions;
  const signalAvailability = signalAvailabilityFromDecisions({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
  });
  const companyContext = extractCompanyNarrativeContext({
    resolvedInput: params.resolvedInput,
  });
  const strategicContext = assessPositioningAndMarket({
    companyContext,
    competitorIntelligence,
    decisions: finalDecisions,
    publicAudit: params.publicAudit ?? null,
  });

  let sections = SNAPSHOT_SECTION_DEFINITIONS.map((definition) => {
    const sectionDecisions = finalDecisions
      .filter(definition.matches)
      .sort(rankByImpactConfidence);

    return {
      section_name: definition.section_name,
      IU_ids: definition.IU_ids,
      insights: sectionDecisions.slice(0, 4).map((decision) => toInsight(decision, companyContext)),
      opportunities: sectionDecisions.filter(isOpportunityCandidate).slice(0, 2).map(toOpportunity),
      actions: sortSectionActions(sectionDecisions.slice(0, 3).map((decision) => toAction(decision, companyContext, strategicContext))),
    } satisfies SnapshotReportSection;
  });

  sections = sections.map((section, index) => {
    const ensured = ensureSectionFloor(
      section,
      finalDecisions,
      SNAPSHOT_SECTION_DEFINITIONS[index],
      companyContext,
      strategicContext,
    );
    return {
      ...ensured,
      actions: sortSectionActions(ensured.actions),
    };
  });

  let totalInsights = sections.reduce((sum, section) => sum + section.insights.length, 0);
  let totalActions = sections.reduce((sum, section) => sum + section.actions.length, 0);

  if (totalInsights < SNAPSHOT_MIN_INSIGHTS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.insights.map((item) => item.decision_id)));
    const signalCounts = new Map<string, number>();
    for (const section of sections) {
      for (const insight of section.insights) {
        const key = signalKeyFromIssueType(insight.issue_type);
        signalCounts.set(key, (signalCounts.get(key) ?? 0) + 1);
      }
    }
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      const signalKey = signalKeyFromIssueType(decision.issue_type);
      if ((signalCounts.get(signalKey) ?? 0) >= 2) continue;
      sections[0].insights.push(toInsight(decision, companyContext));
      existingIds.add(decision.id);
      signalCounts.set(signalKey, (signalCounts.get(signalKey) ?? 0) + 1);
      totalInsights += 1;
      if (totalInsights >= SNAPSHOT_MIN_INSIGHTS) break;
    }
  }

  if (totalActions < SNAPSHOT_MIN_ACTIONS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.actions.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].actions.push(toAction(decision, companyContext, strategicContext));
      existingIds.add(decision.id);
      totalActions += 1;
      if (totalActions >= SNAPSHOT_MIN_ACTIONS) break;
    }
    sections[0].actions = sortSectionActions(sections[0].actions);
  }

  sections = capSignalReuseAcrossSections(sections, 2);
  sections = capActionMentionsAcrossSections(sections, 1);
  totalInsights = sections.reduce((sum, section) => sum + section.insights.length, 0);
  totalActions = sections.reduce((sum, section) => sum + section.actions.length, 0);

  if (totalInsights < SNAPSHOT_MIN_INSIGHTS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.insights.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].insights.push(toInsight(decision, companyContext));
      existingIds.add(decision.id);
      totalInsights += 1;
      if (totalInsights >= SNAPSHOT_MIN_INSIGHTS) break;
    }
  }

  if (totalActions < SNAPSHOT_MIN_ACTIONS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.actions.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].actions.push(toAction(decision, companyContext, strategicContext));
      existingIds.add(decision.id);
      totalActions += 1;
      if (totalActions >= SNAPSHOT_MIN_ACTIONS) break;
    }
    sections[0].actions = sortSectionActions(sections[0].actions);
  }

  const narrative = synthesizePrimaryNarrative(finalDecisions);
  const coreProblem = normalizeCoreProblem(narrative.primary_problem);
  const diagnosis = buildDiagnosis({
    narrative,
    companyContext,
    strategicContext,
  });
  const score = buildReportScoreModel({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
    competitorIntelligence,
  });
  const narrativeContext = createNarrativeContext();
  const visualIntelligence = buildSnapshotVisualIntelligence({
    decisions: finalDecisions,
    score,
    competitorIntelligence,
    publicAudit: params.publicAudit ?? null,
    narrativeContext,
  });
  const geoAeoVisuals = buildGeoAeoVisuals({
    publicAudit: params.publicAudit ?? null,
  });
  const topPriorities = buildTopPriorities(sections);
  const summary = buildSummary({
    sections,
    signalAvailability,
    competitorIntelligence,
    narrative,
    readiness: params.readiness,
    topPriorityTitle: topPriorities[0]?.title ?? null,
    coreProblem,
    companyContext,
  });
  const seoExecutiveSummary = buildSeoExecutiveSummary({
    decisions: finalDecisions,
    score,
    visualIntelligence,
    topPriorities,
  });
  const geoAeoExecutiveSummary = buildGeoAeoExecutiveSummary({
    geoAeoVisuals,
  });
  const unifiedIntelligenceSummary = buildUnifiedIntelligenceSummary({
    coreProblem,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    narrativeContext,
  });
  const competitorVisuals = buildCompetitorVisuals({
    competitorIntelligence,
    visualIntelligence,
    geoAeoVisuals,
    decisions: finalDecisions,
  });
  const competitorIntelligenceSummary = buildCompetitorIntelligenceSummary({
    competitorIntelligence,
    competitorVisuals,
    narrativeContext,
  });
  const decisionSnapshot = buildDecisionSnapshot({
    diagnosis,
    coreProblem,
    companyContext,
    strategicContext,
    signalAvailability,
    unifiedSummary: unifiedIntelligenceSummary,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    competitorSummary: competitorIntelligenceSummary,
    competitorIntelligence,
    topPriorities,
  });

  return {
    report_type: 'snapshot',
    score,
    diagnosis,
    summary,
    primary_problem: coreProblem,
    secondary_problems: narrative.secondary_problems.slice(0, 2),
    seo_executive_summary: seoExecutiveSummary,
    geo_aeo_visuals: geoAeoVisuals,
    geo_aeo_executive_summary: geoAeoExecutiveSummary,
    unified_intelligence_summary: unifiedIntelligenceSummary,
    competitor_visuals: competitorVisuals,
    competitor_intelligence_summary: competitorIntelligenceSummary,
    visual_intelligence: visualIntelligence,
    signal_availability: signalAvailability,
    company_context: {
      company_name: companyContext.companyName,
      domain: companyContext.domain,
      homepage_headline: companyContext.homepageHeadline,
      tagline: companyContext.tagline,
      primary_offering: companyContext.primaryOffering,
      positioning: companyContext.positioning,
      market_context: companyContext.marketContext,
      positioning_strength: strategicContext.positioningStrength,
      positioning_narrative: strategicContext.positioningNarrative,
      positioning_gap: strategicContext.positioningGap,
      market_type: strategicContext.marketType,
      market_narrative: strategicContext.marketNarrative,
      strategy_alignment: strategicContext.strategyAlignment,
      market_position: strategicContext.marketPosition,
      market_position_statement: strategicContext.marketPositionStatement,
      position_implication: strategicContext.positionImplication,
      execution_risk: strategicContext.executionRisk,
      resilience_guidance: strategicContext.resilienceGuidance,
    },
    competitor_intelligence: competitorIntelligence,
    decision_snapshot: decisionSnapshot,
    top_priorities: topPriorities,
    pipeline_audit: {
      resolver_inputs_present: resolverInputsPresent(params.resolvedInput),
      snapshot_decisions: params.snapshotDecisions.length,
      supplemental_growth_decisions: supplementalGrowthDecisions.length,
      competitor_gap_decisions_added: competitorDecisions.length,
      fallback_decisions_added: floor.fallbackAdded,
      final_decisions: finalDecisions.length,
      final_insights: sections.reduce((sum, section) => sum + section.insights.length, 0),
      final_actions: sections.reduce((sum, section) => sum + section.actions.length, 0),
    },
    sections,
  };
}

export async function composeSnapshotReport(
  companyId: string,
  options?: SnapshotReportOptions,
): Promise<SnapshotReport> {
  const [snapshotComposition, growthComposition] = await Promise.all([
    composeDecisionIntelligence({
      companyId,
      reportTier: 'snapshot',
      status: ['open'],
    }),
    composeDecisionIntelligence({
      companyId,
      reportTier: 'growth',
      status: ['open'],
    }),
  ]);

  const growthSupplement = growthComposition.decisions.filter((decision) => {
    const category = classifyDecisionType(decision.issue_type);
    return category === 'authority' || category === 'trust' || category === 'geo' || isContentDecision(decision) || isCompetitorDecision(decision);
  });
  const publicAudit = await buildPublicDomainAuditDecisions({
    companyId,
    reportTier: 'snapshot',
    resolvedInput: options?.resolvedInput ?? null,
  });
  const activeCompetitorIntelligence = await buildCompetitorIntelligenceActive({
    companyId,
    decisions: uniqueById([...snapshotComposition.decisions, ...growthSupplement, ...publicAudit.decisions]),
    resolvedInput: options?.resolvedInput ?? null,
  });

  return composeSnapshotReportFromDecisions({
    companyId,
    snapshotDecisions: [...snapshotComposition.decisions, ...publicAudit.decisions],
    supplementalGrowthDecisions: growthSupplement,
    resolvedInput: options?.resolvedInput ?? null,
    readiness: options?.readiness ?? null,
    publicAudit,
    competitorIntelligenceOverride: activeCompetitorIntelligence,
  });
}

export function createSnapshotInsightsFromComposition(insights: ComposedDecisionInsight[]): SnapshotInsight[] {
  return insights.map((insight) => ({
    decision_id: insight.decision_id,
    title: insight.title,
    description: insight.description,
    why_it_matters: '',
    issue_type: insight.issue_type,
    confidence_score: insight.confidence_score,
    impact_score: insight.impact_score,
    recommendation: insight.recommendation,
    action_type: insight.action_type,
    business_impact: insight.business_impact || '',
  }));
}
