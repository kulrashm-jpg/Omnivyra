/**
 * Billing Forensics Service — Phase 3 C / G
 *
 * Investigation surface for finance/support: given a correlation_id, a
 * billing_operation id, or an idempotency key, reconstruct the full
 * lineage across:
 *
 *   billing_operations
 *   credit_transactions (HOLD / CONFIRM / RELEASE)
 *   credit_action_approvals + signatures
 *   admin_financial_audit_events
 *   payment_transactions
 *
 * Pure read; never mutates anything.
 */

import { supabase } from '../../../db/supabaseClient';

export interface ForensicsResult {
  query: { correlationId?: string; operationId?: string; idempotencyKey?: string };
  billingOperations: Array<Record<string, unknown>>;
  ledgerTransactions: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  signatures: Array<Record<string, unknown>>;
  financialAudits: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
}

export async function traceBillingOperation(args: {
  correlationId?:  string;
  operationId?:    string;
  idempotencyKey?: string;
}): Promise<ForensicsResult> {
  // Resolve to a set of idempotency_keys to search the ledger by.
  const idemKeys = new Set<string>();
  const operationIds = new Set<string>();
  const correlationIds = new Set<string>();
  if (args.idempotencyKey) idemKeys.add(args.idempotencyKey);
  if (args.operationId)    operationIds.add(args.operationId);
  if (args.correlationId)  correlationIds.add(args.correlationId);

  // Step 1: pull billing_operations rows that match any of the query keys.
  let opsQuery = supabase.from('billing_operations').select('*');
  if (args.operationId) {
    opsQuery = opsQuery.eq('id', args.operationId);
  } else if (args.correlationId) {
    opsQuery = opsQuery.eq('correlation_id', args.correlationId);
  } else if (args.idempotencyKey) {
    opsQuery = opsQuery.eq('idempotency_key', args.idempotencyKey);
  }
  const { data: ops, error: opsErr } = await opsQuery.limit(50);
  // A forensic trace missing a piece would be presented as complete (2026-11-12).
  if (opsErr) throw new Error(`[billingForensics] ops read failed: ${opsErr.message}`);
  const opsRows = (ops ?? []) as Array<Record<string, unknown>>;
  for (const op of opsRows) {
    if (op.idempotency_key)  idemKeys.add(String(op.idempotency_key));
    if (op.correlation_id)   correlationIds.add(String(op.correlation_id));
  }

  // Step 2: ledger transactions matching any idem-key (HOLD/CONFIRM/RELEASE/GRANT)
  let ledgerRows: Array<Record<string, unknown>> = [];
  if (idemKeys.size > 0) {
    const phaseKeys = Array.from(idemKeys).flatMap(k => [k, `${k}:hold`, `${k}:confirm`, `${k}:release`]);
    const { data: ledger, error: ledgerErr } = await supabase
      .from('credit_transactions')
      .select('*')
      .in('idempotency_key', phaseKeys);
    // A forensic trace missing a piece would be presented as complete (2026-11-12).
    if (ledgerErr) throw new Error(`[billingForensics] ledger read failed: ${ledgerErr.message}`);
    ledgerRows = (ledger ?? []) as Array<Record<string, unknown>>;
  }

  // Step 3: approvals — look up via executed_idempotency_key OR proposed_by metadata
  let approvalRows: Array<Record<string, unknown>> = [];
  let signatures: Array<Record<string, unknown>> = [];
  if (idemKeys.size > 0) {
    const { data: app, error: appErr } = await supabase
      .from('credit_action_approvals')
      .select('*')
      .in('executed_idempotency_key', Array.from(idemKeys));
    // A forensic trace missing a piece would be presented as complete (2026-11-12).
    if (appErr) throw new Error(`[billingForensics] app read failed: ${appErr.message}`);
    approvalRows = (app ?? []) as Array<Record<string, unknown>>;
    if (approvalRows.length > 0) {
      const approvalIds = approvalRows.map(r => String(r.id));
      const { data: sigs, error: sigsErr } = await supabase
        .from('credit_action_approval_signatures')
        .select('*')
        .in('approval_id', approvalIds);
      // A forensic trace missing a piece would be presented as complete (2026-11-12).
      if (sigsErr) throw new Error(`[billingForensics] sigs read failed: ${sigsErr.message}`);
      signatures = (sigs ?? []) as Array<Record<string, unknown>>;
    }
  }

  // Step 4: financial audit events — by correlation OR idempotency key
  let financialAudits: Array<Record<string, unknown>> = [];
  if (correlationIds.size > 0 || idemKeys.size > 0) {
    const idemKeyArr = Array.from(idemKeys);
    const corrArr = Array.from(correlationIds);
    const queries: Array<PromiseLike<Array<Record<string, unknown>>>> = [];
    if (corrArr.length > 0) {
      queries.push(supabase
        .from('admin_financial_audit_events')
        .select('*')
        .in('correlation_id', corrArr)
        .then(r => {
          if (r.error) throw new Error(`[billingForensics] financial audit read failed: ${r.error.message}`);
          return (r.data ?? []) as Array<Record<string, unknown>>;
        }));
    }
    if (idemKeyArr.length > 0) {
      queries.push(supabase
        .from('admin_financial_audit_events')
        .select('*')
        .in('ledger_idempotency_key', idemKeyArr)
        .then(r => {
          if (r.error) throw new Error(`[billingForensics] financial audit read failed: ${r.error.message}`);
          return (r.data ?? []) as Array<Record<string, unknown>>;
        }));
    }
    const results = await Promise.all(queries);
    const seen = new Set<string>();
    for (const batch of results) {
      for (const row of batch) {
        const id = String(row.id);
        if (!seen.has(id)) { seen.add(id); financialAudits.push(row); }
      }
    }
  }

  // Step 5: related payment_transactions — for now we don't have a direct
  // link from idempotency_key → payment_transactions (deferred to Phase 4
  // when Stripe lands). We surface payments by org if the operation rows
  // narrowed us to one org.
  let payments: Array<Record<string, unknown>> = [];
  const orgIds = new Set<string>();
  for (const op of opsRows) if (op.organization_id) orgIds.add(String(op.organization_id));
  for (const txn of ledgerRows) if (txn.organization_id) orgIds.add(String(txn.organization_id));
  if (orgIds.size === 1) {
    const orgId = Array.from(orgIds)[0];
    const earliest = [
      ...ledgerRows.map(r => String(r.created_at)),
      ...opsRows.map(r => String(r.started_at)),
    ].sort()[0];
    if (earliest) {
      const window24h = new Date(Date.parse(earliest) - 86400_000).toISOString();
      const window24hAfter = new Date(Date.parse(earliest) + 86400_000).toISOString();
      const { data: pays, error: paysErr } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('organization_id', orgId)
        .gte('occurred_at', window24h)
        .lte('occurred_at', window24hAfter)
        .order('occurred_at', { ascending: true });
      // A forensic trace missing a piece would be presented as complete (2026-11-12).
      if (paysErr) throw new Error(`[billingForensics] pays read failed: ${paysErr.message}`);
      payments = (pays ?? []) as Array<Record<string, unknown>>;
    }
  }

  return {
    query: args,
    billingOperations:  opsRows,
    ledgerTransactions: ledgerRows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    approvals:          approvalRows,
    signatures,
    financialAudits,
    payments,
  };
}

/**
 * Replay investigation: given a job_execution_registry id or execution_hash,
 * surface the registry row + all retry counts + the billing_operations row
 * + the ledger rows. Used by the ops "did this job retry-charge" surface.
 */
export async function investigateJobReplay(args: {
  executionHash?: string;
  registryId?:    string;
}): Promise<{
  registry:  Record<string, unknown> | null;
  billingOp: Record<string, unknown> | null;
  ledger:    Array<Record<string, unknown>>;
}> {
  let regQ = supabase.from('job_execution_registry').select('*');
  if (args.executionHash) regQ = regQ.eq('execution_hash', args.executionHash);
  else if (args.registryId) regQ = regQ.eq('id', args.registryId);
  else return { registry: null, billingOp: null, ledger: [] };
  const { data: reg, error: regErr } = await regQ.maybeSingle();
  // A forensic trace missing a piece would be presented as complete (2026-11-12).
  if (regErr) throw new Error(`[billingForensics] reg read failed: ${regErr.message}`);
  const registry = (reg as Record<string, unknown> | null) ?? null;
  if (!registry) return { registry: null, billingOp: null, ledger: [] };

  let billingOp: Record<string, unknown> | null = null;
  if (registry.billing_operation_id) {
    const { data: bo, error: boErr } = await supabase
      .from('billing_operations')
      .select('*')
      .eq('id', String(registry.billing_operation_id))
      .maybeSingle();
    // A forensic trace missing a piece would be presented as complete (2026-11-12).
    if (boErr) throw new Error(`[billingForensics] bo read failed: ${boErr.message}`);
    billingOp = (bo as Record<string, unknown> | null) ?? null;
  }

  let ledger: Array<Record<string, unknown>> = [];
  if (registry.idempotency_key) {
    const idem = String(registry.idempotency_key);
    const { data: l, error: lErr } = await supabase
      .from('credit_transactions')
      .select('*')
      .in('idempotency_key', [idem, `${idem}:hold`, `${idem}:confirm`, `${idem}:release`]);
    // A forensic trace missing a piece would be presented as complete (2026-11-12).
    if (lErr) throw new Error(`[billingForensics] l read failed: ${lErr.message}`);
    ledger = (l ?? []) as Array<Record<string, unknown>>;
  }
  return { registry, billingOp, ledger };
}
