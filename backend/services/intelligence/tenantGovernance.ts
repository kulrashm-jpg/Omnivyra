// Multi-tenant intelligence governance.
//
// `TenantContext` is the single object every Phase 6 system reads from. It
// scopes provider enablement, scan budgets, retention windows, benchmark
// access, and audit attribution. Every read against the historical store
// MUST filter on `tenant_id`; every adapter MUST consult the tenant's
// provider policy before making an external call.

import type { ScanProfile } from './snapshotWriter';

export type TenantId = string;
export type ActorId = string;

export type TenantContext = {
  tenant_id: TenantId;
  /** The acting user / agent — flows into audit log entries. */
  actor: { id: ActorId; kind: 'user' | 'analyst' | 'admin' | 'system' | 'scheduled_job'; label: string };
  /** Time the request entered the report engine. */
  request_at: string;
  /** Optional correlation id so a single user action can trace through every downstream record. */
  correlation_id: string;
};

// ── Provider policy ───────────────────────────────────────────────────────────

export type TenantProviderPolicy = {
  /** Provider ids the tenant is authorised to use. */
  enabled_providers: string[];
  /** Provider ids the tenant has explicitly excluded (overrides `enabled_providers`). */
  excluded_providers: string[];
  /** Per-tenant per-provider rate cap (calls / hour). null = use system default. */
  rate_caps_per_hour: Record<string, number>;
  /** When true, the tenant CANNOT trigger any external provider call — only cached / structured-data measurements run. */
  external_calls_forbidden: boolean;
};

// ── Scan budget policy ────────────────────────────────────────────────────────

export type TenantScanBudgetPolicy = {
  /** Maximum scans per day. Reaching this cap forces `unavailable: 'tenant_scan_budget_exhausted'`. */
  max_scans_per_day: number;
  /** Per-scan dollar ceiling (overrides the per-profile default if more restrictive). */
  max_cost_usd_per_scan: number;
  /** Allowed scan profiles. Tenants on a tier that disallows `deep` see it removed from the menu. */
  allowed_profiles: ScanProfile[];
};

// ── Retention policy ──────────────────────────────────────────────────────────

export type TenantRetentionPolicy = {
  /** Days to retain `report_score_history` rows. After this they are eligible for purge. */
  history_retention_days: number;
  /** Days to retain provider-call detail rows (typically shorter than score history). */
  provider_history_retention_days: number;
  /** Days to retain audit log entries. Compliance contexts often demand long retention. */
  audit_retention_days: number;
};

// ── Benchmark scope policy ────────────────────────────────────────────────────

export type TenantBenchmarkPolicy = {
  /** Benchmark dataset ids this tenant is permitted to compare against. */
  allowed_dataset_ids: string[];
  /** When true, the tenant's snapshots feed the curated peer dataset. When false, scans are isolated. */
  contributes_to_peer_set: boolean;
};

// ── Aggregate tenant policy ───────────────────────────────────────────────────

export type TenantPolicy = {
  tenant_id: TenantId;
  display_name: string;
  providers: TenantProviderPolicy;
  scan_budget: TenantScanBudgetPolicy;
  retention: TenantRetentionPolicy;
  benchmark: TenantBenchmarkPolicy;
  /** Plan tier name surfaced in the admin console. */
  plan_tier: 'starter' | 'standard' | 'professional' | 'enterprise';
  /** Tenant policy id — every audit log entry that touches policy carries this. */
  policy_revision: string;
};

const DEFAULT_POLICY = (tenant_id: TenantId, display_name = tenant_id): TenantPolicy => ({
  tenant_id,
  display_name,
  providers: {
    enabled_providers: ['chatgpt', 'claude', 'gemini', 'perplexity', 'wikidata'],
    excluded_providers: [],
    rate_caps_per_hour: {},
    external_calls_forbidden: false,
  },
  scan_budget: {
    max_scans_per_day: 10,
    max_cost_usd_per_scan: 5,
    allowed_profiles: ['lightweight', 'standard', 'manual_refresh', 'delta_only'],
  },
  retention: {
    history_retention_days: 365,
    provider_history_retention_days: 90,
    audit_retention_days: 730,
  },
  benchmark: {
    allowed_dataset_ids: ['curated_vertical'],
    contributes_to_peer_set: false,
  },
  plan_tier: 'standard',
  policy_revision: 'v1',
});

// ── Policy registry ───────────────────────────────────────────────────────────
//
// Production: Supabase-backed `tenant_policy` table; tests use the in-memory
// fallback. Same registry pattern as the historical store / provider registry.

export interface TenantPolicyStore {
  loadPolicy(tenant_id: TenantId): Promise<TenantPolicy | null>;
  upsertPolicy(policy: TenantPolicy, actor: TenantContext['actor']): Promise<void>;
}

class InMemoryTenantPolicyStore implements TenantPolicyStore {
  private policies = new Map<TenantId, TenantPolicy>();
  async loadPolicy(tenant_id: TenantId): Promise<TenantPolicy | null> {
    return this.policies.get(tenant_id) ?? null;
  }
  async upsertPolicy(policy: TenantPolicy): Promise<void> {
    this.policies.set(policy.tenant_id, policy);
  }
  /** Test helper. */
  _reset(): void {
    this.policies.clear();
  }
}

let activePolicyStore: TenantPolicyStore = new InMemoryTenantPolicyStore();

export function registerTenantPolicyStore(store: TenantPolicyStore): void {
  activePolicyStore = store;
}

export async function loadTenantPolicy(tenant_id: TenantId): Promise<TenantPolicy> {
  const stored = await activePolicyStore.loadPolicy(tenant_id);
  return stored ?? DEFAULT_POLICY(tenant_id);
}

export async function upsertTenantPolicy(
  policy: TenantPolicy,
  actor: TenantContext['actor'],
): Promise<void> {
  await activePolicyStore.upsertPolicy(policy, actor);
}

// ── Provider gating ───────────────────────────────────────────────────────────

export function isProviderAllowed(policy: TenantPolicy, provider_id: string): boolean {
  if (policy.providers.external_calls_forbidden) {
    // Wikidata / structured-data extractors are not external in the API-cost sense;
    // they read from public APIs without per-call billing. Operators with strict
    // tenants can still exclude them via `excluded_providers`.
    if (!['wikidata', 'schema_org'].includes(provider_id)) return false;
  }
  if (policy.providers.excluded_providers.includes(provider_id)) return false;
  if (policy.providers.enabled_providers.length === 0) return true; // empty allow-list = no restriction
  return policy.providers.enabled_providers.includes(provider_id);
}

export function isScanProfileAllowed(policy: TenantPolicy, profile: ScanProfile): boolean {
  return policy.scan_budget.allowed_profiles.includes(profile);
}

/** Test helper. */
export function _resetTenantPolicyStore(): void {
  activePolicyStore = new InMemoryTenantPolicyStore();
}
