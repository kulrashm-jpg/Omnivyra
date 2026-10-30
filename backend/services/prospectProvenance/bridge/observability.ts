/**
 * Bridge observability. Every outcome is COUNTED in-process; every failure is
 * LOGGED (warn) and emitted as a `system_health_metrics` count. Gate-closed
 * skips are counted and logged at debug only: with the gate closed for every
 * tenant (the production default) an info line per feed item would be noise.
 *
 * Logged fields are ids, statuses and reasons only — never a handle, name,
 * URL or content.
 */
import { logger } from '../../logger';
import type { BridgeOutcome } from './types';

const counters = new Map<string, number>();

/** `<kind>.<status>.<reason-head>` → count, since process start. */
export function getBridgeCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetBridgeCounters(): void {
  counters.clear();
}

function reasonHead(reason: string): string {
  const i = reason.indexOf(':');
  return i > 0 ? reason.slice(0, i) : reason;
}

export function observeBridgeOutcome(outcome: BridgeOutcome): BridgeOutcome {
  const key = `${outcome.kind}.${outcome.status}.${reasonHead(outcome.reason)}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);

  const payload = {
    kind: outcome.kind,
    status: outcome.status,
    reason: outcome.reason,
    organizationId: outcome.organizationId,
    externalRef: outcome.externalRef,
    prospectId: outcome.prospectId ?? null,
    personId: outcome.personId ?? null,
    sourceRecordId: outcome.sourceRecordId ?? null,
    leadCreated: outcome.leadCreated ?? null,
    prospectPath: outcome.prospectPath ?? null,
    contribution: outcome.contribution ?? null,
    contributionRole: outcome.contributionRole ?? null,
    roleDowngraded: outcome.roleDowngraded ?? null,
  };

  try {
    if (outcome.status === 'failed') {
      logger.warn('prospect_provenance_bridge_failed', payload);
      void import('../../systemHealthMetricsService')
        .then(({ recordMetric }) => recordMetric(
          'prospect_provenance_bridge', `${outcome.kind}.failed`, 1, 'count', { reason: reasonHead(outcome.reason) },
        ))
        .catch(() => undefined);
    } else if (outcome.status === 'skipped' && outcome.reason.startsWith('gate_closed')) {
      logger.debug('prospect_provenance_bridge', payload);
    } else {
      logger.info('prospect_provenance_bridge', payload);
    }
  } catch {
    // Observability must never break the caller.
  }
  return outcome;
}
