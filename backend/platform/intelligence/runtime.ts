/**
 * PIP universal runtime (PROD-IMPL-001, Phase 2/3/5/6/7).
 *
 * Every service inherits identical behavior through `runPIP`:
 *   - request/response envelope + version + correlation id
 *   - feature-flag routing (PIP_<SERVICE>_ENABLED, DEFAULT OFF → legacy adapter)
 *   - tenant isolation guard (companyId required; no cross-company reads)
 *   - fail-open: any failure degrades to a deterministic default, logs, and
 *     returns — it can NEVER throw into a caller's critical path
 *   - observability: one structured event per call (existing conventions)
 *
 * No business logic here — this is the platform substrate the skeleton services
 * compose. Nothing in the product calls it yet (foundation only).
 */
import { PIP_VERSION, type PIPService, type PIPRequest, type PIPResponse } from './contracts';

// ── Feature flags — DEFAULT OFF; OFF ⇒ legacy adapter, ON ⇒ platform impl ─────
export function isPIPEnabled(service: PIPService): boolean {
  const raw = String(process.env[`PIP_${service.toUpperCase()}_ENABLED`] ?? '').trim().toLowerCase();
  return /^(1|true|on|yes)$/.test(raw);
}

// ── Correlation ids — caller-provided wins; else a monotonic per-process id.
//    Kept counter-based (not random) so trace ids are stable/parseable. ───────
let _seq = 0;
function nextCorrelationId(companyId: string): string {
  _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER;
  return `pip-${companyId.slice(0, 8)}-${_seq.toString(36)}`;
}

// ── Observability — fail-safe structured event (never throws). Mirrors the
//    repo's structured-telemetry convention; no new framework introduced. ────
export interface PIPCallMetric {
  service: PIPService; op: string; correlationId: string;
  latencyMs: number; degraded: boolean; source: 'platform' | 'legacy-adapter';
  failure: boolean; fallback: boolean; companyPresent: boolean;
}
export function recordPIPCall(m: PIPCallMetric): void {
  try {
    // Single-line structured event; scraped like deployment_integrity_snapshot.
    process.stdout.write(JSON.stringify({ event: 'pip.call', ...m }) + '\n');
  } catch { /* observability is best-effort — never affects behavior */ }
}

function degradedResponse<T>(data: T, source: 'platform' | 'legacy-adapter', correlationId: string): PIPResponse<T> {
  return { v: PIP_VERSION, data, degraded: true, source, correlationId };
}

/**
 * The one execution seam. Routes by flag, guards tenant, times, records, and
 * guarantees fail-open. `emptyDefault` is the deterministic degraded value for
 * this operation (e.g. [] for reads).
 */
export async function runPIP<T>(
  service: PIPService,
  op: string,
  req: PIPRequest,
  fns: { platform: () => Promise<PIPResponse<T>>; legacy: () => Promise<PIPResponse<T>> },
  emptyDefault: T,
): Promise<PIPResponse<T>> {
  const start = Date.now();
  const correlationId = req.correlationId ?? nextCorrelationId(String(req.companyId ?? 'anon'));

  // Tenant isolation guard — a request without a companyId can never read
  // cross-company data; it degrades to the empty default (fail-safe).
  const companyPresent = typeof req.companyId === 'string' && req.companyId.length > 0;
  if (!companyPresent) {
    recordPIPCall({ service, op, correlationId, latencyMs: 0, degraded: true, source: 'legacy-adapter', failure: true, fallback: true, companyPresent: false });
    return degradedResponse(emptyDefault, 'legacy-adapter', correlationId);
  }

  const enabled = isPIPEnabled(service);
  try {
    const res = enabled ? await fns.platform() : await fns.legacy();
    recordPIPCall({ service, op, correlationId, latencyMs: Date.now() - start, degraded: res.degraded, source: res.source, failure: false, fallback: false, companyPresent: true });
    return { ...res, correlationId };
  } catch {
    // Fail-open: degrade, log, deterministic default. Legacy behavior continues
    // because nothing downstream depends on a thrown platform error.
    recordPIPCall({ service, op, correlationId, latencyMs: Date.now() - start, degraded: true, source: enabled ? 'platform' : 'legacy-adapter', failure: true, fallback: true, companyPresent: true });
    return degradedResponse(emptyDefault, enabled ? 'platform' : 'legacy-adapter', correlationId);
  }
}

/** Helper for services to build a clean success envelope. */
export function ok<T>(data: T, source: 'platform' | 'legacy-adapter', correlationId = '', explanation?: PIPResponse<T>['explanation']): PIPResponse<T> {
  return { v: PIP_VERSION, data, degraded: false, source, correlationId, explanation };
}
