import {
  ingestSerpSnapshot,
  upsertCompetitorDomain,
  type SerpSnapshotInput,
} from './externalCompetitiveIntelligenceService';
import { assertAnalyticsMutationAllowed } from './analyticsEnvironmentGuardService';
import { ownedDbTable } from '../db/writeOwner';
import { authorizeProviderCall, recordProviderUsage } from './providers/providerCostGovernor';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type SerpProviderId = 'manual_import' | 'compliant_api' | 'dataforseo' | 'serpapi' | 'scaleserp';

export type SerpProviderResult = {
  query: string;
  geography?: string | null;
  device?: string | null;
  results: SerpSnapshotInput['results'];
  provider_metadata?: Record<string, unknown>;
};

export type SerpAcquisitionProvider = {
  id: SerpProviderId;
  costPerQueryUsd?: number;
  fetch(query: string): Promise<SerpProviderResult | null>;
};

export type SerpAcquisitionRun = {
  status: 'completed' | 'partial' | 'skipped' | 'failed';
  attempted_queries: number;
  snapshots_written: number;
  results_written: number;
  competitors_observed?: number;
  seeded_queries?: number;
  provider_health?: SerpProviderHealth[];
  estimated_cost_usd?: number;
  errors: string[];
};

export type SerpProviderHealth = {
  provider: SerpProviderId;
  status: 'ready' | 'not_configured' | 'degraded' | 'failed';
  requests: number;
  successes: number;
  failures: number;
  quota_remaining: number | null;
  last_error: string | null;
};

export type SerpQuerySeed = {
  query: string;
  source: 'gsc_high_value' | 'authority_topic' | 'commercial_intent' | 'manual';
  priority_score: number;
  evidence: Record<string, unknown>;
};

export function createManualSerpProvider(rows: SerpProviderResult[]): SerpAcquisitionProvider {
  const byQuery = new Map(rows.map((row) => [row.query.toLowerCase().trim(), row]));
  return {
    id: 'manual_import',
    costPerQueryUsd: 0,
    async fetch(query: string) {
      return byQuery.get(query.toLowerCase().trim()) ?? null;
    },
  };
}

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}

function domainFromUrl(value: string): string {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return '';
  }
}

function parseProviderResults(rawResults: any[]): SerpSnapshotInput['results'] {
  return rawResults.slice(0, 50).map((row: any, index: number): SerpSnapshotInput['results'][number] => {
    const urlValue = String(row.url ?? row.link ?? row.link_url ?? '').trim();
    const domain = normalizeDomain(String(row.domain ?? row.displayed_link ?? row.source ?? '').trim()) || domainFromUrl(urlValue);
    return {
      position: Number(row.position ?? row.rank ?? row.rank_absolute ?? index + 1),
      url: urlValue,
      domain,
      title: row.title ?? null,
      result_type: row.featured_snippet || row.type === 'featured_snippet' ? 'featured_snippet' : 'organic',
    };
  }).filter((row) => row.url && row.domain && row.position > 0);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // ssrf-ok: url is a fixed/env SERP provider endpoint (SERPAPI/ScaleSERP/DataForSEO)
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(label: string, run: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function configuredProviderHealth(id: SerpProviderId, configured: boolean): SerpProviderHealth {
  return {
    provider: id,
    status: configured ? 'ready' : 'not_configured',
    requests: 0,
    successes: 0,
    failures: 0,
    quota_remaining: null,
    last_error: null,
  };
}

function createGenericSerpProvider(): SerpAcquisitionProvider | null {
  const endpoint = process.env.SERP_INTELLIGENCE_API_ENDPOINT;
  const apiKey = process.env.SERP_INTELLIGENCE_API_KEY;
  if (!endpoint || !apiKey) return null;
  return {
    id: 'compliant_api',
    costPerQueryUsd: Number(process.env.SERP_GENERIC_COST_PER_QUERY_USD ?? 0),
    async fetch(query: string) {
      const url = new URL(endpoint);
      url.searchParams.set('q', query);
      const response = await withRetry(`generic SERP provider "${query}"`, () => fetchWithTimeout(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, Number(process.env.SERP_PROVIDER_TIMEOUT_MS ?? 15000)));
      if (!response.ok) {
        throw new Error(`SERP provider failed for "${query}" with HTTP ${response.status}`);
      }
      const body = await response.json() as any;
      const rawResults = Array.isArray(body.results) ? body.results : Array.isArray(body.organic_results) ? body.organic_results : [];
      return {
        query,
        geography: body.geography ?? body.location ?? 'global',
        device: body.device ?? 'desktop',
        results: parseProviderResults(rawResults),
        provider_metadata: { provider: 'compliant_api' },
      };
    },
  };
}

function createSerpApiProvider(): SerpAcquisitionProvider | null {
  const apiKey = process.env.SERPAPI_KEY || process.env.SERP_INTELLIGENCE_SERPAPI_KEY;
  if (!apiKey) return null;
  return {
    id: 'serpapi',
    costPerQueryUsd: Number(process.env.SERPAPI_COST_PER_QUERY_USD ?? 0.01),
    async fetch(query: string) {
      const url = new URL(process.env.SERPAPI_ENDPOINT ?? 'https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', apiKey);
      if (process.env.SERP_LOCATION) url.searchParams.set('location', process.env.SERP_LOCATION);
      const response = await withRetry(`SerpAPI "${query}"`, () => fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } }, Number(process.env.SERP_PROVIDER_TIMEOUT_MS ?? 15000)));
      if (!response.ok) throw new Error(`SerpAPI failed for "${query}" with HTTP ${response.status}`);
      const body = await response.json() as any;
      return {
        query,
        geography: body.search_parameters?.location ?? body.search_information?.detected_location ?? 'global',
        device: body.search_parameters?.device ?? 'desktop',
        results: parseProviderResults(Array.isArray(body.organic_results) ? body.organic_results : []),
        provider_metadata: {
          provider: 'serpapi',
          search_id: body.search_metadata?.id ?? null,
          total_results: body.search_information?.total_results ?? null,
        },
      };
    },
  };
}

function createScaleSerpProvider(): SerpAcquisitionProvider | null {
  const apiKey = process.env.SCALESERP_API_KEY || process.env.SERP_INTELLIGENCE_SCALESERP_KEY;
  if (!apiKey) return null;
  return {
    id: 'scaleserp',
    costPerQueryUsd: Number(process.env.SCALESERP_COST_PER_QUERY_USD ?? 0.01),
    async fetch(query: string) {
      const url = new URL(process.env.SCALESERP_ENDPOINT ?? 'https://api.scaleserp.com/search');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('q', query);
      if (process.env.SERP_LOCATION) url.searchParams.set('location', process.env.SERP_LOCATION);
      const response = await withRetry(`ScaleSERP "${query}"`, () => fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } }, Number(process.env.SERP_PROVIDER_TIMEOUT_MS ?? 15000)));
      if (!response.ok) throw new Error(`ScaleSERP failed for "${query}" with HTTP ${response.status}`);
      const body = await response.json() as any;
      return {
        query,
        geography: body.request_info?.location ?? body.search_parameters?.location ?? 'global',
        device: body.request_info?.device ?? 'desktop',
        results: parseProviderResults(Array.isArray(body.organic_results) ? body.organic_results : []),
        provider_metadata: {
          provider: 'scaleserp',
          search_id: body.request_info?.id ?? null,
          total_results: body.search_information?.total_results ?? null,
        },
      };
    },
  };
}

function createDataForSeoProvider(): SerpAcquisitionProvider | null {
  const login = process.env.DATAFORSEO_LOGIN || process.env.SERP_INTELLIGENCE_DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD || process.env.SERP_INTELLIGENCE_DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return {
    id: 'dataforseo',
    costPerQueryUsd: Number(process.env.DATAFORSEO_COST_PER_QUERY_USD ?? 0.002),
    async fetch(query: string) {
      const endpoint = process.env.DATAFORSEO_SERP_ENDPOINT ?? 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
      const auth = Buffer.from(`${login}:${password}`).toString('base64');
      const payload = [{
        keyword: query,
        location_name: process.env.SERP_LOCATION || 'United States',
        language_code: process.env.SERP_LANGUAGE_CODE || 'en',
        device: process.env.SERP_DEVICE || 'desktop',
        depth: Number(process.env.SERP_RESULT_DEPTH ?? 50),
      }];
      const response = await withRetry(`DataForSEO "${query}"`, () => fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }, Number(process.env.SERP_PROVIDER_TIMEOUT_MS ?? 20000)));
      if (!response.ok) throw new Error(`DataForSEO failed for "${query}" with HTTP ${response.status}`);
      const body = await response.json() as any;
      const task = body.tasks?.[0];
      const items = task?.result?.[0]?.items ?? [];
      return {
        query,
        geography: task?.data?.location_name ?? payload[0].location_name,
        device: task?.data?.device ?? payload[0].device,
        results: parseProviderResults(items.filter((item: any) => item.type === 'organic' || item.type === 'featured_snippet')),
        provider_metadata: {
          provider: 'dataforseo',
          task_id: task?.id ?? null,
          cost: task?.cost ?? null,
          status_code: task?.status_code ?? null,
        },
      };
    },
  };
}

export function configuredSerpProviders(): SerpAcquisitionProvider[] {
  const requested = String(process.env.SERP_PROVIDER_PRIORITY ?? 'dataforseo,serpapi,scaleserp,generic')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const factories: Record<string, () => SerpAcquisitionProvider | null> = {
    dataforseo: createDataForSeoProvider,
    serpapi: createSerpApiProvider,
    scaleserp: createScaleSerpProvider,
    generic: createGenericSerpProvider,
    compliant_api: createGenericSerpProvider,
  };
  return requested.flatMap((key) => {
    const provider = factories[key]?.() ?? null;
    return provider ? [provider] : [];
  });
}

export function getConfiguredSerpProviderHealth(): SerpProviderHealth[] {
  const providers = configuredSerpProviders();
  const configured = new Set(providers.map((provider) => provider.id));
  return (['dataforseo', 'serpapi', 'scaleserp', 'compliant_api'] as SerpProviderId[]).map((id) =>
    configuredProviderHealth(id, configured.has(id)),
  );
}

async function recordProviderHealth(params: {
  provider: SerpProviderId;
  status: 'ready' | 'degraded' | 'failed';
  requests: number;
  successes: number;
  failures: number;
  estimatedCostUsd: number;
  lastError: string | null;
}): Promise<void> {
  await ownedDbTable('analytics_serp_provider_health').insert({
    provider: params.provider,
    status: params.status,
    checked_at: new Date().toISOString(),
    requests: params.requests,
    successes: params.successes,
    failures: params.failures,
    quota_remaining: null,
    estimated_cost_usd: params.estimatedCostUsd,
    last_error: params.lastError,
    metadata: {
      source: 'serp_acquisition',
      fabricated: false,
    },
  });
}

export function createConfiguredSerpApiProvider(): SerpAcquisitionProvider | null {
  const providers = configuredSerpProviders();
  if (providers.length === 0) return null;
  if (providers.length === 1) return providers[0];
  const health = new Map<SerpProviderId, SerpProviderHealth>();
  for (const id of ['dataforseo', 'serpapi', 'scaleserp', 'compliant_api'] as SerpProviderId[]) {
    const configured = providers.some((provider) => provider.id === id);
    health.set(id, configuredProviderHealth(id, configured));
  }
  return {
    id: providers[0].id,
    costPerQueryUsd: Math.max(...providers.map((provider) => provider.costPerQueryUsd ?? 0)),
    async fetch(query: string) {
      const errors: string[] = [];
      for (const provider of providers) {
        const state = health.get(provider.id) ?? configuredProviderHealth(provider.id, true);
        state.requests += 1;
        try {
          const result = await provider.fetch(query);
          state.successes += 1;
          state.status = 'ready';
          health.set(provider.id, state);
          return result ? {
            ...result,
            provider_metadata: {
              ...(result.provider_metadata ?? {}),
              failover_provider: provider.id,
              failover_errors: errors,
            },
          } : null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.failures += 1;
          state.status = 'degraded';
          state.last_error = message;
          health.set(provider.id, state);
          errors.push(`${provider.id}: ${message}`);
        }
      }
      throw new Error(`All configured SERP providers failed for "${query}": ${errors.join('; ')}`);
    },
  };
}

export function prioritySerpQueries(gsc: GscSeoIntelligence | null, limit = 8): string[] {
  return (gsc?.top_queries ?? [])
    .filter((query) => query.classification !== 'branded' && query.impressions >= 1)
    .sort((a, b) => b.opportunity_score - a.opportunity_score || b.impressions - a.impressions)
    .map((query) => query.query)
    .slice(0, limit);
}

function isOwnedDomain(domain: string): boolean {
  return /(^|\.)omnivyra\.com$/i.test(normalizeDomain(domain));
}

function isUtilityDomain(domain: string): boolean {
  return /(^|\.)?(google|youtube|facebook|instagram|linkedin|x|twitter|reddit|wikipedia|apple|microsoft)\.com$/i.test(normalizeDomain(domain));
}

function maxQueriesAllowed(requested: number): number {
  const dailyLimit = Number(process.env.SERP_DAILY_QUERY_LIMIT ?? 25);
  const runLimit = Number(process.env.SERP_MAX_QUERIES_PER_RUN ?? 8);
  return Math.max(0, Math.min(requested, runLimit, dailyLimit));
}

function estimateCost(provider: SerpAcquisitionProvider, queryCount: number): number {
  return Number(((provider.costPerQueryUsd ?? 0) * queryCount).toFixed(4));
}

async function persistObservedCompetitors(params: {
  companyId: string;
  query: string;
  results: SerpSnapshotInput['results'];
  provider: SerpProviderId;
}): Promise<number> {
  const domains = new Map<string, { bestPosition: number; urls: string[]; titles: string[] }>();
  for (const result of params.results) {
    const domain = normalizeDomain(result.domain);
    if (!domain || isOwnedDomain(domain) || isUtilityDomain(domain) || result.position > 10) continue;
    const current = domains.get(domain) ?? { bestPosition: 99, urls: [], titles: [] };
    current.bestPosition = Math.min(current.bestPosition, result.position);
    current.urls.push(result.url);
    if (result.title) current.titles.push(result.title);
    domains.set(domain, current);
  }

  let persisted = 0;
  for (const [domain, row] of domains) {
    await upsertCompetitorDomain({
      company_id: params.companyId,
      domain,
      label: domain,
      source: 'serp_observed',
      confidence: row.bestPosition <= 3 ? 'high' : 'medium',
      relevance_score: Math.max(55, 96 - row.bestPosition * 5),
      active: true,
      evidence: {
        source: 'external_serp_warehouse',
        query: params.query,
        best_position: row.bestPosition,
        observed_urls: row.urls.slice(0, 3),
        observed_titles: row.titles.slice(0, 3),
        provider: params.provider,
        fabricated: false,
      },
    });
    persisted += 1;
  }
  return persisted;
}

export function buildSerpQuerySeeds(gsc: GscSeoIntelligence | null, limit = 20): SerpQuerySeed[] {
  const seeds = new Map<string, SerpQuerySeed>();
  for (const query of gsc?.top_queries ?? []) {
    if (query.classification === 'branded' || query.impressions < 1) continue;
    const source = query.classification === 'commercial' ? 'commercial_intent' : 'gsc_high_value';
    const priority = Math.round(
      query.opportunity_score * 0.6
      + Math.min(100, query.impressions / 10) * 0.25
      + Math.max(0, 30 - query.avg_position) * 0.5,
    );
    const current = seeds.get(query.query);
    const next: SerpQuerySeed = {
      query: query.query,
      source,
      priority_score: Math.max(1, Math.min(100, priority)),
      evidence: {
        source: 'gsc_canonical_ingestion',
        impressions: query.impressions,
        clicks: query.clicks,
        ctr: query.ctr,
        avg_position: query.avg_position,
        classification: query.classification,
        opportunity_score: query.opportunity_score,
      },
    };
    if (!current || next.priority_score > current.priority_score) seeds.set(query.query, next);
  }
  return [...seeds.values()]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, limit);
}

export async function seedSerpQueryQueue(params: {
  companyId: string;
  gsc: GscSeoIntelligence | null;
  limit?: number;
}): Promise<{ status: 'ready' | 'skipped' | 'failed'; seeded: number; errors: string[]; seeds: SerpQuerySeed[] }> {
  const seeds = buildSerpQuerySeeds(params.gsc, params.limit ?? 20);
  if (!seeds.length) return { status: 'skipped', seeded: 0, errors: [], seeds: [] };
  try {
    assertAnalyticsMutationAllowed('serp_acquisition');
    const rows = seeds.map((seed) => ({
      company_id: params.companyId,
      query: seed.query,
      source: seed.source,
      priority_score: seed.priority_score,
      status: 'queued',
      evidence: seed.evidence,
      next_refresh_at: new Date().toISOString(),
    }));
    const result = await ownedDbTable('analytics_serp_query_queue')
      .upsert(rows, { onConflict: 'company_id,query' });
    if (result.error) throw new Error(result.error.message);
    return { status: 'ready', seeded: rows.length, errors: [], seeds };
  } catch (error) {
    return {
      status: 'failed',
      seeded: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      seeds,
    };
  }
}

export async function runSerpAcquisition(params: {
  companyId: string;
  gsc: GscSeoIntelligence | null;
  provider: SerpAcquisitionProvider;
  maxQueries?: number;
}): Promise<SerpAcquisitionRun> {
  assertAnalyticsMutationAllowed('serp_acquisition');
  const maxQueries = maxQueriesAllowed(params.maxQueries ?? 8);
  if (maxQueries <= 0) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: ['SERP acquisition skipped by cost/query limits.'] };
  }
  const queries = prioritySerpQueries(params.gsc, maxQueries);
  if (!queries.length) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: [] };
  }

  // Canonical governor gate (no provider bypass): kill-switch / dry-run / budget.
  const gov = authorizeProviderCall({ providerId: params.provider.id, organizationId: params.companyId });
  if (!gov.allowed) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: [`provider_governor_blocked:${params.provider.id}:${gov.reason}`] };
  }

  let snapshots = 0;
  let results = 0;
  let competitors = 0;
  const errors: string[] = [];

  for (const query of queries) {
    try {
      const payload = await params.provider.fetch(query);
      void recordProviderUsage({ providerId: params.provider.id, organizationId: params.companyId, units: 1, operation: 'serp_query' });
      if (!payload || payload.results.length === 0) continue;
      const written = await ingestSerpSnapshot({
        companyId: params.companyId,
        query,
        geography: payload.geography ?? 'global',
        device: payload.device ?? 'desktop',
        provider: params.provider.id,
        results: payload.results,
        provenance: payload.provider_metadata ?? {},
      });
      if (written.snapshot_id) snapshots += 1;
      results += written.result_count;
      competitors += await persistObservedCompetitors({
        companyId: params.companyId,
        query,
        results: payload.results,
        provider: params.provider.id,
      }).catch(() => 0);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const status: SerpAcquisitionRun['status'] = errors.length && snapshots === 0 ? 'failed' : errors.length ? 'partial' : snapshots > 0 ? 'completed' : 'skipped';
  await recordProviderHealth({
    provider: params.provider.id,
    status: status === 'failed' ? 'failed' : errors.length ? 'degraded' : 'ready',
    requests: queries.length,
    successes: snapshots,
    failures: errors.length,
    estimatedCostUsd: estimateCost(params.provider, queries.length),
    lastError: errors[0] ?? null,
  }).catch(() => undefined);

  return {
    status,
    attempted_queries: queries.length,
    snapshots_written: snapshots,
    results_written: results,
    competitors_observed: competitors,
    estimated_cost_usd: estimateCost(params.provider, queries.length),
    errors: errors.slice(0, 5),
  };
}

export async function runQueuedSerpAcquisition(params: {
  companyId: string;
  provider: SerpAcquisitionProvider;
  maxQueries?: number;
}): Promise<SerpAcquisitionRun> {
  assertAnalyticsMutationAllowed('serp_acquisition');
  const startedAt = new Date().toISOString();
  const maxQueries = maxQueriesAllowed(params.maxQueries ?? 8);
  if (maxQueries <= 0) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: ['SERP acquisition skipped by cost/query limits.'] };
  }
  const { data, error } = await ownedDbTable('analytics_serp_query_queue')
    .select('query, priority_score')
    .eq('company_id', params.companyId)
    .in('status', ['queued', 'failed'])
    .lte('next_refresh_at', startedAt)
    .order('priority_score', { ascending: false })
    .limit(maxQueries);
  if (error) throw new Error(`Failed to load SERP query queue: ${error.message}`);
  const queries = ((data ?? []) as Array<{ query: string | null }>).map((row) => String(row.query ?? '').trim()).filter(Boolean);
  if (!queries.length) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: [] };
  }

  // Canonical governor gate (no provider bypass): kill-switch / dry-run / budget.
  const gov = authorizeProviderCall({ providerId: params.provider.id, organizationId: params.companyId });
  if (!gov.allowed) {
    return { status: 'skipped', attempted_queries: 0, snapshots_written: 0, results_written: 0, estimated_cost_usd: 0, errors: [`provider_governor_blocked:${params.provider.id}:${gov.reason}`] };
  }

  const runInsert = await ownedDbTable('analytics_serp_acquisition_runs')
    .insert({
      company_id: params.companyId,
      provider: params.provider.id,
      status: 'running',
      attempted_queries: queries.length,
      snapshots_written: 0,
      results_written: 0,
      estimated_cost_usd: estimateCost(params.provider, queries.length),
      started_at: startedAt,
      errors: [],
    })
    .select('id')
    .maybeSingle();
  const runId = runInsert.data?.id ?? null;

  let snapshots = 0;
  let results = 0;
  let competitors = 0;
  const errors: string[] = [];
  for (const query of queries) {
    try {
      const payload = await params.provider.fetch(query);
      void recordProviderUsage({ providerId: params.provider.id, organizationId: params.companyId, units: 1, operation: 'serp_query' });
      if (!payload || payload.results.length === 0) {
        await ownedDbTable('analytics_serp_query_queue')
          .update({
            status: 'queued',
            last_attempt_at: new Date().toISOString(),
            next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq('company_id', params.companyId)
          .eq('query', query);
        continue;
      }
      const written = await ingestSerpSnapshot({
        companyId: params.companyId,
        query,
        geography: payload.geography ?? 'global',
        device: payload.device ?? 'desktop',
        provider: params.provider.id,
        results: payload.results,
        provenance: payload.provider_metadata ?? {},
      });
      if (written.snapshot_id) snapshots += 1;
      results += written.result_count;
      competitors += await persistObservedCompetitors({
        companyId: params.companyId,
        query,
        results: payload.results,
        provider: params.provider.id,
      }).catch(() => 0);
      await ownedDbTable('analytics_serp_query_queue')
        .update({
          status: 'completed',
          last_attempt_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          next_refresh_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('company_id', params.companyId)
        .eq('query', query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      await ownedDbTable('analytics_serp_query_queue')
        .update({
          status: 'failed',
          last_attempt_at: new Date().toISOString(),
          next_refresh_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          last_error: message,
        })
        .eq('company_id', params.companyId)
        .eq('query', query);
    }
  }

  const status: SerpAcquisitionRun['status'] = errors.length && snapshots === 0
    ? 'failed'
    : errors.length
      ? 'partial'
      : snapshots > 0
        ? 'completed'
        : 'skipped';
  if (runId) {
    await ownedDbTable('analytics_serp_acquisition_runs')
      .update({
        status,
        snapshots_written: snapshots,
        results_written: results,
        competitors_observed: competitors,
        estimated_cost_usd: estimateCost(params.provider, queries.length),
        completed_at: new Date().toISOString(),
        errors: errors.slice(0, 10),
      })
      .eq('id', runId);
  }
  await recordProviderHealth({
    provider: params.provider.id,
    status: status === 'failed' ? 'failed' : errors.length ? 'degraded' : 'ready',
    requests: queries.length,
    successes: snapshots,
    failures: errors.length,
    estimatedCostUsd: estimateCost(params.provider, queries.length),
    lastError: errors[0] ?? null,
  }).catch(() => undefined);

  return {
    status,
    attempted_queries: queries.length,
    snapshots_written: snapshots,
    results_written: results,
    competitors_observed: competitors,
    estimated_cost_usd: estimateCost(params.provider, queries.length),
    errors: errors.slice(0, 5),
  };
}
