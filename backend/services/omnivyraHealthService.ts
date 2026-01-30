type OmniVyraErrorType =
  | 'timeout'
  | 'schema_invalid'
  | 'http_error'
  | 'version_mismatch'
  | 'unknown';

type OmniVyraEndpointHealth = {
  endpoint: string;
  total_calls: number;
  success_calls: number;
  failure_calls: number;
  avg_latency_ms: number;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_error_reason?: string | null;
  last_error_type?: OmniVyraErrorType | null;
};

type OmniVyraHealthReport = {
  status: 'healthy' | 'degraded' | 'down' | 'disabled';
  endpoints: Record<string, OmniVyraEndpointHealth>;
  avg_latency_ms: number;
  success_rate: number;
  last_error: string | null;
};

const store = new Map<string, OmniVyraEndpointHealth>();
let lastMeta: {
  endpoint?: string;
  latency_ms?: number;
  contract_valid?: boolean;
  error_type?: OmniVyraErrorType;
  contract_version?: string;
} | null = null;
let lastFallbackReason: string | null = null;

const nowIso = () => new Date().toISOString();

const ensureEndpoint = (endpoint: string): OmniVyraEndpointHealth => {
  const existing = store.get(endpoint);
  if (existing) return existing;
  const created: OmniVyraEndpointHealth = {
    endpoint,
    total_calls: 0,
    success_calls: 0,
    failure_calls: 0,
    avg_latency_ms: 0,
    last_success_at: null,
    last_failure_at: null,
    last_error_reason: null,
    last_error_type: null,
  };
  store.set(endpoint, created);
  return created;
};

export const recordSuccess = (endpoint: string, latencyMs: number) => {
  const entry = ensureEndpoint(endpoint);
  entry.total_calls += 1;
  entry.success_calls += 1;
  entry.last_success_at = nowIso();
  entry.avg_latency_ms = entry.avg_latency_ms
    ? Math.round(entry.avg_latency_ms * 0.8 + latencyMs * 0.2)
    : latencyMs;
  entry.last_error_reason = null;
  entry.last_error_type = null;
  store.set(endpoint, entry);
};

export const recordFailure = (endpoint: string, errorType: OmniVyraErrorType, reason?: string) => {
  const entry = ensureEndpoint(endpoint);
  entry.total_calls += 1;
  entry.failure_calls += 1;
  entry.last_failure_at = nowIso();
  entry.last_error_reason = reason ?? errorType;
  entry.last_error_type = errorType;
  store.set(endpoint, entry);
};

export const setLastMeta = (meta: {
  endpoint: string;
  latency_ms: number;
  contract_valid: boolean;
  error_type?: OmniVyraErrorType;
  contract_version?: string;
}) => {
  lastMeta = meta;
};

export const setLastFallbackReason = (reason: string | null) => {
  lastFallbackReason = reason;
};

export const getLastMeta = () => lastMeta;

export const getLastFallbackReason = () => lastFallbackReason;

export const getHealthReport = (omnivyraEnabled: boolean): OmniVyraHealthReport => {
  if (!omnivyraEnabled) {
    return {
      status: 'disabled',
      endpoints: Object.fromEntries(store.entries()),
      avg_latency_ms: 0,
      success_rate: 0,
      last_error: 'omnivyra_disabled',
    };
  }

  const entries = Array.from(store.values());
  const totalCalls = entries.reduce((sum, entry) => sum + entry.total_calls, 0);
  const successCalls = entries.reduce((sum, entry) => sum + entry.success_calls, 0);
  const avgLatency =
    entries.length > 0
      ? Math.round(entries.reduce((sum, entry) => sum + entry.avg_latency_ms, 0) / entries.length)
      : 0;
  const successRate = totalCalls > 0 ? Number((successCalls / totalCalls).toFixed(3)) : 1;
  const lastError = entries.find((entry) => entry.last_error_reason)?.last_error_reason ?? null;

  let status: OmniVyraHealthReport['status'] = 'healthy';
  if (totalCalls === 0) {
    status = 'degraded';
  } else if (successRate < 0.5) {
    status = 'down';
  } else if (successRate < 0.8) {
    status = 'degraded';
  }

  return {
    status,
    endpoints: Object.fromEntries(store.entries()),
    avg_latency_ms: avgLatency,
    success_rate: successRate,
    last_error: lastError,
  };
};

export const resetOmniVyraHealth = () => {
  store.clear();
  lastMeta = null;
  lastFallbackReason = null;
};
