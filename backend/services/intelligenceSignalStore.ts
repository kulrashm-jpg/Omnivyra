/**
 * Unified Intelligence Signal Store
 * Central signal storage layer for the External API Intelligence System.
 * Stores normalized intelligence signals from external APIs with idempotency
 * and optional entity tables (topics, companies, keywords, influencers).
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

/** Input for a single normalized signal to insert */
export type NormalizedSignalInput = {
  source_api_id: string;
  company_id?: string | null;
  signal_type: string;
  topic?: string | null;
  cluster_id?: string | null;
  confidence_score?: number | null;
  detected_at: Date | string;
  source_url?: string | null;
  normalized_payload?: Record<string, unknown> | null;
  raw_payload?: Record<string, unknown> | null;
  /** Optional: if not provided, will be computed from source_api_id + topic + detected_at */
  idempotency_key?: string | null;
  /** Optional entity values to store in relational tables */
  topics?: string[];
  companies?: string[];
  keywords?: string[];
  influencers?: string[];
  /** Phase 1 taxonomy fields */
  primary_category?: string | null;
  tags?: string[] | null;
  relevance_score?: number | null;
};

/** Result of inserting one signal (inserted or skipped duplicate) */
export type InsertSignalResult = {
  id: string;
  idempotency_key: string;
  inserted: boolean;
};

/** Result of insertNormalizedSignals */
export type InsertNormalizedSignalsResult = {
  inserted: number;
  skipped: number;
  results: InsertSignalResult[];
};

const SIGNAL_TYPE_TREND = 'trend';
const DEFAULT_SIGNAL_TYPE = SIGNAL_TYPE_TREND;

/**
 * Generate idempotency key: hash(source_api_id + topic + detected_at [+ queryHash])
 * When queryHash exists (template expansion), include it for uniqueness.
 * Prevents duplicate signals when polling APIs repeatedly.
 */
export function buildIdempotencyKey(
  sourceApiId: string,
  topic: string | null | undefined,
  detectedAt: Date | string,
  queryHash?: string | null
): string {
  const iso = typeof detectedAt === 'string' ? detectedAt : new Date(detectedAt).toISOString();
  const base = `${sourceApiId}:${(topic ?? '').trim().toLowerCase()}:${iso}`;
  const raw = queryHash ? `${base}:${queryHash}` : base;
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Normalize detected_at to ISO string for DB
 */
function toDetectedAt(detectedAt: Date | string): string {
  return typeof detectedAt === 'string' ? detectedAt : new Date(detectedAt).toISOString();
}

/**
 * Insert normalized signals into intelligence_signals and entity tables.
 * Duplicates (same idempotency_key) are skipped; entities are inserted only for new signals.
 */
export async function insertNormalizedSignals(
  signals: NormalizedSignalInput[],
  options?: { signal_type?: string; queryHash?: string | null }
): Promise<InsertNormalizedSignalsResult> {
  const results: InsertSignalResult[] = [];
  let inserted = 0;
  let skipped = 0;
  const signalType = options?.signal_type ?? DEFAULT_SIGNAL_TYPE;

  for (const s of signals) {
    const detectedAt = toDetectedAt(s.detected_at);
    const queryHash = options?.queryHash ?? null;
    const idempotencyKey =
      s.idempotency_key?.trim() ||
      buildIdempotencyKey(s.source_api_id, s.topic ?? null, detectedAt, queryHash);

    const row: Record<string, unknown> = {
      source_api_id: s.source_api_id,
      company_id: s.company_id ?? null,
      signal_type: s.signal_type || signalType,
      topic: s.topic ?? null,
      cluster_id: s.cluster_id ?? null,
      confidence_score: s.confidence_score ?? null,
      detected_at: detectedAt,
      source_url: s.source_url ?? null,
      normalized_payload: s.normalized_payload ?? null,
      raw_payload: s.raw_payload ?? null,
      idempotency_key: idempotencyKey,
      primary_category: s.primary_category ?? null,
      tags: s.tags ?? [],
      relevance_score: s.relevance_score ?? null,
    };

    const { data: insertedRows, error } = await supabase
      .from('intelligence_signals')
      .upsert(row, {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      })
      .select('id, idempotency_key');

    if (error) {
      throw new Error(`intelligence_signals insert failed: ${error.message}`);
    }

    const insertedRow = Array.isArray(insertedRows) && insertedRows.length > 0 ? insertedRows[0] : null;

    if (insertedRow) {
      inserted += 1;
      results.push({
        id: insertedRow.id,
        idempotency_key: insertedRow.idempotency_key,
        inserted: true,
      });

      const entities = {
        topics: [...new Set((s.topics ?? []).filter(Boolean))],
        companies: [...new Set((s.companies ?? []).filter(Boolean))],
        keywords: [...new Set((s.keywords ?? []).filter(Boolean))],
        influencers: [...new Set((s.influencers ?? []).filter(Boolean))],
      };
      if (s.topic && !entities.topics.includes(s.topic)) {
        entities.topics.push(s.topic);
      }

      await insertEntities(insertedRow.id, entities);
    } else {
      skipped += 1;
      results.push({
        id: '',
        idempotency_key: idempotencyKey,
        inserted: false,
      });
    }
  }

  return { inserted, skipped, results };
}

async function insertEntities(
  signalId: string,
  entities: {
    topics: string[];
    companies: string[];
    keywords: string[];
    influencers: string[];
  }
): Promise<void> {
  const trim = (v: string) => v.trim();
  const nonEmpty = (v: string) => v.length > 0;

  if (entities.topics.length > 0) {
    const rows = entities.topics.map(trim).filter(nonEmpty).map((value) => ({ signal_id: signalId, value }));
    if (rows.length > 0) await supabase.from('signal_topics').insert(rows);
  }
  if (entities.companies.length > 0) {
    const rows = entities.companies.map(trim).filter(nonEmpty).map((value) => ({ signal_id: signalId, value }));
    if (rows.length > 0) await supabase.from('signal_companies').insert(rows);
  }
  if (entities.keywords.length > 0) {
    const rows = entities.keywords.map(trim).filter(nonEmpty).map((value) => ({ signal_id: signalId, value }));
    if (rows.length > 0) await supabase.from('signal_keywords').insert(rows);
  }
  if (entities.influencers.length > 0) {
    const rows = entities.influencers.map(trim).filter(nonEmpty).map((value) => ({ signal_id: signalId, value }));
    if (rows.length > 0) await supabase.from('signal_influencers').insert(rows);
  }
}

/**
 * Run retention cleanup: delete signals older than 365 days.
 * Entity rows are removed automatically via ON DELETE CASCADE.
 */
export async function runRetentionCleanup(): Promise<number> {
  const { data, error } = await supabase.rpc('delete_intelligence_signals_older_than_365_days');
  if (error) throw new Error(`Retention cleanup failed: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}

/** Input shape for insertFromTrendApiResults (matches externalApiService fetch results) */
export type TrendApiResultItem = {
  source: { id: string; name?: string };
  payload: any;
  health?: { freshness_score: number; reliability_score: number } | null;
};

/**
 * Build normalized signal inputs from external API trend results.
 * Use from externalApiService after building the results array (before flattening).
 */
export function buildNormalizedSignalsFromTrendResults(
  results: TrendApiResultItem[],
  companyId: string | null,
  detectedAt: Date = new Date(),
  signalType: string = SIGNAL_TYPE_TREND
): NormalizedSignalInput[] {
  const detectedAtStr = toDetectedAt(detectedAt);
  const signals: NormalizedSignalInput[] = [];

  for (const { source, payload } of results) {
    if (!payload) continue;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const topic = item?.topic ?? item?.title ?? '';
      if (!topic || typeof topic !== 'string') continue;
      const confidence =
        typeof item?.signal_confidence === 'number'
          ? item.signal_confidence
          : typeof item?.confidence === 'number'
            ? item.confidence
            : null;
      signals.push({
        source_api_id: source.id,
        company_id: companyId ?? null,
        signal_type: signalType,
        topic: String(topic).trim(),
        confidence_score: confidence,
        detected_at: detectedAtStr,
        source_url: payload?.source_url ?? item?.url ?? null,
        normalized_payload: item ? { topic, ...item } : null,
        raw_payload: item ?? null,
        topics: [String(topic).trim()],
      });
    }
  }
  return signals;
}

export type QueryContextForRelevance = {
  topic?: string | null;
  competitor?: string | null;
  product?: string | null;
  region?: string | null;
  keyword?: string | null;
};

/**
 * Insert trend signals from external API results (e.g. after fetchTrendsFromApis flow).
 * Idempotency is enforced; duplicates are skipped.
 * When options.queryHash or options.queryContext provided, applies relevance scoring and taxonomy.
 */
export async function insertFromTrendApiResults(
  results: TrendApiResultItem[],
  companyId: string | null,
  options?: {
    detectedAt?: Date;
    signalType?: string;
    queryHash?: string | null;
    queryContext?: QueryContextForRelevance | null;
  }
): Promise<InsertNormalizedSignalsResult> {
  const signals = buildNormalizedSignalsFromTrendResults(
    results,
    companyId,
    options?.detectedAt ?? new Date(),
    options?.signalType ?? SIGNAL_TYPE_TREND
  );
  if (signals.length === 0) return { inserted: 0, skipped: 0, results: [] };

  let signalsToInsert = signals;
  if (companyId || options?.queryContext) {
    const { computeRelevance, loadCompanyContextForRelevance } = await import(
      './signalRelevanceEngine'
    );
    const companyContext = companyId
      ? await loadCompanyContextForRelevance(companyId)
      : null;
    const queryContext = options?.queryContext ?? {
      topic: null,
      competitor: null,
      product: null,
      region: null,
      keyword: null,
    };

    signalsToInsert = signals.map((s) => {
      const relevance = computeRelevance(
        {
          topic: s.topic,
          source: null,
          geo: (s.normalized_payload as Record<string, unknown>)?.geo as string | undefined,
          volume: (s.normalized_payload as Record<string, unknown>)?.volume as number | undefined,
          velocity: (s.normalized_payload as Record<string, unknown>)?.velocity as number | undefined,
          confidence_score: s.confidence_score,
          normalized_payload: s.normalized_payload,
        },
        companyContext,
        queryContext
      );
      return {
        ...s,
        primary_category: relevance.primary_category,
        tags: relevance.tags,
        relevance_score: relevance.relevance_score,
      };
    });
  }

  return insertNormalizedSignals(signalsToInsert, {
    signal_type: options?.signalType ?? SIGNAL_TYPE_TREND,
    queryHash: options?.queryHash ?? null,
  });
}
