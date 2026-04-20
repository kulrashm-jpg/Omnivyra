import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveOrganizationPlanLimits, type ResolvedPlanLimits } from '../../../backend/services/planResolutionService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';

type HealthState = 'active' | 'error' | 'disconnected';

type GenericRow = Record<string, unknown>;

type TimelinePoint = {
  label: string;
  value: number;
};

type OverviewMetric = {
  platformsConnected: number;
  activeIntegrations: number;
  activeCampaigns: number;
  totalContentAssets: number;
  activeUsers: number;
};

type IntegrationPlatform = {
  key: string;
  label: string;
  status: HealthState;
  accountCount: number;
  lastSyncAt: string | null;
  postsPublished: number;
  engagementCount: number;
  trend: TimelinePoint[];
};

type IntegrationApi = {
  id: string;
  name: string;
  category: string;
  status: HealthState;
  lastSyncAt: string | null;
};

type TrafficState = {
  enabled: boolean;
  sessions7d: number;
  sessions30d: number;
  users30d: number;
  topSources: Array<{
    source: string;
    sessions: number;
  }>;
  trend: Array<{
    label: string;
    sessions: number;
    users: number;
  }>;
};

type BillingUsageItem = {
  key: 'llm_tokens' | 'external_api_calls' | 'automation_executions';
  label: string;
  used: number;
  limit: number | null;
};

type SystemStateResponse = {
  generatedAt: string;
  companyId: string;
  meta: {
    version: 'v1';
    lastUpdated: string;
    sectionUpdatedAt: {
      overview: string;
      integrationStatus: string;
      trafficState: string;
      systemUsage: string;
      contentState: string;
      campaignState: string;
      engagementState: string;
      billingAccount: string;
      intelligenceActivity: string;
    };
    featureFlags: {
      trafficState: boolean;
      platformState: boolean;
      billingAccount: boolean;
      intelligenceActivity: boolean;
      crmBridge: boolean;
    };
  };
  overview: OverviewMetric;
  integrationStatus: {
    platforms: IntegrationPlatform[];
    apis: IntegrationApi[];
    flags: {
      googleAnalyticsConnected: boolean;
      crmConnected: boolean;
    };
  };
  trafficState: TrafficState;
  systemUsage: {
    campaignsCreatedTrend: TimelinePoint[];
    contentCreatedTrend: TimelinePoint[];
    postsPublishedTrend: TimelinePoint[];
  };
  contentState: {
    totalContent: number;
    draftCount: number;
    publishedCount: number;
    publishingFrequencyPerWeek: number;
    byType: {
      blogs: number;
      carousels: number;
      banners: number;
      other: number;
    };
  };
  campaignState: {
    active: number;
    paused: number;
    completed: number;
    totalSpend: number;
    totalReach: number;
    totalImpressions: number;
    volumeTrend: TimelinePoint[];
  };
  engagementState: {
    totalConversations: number;
    unansweredConversations: number;
    responseVolume: number;
  };
  billingAccount: {
    plan: string;
    paymentStatus: 'active' | 'free' | 'not_configured';
    usage: BillingUsageItem[];
  };
  intelligenceActivity: {
    recommendationsCount: number;
    reportsCount: number;
    lastReportRun: string | null;
  };
};

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  threads: 'Threads',
  reddit: 'Reddit',
  whatsapp: 'WhatsApp',
};

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function mostRecentDate(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter(hasText);
  if (valid.length === 0) return null;
  return valid.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function classifyApiStatus(row: GenericRow): HealthState {
  const status = String(row.status ?? row.last_test_status ?? '').trim().toLowerCase();
  const isActive = row.is_active === true;
  const hasError = hasText(row.last_error_message) || hasText(row.last_error);

  if (status === 'connected' || status === 'active' || status === 'success' || isActive) return 'active';
  if (status === 'failed' || status === 'error' || hasError) return 'error';
  return 'disconnected';
}

function classifyContentType(value: unknown): 'blogs' | 'carousels' | 'banners' | 'other' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('blog') || normalized.includes('article') || normalized.includes('newsletter') || normalized.includes('guide')) {
    return 'blogs';
  }
  if (normalized.includes('carousel') || normalized.includes('thread')) {
    return 'carousels';
  }
  if (normalized.includes('banner') || normalized.includes('ad') || normalized.includes('display')) {
    return 'banners';
  }
  return 'other';
}

function integrationMatches(row: GenericRow, patterns: string[]): boolean {
  const haystack = [
    row.type,
    row.name,
    row.category,
    row.purpose,
    typeof row.config === 'object' ? JSON.stringify(row.config) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return patterns.some((pattern) => haystack.includes(pattern));
}

async function fetchRows(table: string, select: string, build?: (query: any) => any): Promise<GenericRow[]> {
  try {
    let query = supabase.from(table).select(select);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as unknown as GenericRow[];
  } catch {
    return [];
  }
}

function buildTimeline(days: number, compute: (dateKey: string, date: Date) => number): TimelinePoint[] {
  const today = startOfDay(new Date());
  const points: TimelinePoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    points.push({
      label: formatShortDate(date),
      value: compute(key, date),
    });
  }
  return points;
}

function buildWeeklyTimeline(weeks: number, rows: GenericRow[], dateField: string): TimelinePoint[] {
  const now = startOfDay(new Date());
  const buckets = new Map<string, number>();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - index * 7);
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  for (const row of rows) {
    const raw = String(row[dateField] ?? '').slice(0, 10);
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0 || diffDays >= weeks * 7) continue;
    const weekOffset = Math.floor(diffDays / 7);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - weekOffset * 7);
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, value]) => ({
      label: formatShortDate(new Date(key)),
      value,
    }));
}

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

  const campaignVersionRows = await fetchRows('campaign_versions', 'campaign_id', (query) =>
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
    externalApiSources,
    externalApiHealth,
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
    fetchRows('company_integrations', 'id, type, name, status, config, last_tested_at, updated_at, last_error', (query) =>
      query.eq('company_id', companyId)
    ),
    fetchRows('social_accounts', 'id, platform, is_active, last_sync_at, updated_at', (query) =>
      query.eq('company_id', companyId)
    ),
    fetchRows('external_api_sources', 'id, name, category, purpose, is_active, company_id, updated_at', (query) =>
      query.or(`company_id.eq.${companyId},company_id.is.null`)
    ),
    fetchRows('external_api_health', 'api_source_id, last_test_status, last_test_at, last_error_message'),
    fetchRows('campaigns', 'id, status, created_at', (query) =>
      hasCampaigns ? query.in('id', campaignIds) : query.eq('id', ZERO_UUID)
    ),
    fetchRows('campaign_performance_metrics', 'platform, reach, impressions, likes, comments, shares, spend, ad_spend, cost', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    fetchRows('scheduled_posts', 'id, campaign_id, platform, status, published_at, created_at, updated_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    fetchRows('content_plans', 'campaign_id, content_type, status, created_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    fetchRows('content_assets', 'campaign_id, platform, status, created_at', (query) =>
      hasCampaigns ? query.in('campaign_id', campaignIds) : query.eq('campaign_id', ZERO_UUID)
    ),
    fetchRows('user_company_roles', 'user_id', (query) =>
      query.eq('company_id', companyId).eq('status', 'active')
    ),
    fetchRows('usage_meter_monthly', 'llm_total_tokens, external_api_calls, automation_executions', (query) =>
      query.eq('organization_id', companyId).eq('year', currentYear).eq('month', currentMonth)
    ),
    fetchRows('canonical_sessions', 'source, started_at, session_count, session_metadata', (query) =>
      query.eq('company_id', companyId).gte('started_at', since30d)
    ),
    fetchRows('canonical_users', 'id, created_at', (query) =>
      query.eq('company_id', companyId).gte('created_at', since30d)
    ),
    fetchRows('engagement_threads', 'id, status', (query) =>
      query.eq('organization_id', companyId)
    ),
    fetchRows('response_performance_metrics', 'id', (query) =>
      query.eq('organization_id', companyId)
    ),
    fetchRows('decision_objects', 'id, status', (query) =>
      query.eq('company_id', companyId)
    ),
    fetchRows('report_automation_events', 'id, triggered_at', (query) =>
      query.eq('company_id', companyId)
    ),
    fetchRows('pricing_plans', 'plan_key, name, monthly_price, currency, is_active'),
  ]);

  const contentRows = contentPlans.length > 0 ? contentPlans : contentAssets;
  const activeUsers = new Set(companyUsers.map((row) => String(row.user_id ?? '').trim()).filter(Boolean)).size;
  const activeSocialAccounts = socialAccounts.filter((row) => row.is_active === true);

  const healthByApiSourceId = new Map<string, GenericRow>();
  for (const row of externalApiHealth) {
    const key = String(row.api_source_id ?? '').trim();
    if (!key) continue;
    const existing = healthByApiSourceId.get(key);
    const existingDate = existing ? new Date(String(existing.last_test_at ?? 0)).getTime() : 0;
    const currentDate = new Date(String(row.last_test_at ?? 0)).getTime();
    if (!existing || currentDate >= existingDate) {
      healthByApiSourceId.set(key, row);
    }
  }

  const apis: IntegrationApi[] = [
    ...companyIntegrations.map((row) => ({
      id: String(row.id ?? row.type ?? Math.random()),
      name: String(row.name ?? row.type ?? 'Integration'),
      category: String(row.type ?? 'integration'),
      status: classifyApiStatus(row),
      lastSyncAt: mostRecentDate(String(row.last_tested_at ?? ''), String(row.updated_at ?? '')),
    })),
    ...externalApiSources.map((row) => {
      const health = healthByApiSourceId.get(String(row.id ?? '').trim()) ?? {};
      return {
        id: String(row.id ?? Math.random()),
        name: String(row.name ?? 'External API'),
        category: String(row.category ?? row.purpose ?? 'other'),
        status: classifyApiStatus({ ...row, ...health }),
        lastSyncAt: mostRecentDate(String((health as GenericRow).last_test_at ?? ''), String(row.updated_at ?? '')),
      };
    }),
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);

  const googleAnalyticsConnected =
    companyIntegrations.some((row) => integrationMatches(row, ['google analytics', 'ga4'])) ||
    externalApiSources.some((row) => integrationMatches(row, ['google analytics', 'ga4']));
  const crmConnected =
    companyIntegrations.some((row) => integrationMatches(row, ['hubspot', 'salesforce', 'pipedrive', 'zoho crm', 'crm'])) ||
    externalApiSources.some((row) => integrationMatches(row, ['hubspot', 'salesforce', 'pipedrive', 'zoho crm', 'crm']));

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
    ...activeSocialAccounts.map((row) => String(row.platform ?? '').trim().toLowerCase()).filter(Boolean),
  ])).sort();

  const platformState: IntegrationPlatform[] = platformKeys.map((platform) => {
    const platformAccounts = activeSocialAccounts.filter((row) => String(row.platform ?? '').trim().toLowerCase() === platform);
    const allPlatformAccounts = socialAccounts.filter((row) => String(row.platform ?? '').trim().toLowerCase() === platform);
    const status: HealthState = platformAccounts.length > 0 ? 'active' : allPlatformAccounts.length > 0 ? 'error' : 'disconnected';
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

  const trafficState: TrafficState = {
    enabled: googleAnalyticsConnected,
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
      platformsConnected: activeSocialAccounts.length,
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
        crmConnected,
      },
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
