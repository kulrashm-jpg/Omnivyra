import { runInBackgroundJobContext } from './intelligenceExecutionContext';
import { buildAdsRunKey, ingestAdsData, type AdsCampaignRow } from './adsIngestionService';
import { buildCrawlerRunKey, crawlCompanyWebsite } from './crawlerService';
import { buildCrmRunKey, ingestCrmData, type CrmLeadRecord } from './crmIngestionService';
import { buildGa4RunKey, ingestGa4Data, type Ga4SessionRow } from './ga4IngestionService';
import { buildGscRunKey, ingestGscData, type GscKeywordRow } from './gscIngestionService';
import {
  beginIngestionRun,
  completeIngestionRun,
  findIngestionRunByKey,
  getRetryableFailedRuns,
  hasRunningIngestion,
  setDataSourceStatus,
  type IngestionSource,
} from './ingestionRunService';
import { resolveCompanyWebsite } from './ingestionUtils';
import { supabase } from '../db/supabaseClient';

type CompanyIntegrationRow = {
  type: string;
  status: string | null;
  config: Record<string, unknown> | null;
};

export type IngestionSourceResult = {
  source: IngestionSource;
  success: boolean;
  runId?: string;
  skipped?: boolean;
  missingIntegration?: boolean;
  details: Record<string, unknown>;
  error?: string;
};

export type CompanyIngestionSummary = {
  companyId: string;
  sources: IngestionSourceResult[];
  validation: {
    pages: number;
    sessions: number;
    keywords: number;
    leads: number;
    campaigns: number;
  };
  ready: boolean;
};

type SchedulerOverrides = {
  crawler?: { rootUrl?: string; maxPages?: number };
  ga4?: { propertyId?: string; accessToken?: string; rows?: Ga4SessionRow[]; startDate?: string; endDate?: string };
  gsc?: { siteUrl?: string; accessToken?: string; rows?: GscKeywordRow[]; startDate?: string; endDate?: string };
  crm?: { csvContent?: string; rows?: CrmLeadRecord[] };
  ads?: { endpointUrl?: string; accessToken?: string; rows?: AdsCampaignRow[] };
};

type SourcePayload = Record<string, unknown>;

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadCompanyIntegrations(companyId: string): Promise<Map<string, CompanyIntegrationRow>> {
  const { data, error } = await supabase
    .from('company_integrations')
    .select('type, status, config')
    .eq('company_id', companyId);

  if (error) {
    throw new Error(`Failed to load company integrations for ${companyId}: ${error.message}`);
  }

  const map = new Map<string, CompanyIntegrationRow>();
  for (const row of (data ?? []) as CompanyIntegrationRow[]) {
    map.set(String(row.type).toLowerCase(), row);
  }
  return map;
}

async function runCrawlerSource(companyId: string, overrides: SchedulerOverrides['crawler']): Promise<SourcePayload> {
  const rootUrl = overrides?.rootUrl ?? (await resolveCompanyWebsite(companyId)) ?? undefined;
  if (!rootUrl) {
    throw new Error('Crawler root URL missing');
  }
  return (await crawlCompanyWebsite({
    companyId,
    rootUrl,
    maxPages: overrides?.maxPages,
  })) as unknown as SourcePayload;
}

async function runGa4Source(
  companyId: string,
  integration: CompanyIntegrationRow | undefined,
  overrides: SchedulerOverrides['ga4']
): Promise<SourcePayload> {
  const config = { ...toObject(integration?.config), ...toObject(overrides) };
  return (await ingestGa4Data({
    companyId,
    propertyId: typeof config.propertyId === 'string' ? config.propertyId : undefined,
    accessToken: typeof config.accessToken === 'string' ? config.accessToken : undefined,
    rows: Array.isArray(overrides?.rows) ? overrides.rows : undefined,
    startDate: typeof config.startDate === 'string' ? config.startDate : undefined,
    endDate: typeof config.endDate === 'string' ? config.endDate : undefined,
  })) as unknown as SourcePayload;
}

async function runGscSource(
  companyId: string,
  integration: CompanyIntegrationRow | undefined,
  overrides: SchedulerOverrides['gsc']
): Promise<SourcePayload> {
  const config = { ...toObject(integration?.config), ...toObject(overrides) };
  return (await ingestGscData({
    companyId,
    siteUrl: typeof config.siteUrl === 'string' ? config.siteUrl : undefined,
    accessToken: typeof config.accessToken === 'string' ? config.accessToken : undefined,
    rows: Array.isArray(overrides?.rows) ? overrides.rows : undefined,
    startDate: typeof config.startDate === 'string' ? config.startDate : undefined,
    endDate: typeof config.endDate === 'string' ? config.endDate : undefined,
  })) as unknown as SourcePayload;
}

async function runCrmSource(
  companyId: string,
  integration: CompanyIntegrationRow | undefined,
  overrides: SchedulerOverrides['crm']
): Promise<SourcePayload> {
  const config = { ...toObject(integration?.config), ...toObject(overrides) };
  return (await ingestCrmData({
    companyId,
    csvContent: typeof config.csvContent === 'string' ? config.csvContent : undefined,
    rows: Array.isArray(overrides?.rows) ? overrides.rows : undefined,
  })) as unknown as SourcePayload;
}

async function runAdsSource(
  companyId: string,
  integration: CompanyIntegrationRow | undefined,
  overrides: SchedulerOverrides['ads']
): Promise<SourcePayload> {
  const config = { ...toObject(integration?.config), ...toObject(overrides) };
  return (await ingestAdsData({
    companyId,
    endpointUrl: typeof config.endpointUrl === 'string' ? config.endpointUrl : undefined,
    accessToken: typeof config.accessToken === 'string' ? config.accessToken : undefined,
    rows: Array.isArray(overrides?.rows) ? overrides.rows : undefined,
  })) as unknown as SourcePayload;
}

function buildRunKey(source: IngestionSource, companyId: string, overrides: SchedulerOverrides): string {
  switch (source) {
    case 'crawler':
      return buildCrawlerRunKey(companyId, overrides.crawler?.rootUrl ?? companyId);
    case 'ga4':
      return buildGa4RunKey({ companyId, ...overrides.ga4 });
    case 'gsc':
      return buildGscRunKey({ companyId, ...overrides.gsc });
    case 'crm':
      return buildCrmRunKey({ companyId, ...overrides.crm });
    case 'ads':
      return buildAdsRunKey({ companyId, ...overrides.ads });
    default:
      return `${companyId}:${source}`;
  }
}

function statusSourceForTable(source: IngestionSource): 'crawler' | 'ga' | 'gsc' | 'crm' | 'ads' {
  return source === 'ga4' ? 'ga' : source;
}

export async function validateIngestionOutput(companyId: string): Promise<CompanyIngestionSummary['validation']> {
  const [pages, sessions, keywords, leads, campaigns] = await Promise.all([
    supabase.from('canonical_pages').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('canonical_sessions').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('canonical_keywords').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('canonical_leads').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);

  return {
    pages: pages.count ?? 0,
    sessions: sessions.count ?? 0,
    keywords: keywords.count ?? 0,
    leads: leads.count ?? 0,
    campaigns: campaigns.count ?? 0,
  };
}

export async function runIngestionForCompany(params: {
  companyId: string;
  sources?: IngestionSource[];
  overrides?: SchedulerOverrides;
}): Promise<CompanyIngestionSummary> {
  return runInBackgroundJobContext('ingestionScheduler', async () => {
    const companyId = params.companyId;
    const sources = params.sources ?? ['crawler', 'ga4', 'gsc', 'crm', 'ads'];
    const overrides = params.overrides ?? {};
    const integrations = await loadCompanyIntegrations(companyId);
    const results: IngestionSourceResult[] = [];

    for (const source of sources) {
      const integration = integrations.get(source);
      const runKey = buildRunKey(source, companyId, overrides);
      const existingRun = await findIngestionRunByKey({
        companyId,
        source,
        idempotencyKey: runKey,
      });

      if (await hasRunningIngestion(companyId, source)) {
        results.push({
          source,
          success: true,
          skipped: true,
          details: { reason: 'already_running' },
        });
        continue;
      }

      if (existingRun?.status === 'completed') {
        results.push({
          source,
          success: true,
          runId: existingRun.id,
          skipped: true,
          details: { reason: 'duplicate_idempotency_key' },
        });
        continue;
      }

      if (!integration && source !== 'crawler' && !overrides[source]) {
        await setDataSourceStatus({
          companyId,
          source: statusSourceForTable(source),
          status: 'missing',
          errorMessage: 'Integration config missing',
        });
        results.push({
          source,
          success: false,
          missingIntegration: true,
          details: {},
          error: 'Integration config missing',
        });
        continue;
      }

      const run = await beginIngestionRun({
        companyId,
        source,
        idempotencyKey: runKey,
        cursorPayload: {
          source,
        },
      });

      await setDataSourceStatus({
        companyId,
        source: statusSourceForTable(source),
        status: 'syncing',
        errorMessage: null,
      });

      try {
        let payload: Record<string, unknown>;
        switch (source) {
          case 'crawler':
            payload = await runCrawlerSource(companyId, overrides.crawler);
            break;
          case 'ga4':
            payload = await runGa4Source(companyId, integration, overrides.ga4);
            break;
          case 'gsc':
            payload = await runGscSource(companyId, integration, overrides.gsc);
            break;
          case 'crm':
            payload = await runCrmSource(companyId, integration, overrides.crm);
            break;
          case 'ads':
            payload = await runAdsSource(companyId, integration, overrides.ads);
            break;
          default:
            payload = {};
        }

        const processed =
          Number(payload.pagesProcessed) ||
          Number(payload.sessionsProcessed) ||
          Number(payload.keywordsProcessed) ||
          Number(payload.leadsProcessed) ||
          Number(payload.campaignsProcessed) ||
          0;
        const inserted =
          Number(payload.pagesInserted) ||
          Number(payload.sessionsInserted) ||
          Number(payload.keywordsInserted) ||
          Number(payload.leadsInserted) ||
          Number(payload.campaignsInserted) ||
          0;
        const updated =
          Number(payload.linksInserted) ||
          Number(payload.pageViewsInserted) ||
          Number(payload.metricsInserted) ||
          Number(payload.revenueEventsInserted) ||
          0;

        await completeIngestionRun({
          runId: run.id,
          status: 'completed',
          counts: { processed, inserted, updated },
        });
        await setDataSourceStatus({
          companyId,
          source: statusSourceForTable(source),
          status: 'connected',
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        });
        results.push({
          source,
          success: true,
          runId: run.id,
          details: payload,
        });
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        await completeIngestionRun({
          runId: run.id,
          status: 'failed',
          counts: { processed: 0, inserted: 0, updated: 0 },
          errorMessage: message,
        });
        await setDataSourceStatus({
          companyId,
          source: statusSourceForTable(source),
          status: 'error',
          errorMessage: message,
        });
        results.push({
          source,
          success: false,
          runId: run.id,
          details: {},
          error: message,
        });
      }
    }

    const validation = await validateIngestionOutput(companyId);
    const ready = validation.pages > 0 && validation.sessions > 0 && validation.keywords > 0 && validation.leads > 0 && validation.campaigns > 0;

    return {
      companyId,
      sources: results,
      validation,
      ready,
    };
  });
}

export async function retryFailedIngestionForCompany(params: {
  companyId: string;
  source?: IngestionSource;
  maxRetries?: number;
  overrides?: SchedulerOverrides;
}): Promise<IngestionSourceResult[]> {
  const failedRuns = await getRetryableFailedRuns({
    companyId: params.companyId,
    source: params.source,
    maxRetries: params.maxRetries ?? 3,
  });

  const retried: IngestionSourceResult[] = [];
  for (const run of failedRuns) {
    const summary = await runIngestionForCompany({
      companyId: params.companyId,
      sources: [run.source],
      overrides: params.overrides,
    });
    retried.push(...summary.sources);
  }

  return retried;
}
