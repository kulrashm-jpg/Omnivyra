/**
 * gatewaySynchronousResolve.ts — AI-ORCH 3C/3D: the deferred gateway synchronous
 * configuration-resolution path.
 *
 * THE one new integration that lets the AI Gateway CONSUME the resolver-generated
 * execution configuration before provider dispatch — when, and only when, the rollout
 * authority selects the resolver. It changes NOTHING about the resolver algorithm, the
 * provider resolution, execution planning, or the rollout stages: it only SELECTS the
 * configuration source (via the already-built promotion primitive) and hands the chosen
 * provider/model back to the gateway.
 *
 * Contract by mode (resolveExecutionAuthority):
 *   OFF / SHADOW  → returns null → this path does nothing; the gateway keeps its legacy
 *                   config (SHADOW observation stays on the async fire-and-forget hook).
 *   DUAL          → resolves synchronously, records the parity comparison, and returns
 *                   the LEGACY selection → the gateway remains byte-identical.
 *   CANARY / FULL → resolves synchronously; when the master enable flag is on AND the
 *                   resolver config is byte-identical to legacy (parity guard), returns
 *                   the RESOLVER selection; otherwise legacy fallback.
 *
 * FAIL-SAFE: any resolver / deps / adapter error → returns null → the gateway executes
 * legacy (documented failure policy). Never throws.
 *
 * ROLLBACK: driven entirely by AI_CONFIG_RESOLVER_MODE (read through
 * resolveOrchestrationMode) + the master enable flag — a configuration change, no deploy,
 * no schema change. Setting the mode to `off` makes validateParity false → returns null
 * on the very next request → legacy execution restored immediately.
 */
import { resolveExecutionAuthority, resolveOrchestrationMode, type ExecutionAuthority } from './orchestrationMode';
import { resolveExecutionPlan, type ResolverInput, type ResolverDeps } from './configurationResolver';
import { LegacyExecutionAdapter } from './legacyExecutionAdapter';
import { ConfigurationParityGuard } from './configurationParityGuard';
import { selectExecutionConfiguration } from './promotion';
import { recordDualExecution, recordFailure } from './resolverShadowMetrics';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';

/** The gateway's genuine legacy execution inputs at the pre-dispatch point. */
export interface GatewayExecutionInput {
  companyId: string | null;
  operation: string | null;
  legacyProvider: string | null;
  legacyModel: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  streaming?: boolean;
  structuredOutput?: boolean;
  responseFormat?: string | null;
  reasoning?: string | null;
  toolCalling?: boolean;
  /** Central reliability policy (AI-ORCH 3G): the gateway's genuine per-op timeout/retries. */
  timeoutMs?: number | null;
  maxRetries?: number | null;
}

export interface GatewayExecutionSelection {
  provider: string | null;
  model: string | null;
  source: 'legacy' | 'resolver';
  reason: string;
}

export interface GatewayResolveOptions {
  /** Deps factory (default: supabase-backed loaders). Injectable for tests. */
  depsFactory?: () => ResolverDeps | Promise<ResolverDeps>;
  /** Authority override (default: rollout-derived). Injectable for tests. */
  authority?: ExecutionAuthority;
}

/**
 * Synchronously resolve + parity-gate the execution configuration for DUAL/CANARY/FULL.
 * Returns the provider/model the gateway should execute, or null to keep legacy
 * unchanged (OFF / SHADOW, or any failure). Pure w.r.t. the resolver — read-only.
 */
export async function resolveGatewayExecutionSelection(
  input: GatewayExecutionInput,
  opts?: GatewayResolveOptions,
): Promise<GatewayExecutionSelection | null> {
  let authority: ExecutionAuthority;
  try {
    authority = opts?.authority ?? resolveExecutionAuthority(resolveOrchestrationMode());
  } catch {
    return null; // fail-safe → legacy
  }
  // OFF / SHADOW never take the synchronous authoritative path (byte-identical).
  if (!authority.validateParity) return null;

  try {
    const deps = await (opts?.depsFactory
      ?? (async () => (await import('./resolverDataSource')).createSupabaseResolverDeps()))();

    // AI-ORCH 3G — caller intent flows in as resolver overrides (Request > Profile), and
    // reliability ownership is centralized to the gateway policy (timeout/retries).
    const resolverInput: ResolverInput = {
      operation: input.operation,
      orgId: input.companyId,
      legacyProvider: input.legacyProvider,
      legacyModel: input.legacyModel,
      overrides: {
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        streaming: input.streaming,
        structuredOutput: input.structuredOutput,
        responseFormat: input.responseFormat,
        reasoning: input.reasoning,
        toolCalling: input.toolCalling,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        reliabilityCentralized: true,
      },
    };
    const { plan } = await resolveExecutionPlan(resolverInput, deps);
    const resolverConfig = LegacyExecutionAdapter.toLegacyConfiguration(plan);

    // The gateway's genuine legacy config — the SAME caller/policy values, so parity
    // compares like-for-like (UNSET where the request genuinely omits a field).
    const legacyConfig: LegacyExecutionConfiguration = {
      provider: input.legacyProvider ?? null,
      model: input.legacyModel ?? null,
      temperature: input.temperature ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      streaming: input.streaming ?? null,
      structuredOutput: input.structuredOutput ?? null,
      responseFormat: input.responseFormat ?? null,
      toolCalling: input.toolCalling ?? null,
      timeoutMs: input.timeoutMs ?? null,
      maxRetries: input.maxRetries ?? null,
    };

    const guard = ConfigurationParityGuard.compare(legacyConfig, resolverConfig);
    recordDualExecution(guard, authority.executes, authority.canary);

    // Parity-gated selection (the already-validated promotion primitive). Resolver is
    // chosen ONLY when authority=resolver AND parity is byte-identical; else legacy.
    const selection = selectExecutionConfiguration(authority, legacyConfig, resolverConfig, guard);
    const chosen = selection.config ?? legacyConfig;
    return {
      provider: chosen.provider ?? input.legacyProvider ?? null,
      model: chosen.model ?? input.legacyModel ?? null,
      source: selection.source,
      reason: selection.reason,
    };
  } catch {
    recordFailure();
    return null; // resolver / deps / adapter failure → legacy fallback (documented policy)
  }
}
