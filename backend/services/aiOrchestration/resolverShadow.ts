/**
 * resolverShadow.ts — the SHADOW harness for the Configuration Resolver (AI-ORCH 2A-2).
 *
 * Runs the resolver ALONGSIDE legacy execution, compares the two, logs the parity,
 * then DISCARDS everything. Legacy execution is authoritative and unaffected.
 *
 * INVARIANTS (this is the whole safety contract of shadow mode):
 *   1. GATED — when AI_CONFIG_RESOLVER_SHADOW resolves to 'off' (the default), the
 *      resolver NEVER runs; this function returns immediately having done nothing.
 *   2. FAIL-SAFE — any error inside the resolver/comparator/logging is swallowed;
 *      it can NEVER propagate to the caller (legacy execution must not be perturbed).
 *   3. DISCARD — the plan/metadata/trace/parity are logged (debug only) and thrown
 *      away. This function returns void; it hands nothing back to influence execution.
 *
 * NOT WIRED IN 2A-2. Nothing on the execution path calls this yet — wiring the single
 * fail-safe, fire-and-forget call into the gateway is the explicit next micro-step
 * (deferred to keep this phase from touching any existing execution path). Until then
 * the harness is exercised by its unit test with the flag turned ON.
 */
import { resolveExecutionPlan, type ResolverInput, type ResolverDeps } from './configurationResolver';
import { compareToLegacy, compareExecutionEquivalence, type LegacyExecutionConfig, type ParityResult, type MismatchCategory, type EquivalenceLevel } from './resolverComparator';
import { AdapterValidator, LegacyExecutionAdapter, type AdapterParity } from './legacyExecutionAdapter';
import { ConfigurationParityGuard, type ConfigurationParity } from './configurationParityGuard';
import { resolveOrchestrationMode, resolveExecutionAuthority } from './orchestrationMode';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';
import { recordInvocation, recordSuccess, recordFailure, recordParity, recordEquivalence, recordAdapterParity, recordDualExecution, recordOrchestrationMode } from './resolverShadowMetrics';

export interface ShadowRunArgs {
  input: ResolverInput;
  deps: ResolverDeps;
  /** The configuration the LEGACY path actually used, for the parity comparison. */
  legacy: LegacyExecutionConfig;
  /** Optional sink for the shadow observation (tests inject; production logs to console). */
  sink?: (observation: ShadowObservation) => void;
}

export interface ShadowObservation {
  capabilityId: string;
  operation: string | null;
  orgId: string | null;
  legacy: LegacyExecutionConfig;
  resolvedProvider: string | null;
  resolvedModel: string | null;
  parity: ParityResult;
  mismatchCategory: MismatchCategory;
  // Execution equivalence (AI-ORCH 2A-2.2)
  equivalenceLevel: EquivalenceLevel;
  snapshotHashMatch: boolean;
  rawDifferenceCount: number;
  normalizedDifferenceCount: number;
  executionDifferenceCount: number;
  // Legacy-config adapter round-trip (AI-ORCH 2A-2.3)
  adapterParity: AdapterParity;
  adapterDifferenceCount: number;
  // Dual execution validation (AI-ORCH 2A-3)
  orchestrationMode: string;
  executionAuthority: 'legacy' | 'resolver';
  configParity: ConfigurationParity | null;
  resolutionSource: string | undefined;
  resolutionReasonCode: string | undefined;
  resolutionDecisionCode: string | undefined;
  configFingerprint: string | null | undefined;
  profileKey: string | null | undefined;
  profileVersion: number | null | undefined;
  traceSteps: number;
}

/**
 * Default sink: DEBUG-level logging only (never info/warn/error). No prompts, no
 * model outputs, no PII — only config identifiers + parity. No persistence.
 */
function consoleSink(o: ShadowObservation): void {
  // eslint-disable-next-line no-console
  const log = (console.debug ?? console.log).bind(console);
  log('[ai-config-resolver][shadow]', {
    capability: o.capabilityId,
    operation: o.operation,
    orgId: o.orgId,
    parity: o.parity.status,
    mismatchCategory: o.mismatchCategory,
    equivalence: o.equivalenceLevel,
    snapshotHashMatch: o.snapshotHashMatch,
    rawDiffs: o.rawDifferenceCount,
    normalizedDiffs: o.normalizedDifferenceCount,
    executionDiffs: o.executionDifferenceCount,
    adapterParity: o.adapterParity,
    adapterDiffs: o.adapterDifferenceCount,
    mode: o.orchestrationMode,
    authority: o.executionAuthority,
    configParity: o.configParity,
    diffs: o.parity.diffs,
    source: o.resolutionSource,
    reason: o.resolutionReasonCode,
    decision: o.resolutionDecisionCode,
    fingerprint: o.configFingerprint,
    profile: o.profileKey,
    profileVersion: o.profileVersion,
    traceSteps: o.traceSteps,
    legacy: o.legacy,
    resolved: { provider: o.resolvedProvider, model: o.resolvedModel },
  });
}

/**
 * Run the resolver in shadow. Returns whether it actually ran (true) or was gated off
 * (false) — a diagnostic ONLY; callers must not branch execution on it. Never throws.
 */
export async function runConfigResolverShadow(args: ShadowRunArgs): Promise<boolean> {
  // (1) GATE — default OFF → never runs. Mode drives OFF/SHADOW/DUAL/CANARY (2A-3).
  let authority: ReturnType<typeof resolveExecutionAuthority>;
  try {
    authority = resolveExecutionAuthority(resolveOrchestrationMode());
  } catch {
    return false; // fail-safe.
  }
  recordOrchestrationMode(authority.mode);
  if (authority.mode === 'off') return false;

  recordInvocation();

  // (2) FAIL-SAFE — everything below is swallowed on error.
  try {
    const { plan, metadata, trace } = await resolveExecutionPlan(args.input, args.deps);
    const parity = compareToLegacy(args.legacy, plan);
    recordParity(parity);
    // AI-ORCH 2A-2.2 — canonical execution-equivalence classification.
    const equivalence = compareExecutionEquivalence(args.legacy, plan);
    recordEquivalence(equivalence);
    // AI-ORCH 2A-2.3 — legacy-config adapter round-trip validation (pure; never executes).
    const adapter = AdapterValidator.validate(plan);
    recordAdapterParity(adapter);
    // AI-ORCH 2A-3 — DUAL/CANARY: validate the EXECUTED legacy config against the
    // resolver's config via the ConfigurationParityGuard (pure; legacy still executes).
    let configParity: ConfigurationParity | null = null;
    if (authority.validateParity) {
      const executedCfg: LegacyExecutionConfiguration = {
        provider: args.legacy.provider ?? null, model: args.legacy.model ?? null, modelVersion: args.legacy.modelVersion ?? null,
        temperature: args.legacy.temperature ?? null, maxOutputTokens: args.legacy.maxOutputTokens ?? null,
        streaming: args.legacy.streaming ?? null, structuredOutput: args.legacy.structuredOutput ?? null, vision: args.legacy.vision ?? null,
        timeoutMs: args.legacy.timeoutMs ?? null, maxRetries: args.legacy.maxRetries ?? null,
      };
      const resolverCfg = LegacyExecutionAdapter.toLegacyConfiguration(plan);
      const guard = ConfigurationParityGuard.compare(executedCfg, resolverCfg);
      recordDualExecution(guard, authority.executes, authority.canary);
      configParity = guard.parity;
    }
    const observation: ShadowObservation = {
      capabilityId: plan.capabilityId,
      operation: plan.operation ?? null,
      orgId: plan.orgId ?? null,
      legacy: args.legacy,
      resolvedProvider: plan.model.provider ?? null,
      resolvedModel: plan.model.model ?? null,
      parity,
      mismatchCategory: parity.mismatchCategory,
      equivalenceLevel: equivalence.level,
      snapshotHashMatch: equivalence.snapshotHashMatch,
      rawDifferenceCount: equivalence.rawDifferenceCount,
      normalizedDifferenceCount: equivalence.normalizedDifferenceCount,
      executionDifferenceCount: equivalence.executionDifferenceCount,
      adapterParity: adapter.parity,
      adapterDifferenceCount: adapter.differences.length,
      orchestrationMode: authority.mode,
      executionAuthority: authority.executes,
      configParity,
      resolutionSource: metadata.resolutionSource,
      resolutionReasonCode: metadata.resolutionReasonCode,
      resolutionDecisionCode: metadata.resolutionDecisionCode,
      configFingerprint: plan.configFingerprint,
      profileKey: plan.profileKey,
      profileVersion: plan.profileVersion,
      traceSteps: trace.steps.length,
    };
    (args.sink ?? consoleSink)(observation);
    recordSuccess();
  } catch {
    // (2) swallow — legacy execution must never be affected by a shadow failure.
    recordFailure();
    return true;
  }

  // (3) DISCARD — nothing returned that could influence execution.
  return true;
}

// ── The gated fire-and-forget hook (AI-ORCH 2A-2.1) ──────────────────────────

export interface MaybeShadowOptions {
  /** Deps factory (default: lazy supabase-backed loaders). Injectable for tests. */
  depsFactory?: () => ResolverDeps | Promise<ResolverDeps>;
  /** Scheduler (default: setImmediate — off the request's synchronous path). Injectable for tests. */
  schedule?: (fn: () => void) => void;
  /** Sink override (default: debug console). */
  sink?: (o: ShadowObservation) => void;
}

/**
 * THE production hook. Called fire-and-forget from the single gateway integration
 * point once the legacy config is resolved and execution has not begun. Contract:
 *   - GATED: when AI_CONFIG_RESOLVER_SHADOW is 'off' (default) it returns immediately
 *     having done NOTHING — no deps, no resolver, no comparator, no logging, no DB
 *     call, ≈0 allocations (only primitive args + one cheap flag read).
 *   - NEVER awaited, NEVER throws: all real work is scheduled off the request path
 *     and every error is swallowed.
 *   - DISCARDS output: returns void; legacy execution continues, authoritative.
 */
export function maybeRunResolverShadow(
  orgId: string | null,
  operation: string | null,
  provider: string | null,
  model: string | null,
  temperature: number | null,
  maxTokens: number | null,
  opts?: MaybeShadowOptions,
): void {
  // (1) GATE — default OFF → do nothing (zero overhead). Mode ∈ off/shadow/dual/canary/full.
  let mode: string;
  try {
    mode = resolveOrchestrationMode();
  } catch {
    return;
  }
  if (mode === 'off') return;

  const schedule = opts?.schedule ?? ((fn: () => void) => { setImmediate(fn); });

  // ON: defer ALL real work off the request's synchronous path.
  schedule(() => {
    void (async () => {
      try {
        const factory =
          opts?.depsFactory ??
          (async () => (await import('./resolverDataSource')).createSupabaseResolverDeps());
        const deps = await factory();
        await runConfigResolverShadow({
          input: { operation, orgId, legacyProvider: provider, legacyModel: model },
          deps,
          legacy: { provider, model, temperature, maxOutputTokens: maxTokens },
          sink: opts?.sink,
        });
      } catch {
        // Deps construction / dynamic import failure — swallow; count as a shadow failure.
        recordFailure();
      }
    })();
  });
}
