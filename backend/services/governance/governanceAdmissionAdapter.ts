/**
 * RELEASE-R3D — Governance Admission Adapter.
 *
 * The optional, feature-flagged admission gate that sits BEFORE a
 * governance-designated AI workflow executes. It is the ONLY policy layer of the
 * consumer stack; the abstraction below it (`governanceRuntimeConsumer`) holds no
 * policy, and the frozen runtime alone decides admission.
 *
 * Guarantees (Release R3D):
 *   - OFF by default. When the flag is off, the adapter bypasses ENTIRELY — the
 *     Governance Runtime is never invoked and standard AI requests are untouched.
 *   - Scoped to governance-designated workflows only. A non-designated operation
 *     always bypasses, even when the flag is enforcing — zero impact on standard
 *     AI requests.
 *   - Fail-CLOSED only for governance-enabled workflows. In `enforce` mode a
 *     designated workflow is blocked unless the runtime returns Admitted; any
 *     invocation failure (timeout / invoke error / incompatible runtime / bad
 *     output) is also a block. This is the deliberate inverse of the app's
 *     fail-open AI guard, and it applies to nothing but designated + enforced
 *     workflows.
 *   - `shadow` mode invokes admission for observability but NEVER blocks.
 *   - Invoke-only. No runtime internals are imported; no governance logic is
 *     duplicated; nothing frozen is modified. Independently removable.
 */
import {
  invokeGovernanceRuntime,
  GovernanceConsumerError,
  CONSUMER_VERSION,
  type GovernanceInvokeOptions,
  type GovernanceResponse,
} from './governanceRuntimeConsumer';
import {
  resolveGovernanceAdmissionMode,
  isGovernanceDesignated,
  describeGovernanceFlagState,
} from './governanceAdmissionFlags';
import {
  recordGovernanceDiagnostic,
  getGovernanceObservabilitySnapshot,
  type GovernanceDiagnostic,
} from './governanceConsumerDiagnostics';

/** Context a governance-designated AI workflow passes to the adapter. */
export interface AdmissionContext {
  /** Stable operation label; must be governance-designated to be evaluated. */
  operation: string;
  /** Opaque execution reference for provenance in the runtime's admission ledger. */
  executionRef?: string;
  /** Constitutional generation to target (defaults to the active generation, 3). */
  generation?: number;
  /** Tenant id for per-tenant staged rollout. */
  tenantId?: string;
  /** Invocation overrides (timeout/retry/injected transport) — mainly for tests. */
  invokeOptions?: GovernanceInvokeOptions;
}

/** The adapter's decision for a workflow. `admitted:false` means BLOCK. */
export interface AdmissionResult {
  admitted: boolean;
  mode: 'off' | 'shadow' | 'enforce';
  /** How the decision was reached. */
  disposition: 'bypass' | 'not-designated' | 'admitted' | 'blocked' | 'shadow-observed';
  reason: string | null;
  runtimeDecision?: GovernanceResponse['decision'];
  runtimeVersion?: string | null;
  durationMs: number;
  diagnostic: GovernanceDiagnostic;
}

/** Thrown by `enforceAdmission` when a designated workflow is denied (fail-closed). */
export class GovernanceAdmissionDenied extends Error {
  readonly operation: string;
  readonly runtimeDecision?: string;
  readonly reason: string | null;
  readonly errorCode?: string;
  constructor(operation: string, reason: string | null, opts?: { runtimeDecision?: string; errorCode?: string }) {
    super(`Governance admission denied for '${operation}': ${reason ?? 'not admitted'}`);
    this.name = 'GovernanceAdmissionDenied';
    this.operation = operation;
    this.reason = reason;
    this.runtimeDecision = opts?.runtimeDecision;
    this.errorCode = opts?.errorCode;
  }
}

const ACTIVE_GENERATION = 3;

/**
 * Evaluate admission for an AI workflow. NEVER throws — returns a structured
 * result (`admitted:false` = block). Prefer `enforceAdmission` at call sites that
 * want the fail-closed throw. This function is safe to call from any workflow:
 * off/undesignated operations bypass with `admitted:true` and no runtime invoke.
 */
export async function evaluateAdmission(ctx: AdmissionContext): Promise<AdmissionResult> {
  const decision = resolveGovernanceAdmissionMode(ctx.tenantId);
  const mode = decision.mode;
  const base = { mode, durationMs: 0 } as const;

  // 1. OFF → bypass entirely; the runtime is never invoked.
  if (mode === 'off') {
    const diagnostic = recordGovernanceDiagnostic({
      operation: ctx.operation, mode, outcome: 'bypassed', durationMs: 0,
      runtimeVersion: null, compatible: true,
    });
    return { ...base, admitted: true, disposition: 'bypass', reason: null, diagnostic };
  }

  // 2. Enabled but NOT designated → bypass; standard AI requests are untouched.
  if (!isGovernanceDesignated(ctx.operation)) {
    const diagnostic = recordGovernanceDiagnostic({
      operation: ctx.operation, mode, outcome: 'bypassed', durationMs: 0,
      runtimeVersion: null, compatible: true,
    });
    return { ...base, admitted: true, disposition: 'not-designated', reason: null, diagnostic };
  }

  // 3. Designated + enabled → invoke the published admission entrypoint.
  let response: GovernanceResponse | null = null;
  let errorCode: string | undefined;
  let compatible = true;
  try {
    response = await invokeGovernanceRuntime(
      {
        executionRef: ctx.executionRef ?? `ai:${ctx.operation}`,
        generation: ctx.generation ?? ACTIVE_GENERATION,
      },
      ctx.invokeOptions,
    );
    compatible = response.compatibility.compatible;
  } catch (err) {
    if (err instanceof GovernanceConsumerError) {
      errorCode = err.code;
      compatible = err.code !== 'GOV_CONSUMER_INCOMPATIBLE';
    } else {
      errorCode = 'GOV_CONSUMER_INVOKE_FAILED';
    }
  }

  // 4. shadow → observe only, never block.
  if (mode === 'shadow') {
    const diagnostic = recordGovernanceDiagnostic({
      operation: ctx.operation, mode, outcome: response ? 'shadowed' : 'error',
      decision: response?.decision, durationMs: response?.durationMs ?? 0,
      runtimeVersion: response?.runtimeVersion ?? null, compatible,
      errorCode, attempts: response?.attempts,
    });
    return {
      mode, admitted: true, disposition: 'shadow-observed',
      reason: response ? null : (errorCode ?? 'invocation-error'),
      runtimeDecision: response?.decision, runtimeVersion: response?.runtimeVersion ?? null,
      durationMs: response?.durationMs ?? 0, diagnostic,
    };
  }

  // 5. enforce → FAIL-CLOSED for this designated workflow.
  const admitted = response?.decision === 'Admitted';
  const outcome = !response ? 'error' : admitted ? 'admitted' : 'rejected';
  const diagnostic = recordGovernanceDiagnostic({
    operation: ctx.operation, mode, outcome,
    decision: response?.decision, durationMs: response?.durationMs ?? 0,
    runtimeVersion: response?.runtimeVersion ?? null, compatible,
    errorCode, attempts: response?.attempts,
  });
  const reason = admitted
    ? null
    : response
      ? (response.reason ?? `runtime decision: ${response.decision}`)
      : (errorCode ?? 'invocation-error');
  return {
    mode, admitted, disposition: admitted ? 'admitted' : 'blocked', reason,
    runtimeDecision: response?.decision, runtimeVersion: response?.runtimeVersion ?? null,
    durationMs: response?.durationMs ?? 0, diagnostic,
  };
}

/**
 * Fail-closed admission for a governance-designated AI workflow. Call this
 * immediately before governance-sensitive AI execution:
 *
 *   await enforceAdmission({ operation: 'governance.policySynthesis', tenantId });
 *   // ...proceed to AI execution only if this did not throw.
 *
 * When the flag is off or the operation is not designated, it returns
 * immediately without invoking the runtime (bypass). In `enforce` mode a denied
 * or failed admission throws GovernanceAdmissionDenied.
 */
export async function enforceAdmission(ctx: AdmissionContext): Promise<AdmissionResult> {
  const result = await evaluateAdmission(ctx);
  if (!result.admitted) {
    throw new GovernanceAdmissionDenied(ctx.operation, result.reason, {
      runtimeDecision: result.runtimeDecision,
      errorCode: result.diagnostic.errorCode,
    });
  }
  return result;
}

/** Combined adapter health for observability surfaces (§8). */
export function getAdmissionHealth(tenantId?: string) {
  return {
    adapter: 'governance-admission-adapter',
    consumerVersion: CONSUMER_VERSION,
    flag: describeGovernanceFlagState(tenantId),
    observability: getGovernanceObservabilitySnapshot(CONSUMER_VERSION),
  };
}
