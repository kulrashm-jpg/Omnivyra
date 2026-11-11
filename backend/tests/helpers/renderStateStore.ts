/**
 * A stateful in-memory render store for unit tests: ENFORCES the real UNIQUE keys of the render
 * substrate (20260669), billing_operations (20260663) and the queue table, so a collision is a
 * collision and a refusal is observable. Supports the PostgREST builder shapes the render code uses:
 * select (incl. { count, head }), eq / in / lt / order / limit, maybeSingle / single, awaited lists,
 * update(...).eq(...)[.select()], insert(...).select().single() and upsert. `faults['<table>.<op>']`
 * makes that statement return { data: null, error } (PostgREST never throws).
 */
export type Row = Record<string, any>;
export const NOW = '2026-11-11T12:00:00.000Z';

/** UNIQUE keys of the real schema (20260669 substrate + 20260663 billing + the queue table). */
export const UNIQUE: Record<string, string[][]> = {
  creator_render_job: [['organization_id', 'deterministic_input_hash']],
  creator_render_job_state: [['render_job_id']],
  creator_render_variant: [['render_job_id', 'spec_fingerprint']],
  creator_render_attempt: [['execution_hash'], ['variant_id', 'attempt_number']],
  billing_operations: [['idempotency_key']],
  creator_render_queue_job: [['render_job_id']],
};

export function makeStore() {
  const t: Record<string, Row[]> = {};
  const faults: Record<string, { code: string; message: string } | undefined> = {};
  let seq = 0;
  const rows = (name: string) => (t[name] ||= []);
  const violates = (name: string, rec: Row) => (UNIQUE[name] ?? []).some((cols) =>
    rows(name).some((r) => cols.every((c) => r[c] !== undefined && r[c] === rec[c])));

  function builder(name: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let head = false;
    let returning = false;
    let lim = Infinity;
    const match = () => rows(name).filter((r) => filters.every((f) => f(r)));
    const q: any = {
      select: (_c?: string, opts?: { head?: boolean }) => { if (mode === 'update') returning = true; head = Boolean(opts?.head); return q; },
      eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      lt: (k: string, v: any) => { filters.push((r) => r[k] != null && r[k] < v); return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      update: (p: Row) => { mode = 'update'; patch = p; return q; },
      maybeSingle: async () => {
        const res = await run();
        const d = (res as any).data;
        return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: (res as any).error ?? null };
      },
      single: async () => q.maybeSingle(),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject),
    };
    async function run() {
      if (mode === 'update') {
        const f = faults[`${name}.update`];
        if (f) return { data: null, error: f };
        const hit = match();
        for (const r of hit) Object.assign(r, patch);
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      const f = faults[`${name}.select`];
      if (f) return { data: null, error: f };
      const hit = match().slice(0, lim);
      if (head) return { count: hit.length, data: null, error: null };
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return q;
  }

  const insert = (name: string, row: Row) => {
    const f = faults[`${name}.insert`];
    const rec = { id: `${name}-${++seq}`, created_at: NOW, ...row };
    let result: { data: Row | null; error: any };
    if (f) result = { data: null, error: f };
    else if (violates(name, rec)) result = { data: null, error: { code: '23505', message: `duplicate key on ${name}` } };
    else { rows(name).push(rec); result = { data: { ...rec }, error: null }; }
    return { select: () => ({ single: async () => result, maybeSingle: async () => result }), then: (resolve: (v: unknown) => unknown) => resolve(result) };
  };
  const upsert = (name: string, row: Row) => {
    const f = faults[`${name}.upsert`];
    if (f) return Promise.resolve({ data: null, error: f });
    if (!violates(name, row)) rows(name).push({ ...row });
    return Promise.resolve({ data: null, error: null });
  };

  const supabase = { from: (n: string) => builder(n), rpc: async () => ({ data: {}, error: null }) };
  const ownedDbTable = (n: string) => ({
    ...builder(n),
    insert: (r: Row) => insert(n, Array.isArray(r) ? r[0] : r),
    upsert: (r: Row) => upsert(n, r),
    update: (p: Row) => builder(n).update(p),
  });
  return { t, rows, faults, supabase, ownedDbTable };
}
export type RenderStore = ReturnType<typeof makeStore>;


/**
 * e1's REAL image-credits helper (makeImageCredits) running over this store (05, 2026-11-12: a fake of
 * another track's contract must not be kinder than the real thing). Only its I/O is replaced:
 *  - billing_operations rows live in the store; closeOp is a compare-and-set on `fromStatuses` and
 *    reports the rows it moved, exactly like closeBillingOperation;
 *  - the credit ledger is a fake whose ANSWERS are injectable: `reserveAnswer`, `confirmAnswer`,
 *    `releaseAnswer` (e.g. 'released', 'insufficient_credits', or an unknown status), so the helper's
 *    own state machine meets every case it was written for, including the ones it once got wrong;
 *  - pricing: `prices` maps the lower-cased unit `${model}:${size}:${quality}` to credits; a missing
 *    unit is "pricing missing" -> not_priced, the production default until a Super Admin sets prices.
 * Faults: `faults['billing_operations.insert']` makes the ledger reserve throw (-> 'unavailable');
 * `faults['billing_operations.update']` makes closeOp error (-> 'unavailable').
 */
class TestPricingMissing extends Error {}
export function storeImageCredits(s: RenderStore, opts: {
  prices?: Record<string, number>;
  /** Shorthand for a reserve refusal: insufficient_credits | org_blocked | not_priced | key_spent. */
  refuse?: string;
  reserveAnswer?: string; confirmAnswer?: string; releaseAnswer?: string;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { makeImageCredits } = require('../../services/billing/imageCredits');
  const prices = opts.prices ?? { 'gpt-image-1.5:1024x1024:medium': 5, 'gpt-image-1.5:1024x1536:medium': 5, 'gpt-image-1.5:1536x1024:medium': 5 };
  const refuseAnswer: Record<string, string> = {
    insufficient_credits: 'insufficient_credits', org_blocked: 'org_control_blocked', key_spent: 'already_confirmed',
  };
  const reserveAnswer = opts.reserveAnswer ?? (opts.refuse ? refuseAnswer[opts.refuse] : undefined) ?? 'reserved';
  const ops = () => s.rows('billing_operations');
  const snake: Record<string, string> = {
    amountCharged: 'amount_charged', reservationTxnId: 'reservation_txn_id', confirmTxnId: 'confirm_txn_id',
    releaseTxnId: 'release_txn_id', failureReason: 'failure_reason',
  };
  const helper = makeImageCredits({
    timeoutMs: 2000,
    resolveFeatureActionKey: (a: string) => a,
    bounds: () => ({ min: 2, max: 12 }),
    price: async ({ unit }: { unit: string }) => {
      if (opts.refuse === 'not_priced' || prices[unit] === undefined) throw new TestPricingMissing(`no price for ${unit}`);
      return { credits: prices[unit]!, snapshot: { unit } };
    },
    isPricingMissing: (e: unknown) => e instanceof TestPricingMissing,
    findOpByKey: async (key: string) => ops().find((r) => r.idempotency_key === key) ?? null,
    findOpById: async (id: string) => ops().find((r) => r.id === id) ?? null,
    openOp: async (a: any) => {
      const existing = ops().find((r) => r.idempotency_key === a.idempotencyKey);
      if (existing) return existing.id;
      const row = {
        id: `ic-${ops().length + 1}`, organization_id: a.organizationId, idempotency_key: a.idempotencyKey,
        status: 'initiated', amount_estimated: a.amountEstimated, metadata: a.metadata,
      };
      ops().push(row);
      return row.id;
    },
    closeOp: async (id: string, patch: Record<string, unknown>, from: ReadonlyArray<string>) => {
      if (s.faults['billing_operations.update']) return { updated: null, error: 'fault' };
      const row = ops().find((r) => r.id === id && from.includes(r.status));
      if (!row) return { updated: 0, error: null };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[snake[k] ?? k] = v;
      return { updated: 1, error: null };
    },
    reserve: async (o: any) => {
      if (s.faults['billing_operations.insert']) throw new Error('ledger down');
      if (reserveAnswer !== 'reserved') return { status: reserveAnswer };
      return {
        status: 'reserved', orgId: o.orgId, userId: o.userId, action: o.action, referenceType: o.referenceType,
        referenceId: o.referenceId, idempotencyKey: o.idempotencyKey, holdTransactionId: `hold-${o.idempotencyKey}`,
        creditsReserved: o.amountOverride, split: { free: 0, incentive: 0, paid: o.amountOverride },
      };
    },
    confirm: async (h: any) => ({ status: opts.confirmAnswer ?? 'confirmed', creditsCharged: h.creditsReserved, confirmTransactionId: `confirm-${h.idempotencyKey}` }),
    release: async (h: any) => ({ status: opts.releaseAnswer ?? 'released', releaseTransactionId: `release-${h.idempotencyKey}` }),
  });
  const calls = { reserve: [] as any[], settle: [] as any[], release: [] as any[] };
  const port = {
    reserve: (i: any) => { calls.reserve.push(i); return helper.reserveImageCredits(i); },
    settle: (i: any) => { calls.settle.push(i.billingOperationId); return helper.settleImageCredits(i); },
    release: (i: any) => { calls.release.push(i.billingOperationId); return helper.releaseImageCredits(i); },
  };
  return { port, calls };
}
