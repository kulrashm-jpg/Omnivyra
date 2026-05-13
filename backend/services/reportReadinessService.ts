import type { ResolvedReportCategory, ResolvedReportInput } from './reportInputResolver';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { resolveAnalyticsReportInput } from './analyticsInputResolver';
import { resolveSnapshotReportInput } from './snapshotInputResolver';
import { getCompanyProfileReviewStatus } from './companyProfileService';
import { getGoogleProviderReadiness, type GoogleCapabilityKey, type GoogleCapabilityReadiness } from './googleProviderReadinessService';

export type ReportReadinessResult = {
  report_category: ResolvedReportCategory;
  ready: boolean;
  missing_requirements: string[];
  estimated_credit_cost: number;
  warnings?: string[];
};

export type ReportReadinessSummary = {
  company_id: string;
  reports: Record<ResolvedReportCategory, ReportReadinessResult>;
  integration_state: ResolvedReportInput['integrations'];
  provider_readiness: Record<GoogleCapabilityKey, GoogleCapabilityReadiness>;
  resolved_inputs: ResolvedReportInput['resolved'];
};

function requirementIfMissing(condition: boolean, label: string): string[] {
  return condition ? [] : [label];
}

function estimateCredits(reportCategory: ResolvedReportCategory): number {
  if (reportCategory === 'growth') return 80;
  if (reportCategory === 'performance') return 60;
  return 0;
}

export async function evaluateResolvedReportReadiness(input: ResolvedReportInput): Promise<ReportReadinessResult> {
  const profileReview = getCompanyProfileReviewStatus(input.profile);
  const snapshotBaseRequirements = [
    ...requirementIfMissing(Boolean(input.resolved.websiteDomain), 'Add a valid website domain'),
    ...requirementIfMissing(
      !profileReview.facts_present || !profileReview.pending_confirmation,
      'Company admin should confirm company facts (team size, founded year, revenue range)',
    ),
  ];
  const advancedRequirements = [
    ...snapshotBaseRequirements,
    ...requirementIfMissing(Boolean(input.resolved.businessType), 'Add your business type'),
    ...requirementIfMissing(Boolean(input.resolved.geography), 'Add your target geography'),
  ];

  if (input.reportCategory === 'snapshot') {
    return {
      report_category: 'snapshot',
      ready: snapshotBaseRequirements.length === 0,
      missing_requirements: snapshotBaseRequirements,
      estimated_credit_cost: estimateCredits('snapshot'),
    };
  }

  if (input.reportCategory === 'performance') {
    const analyticsReadiness = await getAnalyticsReadiness(input.companyId);
    const hasPerformanceData =
      input.integrations.google_analytics.connected ||
      input.integrations.google_search_console.connected ||
      input.integrations.data_upload.connected ||
      input.integrations.manual_entry.connected;

    const warnings = [
      ...(!input.integrations.google_search_console.connected
        ? ['Google Search Console is not connected; organic search sections will use available fallback signals.']
        : []),
      ...(input.integrations.google_analytics.connected && !analyticsReadiness.ready
        ? [`Google Analytics is connected but limited: ${analyticsReadiness.reason}`]
        : []),
    ];

    const missing = [
      ...snapshotBaseRequirements,
      ...requirementIfMissing(
        hasPerformanceData,
        'Connect Google Analytics/Search Console, upload a file, or provide manual performance data',
      ),
    ];

    return {
      report_category: 'performance',
      ready: missing.length === 0,
      missing_requirements: missing,
      estimated_credit_cost: estimateCredits('performance'),
      warnings,
    };
  }

  const hasGrowthData =
    input.integrations.google_analytics.connected ||
    input.integrations.google_search_console.connected ||
    input.integrations.google_ads.connected ||
    input.integrations.linkedin_ads.connected ||
    input.integrations.meta_ads.connected ||
    input.integrations.data_upload.connected ||
    input.integrations.manual_entry.connected ||
    input.integrations.website_crawl.connected;

  const missing = [
    ...advancedRequirements,
    ...requirementIfMissing(input.resolved.competitors.length > 0, 'Add at least one competitor'),
    ...requirementIfMissing(
      hasGrowthData,
      'Connect market data sources, upload a file, or provide manual market inputs',
    ),
  ];

  return {
    report_category: 'growth',
    ready: missing.length === 0,
    missing_requirements: missing,
    estimated_credit_cost: estimateCredits('growth'),
  };
}

export async function getReportReadinessSummary(params: {
  companyId: string;
  requestPayload?: {
    formData?: Record<string, unknown> | null;
    generationContext?: Record<string, unknown> | null;
  } | null;
}): Promise<ReportReadinessSummary> {
  const [snapshot, performance, growth] = await Promise.all([
    resolveSnapshotReportInput({ companyId: params.companyId, requestPayload: params.requestPayload ?? undefined }),
    resolveAnalyticsReportInput({ companyId: params.companyId, reportCategory: 'performance', requestPayload: params.requestPayload ?? undefined }),
    resolveAnalyticsReportInput({ companyId: params.companyId, reportCategory: 'growth', requestPayload: params.requestPayload ?? undefined }),
  ]);

  const [snapshotReadiness, performanceReadiness, growthReadiness, providerReadiness] = await Promise.all([
    evaluateResolvedReportReadiness(snapshot),
    evaluateResolvedReportReadiness(performance),
    evaluateResolvedReportReadiness(growth),
    getGoogleProviderReadiness(params.companyId),
  ]);

  const integrationState: ResolvedReportInput['integrations'] = {
    ...snapshot.integrations,
    google_analytics: performance.integrations.google_analytics,
    google_search_console: performance.integrations.google_search_console,
    google_ads: growth.integrations.google_ads,
    linkedin_ads: growth.integrations.linkedin_ads,
    meta_ads: growth.integrations.meta_ads,
    data_upload: performance.integrations.data_upload.connected
      ? performance.integrations.data_upload
      : growth.integrations.data_upload,
    manual_entry: performance.integrations.manual_entry.connected
      ? performance.integrations.manual_entry
      : growth.integrations.manual_entry,
  };

  return {
    company_id: params.companyId,
    reports: {
      snapshot: snapshotReadiness,
      performance: performanceReadiness,
      growth: growthReadiness,
    },
    integration_state: integrationState,
    provider_readiness: providerReadiness,
    resolved_inputs: snapshot.resolved,
  };
}
