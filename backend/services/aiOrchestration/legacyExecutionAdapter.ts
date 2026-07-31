/**
 * legacyExecutionAdapter.ts — LegacyExecutionAdapter (AI-ORCH 2A-2.3).
 *
 * THE one new runtime abstraction for this phase: a PURE, deterministic, stateless
 * MAPPER that transforms a canonical ResolvedExecutionPlan into the gateway-facing
 * LegacyExecutionConfiguration. It proves the resolver can COMPLETELY describe the
 * legacy execution configuration — the last architectural duplication.
 *
 * ZERO BUSINESS LOGIC. No decisions, no provider selection, no routing, no retries,
 * no fallbacks, no heuristics, no normalization, no I/O, no persistence, no execution.
 * It copies already-resolved values into the legacy field names. Nothing else.
 *
 * Execution authority is UNCHANGED: this adapter is NOT wired into the gateway. It is
 * validated by round-trip snapshot identity (AdapterValidator) in shadow only.
 */
import type { ResolvedExecutionPlan } from './types/ResolvedExecutionPlan';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';
import { ExecutionSnapshotBuilder, hashExecutionSnapshot, EXECUTION_FIELDS } from './executionSnapshot';

/** Pure 1:1 field mapper: ResolvedExecutionPlan → LegacyExecutionConfiguration. */
export const LegacyExecutionAdapter = {
  toLegacyConfiguration(plan: ResolvedExecutionPlan): LegacyExecutionConfiguration {
    return {
      provider:         plan.model.provider ?? null,
      model:            plan.model.model ?? null,
      modelVersion:     plan.model.modelVersion ?? null,
      deploymentId:     plan.model.deploymentId ?? null,
      temperature:      plan.params.temperature ?? null,
      topP:             plan.params.topP ?? null,
      presencePenalty:  null,   // not expressed by the plan
      frequencyPenalty: null,   // not expressed by the plan
      maxOutputTokens:  plan.params.maxOutputTokens ?? null,
      streaming:        plan.params.streaming ?? null,
      structuredOutput: plan.params.structuredOutput ?? null,
      vision:           plan.params.vision ?? null,
      reasoning:        plan.params.reasoningLevel ?? null,
      responseFormat:   plan.params.responseFormat ?? null,
      toolCalling:      plan.params.toolCalling ?? null,
      timeoutMs:        plan.reliability.timeoutMs ?? null,
      maxRetries:       plan.reliability.maxRetries ?? null,
      retryPolicy:      plan.reliability.retryPolicy ?? null,
      routingPolicy:    plan.routingPolicyKey ?? plan.routingPolicyId ?? null,
      safety:           plan.safety ?? null,
      cachePolicy:      plan.caching ?? null,
      seedPolicy:       plan.params.seedPolicy ?? null,
      costLimit:        plan.limits.maxCostUsdPerCall ?? null,
      tokenLimit:       plan.limits.tokenCeiling ?? null,
      configFingerprint: plan.configFingerprint ?? null, // diagnostic only
    };
  },
};

// ── Adapter parity diagnostics ────────────────────────────────────────────────

export type AdapterParity = 'IDENTICAL' | 'DIFFERENT';

export interface AdapterFieldDifference {
  mappedField: string;
  resolverValue: unknown;
  adapterValue: unknown;
}

export interface AdapterParityResult {
  parity: AdapterParity;
  reason: string;
  differences: AdapterFieldDifference[];
  /** Execution-snapshot hash of the resolver plan vs the adapter output. */
  snapshotHashPlan: string;
  snapshotHashAdapter: string;
  snapshotHashMatch: boolean;
  /** The adapter output, for inspection (not persisted). */
  configuration: LegacyExecutionConfiguration;
}

/** Stable identity key (distinguishes null/undefined/typed scalars/objects). */
function valueKey(v: unknown): string {
  if (v === undefined) return 'U';
  if (v === null) return 'N';
  if (typeof v === 'object') return 'O:' + JSON.stringify(v);
  return (typeof v)[0] + ':' + String(v);
}

/**
 * AdapterValidator — round-trip proof that the adapter losslessly describes the plan.
 *
 *   plan ──adapter──▶ LegacyExecutionConfiguration ──ExecutionSnapshotBuilder──▶ snapshotAdapter
 *   plan ────────────────────────────────────────── ExecutionSnapshotBuilder──▶ snapshotPlan
 *   require: snapshotAdapter EXECUTION fields IDENTICAL to snapshotPlan (not merely equivalent)
 *
 * Reuses the SAME ExecutionSnapshotBuilder (rule 5). Pure; never executes; never throws.
 */
export const AdapterValidator = {
  validate(plan: ResolvedExecutionPlan): AdapterParityResult {
    const configuration = LegacyExecutionAdapter.toLegacyConfiguration(plan);
    const snapPlan = ExecutionSnapshotBuilder.fromPlan(plan);
    const snapAdapter = ExecutionSnapshotBuilder.fromLegacyConfiguration(configuration);

    const differences: AdapterFieldDifference[] = [];
    for (const field of EXECUTION_FIELDS) {
      if (valueKey(snapPlan[field]) !== valueKey(snapAdapter[field])) {
        differences.push({ mappedField: field, resolverValue: snapPlan[field], adapterValue: snapAdapter[field] });
      }
    }

    const snapshotHashPlan = hashExecutionSnapshot(snapPlan);
    const snapshotHashAdapter = hashExecutionSnapshot(snapAdapter);
    const snapshotHashMatch = snapshotHashPlan === snapshotHashAdapter;
    const parity: AdapterParity = differences.length === 0 ? 'IDENTICAL' : 'DIFFERENT';

    return {
      parity,
      reason: parity === 'IDENTICAL'
        ? 'adapter output round-trips to an identical execution snapshot'
        : `${differences.length} field(s) diverge after round-trip`,
      differences,
      snapshotHashPlan,
      snapshotHashAdapter,
      snapshotHashMatch,
      configuration,
    };
  },
};
