/**
 * PL-09(b) — the ONE decision for the Prometheus scrape token, shared by both scrape targets:
 * pages/api/observability/metrics.ts (API) and backend/workers/healthServer.ts (worker /metrics).
 * Both endpoints call this, so they cannot drift.
 *
 * Dual-token acceptance, so the token can be rotated without a scrape gap:
 *   - OBSERVABILITY_EXPORT_TOKEN unset/empty      -> 'dark' (404). PREVIOUS can NEVER re-enable a dark endpoint.
 *   - presented equals CURRENT                    -> 'accepted'
 *   - presented equals PREVIOUS (set, non-blank)  -> 'accepted'
 *   - anything else (wrong / missing)             -> 'rejected' (401) — the same answer whichever token was
 *     wrong, so there is no oracle.
 * PREVIOUS set to '' (or whitespace only) is treated as unset.
 *
 * Timing: BOTH comparisons always run (no short-circuit), each through the constant-time helper; when
 * PREVIOUS is unset the second comparison runs against CURRENT and its result is discarded, so the work done
 * does not reveal which token matched (or whether a previous token is configured).
 *
 * Scope: the metrics scrape token ONLY. The ads trigger (ADS_ACQUISITION_TRIGGER_TOKEN, PO-3 F1) stays
 * single-token and must not call this.
 */
import { constantTimeEqual } from './constantTimeEqual';

export type MetricsExportTokenDecision = 'dark' | 'accepted' | 'rejected';

function configuredPrevious(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.OBSERVABILITY_EXPORT_TOKEN_PREVIOUS;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

/**
 * 05 (PL-09(b) review): a PREVIOUS token left configured after a rotation keeps the rotated-away secret valid
 * indefinitely. Make that VISIBLE in monitoring rather than discoverable in a record: a gauge appended to the
 * /metrics body - which only a token holder can read (never on the unauthenticated /health, where "a rotation is in
 * progress" would be a free hint). Alert when it stays 1 for more than 24 h.
 */
export function previousTokenGaugeText(env: NodeJS.ProcessEnv = process.env): string {
  const on = configuredPrevious(env) !== undefined ? 1 : 0;
  return '# TYPE observability_export_token_previous_configured gauge\n'
    + `observability_export_token_previous_configured ${on}\n`;
}

export function decideMetricsExportToken(
  presented: unknown,
  env: NodeJS.ProcessEnv = process.env,
): MetricsExportTokenDecision {
  const current = env.OBSERVABILITY_EXPORT_TOKEN;
  if (!current) return 'dark';
  const previous = configuredPrevious(env);

  const matchesCurrent = constantTimeEqual(presented, current);
  const matchesPreviousSlot = constantTimeEqual(presented, previous ?? current);
  const matchesPrevious = previous !== undefined && matchesPreviousSlot;

  return matchesCurrent || matchesPrevious ? 'accepted' : 'rejected';
}
