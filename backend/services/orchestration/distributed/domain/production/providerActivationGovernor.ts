/**
 * Phase 27B.4 — Provider Activation Governor.
 *
 * Gatekeeper for which providers + production domains the runtime is
 * allowed to drive. The governor is consulted BEFORE the activation
 * boot wiring touches an adapter — if the provider is not on the
 * allowlist (or is explicitly hard-blocked), the boot refuses.
 *
 * KEY GUARANTEES:
 *   - runtime CANNOT accidentally activate all providers (the empty
 *     allowlist is interpreted as "no providers permitted");
 *   - reddit is HARD-BLOCKED until its adapter exits stub state
 *     (the publish stub returns `error`, surveyed in 27A.3);
 *   - domain-level allowlist refuses unknown domains;
 *   - rollout-stage compatibility check rejects activations that
 *     are illegal for the current stage (e.g. provider activation
 *     during `publish_disabled`).
 *
 * SCOPE: read-only authorization decision. The governor does NOT
 * mutate the adapter map, does NOT modify env, does NOT call into
 * the runtime. Callers consult it and respect its verdict.
 *
 * Env (both optional; default = empty allowlist = nothing activates):
 *   ALLOWED_RUNTIME_PROVIDERS=x,linkedin,instagram
 *   ALLOWED_PRODUCTION_DOMAINS=social_publish,provider_reconciliation
 */

import type { ProductionRolloutStage } from './productionRuntimeRolloutGovernor';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type RuntimeProvider =
  | 'x'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'spotify';

export type ProductionDomain =
  | 'long_form_generation'
  | 'campaign_execution'
  | 'social_publish'
  | 'provider_reconciliation';

const KNOWN_PROVIDERS: ReadonlySet<RuntimeProvider> = new Set<RuntimeProvider>([
  'x', 'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube',
  'pinterest', 'reddit', 'spotify',
]);
const KNOWN_DOMAINS: ReadonlySet<ProductionDomain> = new Set<ProductionDomain>([
  'long_form_generation', 'campaign_execution', 'social_publish',
  'provider_reconciliation',
]);

/**
 * Providers whose adapters are not yet runtime-ready. Surveyed in
 * Phase 27A.3 — the reddit adapter is a stub that returns an error.
 * The runtime MUST refuse to activate any provider in this set
 * regardless of operator allowlist.
 */
const HARD_BLOCKED_PROVIDERS: ReadonlySet<RuntimeProvider> = new Set<RuntimeProvider>(['reddit']);

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ProviderActivationTelemetryEvent =
  | 'provider_activation_allowed'
  | 'provider_activation_refused'
  | 'domain_activation_allowed'
  | 'domain_activation_refused'
  | 'provider_activation_hard_blocked';

export interface ProviderActivationTelemetrySink {
  emit(event: ProviderActivationTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProviderActivationTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event.endsWith('refused') || event.endsWith('hard_blocked')) {
        console.warn(`[provider_governor] ${line}`);
      } else {
        console.log(`[provider_governor] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Verdict shape
// ────────────────────────────────────────────────────────────────────

export interface ProviderActivationVerdict {
  allowed: boolean;
  reason: string;
  hardBlocked: boolean;
}

export interface DomainActivationVerdict {
  allowed: boolean;
  reason: string;
}

// ────────────────────────────────────────────────────────────────────
// Governor
// ────────────────────────────────────────────────────────────────────

export interface ProviderActivationGovernorOpts {
  /** Optional override (defaults to env ALLOWED_RUNTIME_PROVIDERS). */
  allowedProviders?: ReadonlyArray<RuntimeProvider>;
  /** Optional override (defaults to env ALLOWED_PRODUCTION_DOMAINS). */
  allowedDomains?: ReadonlyArray<ProductionDomain>;
  /** Optional override (defaults to env PRODUCTION_RUNTIME_ROLLOUT_STAGE). */
  rolloutStage?: ProductionRolloutStage;
  telemetry?: ProviderActivationTelemetrySink;
  /** Optional override of hard-blocked providers (for tests). */
  hardBlockedProviders?: ReadonlySet<RuntimeProvider>;
}

export class ProviderActivationGovernor {
  private readonly allowedProviders: ReadonlySet<RuntimeProvider>;
  private readonly allowedDomains: ReadonlySet<ProductionDomain>;
  private readonly rolloutStage: ProductionRolloutStage;
  private readonly telemetry: ProviderActivationTelemetrySink;
  private readonly hardBlocked: ReadonlySet<RuntimeProvider>;

  constructor(opts?: ProviderActivationGovernorOpts) {
    this.allowedProviders = new Set(
      opts?.allowedProviders ?? parseProviderEnv(process.env.ALLOWED_RUNTIME_PROVIDERS),
    );
    this.allowedDomains = new Set(
      opts?.allowedDomains ?? parseDomainEnv(process.env.ALLOWED_PRODUCTION_DOMAINS),
    );
    this.rolloutStage = opts?.rolloutStage ?? parseRolloutStage(process.env.PRODUCTION_RUNTIME_ROLLOUT_STAGE);
    this.telemetry = opts?.telemetry ?? defaultTelemetrySink;
    this.hardBlocked = opts?.hardBlockedProviders ?? HARD_BLOCKED_PROVIDERS;
  }

  /**
   * Check whether a single provider may activate. Order of checks:
   *   1. known provider name
   *   2. NOT in HARD_BLOCKED_PROVIDERS
   *   3. on operator allowlist
   *   4. rollout stage permits publish at all
   */
  evaluateProvider(provider: string): ProviderActivationVerdict {
    if (!KNOWN_PROVIDERS.has(provider as RuntimeProvider)) {
      const reason = `provider '${provider}' is not a known runtime provider`;
      this.telemetry.emit('provider_activation_refused', { provider, reason });
      return { allowed: false, reason, hardBlocked: false };
    }
    if (this.hardBlocked.has(provider as RuntimeProvider)) {
      const reason = `provider '${provider}' is HARD-BLOCKED until its adapter exits stub state`;
      this.telemetry.emit('provider_activation_hard_blocked', { provider, reason });
      return { allowed: false, reason, hardBlocked: true };
    }
    if (!this.allowedProviders.has(provider as RuntimeProvider)) {
      const reason = `provider '${provider}' not on ALLOWED_RUNTIME_PROVIDERS`;
      this.telemetry.emit('provider_activation_refused', { provider, reason });
      return { allowed: false, reason, hardBlocked: false };
    }
    if (!stagePermitsPublish(this.rolloutStage)) {
      const reason = `rollout stage '${this.rolloutStage}' forbids provider activation`;
      this.telemetry.emit('provider_activation_refused', { provider, reason, rolloutStage: this.rolloutStage });
      return { allowed: false, reason, hardBlocked: false };
    }
    this.telemetry.emit('provider_activation_allowed', { provider, rolloutStage: this.rolloutStage });
    return { allowed: true, reason: 'on allowlist', hardBlocked: false };
  }

  /**
   * Check whether a production domain may activate.
   */
  evaluateDomain(domain: string): DomainActivationVerdict {
    if (!KNOWN_DOMAINS.has(domain as ProductionDomain)) {
      const reason = `domain '${domain}' is not a known production domain`;
      this.telemetry.emit('domain_activation_refused', { domain, reason });
      return { allowed: false, reason };
    }
    if (!this.allowedDomains.has(domain as ProductionDomain)) {
      const reason = `domain '${domain}' not on ALLOWED_PRODUCTION_DOMAINS`;
      this.telemetry.emit('domain_activation_refused', { domain, reason });
      return { allowed: false, reason };
    }
    this.telemetry.emit('domain_activation_allowed', { domain });
    return { allowed: true, reason: 'on allowlist' };
  }

  /**
   * Filter an arbitrary adapter map down to only the providers the
   * governor allows. The original map is NOT mutated.
   */
  filterAdapterMap<T extends Record<string, unknown>>(
    adapterMap: T,
  ): { allowed: Partial<T>; refused: Array<{ provider: string; reason: string; hardBlocked: boolean }> } {
    const allowed: Partial<T> = {};
    const refused: Array<{ provider: string; reason: string; hardBlocked: boolean }> = [];
    for (const provider of Object.keys(adapterMap)) {
      const verdict = this.evaluateProvider(provider);
      if (verdict.allowed) {
        (allowed as Record<string, unknown>)[provider] = adapterMap[provider as keyof T];
      } else {
        refused.push({ provider, reason: verdict.reason, hardBlocked: verdict.hardBlocked });
      }
    }
    return { allowed, refused };
  }

  /**
   * Diagnostics snapshot.
   */
  snapshot(): {
    allowedProviders: RuntimeProvider[];
    allowedDomains: ProductionDomain[];
    rolloutStage: ProductionRolloutStage;
    hardBlockedProviders: RuntimeProvider[];
  } {
    return {
      allowedProviders: Array.from(this.allowedProviders).sort(),
      allowedDomains: Array.from(this.allowedDomains).sort(),
      rolloutStage: this.rolloutStage,
      hardBlockedProviders: Array.from(this.hardBlocked).sort(),
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Env parsing
// ────────────────────────────────────────────────────────────────────

function parseProviderEnv(raw: string | undefined): RuntimeProvider[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => KNOWN_PROVIDERS.has(s as RuntimeProvider)) as RuntimeProvider[];
}

function parseDomainEnv(raw: string | undefined): ProductionDomain[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => KNOWN_DOMAINS.has(s as ProductionDomain)) as ProductionDomain[];
}

function parseRolloutStage(raw: string | undefined): ProductionRolloutStage {
  const valid: ReadonlyArray<ProductionRolloutStage> = [
    'disabled', 'shadow_only', 'replay_audit_only', 'publish_disabled',
    'single_provider_live', 'staged_provider_rollout', 'full_runtime_live',
  ];
  const cleaned = (raw ?? 'disabled').trim().toLowerCase();
  if (valid.includes(cleaned as ProductionRolloutStage)) {
    return cleaned as ProductionRolloutStage;
  }
  return 'disabled';
}

/**
 * Which stages permit ANY provider to receive runtime publish calls.
 */
function stagePermitsPublish(stage: ProductionRolloutStage): boolean {
  return (
    stage === 'single_provider_live' ||
    stage === 'staged_provider_rollout' ||
    stage === 'full_runtime_live'
  );
}
