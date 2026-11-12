/**
 * 20270217000027_creator_render_output_company_id.sql: REAL-POSTGRES proof.
 * creator_render_output.company_id is NOT NULL, FK -> companies ON DELETE RESTRICT, and a guard trigger derives it
 * from the output's lineage (attempt -> variant -> creator_render_job.organization_id) and refuses any value that
 * disagrees. creator_render_output is an append-only ledger, so the migration refuses to apply over existing rows.
 *
 * Every case runs in a ROLLED-BACK transaction (non-committing). Ids are fresh per run.
 *
 *     npm run test:realschema -- creator_render_output_company_id
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000027_creator_render_output_company_id.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'creator_render_output_company_id_rollback.sql');

function unwrapped(file: string): string {
  const lines = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

async function rolledBack<T>(body: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    return await body(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

async function attemptIn(c: Client, sql: string, params: unknown[] = []): Promise<{ ok: boolean; code?: string; message?: string; rows?: any[] }> {
  await c.query('SAVEPOINT a');
  try {
    const r = await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT a');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: err.message };
  }
}

/** A company with one full render lineage (job -> variant -> attempt); returns the ids. */
async function lineage(c: Client, companyId?: string) {
  const co = companyId ?? randomUUID();
  if (!companyId) await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'cro-027')`, [co]);
  const provider = (await c.query(`SELECT provider_key FROM public.creator_render_provider LIMIT 1`)).rows[0]?.provider_key as string;
  if (!provider) throw new Error('no creator_render_provider seeded in this database');
  const job = randomUUID(), variant = randomUUID(), attempt = randomUUID();
  await c.query(
    `INSERT INTO public.creator_render_job (id, task_id, card_id, organization_id, canonical_asset_family, render_modality, deterministic_input_hash, render_spec_snapshot)
     VALUES ($1, $2, $2, $3, 'image', 'image', $2, '{}'::jsonb)`, [job, `t-${job}`, co]);
  await c.query(
    `INSERT INTO public.creator_render_variant (id, render_job_id, platform, aspect_ratio, resolution, spec_fingerprint)
     VALUES ($1, $2, 'linkedin', '1:1', '{}'::jsonb, $3)`, [variant, job, `f-${variant}`]);
  await c.query(
    `INSERT INTO public.creator_render_attempt (id, variant_id, provider_key, attempt_number, idempotency_key, execution_hash)
     VALUES ($1, $2, $3, 1, $4, $4)`, [attempt, variant, provider, `k-${attempt}`]);
  return { co, attempt };
}
const insertOutput = (c: Client, attempt: string, company: string | null = null) =>
  attemptIn(c, `INSERT INTO public.creator_render_output (attempt_id, storage_ref, content_sha256, modality, company_id)
                VALUES ($1, $2, $2, 'image', $3) RETURNING company_id`, [attempt, `s-${randomUUID()}`, company]);

describe('catalog state', () => {
  it('company_id is NOT NULL with exactly one FK -> companies(id) ON DELETE RESTRICT', async () => {
    const nn = (await db.query(`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass AND attname = 'company_id' AND NOT attisdropped`)).rows[0];
    expect(nn).toEqual({ attnotnull: true });
    const fks = (await db.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.creator_render_output'::regclass AND contype = 'f' AND confrelid = 'public.companies'::regclass`)).rows;
    expect(fks).toEqual([{ confdeltype: 'r' }]);
  });
  it('the guard is SECURITY INVOKER, search_path empty, not executable by anon/authenticated', async () => {
    const r = (await db.query(`SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth FROM pg_proc WHERE oid = 'public.creator_render_output_company_id_guard()'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, auth: false });
  });
});

describe('the guard trigger', () => {
  it('an output gets its lineage company', () => rolledBack(async (c) => {
    const { co, attempt } = await lineage(c);
    expect(await insertOutput(c, attempt)).toMatchObject({ ok: true, rows: [{ company_id: co }] });
  }));
  it("CRITICAL: an output naming ANOTHER company than its lineage is refused (23514)", () => rolledBack(async (c) => {
    const { attempt } = await lineage(c);
    const other = randomUUID();
    await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'cro-027-other')`, [other]);
    expect(await insertOutput(c, attempt, other)).toMatchObject({ ok: false, code: '23514' });
  }));
});

describe('the migration itself', () => {
  it('HEAD CONTROL: without 027 an output is stored with NO company (the case above derives it); re-applying over such a ledger row is refused', () => rolledBack(async (c) => {
    // Ledger rows cannot be updated or deleted, so after the rollback an output written without a company stays
    // company-less, and 027 refuses to re-apply over it (documented in both files).
    await c.query(unwrapped(ROLLBACK_FILE));
    const { attempt } = await lineage(c);
    const without = await attemptIn(c, `INSERT INTO public.creator_render_output (attempt_id, storage_ref, content_sha256, modality)
                                        VALUES ($1, 's', 's', 'image') RETURNING id`, [attempt]);
    expect(without.ok).toBe(true);
    const reapply = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(reapply).toMatchObject({ ok: false });
    expect(reapply.message).toMatch(/append-only ledger/);
  }));
  it('re-applies cleanly on the applied state (idempotent)', () => rolledBack(async (c) => {
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
  }));
  it('PROVENANCE: a company_id column 027 did not create is refused by the apply AND by the rollback', () => rolledBack(async (c) => {
    const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
    if (!rb.ok) throw new Error(rb.message);
    await c.query('ALTER TABLE public.creator_render_output ADD COLUMN company_id uuid');
    const apply = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(apply).toMatchObject({ ok: false });
    expect(apply.message).toMatch(/refusing to adopt it|append-only ledger/);
    const again = await attemptIn(c, unwrapped(ROLLBACK_FILE));
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/refusing to drop it/);
  }));
});
