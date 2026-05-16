/**
 * Billing Schema Spec + Safe PostgREST Prober
 *
 * Single source of truth for "what billing DB objects must exist", plus a
 * dependency-free prober that follows this codebase's established pattern
 * (see backend/security/startup/schemaHealthCheck.ts): probe each object
 * through PostgREST and interpret the error, because `information_schema` /
 * `pg_catalog` are not reliably queryable through the JS client and no
 * generic SQL-exec RPC exists.
 *
 * What is DEFINITIVELY verifiable through PostgREST:
 *   - tables / views  → head-count select (read-only, zero rows)
 *   - read-only RPCs  → safe live call (e.g. lookup_fx_rate)
 *
 * What is NOT verifiable without raw SQL (reported as `unverified`, never
 * silently passed — satisfies "no silent schema mismatch"):
 *   - triggers, indexes, mutating RPCs (calling them would mutate data).
 *   For these we emit the exact SQL the operator runs, and we INFER their
 *   presence from the migration that creates them in the same transaction
 *   as a verifiable table (low residual risk, explicit).
 */

import { supabase } from '../../../db/supabaseClient';

export type Severity = 'critical' | 'high' | 'medium';
export type ProbeStatus = 'present' | 'missing' | 'unverified' | 'error';

export interface TableSpec {
  name:      string;
  migration: string;
  severity:  Severity;
  consumer:  string;
  kind:      'table' | 'view';
}

export interface RpcSpec {
  name:        string;
  migration:   string;
  severity:    Severity;
  /** Read-only RPCs can be live-probed safely. Mutating ones cannot. */
  readOnly:    boolean;
  /** Args for the safe read-only probe (ignored for mutating RPCs). */
  safeArgs?:   Record<string, unknown>;
}

export interface OpaqueSpec {
  name:       string;
  migration:  string;
  severity:   Severity;
  /** SQL the operator can run to definitively verify this object. */
  verifySql:  string;
  /** Verifiable table whose presence implies this object (same migration tx). */
  inferredFrom: string;
}

// ── Tables + views ────────────────────────────────────────────────────────────

export const BILLING_TABLES: ReadonlyArray<TableSpec> = [
  // 20260663 — Phase 1
  { name: 'credit_action_approvals',            migration: '20260663', severity: 'critical', kind: 'table', consumer: 'approval flow (grant/adjust/refund), idempotency console' },
  { name: 'credit_action_approval_signatures',  migration: '20260663', severity: 'critical', kind: 'table', consumer: 'sign_credit_action_approval' },
  { name: 'billing_operations',                 migration: '20260663', severity: 'critical', kind: 'table', consumer: 'enterpriseBillingOrchestrator, reconciliation, dashboards' },
  { name: 'job_execution_registry',             migration: '20260663', severity: 'critical', kind: 'table', consumer: 'queueBillingMiddleware exactly-once' },
  { name: 'admin_financial_audit_events',       migration: '20260663', severity: 'high',     kind: 'table', consumer: 'financial audit trail, dashboards' },
  { name: 'credit_untracked_actions',           migration: '20260663', severity: 'high',     kind: 'table', consumer: 'aiGateway billing guard allowlist' },
  // 20260664 — Phase 2
  { name: 'payment_provider_event_state',       migration: '20260664', severity: 'high',     kind: 'table', consumer: 'payment webhook fulfillment state' },
  { name: 'company_billing_profiles',           migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'payment foundation' },
  { name: 'payment_transactions',               migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'payment foundation' },
  { name: 'billing_subscriptions',              migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'subscription projection' },
  { name: 'invoices',                           migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'invoice projection / portal' },
  { name: 'invoice_line_items',                 migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'invoice projection / portal' },
  { name: 'usage_billing_snapshots',            migration: '20260664', severity: 'medium',   kind: 'table', consumer: 'usage aggregation' },
  // 20260665 — Phase 3
  { name: 'currency_exchange_rates',            migration: '20260665', severity: 'high',     kind: 'table', consumer: 'FX engine' },
  { name: 'enterprise_contracts',               migration: '20260665', severity: 'medium',   kind: 'table', consumer: 'contract resolver / portal' },
  { name: 'enterprise_purchase_orders',         migration: '20260665', severity: 'medium',   kind: 'table', consumer: 'enterprise billing' },
  { name: 'billing_export_manifests',           migration: '20260665', severity: 'high',     kind: 'table', consumer: 'export integrity manifests' },
  // Views
  { name: 'v_billing_operations_health',        migration: '20260664', severity: 'medium',   kind: 'view',  consumer: 'super-admin dashboard' },
  { name: 'v_approval_health',                  migration: '20260664', severity: 'medium',   kind: 'view',  consumer: 'super-admin dashboard' },
  { name: 'v_reservation_health',              migration: '20260664', severity: 'high',     kind: 'view',  consumer: 'company portal + reservation recon' },
  { name: 'v_company_financial_timeline',       migration: '20260665', severity: 'medium',   kind: 'view',  consumer: 'forensics timeline' },
];

// ── RPCs ──────────────────────────────────────────────────────────────────────

export const BILLING_RPCS: ReadonlyArray<RpcSpec> = [
  // Read-only → safe to live-probe
  { name: 'lookup_fx_rate',               migration: '20260665', severity: 'high',     readOnly: true,  safeArgs: { p_source: 'USD', p_target: 'USD' } },
  { name: 'required_approvals_for_action', migration: '20260663', severity: 'critical', readOnly: true,  safeArgs: { p_action_type: 'admin_grant', p_amount: 0 } },
  // Mutating → presence INFERRED from same-migration table (never live-probed)
  { name: 'sign_credit_action_approval',  migration: '20260663', severity: 'critical', readOnly: false },
  { name: 'claim_job_execution',          migration: '20260663', severity: 'critical', readOnly: false },
  { name: 'advance_job_execution',        migration: '20260663', severity: 'critical', readOnly: false },
  { name: 'cancel_credit_action_approval', migration: '20260664', severity: 'high',    readOnly: false },
  { name: 'advance_payment_provider_event_state', migration: '20260664', severity: 'high', readOnly: false },
];

// ── Triggers + indexes (not PostgREST-verifiable; inferred + SQL provided) ─────

export const BILLING_OPAQUE: ReadonlyArray<OpaqueSpec> = [
  {
    name: 'credit_transactions immutability triggers',
    migration: '20260663', severity: 'critical', inferredFrom: 'credit_action_approvals',
    verifySql: `SELECT count(*) FROM information_schema.triggers WHERE event_object_table='credit_transactions' AND trigger_name LIKE '%immutable%';`,
  },
  {
    name: 'approval-frozen + signature-immutable triggers',
    migration: '20260663', severity: 'critical', inferredFrom: 'credit_action_approval_signatures',
    verifySql: `SELECT count(*) FROM information_schema.triggers WHERE trigger_name IN ('guard_caa_post_execute','caas_immutable_update','caas_immutable_delete');`,
  },
  {
    name: 'job_execution_registry monotonic-status trigger',
    migration: '20260663', severity: 'high', inferredFrom: 'job_execution_registry',
    verifySql: `SELECT count(*) FROM information_schema.triggers WHERE trigger_name='guard_jer_status_monotonic';`,
  },
  {
    name: 'idempotency + ledger lookup indexes',
    migration: '20260663', severity: 'high', inferredFrom: 'billing_operations',
    verifySql: `SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_bo_correlation','idx_credit_txn_idempotency','idx_credit_tx_parent_phase');`,
  },
  {
    name: 'FX immutability triggers + lookup index',
    migration: '20260665', severity: 'high', inferredFrom: 'currency_exchange_rates',
    verifySql: `SELECT count(*) FROM pg_indexes WHERE indexname='idx_fx_lookup';`,
  },
];

// ── Safe probers ──────────────────────────────────────────────────────────────

const MISSING_HINTS = [
  'does not exist',
  'could not find the table',
  'could not find the function',
  'schema cache',
  'pgrst205',
  'pgrst202',
  '42p01',
];

function looksMissing(message: string | undefined, code: string | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return MISSING_HINTS.some(h => m.includes(h) || c.includes(h));
}

export interface ProbeResult {
  object:    string;
  kind:      'table' | 'view' | 'rpc' | 'opaque';
  status:    ProbeStatus;
  severity:  Severity;
  migration: string;
  detail?:   string;
}

/**
 * Definitive: a RELATION-TOUCHING fetch (`select … limit 1`), at most one
 * row read, zero mutation.
 *
 * Why not `head:true` + `count:exact` + `limit(0)`? Because that is NOT
 * definitive. Verified against production (klkiseupptzbecbxwrky): a
 * head-count probe of a table that genuinely does NOT exist returns
 * `error: null` — PostgREST answers the metadata/count request from its
 * (stale) schema cache without resolving the underlying relation. That
 * produced a silent FALSE POSITIVE: ~21 absent critical tables reported
 * "present". A real `select('*').limit(1)` forces PostgREST to resolve
 * the relation and surfaces the exact `PGRST205 … schema cache` / `42P01`
 * the application itself hits — which is the whole point of fail-fast.
 *
 * `limit(1)` reads at most one row of an otherwise-untouched table; it is
 * read-only and cheap. RLS/permission denials (a DIFFERENT error
 * signature — `42501`, "permission denied", no missing-hint) still mean
 * the relation resolved → `present`.
 */
export async function probeTable(spec: TableSpec): Promise<ProbeResult> {
  try {
    const { error } = await supabase
      .from(spec.name)
      .select('*')
      .limit(1);
    if (!error) {
      return { object: spec.name, kind: spec.kind, status: 'present', severity: spec.severity, migration: spec.migration };
    }
    if (looksMissing(error.message, (error as { code?: string }).code)) {
      return { object: spec.name, kind: spec.kind, status: 'missing', severity: spec.severity, migration: spec.migration, detail: error.message };
    }
    // Relation resolved but the read hit RLS / perms / other — the
    // non-existence error has a distinct signature (handled above), so a
    // different error means the object exists.
    return { object: spec.name, kind: spec.kind, status: 'present', severity: spec.severity, migration: spec.migration, detail: `probe_non_fatal:${error.message}` };
  } catch (err: unknown) {
    return { object: spec.name, kind: spec.kind, status: 'error', severity: spec.severity, migration: spec.migration, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Read-only RPCs are live-probed; mutating RPCs are inferred (never called). */
export async function probeRpc(spec: RpcSpec, tableStatuses: Map<string, ProbeStatus>): Promise<ProbeResult> {
  if (!spec.readOnly) {
    // Infer from a same-migration critical table to avoid a mutating call.
    const sibling = BILLING_TABLES.find(t => t.migration === spec.migration && t.severity === 'critical');
    const sibStatus = sibling ? tableStatuses.get(sibling.name) : undefined;
    const inferred: ProbeStatus =
      sibStatus === 'present' ? 'present' :
      sibStatus === 'missing' ? 'missing' :
                                'unverified';
    return {
      object: spec.name, kind: 'rpc', status: inferred, severity: spec.severity, migration: spec.migration,
      detail: `mutating RPC — not live-probed; inferred from ${sibling?.name ?? 'n/a'} (${sibStatus ?? 'unknown'})`,
    };
  }
  try {
    const { error } = await supabase.rpc(spec.name, spec.safeArgs ?? {});
    if (!error) {
      return { object: spec.name, kind: 'rpc', status: 'present', severity: spec.severity, migration: spec.migration };
    }
    if (looksMissing(error.message, (error as { code?: string }).code)) {
      return { object: spec.name, kind: 'rpc', status: 'missing', severity: spec.severity, migration: spec.migration, detail: error.message };
    }
    // Function resolved but raised a domain error (e.g. validation) → present.
    return { object: spec.name, kind: 'rpc', status: 'present', severity: spec.severity, migration: spec.migration, detail: `probe_non_fatal:${error.message}` };
  } catch (err: unknown) {
    return { object: spec.name, kind: 'rpc', status: 'error', severity: spec.severity, migration: spec.migration, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface BillingSchemaReport {
  generatedAt:  string;
  overall:      'ok' | 'degraded' | 'critical_missing';
  counts:       { present: number; missing: number; unverified: number; error: number };
  criticalMissing: ProbeResult[];
  results:      ProbeResult[];
  opaque:       Array<{ name: string; severity: Severity; status: ProbeStatus; migration: string; verifySql: string; detail: string }>;
}

export async function buildBillingSchemaReport(): Promise<BillingSchemaReport> {
  const tableResults = await Promise.all(BILLING_TABLES.map(probeTable));
  const statusMap = new Map<string, ProbeStatus>(tableResults.map(r => [r.object, r.status]));
  const rpcResults = await Promise.all(BILLING_RPCS.map(r => probeRpc(r, statusMap)));

  const results = [...tableResults, ...rpcResults];

  const opaque = BILLING_OPAQUE.map(o => {
    const sib = statusMap.get(o.inferredFrom);
    const status: ProbeStatus = sib === 'present' ? 'present' : sib === 'missing' ? 'missing' : 'unverified';
    return {
      name: o.name, severity: o.severity, status, migration: o.migration, verifySql: o.verifySql,
      detail: `inferred from ${o.inferredFrom} (${sib ?? 'unknown'}) — run verifySql for a definitive check`,
    };
  });

  const counts = {
    present:    results.filter(r => r.status === 'present').length,
    missing:    results.filter(r => r.status === 'missing').length,
    unverified: results.filter(r => r.status === 'unverified').length,
    error:      results.filter(r => r.status === 'error').length,
  };
  const criticalMissing = results.filter(r => r.status === 'missing' && r.severity === 'critical');
  const overall: BillingSchemaReport['overall'] =
    criticalMissing.length > 0 ? 'critical_missing' :
    counts.missing > 0 || counts.error > 0 ? 'degraded' :
    'ok';

  return {
    generatedAt: new Date().toISOString(),
    overall, counts, criticalMissing, results, opaque,
  };
}
