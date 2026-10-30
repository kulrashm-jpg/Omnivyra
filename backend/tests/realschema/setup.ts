/**
 * W6 — real-schema test harness.
 *
 * Every test in this project runs against a live PostgreSQL database built by
 * scripts/ci/real-schema-ci.sh. There are no mocks here; that is the whole
 * point. If W6_DB_URL is absent the suite fails loudly rather than silently
 * degrading to something that proves nothing.
 */
import { Client } from 'pg';

const url = process.env.W6_DB_URL;
if (!url) {
  throw new Error(
    'W6_DB_URL is not set. The real-schema suite requires a live database; '
    + 'run it via scripts/ci/real-schema-ci.sh.',
  );
}

/** Refuse to run against anything that looks like a managed/production host. */
const FORBIDDEN = /supabase\.(co|com)|amazonaws\.com|railway|neon\.tech|render\.com/i;
if (FORBIDDEN.test(url)) {
  throw new Error(`W6_DB_URL points at a managed host; the real-schema suite is for disposable databases only: ${url.replace(/:[^:@]+@/, ':***@')}`);
}

export const db = new Client({ connectionString: url });

let connected = false;

beforeAll(async () => {
  if (!connected) { await db.connect(); connected = true; }
});

afterAll(async () => {
  if (connected) { await db.end(); connected = false; }
});

/** Deterministic synthetic tenants. Never production identifiers. */
export const ORG_A = '00000000-0000-4000-8000-00000000000a';
export const ORG_B = '00000000-0000-4000-8000-00000000000b';

/**
 * Run a body inside a transaction that is always rolled back. Every test in
 * this suite mutates through this, so the database is identical afterwards and
 * tests cannot leak into one another.
 */
export async function inRollback<T>(body: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    return await body();
  } finally {
    await db.query('ROLLBACK');
  }
}

/** Attempt a statement; return 'ok' or the SQLSTATE it raised. */
export async function attempt(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT s');
  try {
    await db.query(sql, params);
    await db.query('ROLLBACK TO SAVEPOINT s');
    return 'ok';
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    return err.code ?? 'unknown';
  }
}

/**
 * Perform a statement FOR ITS EFFECT, keeping it; return 'ok' or the SQLSTATE.
 *
 * `attempt()` above is a PROBE: it rolls back to its savepoint on both the
 * success and the failure path, so the database is unchanged whether the
 * statement was accepted or refused. That is exactly right for "would this row
 * be admitted", and exactly wrong for "it was admitted — now observe what it
 * did". A DELETE run through `attempt()` reports 'ok' and then un-deletes
 * itself, so any CASCADE assertion made afterwards reads the pre-delete state
 * and can never pass.
 *
 * Use this one when the statement's EFFECT is the thing under test. The failure
 * path still rolls back, because a failed statement aborts the transaction and
 * the savepoint is what makes it usable again. The enclosing `inRollback()`
 * discards the effect at the end of the test either way.
 */
export async function effect(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT e');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT e');
    return 'ok';
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT e');
    return err.code ?? 'unknown';
  }
}

/** Seed the two synthetic tenants. Caller must already be inside inRollback(). */
export async function seedTenants(): Promise<void> {
  for (const [id, name] of [[ORG_A, 'W6 Tenant A'], [ORG_B, 'W6 Tenant B']]) {
    await db.query(
      `INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
  }
}

export async function newPerson(org: string): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [org],
  );
  return rows[0].id;
}

export async function newAccount(
  org: string, opts: { domain?: string | null; source?: string | null; ref?: string | null } = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_accounts (organization_id, domain_normalized, source, source_reference)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [org, opts.domain ?? null, opts.source ?? 'w6', opts.ref ?? null],
  );
  return rows[0].id;
}

/** Definition of a constraint, or null when it does not exist. */
export async function constraintDef(name: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = $1`, [name],
  );
  return rows.length ? rows[0].d : null;
}

/**
 * A canonical prospect (`canonical_leads`) with its required parents.
 *
 * PI LISTS-001 (WS-2D P-2). `prospect_list_members` references
 * `canonical_leads (id, company_id)`, and that table cannot be inserted into on
 * its own: `canonical_leads_user_fk` is a COMPOSITE key onto
 * `canonical_users (id, company_id)`, so a `canonical_users` row must exist in
 * the same tenant first. `source` carries a non-blank CHECK.
 *
 * NOTE the tenant column: `canonical_leads` and `canonical_users` key their
 * tenant as `company_id`, not `organization_id`. Both are `companies.id`.
 *
 * `unified_person_id` is left NULL by default. It is NOT required, and leaving
 * it unset keeps the default fixture honest about the fact — established in
 * WS-2B — that a `canonical_leads` row and the person spine are joined by a
 * nullable `ON DELETE SET NULL` edge rather than by identity.
 */
export async function newLead(
  org: string,
  opts: { source?: string; personId?: string | null } = {},
): Promise<string> {
  const { rows: userRows } = await db.query(
    `INSERT INTO public.canonical_users (company_id, user_type, device)
     VALUES ($1, 'known', 'unknown') RETURNING id`,
    [org],
  );
  const userId: string = userRows[0].id;

  const { rows } = await db.query(
    `INSERT INTO public.canonical_leads (company_id, user_id, source, unified_person_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [org, userId, opts.source ?? 'w6-lists', opts.personId ?? null],
  );
  return rows[0].id;
}

/** Columns of a unique index, in order, or null when the index is absent. */
export async function uniqueIndexColumns(name: string): Promise<string[] | null> {
  const { rows } = await db.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [name],
  );
  if (!rows.length) return null;
  const def: string = rows[0].indexdef;
  if (!/CREATE UNIQUE INDEX/.test(def)) return null;
  const m = def.match(/\(([^)]*)\)/);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
}
