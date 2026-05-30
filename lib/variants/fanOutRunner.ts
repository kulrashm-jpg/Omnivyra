/**
 * Variant fan-out runner.
 *
 * Translates a `VariantExecutionResult` (1–3 decisions) into the
 * matching number of existing-pipeline asset-generation requests.
 * The runner pins `variant_id` + `variant_family` onto each request
 * so the existing renderer's variant overlay path picks the variant
 * up via `media_bundle.metadata` (PHASE 4 of the prior variant
 * exploration phase wired this).
 *
 * Governance preservation:
 *   - The runner does NOT bypass any backend pipeline. It calls the
 *     same generation endpoint the legacy single-variant path uses,
 *     once per decision. Every governance / QA / moderation / brand
 *     validation / approval gate runs per generation.
 *
 *   - On `experiment` mode, the planner already registered the
 *     experiment with the tracker; the runner transitions each asset
 *     to `generated` (best-effort) after the request completes.
 *
 * Pure-ish: no React hooks — embeddable from any callsite. Uses
 * `apiFetch` for auth.
 */

import { apiFetch } from '../apiFetch';
import type { VariantExecutionResult, VariantSelectionDecision } from '../../components/variant-experience/useVariantApi';

export type FanOutAssetGenerationRequest = {
  /** The base request payload the legacy single-variant flow uses.
   *  Spread into every fan-out request before variant fields are
   *  merged. */
  basePayload: Record<string, unknown>;
  /** Endpoint to POST to. Defaults to the existing creator-content
   *  generation endpoint. */
  endpoint?: string;
  /** Optional abort signal forwarded to fetch. */
  signal?: AbortSignal;
};

export type FanOutDecisionOutcome = {
  decision: VariantSelectionDecision;
  ok: boolean;
  status: number;
  responseJson: unknown;
  error?: string;
};

export type FanOutResult = {
  outcomes: FanOutDecisionOutcome[];
  successCount: number;
  failureCount: number;
};

const DEFAULT_ENDPOINT = '/api/command-center/creator-content/generate';

/**
 * Merge the variant fields onto the base payload so the renderer
 * picks them up from `media_bundle.metadata`. The Creator generate
 * endpoint already nests the asset's metadata inside the
 * `creator_card` object; we mirror that shape so the renderer's
 * variant resolver finds the family at its established location.
 */
export function buildVariantAwarePayload(
  basePayload: Record<string, unknown>,
  decision: VariantSelectionDecision,
  options?: { experimentId?: string | null },
): Record<string, unknown> {
  const creatorCard = (basePayload.creator_card && typeof basePayload.creator_card === 'object'
    ? basePayload.creator_card as Record<string, unknown>
    : {});
  return {
    ...basePayload,
    creator_card: {
      ...creatorCard,
      variant_id: decision.variant.variant_id,
      variant_family: decision.variant.variant_family,
      // Echo into the strategy envelope so server-side helpers that
      // read `media_bundle.metadata.strategy_analytics` see the variant
      // attribution without a separate join.
      strategy_analytics: {
        ...(creatorCard.strategy_analytics && typeof creatorCard.strategy_analytics === 'object'
          ? creatorCard.strategy_analytics as Record<string, unknown>
          : {}),
        variant_id: decision.variant.variant_id,
        variant_family: decision.variant.variant_family,
      },
      ...(options?.experimentId
        ? { variant_experiment_id: options.experimentId }
        : {}),
    },
  };
}

/**
 * Run the fan-out. Requests run in PARALLEL (Promise.all) — the
 * existing single-variant generation endpoint is idempotent and the
 * variant_id keeps results distinct. Each outcome is captured per
 * decision; one failure does not cancel the others.
 *
 * Optionally transitions experiment-tracker assets to `generated`
 * after each successful fan-out call (best-effort — failures here
 * are swallowed and do not affect the outcome shape).
 */
export async function runVariantFanOut(input: {
  companyId: string;
  plan: VariantExecutionResult;
  request: FanOutAssetGenerationRequest;
}): Promise<FanOutResult> {
  const endpoint = input.request.endpoint ?? DEFAULT_ENDPOINT;
  // Phase 8 — fan-out duration measured around the parallel batch.
  // The total time includes the slowest generation call plus the
  // batched tracker POST.
  const fanOutStart = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  // P2-6 — collect per-decision transitions and post ONE batch at the
  // end. Replaces N independent tracker POSTs (one per decision)
  // with a single `action: 'transition_batch'` call.
  const pendingTransitions: Array<{
    experiment_id: string;
    variant_id: string;
    state: string;
    asset_id?: string | null;
  }> = [];
  const outcomes = await Promise.all(
    input.plan.decisions.map(async (decision): Promise<FanOutDecisionOutcome> => {
      try {
        const payload = buildVariantAwarePayload(
          input.request.basePayload,
          decision,
          { experimentId: input.plan.experimentId },
        );
        const response = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: input.request.signal,
        });
        const responseJson = await response.json().catch(() => null);
        if (input.plan.experimentId) {
          pendingTransitions.push({
            experiment_id: input.plan.experimentId,
            variant_id: decision.variant.variant_id,
            state: response.ok ? 'generated' : 'created',
            asset_id: (responseJson && typeof responseJson === 'object'
              ? (responseJson as Record<string, unknown>).asset_id as string | null | undefined
              : undefined) ?? null,
          });
        }
        return {
          decision,
          ok: response.ok,
          status: response.status,
          responseJson,
          error: response.ok
            ? undefined
            : (responseJson && typeof responseJson === 'object' && 'error' in (responseJson as object)
                ? String((responseJson as Record<string, unknown>).error)
                : `HTTP ${response.status}`),
        };
      } catch (err) {
        return {
          decision,
          ok: false,
          status: 0,
          responseJson: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  // P2-6 — batched tracker transition. One POST for all decisions.
  // Best-effort; swallowed on error so the fan-out outcomes stand.
  if (pendingTransitions.length > 0) {
    try {
      await apiFetch('/api/creator-intelligence/variant-experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transition_batch',
          company_id: input.companyId,
          transitions: pendingTransitions,
        }),
      });
    } catch {
      // No-op — tracker state is best-effort.
    }
  }
  // Phase 8 — record fan-out duration. Lazy require so client
  // bundles don't pull the server-side telemetry module into the
  // browser; the runner is currently called from both client and
  // server code paths.
  try {
    const fanOutEnd = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const telemetry = require('../../backend/services/creator/variantPerformanceTelemetry') as typeof import('../../backend/services/creator/variantPerformanceTelemetry');
    telemetry.recordVariantTimingSample('fan_out', fanOutEnd - fanOutStart,
      outcomes.every((o) => o.ok),
      { decisions: input.plan.decisions.length, success: outcomes.filter((o) => o.ok).length });
  } catch {
    // Telemetry never blocks fan-out.
  }
  return {
    outcomes,
    successCount: outcomes.filter((o) => o.ok).length,
    failureCount: outcomes.filter((o) => !o.ok).length,
  };
}
