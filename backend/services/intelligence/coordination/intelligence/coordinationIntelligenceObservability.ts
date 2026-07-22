/**
 * Communication Lifecycle Intelligence — observability (WS-2C). Fail-safe;
 * namespace `ai.coordination.intelligence.*` (Shared-Contract names untouched).
 */
import { recordRawCounter, recordRawHistogram } from '../../../../observability';

export function recordIntelligenceQuery(query: string, resultCount: number, latencyMs: number): void {
  try {
    recordRawCounter('ai.coordination.intelligence.query', 1, { query });
    recordRawHistogram('ai.coordination.intelligence.result_count', resultCount, { query });
    recordRawHistogram('ai.coordination.intelligence.latency_ms', latencyMs, { query });
  } catch { /* observability is fail-safe */ }
}

export function recordIntelligenceDegrade(query: string, reason: string): void {
  try {
    recordRawCounter('ai.coordination.intelligence.degrade', 1, { query, reason });
  } catch { /* observability is fail-safe */ }
}
