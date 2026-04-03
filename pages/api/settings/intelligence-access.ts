import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import {
  type CompanyExecutionFlags,
} from '@/backend/services/intentExecutionService';
import {
  DEFAULT_INTELLIGENCE_UNITS,
  listCompanyIntelligenceUnits,
} from '@/backend/services/intelligenceUnitService';

type ActivityNode = {
  key: string;
  label: string;
  jobs: string[];
  enabled: boolean;
};

type IntelligenceUnitNode = {
  id: string;
  name: string;
  category: string;
  report_tiers: string[];
  enabled: boolean;
};

type ResponsePayload = {
  companyId: string;
  mode: 'global' | 'company';
  isSuperAdmin: boolean;
  availableCompanies?: Array<{ id: string; name: string }>;
  hasCompanyOverrides: boolean;
  canResetToDefault: boolean;
  insights: CompanyExecutionFlags['insights'];
  frequency: CompanyExecutionFlags['frequency'];
  activity: ActivityNode[];
  intelligence: IntelligenceUnitNode[];
};

const GLOBAL_DEFAULT_PROFILE_ID = '__GLOBAL_DEFAULT__';

const ACTIVITY_TREE: Array<{ key: keyof CompanyExecutionFlags['insights']; label: string; jobs: string[] }> = [
  {
    key: 'market_trends',
    label: 'Market Trends Engines',
    jobs: [
      'signalClustering',
      'signalIntelligence',
      'strategicTheme',
      'companyTrendRelevance',
      'engagementSignalScheduler',
      'engagementOpportunityScanner',
      'engagementCapture',
      'feedbackIntelligence',
      'engagementDigest',
    ],
  },
  {
    key: 'competitor_tracking',
    label: 'Competitor Tracking Engines',
    jobs: [
      'intelligencePolling',
      'engagementPolling',
    ],
  },
  {
    key: 'ai_recommendations',
    label: 'AI Recommendation Engines',
    jobs: [
      'campaignOpportunity',
      'contentOpportunity',
      'narrativeEngine',
      'communityPost',
      'threadEngine',
      'dailyIntelligence',
      'campaignHealthEvaluation',
      'replyIntelligenceAggregation',
      'responsePerformanceEval',
      'responseStrategyLearning',
      'opportunityLearning',
      'influencerLearning',
      'insightLearning',
      'buyerIntentLearning',
    ],
  },
];

function defaultFlags(): CompanyExecutionFlags {
  return {
    insights: { market_trends: true, competitor_tracking: true, ai_recommendations: true },
    frequency: { insights: '2h' },
  };
}

function rowToFlags(row?: Record<string, unknown> | null): CompanyExecutionFlags {
  if (!row) return defaultFlags();
  const insightsFrequency = ['1h', '2h', '8h'].includes(String(row.frequency_insights))
    ? (row.frequency_insights as '1h' | '2h' | '8h')
    : '2h';

  return {
    insights: {
      market_trends: Boolean(row.insights_market_trends ?? true),
      competitor_tracking: Boolean(row.insights_competitor_tracking ?? true),
      ai_recommendations: Boolean(row.insights_ai_recommendations ?? true),
    },
    frequency: {
      insights: insightsFrequency,
    },
  };
}

async function getFlagsRow(companyId: string): Promise<Record<string, unknown> | null> {
  const { data } = await (supabase as any)
    .from('company_execution_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  return (data as Record<string, unknown> | null) ?? null;
}

async function upsertFlags(companyId: string, flags: CompanyExecutionFlags, updatedBy: string): Promise<void> {
  await (supabase as any).from('company_execution_config').upsert(
    {
      company_id: companyId,
      insights_market_trends: flags.insights.market_trends,
      insights_competitor_tracking: flags.insights.competitor_tracking,
      insights_ai_recommendations: flags.insights.ai_recommendations,
      frequency_insights: flags.frequency.insights,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'company_id' }
  );
}

async function getCompanyUnitOverrides(companyId: string): Promise<Map<string, { enabled: boolean }>> {
  const { data } = await supabase
    .from('company_intelligence_config')
    .select('iu_id, enabled')
    .eq('company_id', companyId);

  const rows = (data ?? []) as Array<{ iu_id: string; enabled: boolean }>;
  return new Map(rows.map((r) => [r.iu_id, { enabled: r.enabled }]));
}

async function setCompanyUnitOverrides(companyId: string, units: Array<{ id: string; enabled: boolean }>): Promise<void> {
  if (!units.length) return;
  const payload = units.map((u) => ({
    company_id: companyId,
    iu_id: u.id,
    enabled: u.enabled,
    priority_override: null,
  }));

  await supabase
    .from('company_intelligence_config')
    .upsert(payload, { onConflict: 'company_id,iu_id' });
}

async function resetCompanyOverrides(companyId: string): Promise<void> {
  await Promise.all([
    (supabase as any)
      .from('company_execution_config')
      .delete()
      .eq('company_id', companyId),
    supabase
      .from('company_intelligence_config')
      .delete()
      .eq('company_id', companyId),
  ]);
}

function toPayload(params: {
  companyId: string;
  mode: 'global' | 'company';
  isSuperAdmin: boolean;
  availableCompanies?: Array<{ id: string; name: string }>;
  hasCompanyOverrides: boolean;
  flags: CompanyExecutionFlags;
  units: Array<IntelligenceUnitNode>;
}): ResponsePayload {
  return {
    companyId: params.companyId,
    mode: params.mode,
    isSuperAdmin: params.isSuperAdmin,
    availableCompanies: params.availableCompanies,
    hasCompanyOverrides: params.hasCompanyOverrides,
    canResetToDefault: params.mode === 'company' && params.hasCompanyOverrides,
    insights: params.flags.insights,
    frequency: params.flags.frequency,
    activity: ACTIVITY_TREE.map((node) => ({
      key: node.key,
      label: node.label,
      jobs: node.jobs,
      enabled: Boolean(params.flags.insights[node.key]),
    })),
    intelligence: params.units,
  };
}

async function listCompaniesForPicker(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase
    .from('companies')
    .select('id, name')
    .order('name', { ascending: true });

  return ((data ?? []) as Array<{ id: string; name: string | null }>).map((company) => ({
    id: company.id,
    name: company.name || company.id,
  }));
}

async function resolveAccess(userId: string, requestedCompanyId?: string, mode: 'global' | 'company' = 'company'): Promise<{ companyId: string; canWrite: boolean; isSuperAdmin: boolean } | null> {
  const { data: roles, error } = await supabase
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error || !roles || roles.length === 0) return null;

  const isSuperAdmin = roles.some((r: any) => String(r.role).toUpperCase() === 'SUPER_ADMIN');

  if (mode === 'global') {
    if (!isSuperAdmin) return null;
    return { companyId: GLOBAL_DEFAULT_PROFILE_ID, canWrite: true, isSuperAdmin: true };
  }

  if (isSuperAdmin) {
    const selected = requestedCompanyId || roles.find((r: any) => r.company_id)?.company_id;
    if (!selected) return null;
    return { companyId: selected, canWrite: true, isSuperAdmin: true };
  }

  const companyAdminRole = roles.find((r: any) => String(r.role).toUpperCase() === 'COMPANY_ADMIN');
  if (!companyAdminRole) return null;

  return {
    companyId: companyAdminRole.company_id,
    canWrite: true,
    isSuperAdmin: false,
  };
}

function parseBody(body: unknown): {
  insights?: Partial<CompanyExecutionFlags['insights']>;
  frequency?: Partial<CompanyExecutionFlags['frequency']>;
  units?: Array<{ id: string; enabled: boolean }>;
  companyId?: string;
  mode?: 'global' | 'company';
  resetToDefault?: boolean;
} {
  if (!body || typeof body !== 'object') return {};
  return body as {
    insights?: Partial<CompanyExecutionFlags['insights']>;
    frequency?: Partial<CompanyExecutionFlags['frequency']>;
    units?: Array<{ id: string; enabled: boolean }>;
    companyId?: string;
    mode?: 'global' | 'company';
    resetToDefault?: boolean;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = parseBody(req.body);
  const queryCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
  const queryMode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
  const mode = body.mode === 'global' || queryMode === 'global' ? 'global' : 'company';
  const requestedCompanyId = body.companyId || queryCompanyId;

  const access = await resolveAccess(user.id, requestedCompanyId, mode);
  if (!access) {
    return res.status(403).json({ error: 'Only company admins or super admins can access this setting' });
  }

  if (req.method === 'PUT') {
    if (!access.canWrite) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (body.resetToDefault === true && mode === 'company') {
      await resetCompanyOverrides(access.companyId);
    }

    if (body.insights || body.frequency) {
      const currentFlags = rowToFlags(await getFlagsRow(access.companyId));
      const nextFlags: CompanyExecutionFlags = {
        insights: {
          ...currentFlags.insights,
          ...(body.insights ?? {}),
        },
        frequency: {
          ...currentFlags.frequency,
          ...(body.frequency ?? {}),
        },
      };
      await upsertFlags(access.companyId, nextFlags, user.id);
    }

    if (Array.isArray(body.units) && body.units.length > 0) {
      await setCompanyUnitOverrides(
        access.companyId,
        body.units.filter((u) => typeof u?.id === 'string' && typeof u?.enabled === 'boolean')
      );
    }
  }

  const [globalFlagsRow, targetFlagsRow, globalUnits, targetUnitOverrides, availableCompanies] = await Promise.all([
    getFlagsRow(GLOBAL_DEFAULT_PROFILE_ID),
    getFlagsRow(access.companyId),
    listCompanyIntelligenceUnits(GLOBAL_DEFAULT_PROFILE_ID),
    mode === 'global' ? Promise.resolve(new Map<string, { enabled: boolean }>()) : getCompanyUnitOverrides(access.companyId),
    access.isSuperAdmin && mode === 'company' ? listCompaniesForPicker() : Promise.resolve(undefined),
  ]);

  const globalFlags = rowToFlags(globalFlagsRow);
  const targetFlags = rowToFlags(targetFlagsRow);

  const resolvedFlags: CompanyExecutionFlags = mode === 'global'
    ? targetFlags
    : {
        insights: {
          market_trends: targetFlagsRow?.insights_market_trends === undefined ? globalFlags.insights.market_trends : targetFlags.insights.market_trends,
          competitor_tracking: targetFlagsRow?.insights_competitor_tracking === undefined ? globalFlags.insights.competitor_tracking : targetFlags.insights.competitor_tracking,
          ai_recommendations: targetFlagsRow?.insights_ai_recommendations === undefined ? globalFlags.insights.ai_recommendations : targetFlags.insights.ai_recommendations,
        },
        frequency: {
          insights: targetFlagsRow?.frequency_insights === undefined ? globalFlags.frequency.insights : targetFlags.frequency.insights,
        },
      };

  const resolvedUnits: IntelligenceUnitNode[] = globalUnits.map((unit) => {
    const override = targetUnitOverrides.get(unit.id);
    return {
      id: unit.id,
      name: unit.name,
      category: unit.category,
      report_tiers: unit.report_tiers,
      enabled: mode === 'global' ? unit.enabled : (override?.enabled ?? unit.enabled),
    };
  });

  const hasExecutionOverride = mode === 'company' && !!targetFlagsRow;
  const hasUnitsOverride = mode === 'company' && targetUnitOverrides.size > 0;
  const hasCompanyOverrides = hasExecutionOverride || hasUnitsOverride;

  return res.status(200).json(
    toPayload({
      companyId: access.companyId,
      mode,
      isSuperAdmin: access.isSuperAdmin,
      availableCompanies,
      hasCompanyOverrides,
      flags: resolvedFlags,
      units: resolvedUnits,
    })
  );
}
