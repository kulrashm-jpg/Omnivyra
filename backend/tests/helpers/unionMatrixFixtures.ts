/**
 * Shared fixtures for the six-workstream union interaction matrix.
 *
 * Pure values and builders only. The jest.mock() calls stay in each suite: they are
 * hoisted per module and cannot be shared through an import.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */
import { execSync } from 'child_process';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

export const NOW_ISO = new Date('2026-03-31T00:00:00.000Z').toISOString();

/** Private Search Console values. None of these may appear in a Report 1 payload. */
export const GSC = {
  impressions: 12000,
  clicks: 300,
  ctr: 0.025,
  avgPosition: 12.4,
  keyword: 'crm software',
  lastSeen: '2026-03-30T00:00:00.000Z',
};

export function decision(params: {
  id: string;
  service: string;
  issueType: string;
  title: string;
  evidence: Record<string, unknown>;
  impact: number;
  payload?: Record<string, unknown>;
}): PersistedDecisionObject {
  return {
    id: params.id,
    company_id: 'c1',
    report_tier: 'snapshot',
    source_service: params.service,
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: 'description',
    evidence: params.evidence,
    impact_traffic: params.impact,
    impact_conversion: 10,
    impact_revenue: 10,
    priority_score: params.impact,
    effort_score: 20,
    execution_score: 60,
    confidence_score: 0.8,
    recommendation: 'recommendation',
    action_type: 'improve_content',
    action_payload: params.payload ?? {},
    status: 'open',
    last_changed_by: 'system',
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    resolved_at: null,
    ignored_at: null,
  } as unknown as PersistedDecisionObject;
}

/** Exactly what seoIntelligenceService emits: impact and priority derived from private impressions. */
export const gscDecision = (payload: Record<string, unknown> = { keyword: GSC.keyword }) =>
  decision({
    id: 'gsc-1',
    service: 'seoIntelligenceService',
    issueType: 'keyword_opportunity',
    title: 'Keyword impressions are not turning into clicks',
    evidence: {
      keyword: GSC.keyword,
      impressions: GSC.impressions,
      clicks: GSC.clicks,
      ctr: GSC.ctr,
      avg_position: GSC.avgPosition,
      last_seen_at: GSC.lastSeen,
    },
    impact: 100,
    payload,
  });

/** A crawl/audit finding — genuinely public evidence. */
export const publicDecision = () =>
  decision({
    id: 'pub-1',
    service: 'publicDomainAuditService',
    issueType: 'content_gap',
    title: 'Buying-stage content is thin',
    evidence: { avg_relevance: 0.62 },
    impact: 40,
    payload: { keyword: 'buying guide' },
  });

export function resolvedInput(competitors: string[] = []): ResolvedReportInput {
  return {
    companyId: 'c1',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'c1',
      name: 'Drishik',
      category: 'AI clarity platform',
      industry: 'AI wellness and decision intelligence',
      website_url: 'https://drishik.com',
      products_services: 'AI clarity engine for self-reflection and life decisions',
      products_services_list: ['AI clarity engine', 'self-reflection guidance'],
      target_audience: 'individuals seeking personal clarity',
      ideal_customer_profile: 'adults seeking private emotional support',
      brand_positioning: 'AI-guided personal clarity',
      competitive_advantages: 'private reflection',
    },
    requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: null,
      websiteDomain: 'drishik.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      socialLinks: [],
      competitors,
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance'],
        targetCustomer: 'individuals seeking personal clarity',
        idealCustomerProfile: 'adults seeking private emotional support',
        brandPositioning: 'AI-guided personal clarity',
        competitiveAdvantages: 'private reflection',
        teamSize: '1-10', foundedYear: '2024', revenueRange: 'Pre-revenue',
      },
    },
    integrations: {},
  } as unknown as ResolvedReportInput;
}

/** Every private GSC figure, in every textual form a renderer might print it. */
export const GSC_FINGERPRINTS = [
  'avg position 12.4',
  'average position 12.4',
  '12,000 impressions',
  '12000 impressions',
  '2.5% CTR',
  '2.50% CTR',
];

/** Strip comments so a structural check reads code, never the prose explaining it. */
export const executable = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

export const productionDefiners = (pattern: string): string[] =>
  execSync(`git grep -l --untracked "${pattern}" -- "backend" "pages" || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => !f.includes('/tests/'));
