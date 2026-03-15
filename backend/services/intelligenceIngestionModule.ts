/**
 * Intelligence Ingestion Module
 * Consolidates: externalApiService, intelligenceQueryBuilder, intelligencePollingWorker,
 * signalRelevanceEngine, intelligenceSignalStore
 *
 * Responsibilities: API ingestion, query building, signal normalization, signal persistence.
 * Engines remain in place; this module exposes a unified interface.
 */

import {
  fetchSingleSourceWithQueryBuilder,
  getExternalApiSourceById,
  addSignalsGenerated,
  checkCompanyApiLimitsForPolling,
  INTELLIGENCE_POLLER_USER_ID,
} from './externalApiService';
import { normalizeTrends } from './trendNormalizationService';
import { insertFromTrendApiResults } from './intelligenceSignalStore';
import { distributeSignalsToCompanies } from './companySignalDistributionService';

export { expand } from './intelligenceQueryBuilder';
export type { QueryBuilderInput, QueryBuilderOutput } from './intelligenceQueryBuilder';
export type { NormalizedSignalInput, InsertNormalizedSignalsResult } from './intelligenceSignalStore';
export type { RelevanceResult, SignalForRelevance, CompanyContext } from './signalRelevanceEngine';

export type IngestSignalsResult = {
  signals_inserted: number;
  signals_skipped: number;
  company_signals_inserted?: number;
  skipped_reason?: string;
};

/**
 * Ingest signals from an external API source.
 * Fetches, normalizes (via signalRelevanceEngine inside store), persists, and processes for company.
 */
export async function ingestSignals(
  apiSourceId: string,
  companyId: string | null = null,
  _purpose?: string | null
): Promise<IngestSignalsResult> {
  console.log('[intelligence] polling started', { apiSourceId, companyId });
  const source = await getExternalApiSourceById(apiSourceId);
  if (!source) {
    throw new Error('API source not found or inactive');
  }

  if (companyId) {
    const limitsCheck = await checkCompanyApiLimitsForPolling(companyId, apiSourceId);
    if (!limitsCheck.allowed) {
      return {
        signals_inserted: 0,
        signals_skipped: 0,
        skipped_reason: limitsCheck.reason ?? 'company limit',
      };
    }
  }

  const { results, queryHash, queryContext } = await fetchSingleSourceWithQueryBuilder(
    apiSourceId,
    companyId
  );

  console.log('[intelligence] raw results fetched', { count: results.length });
  if (results.length === 0) {
    return { signals_inserted: 0, signals_skipped: 0 };
  }

  // Normalize raw API responses (YouTube, NewsAPI, SerpAPI, etc.) to payload.items format
  const trends = normalizeTrends(
    results.map((r) => ({
      source: r.source,
      payload: r.payload,
      health:
        r.health && r.source
          ? { api_source_id: r.source.id, ...r.health }
          : undefined,
    }))
  );
  console.log('[intelligence] normalized signals count', { count: trends.length });
  if (trends.length === 0) {
    return { signals_inserted: 0, signals_skipped: 0 };
  }

  const normalizedResults = results.map((r) => ({
    source: r.source,
    payload: {
      items: trends.map((t) => ({
        topic: t.title,
        title: t.title,
        confidence: t.confidence,
        signal_confidence: t.confidence,
        url: (t.raw as { url?: string })?.url ?? null,
        ...(t.raw != null && { raw: t.raw }),
      })),
    },
    health: r.health,
  }));

  const totalNormalized = trends.length;
  console.log('[intelligenceIngestion] Normalized intelligence signals', {
    source: source.name,
    normalized_count: totalNormalized,
  });

  const storeResult = await insertFromTrendApiResults(normalizedResults, companyId, {
    detectedAt: new Date(),
    signalType: 'trend',
    queryHash: queryHash ?? null,
    queryContext: queryContext ?? null,
  });

  console.log('[intelligence] signals inserted', {
    inserted: storeResult.inserted,
    skipped: storeResult.skipped,
  });

  if (storeResult.inserted > 0) {
    await addSignalsGenerated({
      apiSourceId,
      userId: INTELLIGENCE_POLLER_USER_ID,
      count: storeResult.inserted,
      feature: 'intelligence_polling',
      companyId,
    });

    const insertedIds = storeResult.results
      .filter((r) => r.inserted && r.id)
      .map((r) => r.id);
    if (insertedIds.length > 0) {
      distributeSignalsToCompanies(insertedIds)
        .then((r) => {
          if (r.totalInserted > 0) {
            console.log(
              `[intelligenceIngestion] distributed to ${r.companiesProcessed} companies, inserted ${r.totalInserted}`
            );
          }
        })
        .catch((err) => {
          console.warn('[intelligenceIngestion] company signal distribution failed', (err as Error)?.message);
        });
    }

    return {
      signals_inserted: storeResult.inserted,
      signals_skipped: storeResult.skipped,
    };
  }

  return {
    signals_inserted: storeResult.inserted,
    signals_skipped: storeResult.skipped,
  };
}
