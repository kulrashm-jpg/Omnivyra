/**
 * Analytics system-state API — route shell.
 *
 * Agent-B split (behavior-preserving): types + pure helpers + fetchRows live
 * in backend/apiHandlers/analytics/systemStateShared (kept out of pages/api so
 * Next.js registers no extra routes). The handler below is unchanged.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getGoogleAnalyticsStatus, getGoogleSearchConsoleStatus } from '../../../backend/services/analyticsIntegrationService';
import { getGoogleProviderReadiness, type GoogleCapabilityReadiness } from '../../../backend/services/googleProviderReadinessService';
import { getAnalyticsReadiness, type AnalyticsReadiness } from '../../../backend/services/analyticsDataReadinessService';
import { getLatestCompletedRun, getLatestRun, type IngestionRunRecord } from '../../../backend/services/ingestionRunService';
import { resolveOrganizationPlanLimits, type ResolvedPlanLimits } from '../../../backend/services/planResolutionService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';


import { BillingUsageItem, GenericRow, HealthState, IntegrationApi, IntegrationPlatform, OverviewMetric, PLATFORM_LABELS, SystemStateDataError, SystemStateResponse, TimelinePoint, TrafficState, ZERO_UUID, buildTimeline, buildWeeklyTimeline, classifyApiStatus, classifyContentType, fetchRows, formatShortDate, hasText, integrationMatches, mostRecentDate, safeNumber, startOfDay } from '../../../backend/apiHandlers/analytics/systemStateShared';

export default async function handler(req: NextApiRequest, res: NextApiResponse<SystemStateResponse | { error: string }>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Analytics-Version', 'v1');

  const user = await resolveUserContext(req);
  const companyId =
    typeof req.query.companyId === 'string' ? req.query.companyId :
    typeof req.query.company_id === 'string' ? req.query.company_id :
    user.defaultCompanyId || null;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const dataErrors: SystemStateDataError[] = [];
  const readRows = (table: string, select: string, build?: (query: any) => any) =>
    fetchRows(table, select, build, dataErrors);

  const campaignVersionRows = await readRows('campaign_versions', 'campaign_id', (query) =>
    query.eq('company_id', companyId)
  );
  const campaignIds = Array.from(
    new Set(
      campaignVersionRows
        .map((row) => String(row.campaign_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const hasCampaigns = campaignIds.length > 0;

  const [
    companyIntegrations,
    socialAccounts,
    externalApiConnections,
    campaigns,
    campaignMetrics,
    scheduledPosts,
    contentPlans,
    contentAssets,
    companyUsers,
    usageMeterRows,
    canonicalSessions,
    canonicalUsers,
    engagementThreads,
    responseMetrics,
    decisionObjects,
    reportEvents,
    pricingPlans,
  ] = await Promise.all([
    readRows('company_integrations', 'id, type, name, status, config, last_tested_at, updated_at, last_error', (query) =>
      query.eq('company_id', companyId)
    ),
    readRows('social_accounts', 'id, platform, is_active, last_sync_at, updated_at, token_expires_at, access_token', (query) =>
      query.eq('company_id', companyId)
    ),
    readRows('external_api_connections', 'id, provider_key, display_name, category, auth_type, is_active, updated_at', (query) =>
      query.eq('company_id', companyId)
    ),
    readRows('campaigns', 'id, status, created_at', (query) =>
      hasCampaigns ? query.in('id', campaignIds) : query.eq('id', ZERO_UUID)
    ),
    readRows('campaign_performance_metrics', 'platform, reach, impressions, likes, comments, shares, spend, ad_spend, cost', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    readRows('scheduled_posts', 'id, campaign_id, platform, status, published_at, created_at, updated_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    readRows('content_plans', 'campaign_id, content_type, status, created_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    readRows('content_assets', 'campaign_id, platform, status, created_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    readRows('user_company_roles', 'user_id', (query) =>
      query.eq('company_id', companyId).eq('status', 'active')
    ),
    readRows('usage_meter_monthly', 'llm_total_tokens, external_api_calls, automation_executions', (query) =>
      query.eq('organization_id', companyId).eq('year', currentYear).eq('month', currentMonth)
    ),
    readRows('canonical_sessions', 'source, started_at, session_count, session_metadata', (query) =>
      query.eq('company_id', companyId).gte('started_at', since30d)
    ),
    readRows('canonical_users', 'id, created_at', (query) =>
      query.eq('company_id', companyId).gte('created_at', since30d)
    ),
    readRows('engagement_threads', 'id, status', (query) =>
      query.eq('organization_id', companyId)
    ),
    readRows('response_performance_metrics', 'id', (query) =>
      query.eq('organization_id', companyId)
    ),
    readRows('decision_objects', 'id, status', (query) =>
      query.eq('company_id', companyId)
    ),
    readRows('report_automation_events', 'id, triggered_at', (query) =>
      query.eq('company_id', companyId)
    ),
    readRows('pricing_plans', 'plan_key, name, monthly_price, currency, is_active'),
  ]);

  const contentRows = contentPlans.length > 0 ? contentPlans : contentAssets;
  const activeUsers = new Set(companyUsers.map((row) => String(row.user_id ?? '').trim()).filter(Boolean)).size;
  const nowMs = now.getTime();
  const isPostableSocialAccount = (row: GenericRow): boolean => {
    if (row.is_active !== true) return false;
    const accessToken = typeof row.access_token === 'string' ? row.access_token.trim() : '';
    if (!accessToken) return false;
    const expiresAtRaw = row.token_expires_at;
    if (expiresAtRaw == null || expiresAtRaw === '') return false;
    const expiresAtMs = new Date(String(expiresAtRaw)).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  };
  const readySocialAccounts = socialAccounts.filter(isPostableSocialAccount);
  const platformsReady = readySocialAccounts.length;

  let googleAnalyticsStatusError: string | null = null;
  let googleProviderReadinessError: string | null = null;
  let analyticsReadinessError: string | null = null;
  let latestGaRunError: string | null = null;

  const [googleAnalyticsStatus, googleSearchConsoleStatus, googleProviderReadiness, analyticsReadiness, latestGaRun, latestCompletedGaRun] = await Promise.all([
    getGoogleAnalyticsStatus(companyId).catch((error) => {
      googleAnalyticsStatusError = error instanceof Error ? error.message : String(error);
      return null;
    }),
    getGoogleSearchConsoleStatus(companyId).catch(() => null),
    getGoogleProviderReadiness(companyId).catch((error) => {
      googleProviderReadinessError = error instanceof Error ? error.message : String(error);
      return {} as Record<string, GoogleCapabilityReadiness>;
    }),
    getAnalyticsReadiness(companyId).catch((error) => {
      analyticsReadinessError = error instanceof Error ? error.message : String(error);
      return null as AnalyticsReadiness | null;
    }),
    getLatestRun(companyId, 'ga4').catch((error) => {
      latestGaRunError = error instanceof Error ? error.message : String(error);
      return null as IngestionRunRecord | null;
    }),
    getLatestCompletedRun(companyId, 'ga4').catch(() => null as IngestionRunRecord | null),
  ]);
  const googleAnalyticsConnected = googleAnalyticsStatus?.ready === true;
  const googleSearchConsoleConnected = googleProviderReadiness.google_search_console?.connected === true;

  const apis: IntegrationApi[] = [
    ...companyIntegrations.map((row) => ({
      id: String(row.id ?? row.type ?? Math.random()),
      name: String(row.name ?? row.type ?? 'Integration'),
      category: String(row.type ?? 'integration'),
      status: classifyApiStatus(row),
      lastSyncAt: mostRecentDate(String(row.last_tested_at ?? ''), String(row.updated_at ?? '')),
    })),
    ...externalApiConnections.map((row) => ({
      id: String(row.id ?? Math.random()),
      name: String(row.display_name ?? row.provider_key ?? 'External API'),
      category: String(row.category ?? 'other'),
      status: classifyApiStatus(row),
      lastSyncAt: mostRecentDate(String(row.updated_at ?? '')),
    })),
    ...(googleAnalyticsStatus?.integration
      ? [{
          id: `analytics:${googleAnalyticsStatus.integration.id}`,
          name: 'Google Analytics',
          category: 'analytics',
          status: (googleAnalyticsConnected ? 'active' : googleAnalyticsStatus.integration.status === 'error' ? 'error' : 'disconnected') as HealthState,
          lastSyncAt: mostRecentDate(latestCompletedGaRun?.completed_at ?? null),
        }]
      : []),
    ...(googleSearchConsoleStatus?.integration
      ? [{
          id: `analytics:${googleSearchConsoleStatus.integration.id}`,
          name: 'Google Search Console',
          category: 'analytics',
          status: (googleSearchConsoleConnected ? 'active' : googleSearchConsoleStatus.integration.status === 'error' ? 'error' : 'disconnected') as HealthState,
          lastSyncAt: mostRecentDate(googleSearchConsoleStatus.integration.updated_at ?? null),
        }]
      : []),
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);

  const crmConnected =
    companyIntegrations.some((row) => integrationMatches(row, ['hubspot', 'salesforce', 'pipedrive', 'zoho crm', 'crm'])) ||
    externalApiConnections.some((row) => integrationMatches(row, ['hubspot', 'salesforce', 'pipedrive', 'zoho crm', 'crm']));

  const metricsByPlatform = campaignMetrics.reduce<Record<string, { engagementCount: number }>>((acc, row) => {
    const platform = String(row.platform ?? '').trim().toLowerCase();
    if (!platform) return acc;
    const current = acc[platform] ?? { engagementCount: 0 };
    current.engagementCount += safeNumber(row.likes) + safeNumber(row.comments) + safeNumber(row.shares);
    acc[platform] = current;
    return acc;
  }, {});

  const postsByPlatform = scheduledPosts.reduce<Record<string, GenericRow[]>>((acc, row) => {
    const platform = String(row.platform ?? '').trim().toLowerCase();
    if (!platform) return acc;
    const current = acc[platform] ?? [];
    current.push(row);
    acc[platform] = current;
    return acc;
  }, {});

  const platformKeys = Array.from(new Set([
    ...Object.keys(postsByPlatform),
    ...socialAccounts.map((row) => String(row.platform ?? '').trim().toLowerCase()).filter(Boolean),
  ])).sort();

  const platformState: IntegrationPlatform[] = platformKeys.map((platform) => {
    const readyForPlatform = readySocialAccounts.filter((row) => String(row.platform ?? '').trim().toLowerCase() === platform);
    const allPlatformAccounts = socialAccounts.filter((row) => String(row.platform ?? '').trim().toLowerCase() === platform);
    const status: HealthState = readyForPlatform.length > 0 ? 'active' : allPlatformAccounts.length > 0 ? 'error' : 'disconnected';
    const platformPosts = postsByPlatform[platform] ?? [];
    const trend = buildTimeline(7, (dateKey) => {
      return platformPosts.filter((row) => {
        const publishedAt = String(row.published_at ?? row.created_at ?? '').slice(0, 10);
        return publishedAt === dateKey && String(row.status ?? '').toLowerCase() === 'published';
      }).length;
    });

    return {
      key: platform,
      label: PLATFORM_LABELS[platform] ?? platform.replace(/^\w/, (letter) => letter.toUpperCase()),
      status,
      accountCount: allPlatformAccounts.length,
      lastSyncAt: allPlatformAccounts.reduce<string | null>((latest, row) => {
        return mostRecentDate(latest, String(row.last_sync_at ?? ''), String(row.updated_at ?? ''));
      }, null),
      postsPublished: platformPosts.filter((row) => String(row.status ?? '').toLowerCase() === 'published').length,
      engagementCount: metricsByPlatform[platform]?.engagementCount ?? 0,
      trend,
    };
  });

  const sessionsTrend = buildTimeline(7, (dateKey) => {
    return canonicalSessions.reduce((sum, row) => {
      return String(row.started_at ?? '').slice(0, 10) === dateKey ? sum + safeNumber(row.session_count || 1) : sum;
    }, 0);
  });
  const usersTrend = buildTimeline(7, (dateKey) => {
    return canonicalUsers.filter((row) => String(row.created_at ?? '').slice(0, 10) === dateKey).length;
  });

  const topSourcesMap = canonicalSessions.reduce<Record<string, number>>((acc, row) => {
    const source = String(row.source ?? 'unknown').trim().toLowerCase() || 'unknown';
    acc[source] = (acc[source] ?? 0) + safeNumber(row.session_count || 1);
    return acc;
  }, {});

  const analyticsErrors = [
    ...dataErrors.filter((error) => error.table.startsWith('canonical_')),
    ...(googleAnalyticsStatusError ? [{ table: 'google_analytics_status', message: googleAnalyticsStatusError }] : []),
    ...(googleProviderReadinessError ? [{ table: 'google_provider_readiness', message: googleProviderReadinessError }] : []),
    ...(analyticsReadinessError ? [{ table: 'analytics_readiness', message: analyticsReadinessError }] : []),
    ...(latestGaRunError ? [{ table: 'ingestion_runs', message: latestGaRunError }] : []),
  ];
  const trafficStatus: TrafficState['status'] =
    analyticsErrors.length > 0
      ? 'failed'
      : !googleAnalyticsConnected
        ? 'no_analytics'
        : analyticsReadiness?.status === 'stale'
          ? 'stale'
          : analyticsReadiness?.ready
            ? 'live'
            : 'partial';

  const trafficState: TrafficState = {
    enabled: googleAnalyticsConnected,
    status: trafficStatus,
    degraded: trafficStatus !== 'live',
    reason:
      analyticsErrors[0]?.message ??
      analyticsReadiness?.reason ??
      (googleAnalyticsConnected ? null : 'Google Analytics is not connected or ready'),
    lastSuccessfulIngestionAt: analyticsReadiness?.last_successful_ingestion_at ?? null,
    latestIngestionStatus: latestGaRun?.status ?? null,
    errors: analyticsErrors,
    sessions7d: sessionsTrend.reduce((sum, item) => sum + item.value, 0),
    sessions30d: canonicalSessions.reduce((sum, row) => sum + safeNumber(row.session_count || 1), 0),
    users30d: canonicalUsers.length,
    topSources: Object.entries(topSourcesMap)
      .map(([source, sessions]) => ({ source, sessions }))
      .sort((left, right) => right.sessions - left.sessions)
      .slice(0, 5),
    trend: sessionsTrend.map((point, index) => ({
      label: point.label,
      sessions: point.value,
      users: usersTrend[index]?.value ?? 0,
    })),
  };

  const campaignStatusCounts = campaigns.reduce<{ active: number; paused: number; completed: number }>(
    (acc, row) => {
      const status = String(row.status ?? '').trim().toLowerCase();
      if (status === 'active' || status === 'running' || status === 'in_progress') acc.active += 1;
      else if (status === 'paused' || status === 'draft') acc.paused += 1;
      else if (status === 'completed' || status === 'done' || status === 'archived') acc.completed += 1;
      return acc;
    },
    { active: 0, paused: 0, completed: 0 }
  );

  const contentByType = contentRows.reduce<SystemStateResponse['contentState']['byType']>(
    (acc, row) => {
      const key = classifyContentType((row as GenericRow).content_type ?? (row as GenericRow).platform);
      acc[key] += 1;
      return acc;
    },
    { blogs: 0, carousels: 0, banners: 0, other: 0 }
  );

  const draftCount = contentRows.filter((row) => {
    const status = String(row.status ?? '').trim().toLowerCase();
    return !status || status === 'draft' || status === 'planned';
  }).length;
  const publishedCount = contentRows.filter((row) => {
    const status = String(row.status ?? '').trim().toLowerCase();
    return status === 'published' || status === 'complete';
  }).length;
  const postsPublishedLast30Days = scheduledPosts.filter((row) => {
    const publishedAt = String(row.published_at ?? '').trim();
    return publishedAt >= since30d && String(row.status ?? '').toLowerCase() === 'published';
  }).length;

  const campaignsCreatedTrend = buildWeeklyTimeline(8, campaigns, 'created_at');
  const contentCreatedTrend = buildWeeklyTimeline(8, contentRows, 'created_at');
  const postsPublishedTrend = buildWeeklyTimeline(8, scheduledPosts.filter((row) => String(row.status ?? '').toLowerCase() === 'published'), 'published_at');

  const totalSpend = campaignMetrics.reduce((sum, row) => {
    return sum + safeNumber(row.spend ?? row.ad_spend ?? row.cost);
  }, 0);
  const totalReach = campaignMetrics.reduce((sum, row) => sum + safeNumber(row.reach), 0);
  const totalImpressions = campaignMetrics.reduce((sum, row) => sum + safeNumber(row.impressions), 0);

  const planResolution: ResolvedPlanLimits = await resolveOrganizationPlanLimits(companyId).catch(() => ({
    plan_key: null,
    limits: {
      llm_tokens: null,
      external_api_calls: null,
      automation_executions: null,
    },
    max_campaign_duration_weeks: null,
  }));
  const planDetails = pricingPlans.find((row) => String(row.plan_key ?? '').toLowerCase() === String(planResolution.plan_key ?? '').toLowerCase()) ?? null;
  const usageRow: GenericRow = usageMeterRows[0] ?? {};

  const response: SystemStateResponse = {
    generatedAt: now.toISOString(),
    companyId,
    meta: {
      version: 'v1',
      lastUpdated: now.toISOString(),
      sectionUpdatedAt: {
        overview: now.toISOString(),
        integrationStatus: now.toISOString(),
        trafficState: now.toISOString(),
        systemUsage: now.toISOString(),
        contentState: now.toISOString(),
        campaignState: now.toISOString(),
        engagementState: now.toISOString(),
        billingAccount: now.toISOString(),
        intelligenceActivity: now.toISOString(),
      },
      featureFlags: {
        trafficState: true,
        platformState: true,
        billingAccount: true,
        intelligenceActivity: true,
        crmBridge: crmConnected,
      },
    },
    overview: {
      platformsConnected: socialAccounts.length,
      platformsReady,
      activeIntegrations: apis.filter((row) => row.status === 'active').length,
      activeCampaigns: campaignStatusCounts.active,
      totalContentAssets: contentRows.length,
      activeUsers,
    },
    integrationStatus: {
      platforms: platformState,
      apis: apis.sort((left, right) => left.name.localeCompare(right.name)),
      flags: {
        googleAnalyticsConnected,
        googleSearchConsoleConnected,
        crmConnected,
      },
      providerReadiness: googleProviderReadiness,
    },
    trafficState,
    systemUsage: {
      campaignsCreatedTrend,
      contentCreatedTrend,
      postsPublishedTrend,
    },
    contentState: {
      totalContent: contentRows.length,
      draftCount,
      publishedCount,
      publishingFrequencyPerWeek: Number((postsPublishedLast30Days / (30 / 7)).toFixed(1)),
      byType: contentByType,
    },
    campaignState: {
      active: campaignStatusCounts.active,
      paused: campaignStatusCounts.paused,
      completed: campaignStatusCounts.completed,
      totalSpend,
      totalReach,
      totalImpressions,
      volumeTrend: campaignsCreatedTrend,
    },
    engagementState: {
      totalConversations: engagementThreads.length,
      unansweredConversations: engagementThreads.filter((row) => {
        const status = String(row.status ?? '').trim().toLowerCase();
        return !status || status === 'open' || status === 'unanswered' || status === 'pending';
      }).length,
      responseVolume: responseMetrics.length,
    },
    billingAccount: {
      plan: String(planDetails?.name ?? planResolution.plan_key ?? 'Free'),
      paymentStatus:
        planResolution.plan_key && String(planResolution.plan_key).toLowerCase() !== 'free'
          ? 'active'
          : planResolution.plan_key
            ? 'free'
            : 'not_configured',
      usage: [
        {
          key: 'llm_tokens',
          label: 'LLM tokens',
          used: safeNumber(usageRow.llm_total_tokens),
          limit: planResolution.limits.llm_tokens,
        },
        {
          key: 'external_api_calls',
          label: 'External API calls',
          used: safeNumber(usageRow.external_api_calls),
          limit: planResolution.limits.external_api_calls,
        },
        {
          key: 'automation_executions',
          label: 'Automation runs',
          used: safeNumber(usageRow.automation_executions),
          limit: planResolution.limits.automation_executions,
        },
      ],
    },
    intelligenceActivity: {
      recommendationsCount: decisionObjects.filter((row) => String(row.status ?? '').toLowerCase() === 'open').length,
      reportsCount: reportEvents.length,
      lastReportRun: reportEvents.reduce<string | null>((latest, row) => {
        return mostRecentDate(latest, String(row.triggered_at ?? ''));
      }, null),
    },
  };

  return res.status(200).json(response);
}
