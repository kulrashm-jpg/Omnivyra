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
 * A store-backed fake of e1's image-credits helper (backend/services/billing/imageCredits), with its
 * agreed semantics. It OWNS one billing_operations row per idempotency key:
 *  - reserve: same key while held -> the same row; a refused key leaves nothing held; a settled or
 *    released key -> key_spent. `prices` maps `${model}:${size}:${quality}` to credits; an unpriced
 *    SKU -> not_priced, the production default until pricing exists.
 *  - settle / release: move exactly the one held row (by id); release is idempotent and never
 *    un-confirms.
 * Faults: `faults['billing_operations.insert']` -> reserve 'unavailable';
 * `faults['billing_operations.update']` -> settle / release 'unavailable'.
 */
export function storeImageCredits(s: RenderStore, opts: { prices?: Record<string, number>; refuse?: string } = {}) {
  const prices = opts.prices ?? { 'gpt-image-1.5:1024x1024:medium': 5, 'gpt-image-1.5:1024x1536:medium': 5, 'gpt-image-1.5:1536x1024:medium': 5 };
  const calls = { reserve: [] as any[], settle: [] as any[], release: [] as any[] };
  let seq = 0;
  const port = {
    reserve: async (input: any) => {
      calls.reserve.push(input);
      if (opts.refuse) return { ok: false, reason: opts.refuse };
      if (s.faults['billing_operations.insert']) return { ok: false, reason: 'unavailable', detail: 'fault' };
      const unit = `${input.model}:${input.size}:${input.quality}`;
      const price = prices[unit];
      const existing = s.rows('billing_operations').find((r) => r.idempotency_key === input.idempotencyKey);
      if (existing && existing.status === 'held') return { ok: true, billingOperationId: existing.id, creditsReserved: existing.amount_estimated };
      if (existing && (existing.status === 'confirmed' || existing.status === 'released')) return { ok: false, reason: 'key_spent' };
      if (price === undefined) return { ok: false, reason: 'not_priced' };
      const row = {
        id: `ic-${++seq}`, idempotency_key: input.idempotencyKey, organization_id: input.organizationId,
        status: 'held', amount_estimated: price, metadata: { helper: 'image_credits_v1', unit, ...(input.metadata ?? {}) },
      };
      s.rows('billing_operations').push(row);
      return { ok: true, billingOperationId: row.id, creditsReserved: price };
    },
    settle: async ({ billingOperationId }: any) => {
      calls.settle.push(billingOperationId);
      if (s.faults['billing_operations.update']) return { ok: false, reason: 'unavailable', detail: 'fault' };
      const row = s.rows('billing_operations').find((r) => r.id === billingOperationId);
      if (!row || row.status !== 'held') return { ok: false, reason: 'not_held' };
      row.status = 'confirmed'; row.amount_charged = row.amount_estimated;
      return { ok: true, creditsCharged: row.amount_charged };
    },
    release: async ({ billingOperationId }: any) => {
      calls.release.push(billingOperationId);
      if (s.faults['billing_operations.update']) return { ok: false, reason: 'unavailable', detail: 'fault' };
      const row = s.rows('billing_operations').find((r) => r.id === billingOperationId);
      if (!row) return { ok: false, reason: 'not_held' };
      if (row.status === 'released') return { ok: true };
      if (row.status !== 'held') return { ok: false, reason: 'not_held' };
      row.status = 'released';
      return { ok: true };
    },
  };
  return { port, calls };
}
