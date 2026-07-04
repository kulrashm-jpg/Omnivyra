import { runInBackgroundJobContext } from './intelligenceExecutionContext';
import { buildAdsRunKey, ingestAdsData, type AdsCampaignRow } from './adsIngestionService';
import { getGoogleAnalyticsStatus, getGoogleSearchConsoleStatus, resolveGscIngestionContext } from './analyticsIntegrationService';
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
import { runReviewIngestion, resolveReviewSubject } from './reviews/reviewIngestionOrchestrator';
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

export type MultiCompanyIngestionSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  companies: CompanyIngestionSummary[];
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
  _integration: CompanyIntegrationRow | undefined,
  overrides: SchedulerOverrides['ga4']
): Promise<SourcePayload> {
  const config = { ...toObject(overrides) };
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
  if (!Array.isArray(overrides?.rows) && !overrides?.accessToken && !config.accessToken) {
    const context = await resolveGscIngestionContext(companyId);
    return (await ingestGscData({
      companyId,
      siteUrl: context.property.property_id,
      accessToken: context.accessToken,
      startDate: typeof config.startDate === 'string' ? config.startDate : undefined,
      endDate: typeof config.endDate === 'string' ? config.endDate : undefined,
    })) as unknown as SourcePayload;
  }
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

function statusSourceForTable(source: IngestionSource): 'crawler' | 'ga' | 'gsc' | 'crm' | 'ads' | 'reviews' {
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
  /**
   * When true, bypass the duplicate-idempotency-key short-circuit and force a
   * fresh execution of each source. Used by the manual force-sync endpoint so
   * the user always gets a real run instead of a cached "already completed"
   * result. The hasRunningIngestion check still applies — we never double-run.
   */
  force?: boolean;
  /** Audit tag persisted into ingestion_runs.cursor_payload.reason. */
  reason?: string;
}): Promise<CompanyIngestionSummary> {
  return runInBackgroundJobContext('ingestionScheduler', async () => {
    const companyId = params.companyId;
    const sources = params.sources ?? ['crawler', 'ga4', 'gsc', 'crm', 'ads'];
    const overrides = params.overrides ?? {};
    const integrations = await loadCompanyIntegrations(companyId);
    const ga4Status = sources.includes('ga4') ? await getGoogleAnalyticsStatus(companyId) : null;
    const gscStatus = sources.includes('gsc') ? await getGoogleSearchConsoleStatus(companyId) : null;
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

      if (!params.force && existingRun?.status === 'completed') {
        results.push({
          source,
          success: true,
          runId: existingRun.id,
          skipped: true,
          details: { reason: 'duplicate_idempotency_key' },
        });
        continue;
      }

      const missingGa4Integration =
        source === 'ga4' &&
        !overrides.ga4 &&
        (!ga4Status?.integration || ga4Status.integration.status !== 'connected' || !ga4Status.activeProperty || !ga4Status.tokenValid);
      const missingGscIntegration =
        source === 'gsc' &&
        !overrides.gsc &&
        !integration &&
        (!gscStatus?.integration || gscStatus.integration.status !== 'connected' || !gscStatus.activeProperty || !gscStatus.tokenValid);

      if ((!integration && source !== 'crawler' && source !== 'ga4' && source !== 'gsc' && source !== 'reviews' && !overrides[source]) || missingGa4Integration || missingGscIntegration) {
        const readinessError =
          source === 'ga4'
            ? 'GA4 integration is not ready'
            : source === 'gsc'
              ? 'Search Console integration is not ready'
              : 'Integration config missing';
        await setDataSourceStatus({
          companyId,
          source: statusSourceForTable(source),
          status: 'missing',
          errorMessage: readinessError,
        });
        results.push({
          source,
          success: false,
          missingIntegration: true,
          details: {},
          error: readinessError,
        });
        continue;
      }

      const run = await beginIngestionRun({
        companyId,
        source,
        idempotencyKey: runKey,
        cursorPayload: {
          source,
          ...(params.reason ? { reason: params.reason } : {}),
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
          case 'reviews': {
            // BETA-PHASE5-EXEC-002: reviews participate canonically through the ONE scheduler.
            // Resolve the subject from company data, then run the existing orchestrator — all
            // env/credential gating + graceful degradation live inside runReviewIngestion.
            const subject = await resolveReviewSubject(companyId);
            payload = (await runReviewIngestion(subject)) as unknown as Record<string, unknown>;
            break;
          }
          default:
            payload = {};
        }

        const processed =
          source === 'ga4'
            ? Number(payload.eventsProcessed) || Number(payload.sessionsProcessed) || 0
            : Number(payload.pagesProcessed) ||
          Number(payload.sessionsProcessed) ||
          Number(payload.keywordsProcessed) ||
          Number(payload.leadsProcessed) ||
          Number(payload.campaignsProcessed) ||
          0;
        const inserted =
          source === 'ga4'
            ? Number(payload.eventsInserted) || Number(payload.sessionsInserted) || 0
            : Number(payload.pagesInserted) ||
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
          counts: {
            processed,
            inserted,
            updated,
            eventsProcessed: source === 'ga4' ? Number(payload.eventsProcessed) || 0 : 0,
            eventsInserted: source === 'ga4' ? Number(payload.eventsInserted) || 0 : 0,
            conversionsInserted: source === 'ga4' ? Number(payload.conversionsInserted) || 0 : 0,
          },
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
          counts: {
            processed: 0,
            inserted: 0,
            updated: 0,
            eventsProcessed: 0,
            eventsInserted: 0,
            conversionsInserted: 0,
          },
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

export async function runIngestionForAllCompanies(params?: {
  sources?: IngestionSource[];
  overrides?: SchedulerOverrides;
}): Promise<MultiCompanyIngestionSummary> {
  const { data: integrations, error } = await supabase
    .from('analytics_integrations')
    .select('id, company_id')
    .eq('provider', 'GA4')
    .eq('status', 'connected');

  if (error) {
    throw new Error(`Failed to load connected GA4 integrations: ${error.message}`);
  }

  const integrationRows = (integrations ?? []) as Array<{ id: string; company_id: string }>;
  if (integrationRows.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      companies: [],
    };
  }

  const integrationIds = integrationRows.map((row) => row.id);
  const { data: activeProperties, error: propertyError } = await supabase
    .from('analytics_properties')
    .select('integration_id')
    .in('integration_id', integrationIds)
    .eq('is_active', true);

  if (propertyError) {
    throw new Error(`Failed to load active GA4 properties: ${propertyError.message}`);
  }

  const activeIntegrationIds = new Set(
    ((activeProperties ?? []) as Array<{ integration_id: string }>).map((row) => row.integration_id),
  );
  const companyIds = [...new Set(
    integrationRows
      .filter((row) => activeIntegrationIds.has(row.id))
      .map((row) => row.company_id),
  )];

  const companies: CompanyIngestionSummary[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const companyId of companyIds) {
    try {
      const summary = await runIngestionForCompany({
        companyId,
        sources: params?.sources ?? ['ga4'],
        overrides: params?.overrides,
      });
      companies.push(summary);
      if (summary.sources.every((source) => source.success || source.skipped)) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    } catch (ingestionError) {
      failed += 1;
      companies.push({
        companyId,
        sources: [
          {
            source: 'ga4',
            success: false,
            details: {},
            error: ingestionError instanceof Error ? ingestionError.message : String(ingestionError),
          },
        ],
        validation: {
          pages: 0,
          sessions: 0,
          keywords: 0,
          leads: 0,
          campaigns: 0,
        },
        ready: false,
      });
    }
  }

  return {
    attempted: companyIds.length,
    succeeded,
    failed,
    companies,
  };
}
