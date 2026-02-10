import { supabase } from '../db/supabaseClient';

type ApiHealthRuntime = {
  avg_latency_ms: number;
  last_latency_ms: number;
};

type ApiHealthSnapshot = {
  api_source_id: string;
  success_count: number;
  failure_count: number;
  last_success_at?: string | null;
  avg_latency_ms: number;
  health_score: number;
  freshness_score: number;
  reliability_score: number;
};

const runtimeStats = new Map<string, ApiHealthRuntime>();

const computeFreshnessScore = (lastSuccessAt?: string | null): number => {
  if (!lastSuccessAt) return 0;
  const last = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(last)) return 0;
  const now = Date.now();
  const diffHours = (now - last) / (1000 * 60 * 60);
  if (diffHours <= 24) return 1;
  const decayWindowHours = 24 * 6;
  const decay = Math.max(0, 1 - (diffHours - 24) / decayWindowHours);
  return Number(decay.toFixed(3));
};

const computeReliabilityScore = (successCount: number, failureCount: number): number => {
  const total = successCount + failureCount;
  if (total === 0) return 1;
  return Number((successCount / total).toFixed(3));
};

const computeLatencyScore = (avgLatencyMs: number): number => {
  if (!avgLatencyMs || avgLatencyMs <= 0) return 1;
  const normalized = Math.min(1, 8000 / avgLatencyMs);
  return Number(normalized.toFixed(3));
};

const computeHealthScore = (input: {
  reliability_score: number;
  freshness_score: number;
  avg_latency_ms: number;
}): number => {
  const latencyScore = computeLatencyScore(input.avg_latency_ms);
  const score = input.reliability_score * input.freshness_score * latencyScore;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
};

const updateLatency = (apiId: string, latencyMs: number) => {
  const existing = runtimeStats.get(apiId);
  if (!existing) {
    runtimeStats.set(apiId, { avg_latency_ms: latencyMs, last_latency_ms: latencyMs });
    return latencyMs;
  }
  const nextAvg = Number(((existing.avg_latency_ms * 0.8) + latencyMs * 0.2).toFixed(2));
  runtimeStats.set(apiId, { avg_latency_ms: nextAvg, last_latency_ms: latencyMs });
  return nextAvg;
};

export const updateApiHealth = async (input: {
  apiId: string;
  success: boolean;
  latencyMs: number;
  /** Set when this update is from a Test API run; used for health status (dot/header). */
  last_test_status?: 'SUCCESS' | 'FAILED';
  last_test_at?: string;
}): Promise<ApiHealthSnapshot | null> => {
  try {
    const { data, error } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', input.apiId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return null;
    }

    const nowIso = new Date().toISOString();
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const freshnessScore = computeFreshnessScore(lastSuccessAt);
    const reliabilityScore = computeReliabilityScore(successCount, failureCount);
    const avgLatencyMs = updateLatency(input.apiId, input.latencyMs);
    const healthScore = computeHealthScore({
      reliability_score: reliabilityScore,
      freshness_score: freshnessScore,
      avg_latency_ms: avgLatencyMs,
    });

    const lastTestStatus = input.last_test_status ?? (input.success ? 'SUCCESS' : 'FAILED');
    const lastTestAt = input.last_test_at ?? nowIso;

    const payloadWithLastTest: Record<string, unknown> = {
      api_source_id: input.apiId,
      last_success_at: lastSuccessAt,
      last_failure_at: lastFailureAt,
      success_count: successCount,
      failure_count: failureCount,
      freshness_score: freshnessScore,
      reliability_score: reliabilityScore,
      last_test_status: lastTestStatus,
      last_test_at: lastTestAt,
      last_test_latency_ms: input.latencyMs,
    };

    let upsertError = (await supabase
      .from('external_api_health')
      .upsert(payloadWithLastTest, { onConflict: 'api_source_id' })).error;

    if (upsertError && (upsertError.message?.includes('last_test') || upsertError.message?.includes('column'))) {
      const payloadWithoutLastTest = {
        api_source_id: input.apiId,
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt,
        success_count: successCount,
        failure_count: failureCount,
        freshness_score: freshnessScore,
        reliability_score: reliabilityScore,
      };
      upsertError = (await supabase
        .from('external_api_health')
        .upsert(payloadWithoutLastTest, { onConflict: 'api_source_id' })).error;
    }

    if (upsertError) {
      console.warn('Failed to persist API health record', { apiId: input.apiId });
    }

    return {
      api_source_id: input.apiId,
      success_count: successCount,
      failure_count: failureCount,
      last_success_at: lastSuccessAt,
      avg_latency_ms: avgLatencyMs,
      health_score: healthScore,
      freshness_score: freshnessScore,
      reliability_score: reliabilityScore,
    };
  } catch (error) {
    console.warn('API health update failed', { apiId: input.apiId });
    return null;
  }
};

export const getHealthSnapshot = async (apiIds: string[]): Promise<ApiHealthSnapshot[]> => {
  if (!apiIds.length) return [];
  const { data, error } = await supabase
    .from('external_api_health')
    .select('*')
    .in('api_source_id', apiIds);
  if (error || !data) return [];

  return data.map((row: any) => {
    const avgLatencyMs = runtimeStats.get(row.api_source_id)?.avg_latency_ms ?? 0;
    const healthScore = computeHealthScore({
      reliability_score: row.reliability_score ?? 1,
      freshness_score: row.freshness_score ?? 1,
      avg_latency_ms: avgLatencyMs,
    });
    return {
      api_source_id: row.api_source_id,
      success_count: row.success_count ?? 0,
      failure_count: row.failure_count ?? 0,
      last_success_at: row.last_success_at ?? null,
      avg_latency_ms: avgLatencyMs,
      health_score: healthScore,
      freshness_score: row.freshness_score ?? 1,
      reliability_score: row.reliability_score ?? 1,
    };
  });
};
