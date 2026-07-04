/**
 * Canonical Telemetry — Consumption Layer
 * ---------------------------------------
 * THE single seam every consumer requests canonical signals through:
 *
 *     providerId  →  TELEMETRY_PROVIDERS  →  TelemetryProviderResult
 *
 * No consumer (Mastery, Readiness, Recommendations, Analytics) queries telemetry
 * storage directly — the providers are the only readers, and this layer is the
 * only orchestrator over them. Consumers pass provider ids; they never touch the
 * store or the aggregator.
 *
 * Fail-soft: a provider that throws is omitted from the result; the calling
 * consumer then falls back to its existing proxy for that signal. While the
 * telemetry table is unprovisioned every provider returns { available:false },
 * so consumers fall back everywhere and behavior is unchanged.
 */

import { TELEMETRY_PROVIDERS, type TelemetryProviderId } from './telemetryProviders';
import type { TelemetryProviderResult, TelemetryWindow } from '../../../lib/telemetry/telemetryTypes';

export type { TelemetryProviderId };

/** id → result for the requested providers (missing id = provider errored, fall back). */
export type TelemetrySignalSet = Partial<Record<TelemetryProviderId, TelemetryProviderResult>>;

/**
 * Resolve a set of canonical signals for an org. The ONLY entry point consumers
 * use; never queries the store. Runs the requested providers concurrently.
 */
export async function resolveTelemetrySignals(
  organizationId: string,
  providerIds: readonly TelemetryProviderId[],
  opts?: { window?: TelemetryWindow; now?: Date },
): Promise<TelemetrySignalSet> {
  const out: TelemetrySignalSet = {};
  if (!organizationId) return out;
  await Promise.all(
    providerIds.map(async (id) => {
      const fn = TELEMETRY_PROVIDERS[id];
      if (!fn) return;
      try {
        out[id] = await fn(organizationId, { window: opts?.window, now: opts?.now });
      } catch {
        /* fail-soft: omit this id so the consumer falls back to its proxy */
      }
    }),
  );
  return out;
}

/**
 * Provider ids the Mastery surface consumes. Mastery scores cumulative adoption,
 * so it reads these over the lifetime window (matching the proxy counts, which
 * count all-time artifacts). One canonical list — no consumer re-declares it.
 */
export const MASTERY_PROVIDER_IDS: readonly TelemetryProviderId[] = [
  'publishing_cadence',
  'campaign_completion_rate',
  'template_utilization',
  'media_utilization',
  'report_usage',
  'automation_adoption',
  'recommendation_adoption',
  'collaboration_depth',
] as const;
