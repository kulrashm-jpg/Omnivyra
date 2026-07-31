/**
 * configurationResolver.ts — THE Configuration Resolver (AI-ORCH 2A-2).
 *
 * The single component that resolves AI execution configuration from the frozen
 * orchestration schema. It is READ-ONLY, DETERMINISTIC, and PURE given its injected
 * data loaders — same inputs → identical plan, metadata, trace, and fingerprint,
 * every time. It NEVER executes a request, NEVER persists, NEVER touches the gateway.
 *
 * In Phase 2A-2 it runs in SHADOW MODE only (see resolverShadow.ts): its output is
 * computed then DISCARDED; legacy execution stays authoritative. This module changes
 * no runtime behavior on its own — nothing on the execution path imports it.
 *
 * DEPENDENCY INJECTION: all data access is via the `ResolverDeps` loaders, so the
 * resolver is unit-testable with in-memory fixtures and has no hard DB coupling. A
 * supabase-backed deps factory (reading the frozen tables) lives in
 * resolverDataSource.ts and is used only when the shadow runner is wired in later.
 */
import {
  computeConfigFingerprint,
  CONFIG_FINGERPRINT_ALGO,
  EXECUTION_SCHEMA_VERSION,
  CANONICALIZATION_VERSION,
  FINGERPRINT_ALGORITHM,
  type ExecutionSemantics,
} from './configFingerprint';
import type { ResolutionSource, ResolutionTrace, ResolutionTraceStep } from './types/ResolutionTrace';
import type { ExecutionMetadata } from './types/ExecutionMetadata';
import type { ResolvedExecutionPlan } from './types/ResolvedExecutionPlan';

/** The default capability when an operation maps to nothing (design §5.3). */
export const GENERIC_CAPABILITY = 'GENERIC_COMPLETION';

// ── Loader row shapes (ids already resolved to names/keys by the loader) ──────

export interface ResolverBindingRow {
  scope: 'platform_default' | 'capability_default' | 'org_default' | 'capability_override';
  capabilityId: string | null;
  orgId: string | null;
  profileId: string;
  overridePatch?: Record<string, unknown> | null;
  isActive: boolean;
}

export interface ResolverProfileVersion {
  profileId: string;
  profileKey: string;
  version: number;
  mode: 'tier' | 'explicit';
  qualityTier?: string | null;
  capabilityRequirements?: Record<string, unknown> | null;
  /** explicit mode: resolved provider name (not id). */
  providerRef?: string | null;
  /** explicit mode: resolved model key (not id). */
  modelRef?: string | null;
  modelVersionTag?: string | null;
  deploymentId?: string | null;
  routingPolicyId?: string | null;
  routingPolicyKey?: string | null;
  /** resolved routing policy content (not id) — for the fingerprint. */
  routingContent?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  modality?: Record<string, unknown> | null;
  reliability?: Record<string, unknown> | null;
  limits?: Record<string, unknown> | null;
  caching?: Record<string, unknown> | null;
  safety?: Record<string, unknown> | null;
}

export interface ResolverDeps {
  mapOperationToCapability(operation: string): Promise<string | null>;
  /** Exact-coordinate active binding for (orgId, capabilityId). NULL args select the NULL scope. */
  loadBinding(orgId: string | null, capabilityId: string | null): Promise<ResolverBindingRow | null>;
  loadPlatformDefaultBinding(): Promise<ResolverBindingRow | null>;
  loadActiveProfileVersion(profileId: string): Promise<ResolverProfileVersion | null>;
}

/**
 * AI-ORCH 3G — caller-supplied execution parameters that OVERRIDE profile defaults.
 * Precedence: Request override → Company/BYOK → Profile → Platform → Provider. A value
 * that is present (not undefined) wins; UNSET (undefined) keeps the profile default —
 * UNSET is never synthesized into a value. `reliabilityCentralized` moves timeout/retry
 * OWNERSHIP to the central operational policy: when true, the resolver takes reliability
 * ONLY from these overrides (profile reliability is not emitted).
 */
export interface ResolverRequestOverrides {
  temperature?: number | null;
  maxOutputTokens?: number | null;
  structuredOutput?: boolean | null;
  responseFormat?: string | null;
  streaming?: boolean | null;
  reasoning?: string | null;
  toolCalling?: boolean | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  reliabilityCentralized?: boolean;
}

export interface ResolverInput {
  capabilityId?: string | null;
  operation?: string | null;
  orgId?: string | null;
  /** Legacy-resolved provider/model adopted for TIER-mode profiles (heuristic-free). */
  legacyProvider?: string | null;
  legacyModel?: string | null;
  /** AI-ORCH 3G — caller-supplied execution params; present values override the profile. */
  overrides?: ResolverRequestOverrides;
}

export interface ResolverOutput {
  plan: ResolvedExecutionPlan;
  metadata: ExecutionMetadata;
  trace: ResolutionTrace;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Deep-merge a sparse override patch onto a base object (objects merge; arrays/scalars replace). */
function deepMerge<T extends Record<string, unknown>>(base: T, patch?: Record<string, unknown> | null): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    const bv = out[key];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = deepMerge(bv as Record<string, unknown>, pv as Record<string, unknown>);
    } else {
      out[key] = pv;
    }
  }
  return out as T;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Map a winning binding scope to (source, decisionCode, reasonCode). */
function scopeProvenance(scope: ResolverBindingRow['scope']): {
  source: ResolutionSource; decisionCode: string; reasonCode: string;
} {
  switch (scope) {
    case 'capability_override': return { source: 'capability_override', decisionCode: 'USE_OVERRIDE', reasonCode: 'CAP_OVERRIDE_APPLIED' };
    case 'org_default':         return { source: 'org_default',         decisionCode: 'USE_ORG_DEFAULT', reasonCode: 'ORG_DEFAULT_APPLIED' };
    case 'capability_default':  return { source: 'capability_default',  decisionCode: 'USE_CAPABILITY_DEFAULT', reasonCode: 'CAP_DEFAULT_APPLIED' };
    case 'platform_default':    return { source: 'platform_default',    decisionCode: 'USE_PLATFORM_DEFAULT', reasonCode: 'PLATFORM_DEFAULT_APPLIED' };
  }
}

/** Build the execution-semantics view used for the fingerprint (profile identity only). */
function toSemantics(v: {
  mode: string; qualityTier?: string | null; capabilityRequirements?: Record<string, unknown> | null;
  providerRef?: string | null; modelRef?: string | null; modelVersionTag?: string | null; deploymentId?: string | null;
  routingContent?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null; modality?: Record<string, unknown> | null;
  reliability?: Record<string, unknown> | null; limits?: Record<string, unknown> | null;
  caching?: Record<string, unknown> | null; safety?: Record<string, unknown> | null;
}): ExecutionSemantics {
  const explicit = v.mode === 'explicit';
  return {
    mode: v.mode,
    quality_tier: v.qualityTier ?? null,
    capability_requirements: v.capabilityRequirements ?? null,
    provider_ref: explicit ? v.providerRef ?? null : null,
    model_ref: explicit ? v.modelRef ?? null : null,
    model_version_tag: explicit ? v.modelVersionTag ?? null : null,
    deployment_id: explicit ? v.deploymentId ?? null : null,
    routing: v.routingContent ?? null,
    params: v.params ?? null,
    modality: v.modality ?? null,
    reliability: v.reliability ?? null,
    limits: v.limits ?? null,
    caching: v.caching ?? null,
    safety: v.safety ?? null,
  };
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * AI-ORCH 3G — public entry: resolve the plan, then apply request-parameter inheritance
 * as a pure post-overlay (Request wins over the profile default; UNSET keeps the profile).
 * The core resolution (provider/model/capability/profile selection) is UNCHANGED.
 */
export async function resolveExecutionPlan(input: ResolverInput, deps: ResolverDeps): Promise<ResolverOutput> {
  const out = await resolveExecutionPlanCore(input, deps);
  const o = input.overrides;
  if (!o) return out;
  // present (not undefined/null) override wins; otherwise keep the profile value.
  const pick = <T>(ov: T | null | undefined, prof: T | null | undefined): T | null =>
    (ov !== undefined && ov !== null) ? ov : (prof ?? null);
  const reliability = o.reliabilityCentralized
    // Central policy OWNS reliability: take ONLY the overrides; do not emit profile reliability.
    ? { timeoutMs: o.timeoutMs ?? null, maxRetries: o.maxRetries ?? null, retryPolicy: null, partialAllowed: out.plan.reliability.partialAllowed ?? null }
    : { ...out.plan.reliability, timeoutMs: pick(o.timeoutMs, out.plan.reliability.timeoutMs), maxRetries: pick(o.maxRetries, out.plan.reliability.maxRetries) };
  return {
    ...out,
    plan: {
      ...out.plan,
      params: {
        ...out.plan.params,
        temperature:      pick(o.temperature, out.plan.params.temperature),
        maxOutputTokens:  pick(o.maxOutputTokens, out.plan.params.maxOutputTokens),
        streaming:        pick(o.streaming, out.plan.params.streaming),
        structuredOutput: pick(o.structuredOutput, out.plan.params.structuredOutput),
        responseFormat:   pick(o.responseFormat, out.plan.params.responseFormat),
        reasoningLevel:   pick(o.reasoning, out.plan.params.reasoningLevel),
        toolCalling:      pick(o.toolCalling, out.plan.params.toolCalling),
      },
      reliability,
    },
  };
}

async function resolveExecutionPlanCore(input: ResolverInput, deps: ResolverDeps): Promise<ResolverOutput> {
  const steps: ResolutionTraceStep[] = [];
  let seq = 0;
  const step = (s: Omit<ResolutionTraceStep, 'sequence'>) => { steps.push({ sequence: seq++, ...s }); };

  // 1. Capability identity.
  let capabilityId = input.capabilityId ?? null;
  let unmapped = false;
  if (!capabilityId) {
    const mapped = input.operation ? await deps.mapOperationToCapability(input.operation) : null;
    capabilityId = mapped ?? GENERIC_CAPABILITY;
    unmapped = !mapped;
    step({
      step: 'map operation to capability',
      metadata: { operation: input.operation ?? null, capability: capabilityId, mapped: !unmapped },
      ...(unmapped ? { reasonCode: 'LEGACY_UNMAPPED_OPERATION' } : {}),
    });
  }

  // 2. Precedence walk — MOST SPECIFIC FIRST, first match wins.
  const orgId = input.orgId ?? null;
  let binding: ResolverBindingRow | null = null;

  if (orgId) {
    binding = await deps.loadBinding(orgId, capabilityId);
    step({ step: 'lookup capability override (org+capability)', metadata: { orgId, capabilityId, hit: !!binding } });
    if (!binding) {
      binding = await deps.loadBinding(orgId, null);
      step({ step: 'lookup organization default (org, *)', metadata: { orgId, hit: !!binding } });
    }
  }
  if (!binding) {
    binding = await deps.loadBinding(null, capabilityId);
    step({ step: 'lookup capability default (*, capability)', metadata: { capabilityId, hit: !!binding } });
  }
  if (!binding) {
    binding = await deps.loadPlatformDefaultBinding();
    step({ step: 'lookup platform default', metadata: { hit: !!binding } });
  }

  // 3/4/5. Either a binding won, or fall through to a legacy plan.
  if (!binding) {
    step({ step: 'legacy selection (no binding matched)', decisionCode: 'LEGACY_SELECTION', reasonCode: 'LEGACY_RESOLVER_UNAVAILABLE', source: 'legacy_hardcoded' });
    step({ step: 'finish' });
    const trace: ResolutionTrace = { steps };
    const plan: ResolvedExecutionPlan = {
      capabilityId, operation: input.operation ?? null, orgId,
      model: { provider: input.legacyProvider ?? null, model: input.legacyModel ?? null, modelVersion: null, deploymentId: null },
      params: {}, reliability: {}, limits: {}, caching: {},
      configFingerprint: null, source: 'legacy_hardcoded',
    };
    const metadata: ExecutionMetadata = {
      resolutionSource: 'legacy_hardcoded',
      resolutionDecisionCode: 'LEGACY_SELECTION',
      resolutionReasonCode: 'LEGACY_RESOLVER_UNAVAILABLE',
      resolutionTrace: trace,
    };
    return { plan, metadata, trace };
  }

  const prov = scopeProvenance(binding.scope);

  // Load the active immutable version + apply the sparse override patch.
  const ver = await deps.loadActiveProfileVersion(binding.profileId);
  if (!ver) {
    // Binding points at a profile with no active version — treat as legacy fallthrough (fail-safe).
    step({ step: 'profile version missing → legacy selection', decisionCode: 'LEGACY_SELECTION', reasonCode: 'LEGACY_RESOLVER_UNAVAILABLE', source: 'legacy_hardcoded' });
    step({ step: 'finish' });
    const trace: ResolutionTrace = { steps };
    const plan: ResolvedExecutionPlan = {
      capabilityId, operation: input.operation ?? null, orgId,
      model: { provider: input.legacyProvider ?? null, model: input.legacyModel ?? null, modelVersion: null, deploymentId: null },
      params: {}, reliability: {}, limits: {}, caching: {}, configFingerprint: null, source: 'legacy_hardcoded',
    };
    return { plan, metadata: { resolutionSource: 'legacy_hardcoded', resolutionDecisionCode: 'LEGACY_SELECTION', resolutionReasonCode: 'LEGACY_RESOLVER_UNAVAILABLE', resolutionTrace: trace }, trace };
  }

  step({ step: 'select profile', decisionCode: 'SELECT_PROFILE', reasonCode: prov.reasonCode, source: prov.source, metadata: { profile: ver.profileKey, version: ver.version, scope: binding.scope } });

  // Effective (post-patch) config bundles.
  const patch = binding.overridePatch ?? null;
  const params = deepMerge(obj(ver.params), obj(patch).params as Record<string, unknown> | undefined);
  const modality = deepMerge(obj(ver.modality), obj(patch).modality as Record<string, unknown> | undefined);
  const reliability = deepMerge(obj(ver.reliability), obj(patch).reliability as Record<string, unknown> | undefined);
  const limits = deepMerge(obj(ver.limits), obj(patch).limits as Record<string, unknown> | undefined);
  const caching = deepMerge(obj(ver.caching), obj(patch).caching as Record<string, unknown> | undefined);
  const safety = deepMerge(obj(ver.safety), obj(patch).safety as Record<string, unknown> | undefined);

  // 4. Resolve provider/model/version/deployment.
  const explicit = ver.mode === 'explicit';
  const provider = explicit ? ver.providerRef ?? null : input.legacyProvider ?? null;
  const model = explicit ? ver.modelRef ?? null : input.legacyModel ?? null;
  const modelVersion = explicit ? ver.modelVersionTag ?? null : null;
  const deploymentId = explicit ? ver.deploymentId ?? null : null;
  step({ step: 'resolve provider', decisionCode: 'SELECT_PROVIDER', metadata: { provider, mode: ver.mode } });
  step({ step: 'resolve model', decisionCode: 'SELECT_MODEL', metadata: { model, mode: ver.mode } });
  step({ step: 'resolve model version', decisionCode: 'SELECT_MODEL_VERSION', metadata: { modelVersion } });
  if (ver.routingPolicyId) step({ step: 'select routing policy', decisionCode: 'SELECT_ROUTING_POLICY', metadata: { routingPolicy: ver.routingPolicyKey ?? ver.routingPolicyId } });

  // 5. Modality / reasoning decisions (descriptive trace steps).
  if (modality.streaming === true) step({ step: 'enable streaming', decisionCode: 'ENABLE_STREAMING' });
  else if (modality.streaming === false) step({ step: 'disable streaming', decisionCode: 'DISABLE_STREAMING' });
  if (modality.structured_output === true) step({ step: 'enable structured output', decisionCode: 'ENABLE_STRUCTURED_OUTPUT' });
  if (modality.vision === true) step({ step: 'enable vision', decisionCode: 'ENABLE_VISION' });
  if (params.reasoning_level) step({ step: 'enable reasoning', decisionCode: 'ENABLE_REASONING', metadata: { level: params.reasoning_level } });

  // 6. Fingerprint (over profile identity semantics; recomputed post-patch).
  const semantics = toSemantics({
    mode: ver.mode, qualityTier: ver.qualityTier, capabilityRequirements: ver.capabilityRequirements,
    providerRef: ver.providerRef, modelRef: ver.modelRef, modelVersionTag: ver.modelVersionTag, deploymentId: ver.deploymentId,
    routingContent: ver.routingContent, params, modality, reliability, limits, caching, safety,
  });
  const fingerprint = computeConfigFingerprint(semantics);
  step({ step: 'compute configuration fingerprint', metadata: { fingerprint } });
  step({ step: 'finish' });

  const trace: ResolutionTrace = { steps };

  const plan: ResolvedExecutionPlan = {
    capabilityId, operation: input.operation ?? null, orgId,
    profileId: ver.profileId, profileKey: ver.profileKey, profileVersion: ver.version,
    model: { provider, model, modelVersion, deploymentId },
    params: {
      temperature: params.temperature as number ?? null,
      topP: (params.top_p as number) ?? null,
      maxOutputTokens: (params.max_output_tokens as number) ?? null,
      reasoningLevel: (params.reasoning_level as string) ?? null,
      seedPolicy: (params.seed_policy as string) ?? null,
      streaming: (modality.streaming as boolean) ?? null,
      structuredOutput: (modality.structured_output as boolean) ?? null,
      responseFormat: (modality.response_format as string) ?? null,
      vision: (modality.vision as boolean) ?? null,
      toolCalling: (modality.tool_calling as boolean) ?? null,
    },
    reliability: {
      timeoutMs: (reliability.timeout_ms as number) ?? null,
      maxRetries: (reliability.max_retries as number) ?? null,
      retryPolicy: (reliability.retry_policy as string) ?? null,
      partialAllowed: (reliability.partial_allowed as boolean) ?? null,
    },
    limits: {
      maxCostUsdPerCall: (limits.max_cost_usd_per_call as number) ?? null,
      tokenCeiling: (limits.token_ceiling as number) ?? null,
    },
    caching: {
      cacheable: (caching.cacheable as boolean) ?? null,
      ttlSeconds: (caching.cache_ttl_seconds as number) ?? null,
    },
    routingPolicyId: ver.routingPolicyId ?? null,
    routingPolicyKey: ver.routingPolicyKey ?? null,
    safety,
    configFingerprint: fingerprint,
    source: prov.source,
  };

  const metadata: ExecutionMetadata = {
    executionProfileId: ver.profileId,
    executionProfileKey: ver.profileKey,
    profileVersion: ver.version,
    configFingerprint: fingerprint,
    executionSchemaVersion: EXECUTION_SCHEMA_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
    fingerprintAlgoLegacy: CONFIG_FINGERPRINT_ALGO,
    resolutionSource: prov.source,
    resolutionDecisionCode: prov.decisionCode,
    resolutionReasonCode: prov.reasonCode,
    resolutionTrace: trace,
  };

  return { plan, metadata, trace };
}
