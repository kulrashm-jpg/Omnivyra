/**
 * CLASS-2 B7 / B8 / B9 on REAL PostgreSQL (migrations 20270217000006 + 20270217000007), with
 * INDEPENDENT CONNECTIONS. e9 rule 2026-11-12: sandbox-only evidence does not close a unit.
 *
 *   B8  whatsapp_templates_one_active (partial UNIQUE, NULLS NOT DISTINCT) + whatsapp_apply_template_status:
 *       at most ONE active version per (company, template name). Two APPROVED events for two versions,
 *       racing, end with exactly one active. A direct second activation waits on the first's index
 *       entry and fails 23505. CONTROL: index dropped -> both activations commit, two active versions
 *       (every template broadcast for the name then fails).
 *   B9  status events apply in EVENT order: an older event is 'stale'; at an equal time the more
 *       restrictive status wins.
 *   B7  whatsapp_templates_version_unique: the same version inserted twice (a double-clicked submit)
 *       - the second waits, then fails 23505; CONTROL with the index dropped -> both commit.
 *
 * Note: the production-derived baseline has NO unique on (company, template_name, version) - the
 * database/whatsapp_system.sql UNIQUE never reached prod - which is why 07 exists.
 * Each arrangement is asserted before the subject. COMMITS its rows (two connections): committing pass.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db, seedTenants, ORG_B } from './setup';

const ORG = ORG_B;
const MIG = (v: string) => fs.readFileSync(path.resolve(__dirname, `../../../supabase/migrations/${v}`), 'utf8');
function stmt(file: string, startsWith: string): string {
  const s = MIG(file);
  const start = s.indexOf(startsWith);
  const end = s.indexOf(';', start);
  if (start < 0 || end < 0) throw new Error(`${startsWith} not found in ${file}`);
  return s.slice(start, end + 1);
}
const ACTIVE_INDEX = () => stmt('20270217000006_whatsapp_templates_active_unique.sql', 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_one_active');
const VERSION_INDEX = () => stmt('20270217000007_whatsapp_templates_version_unique.sql', 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_version_unique');

let c1: Client;
let c2: Client;
let pid2: number;
const names: string[] = [];
const newName = () => { const n = `b8-${randomUUID().slice(0, 8)}`; names.push(n); return n; };

async function tpl(c: Client | typeof db, name: string, version: number, over: { active?: boolean; status?: string; company?: string | null } = {}): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO public.whatsapp_templates (company_id, template_name, template_category, status, version, is_active)
     VALUES ($1, $2, 'MARKETING', $3, $4, $5) RETURNING id`,
    [over.company === undefined ? ORG : over.company, name, over.status ?? 'PENDING', version, over.active ?? false]);
  return rows[0].id;
}
async function apply(c: Client | typeof db, id: string, event: string, at: string): Promise<string> {
  const { rows } = await c.query(`SELECT public.whatsapp_apply_template_status($1, $2, $3::timestamptz, NULL) AS r`, [id, event, at]);
  return rows[0].r;
}
async function activeVersions(name: string): Promise<number[]> {
  const { rows } = await db.query(`SELECT version FROM public.whatsapp_templates WHERE template_name = $1 AND is_active ORDER BY version`, [name]);
  return rows.map((r) => r.version);
}
async function state(id: string): Promise<string> {
  const { rows } = await db.query(`SELECT status || '/' || is_active AS s FROM public.whatsapp_templates WHERE id = $1`, [id]);
  return rows[0].s;
}
async function sqlstate(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e: any) { return String(e?.code ?? 'error'); }
}
async function c2Waits(): Promise<boolean> {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
    if (rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
const present = async (idx: string) => (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${idx}`])).rows[0].ok as boolean;

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await db.query('COMMIT');
  c1 = new Client({ connectionString: process.env.W6_DB_URL });
  c2 = new Client({ connectionString: process.env.W6_DB_URL });
  await c1.connect();
  await c2.connect();
  pid2 = Number((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
});
// Cleanup on OUR connection: setup.ts closes the shared `db` first.
afterAll(async () => {
  await c1?.query('ROLLBACK').catch(() => undefined);
  await c2?.query('ROLLBACK').catch(() => undefined);
  if (c1) {
    if (names.length) await c1.query(`DELETE FROM public.whatsapp_templates WHERE template_name = ANY($1::text[])`, [names]);
    for (const [idx, sql] of [['whatsapp_templates_one_active', ACTIVE_INDEX()], ['whatsapp_templates_version_unique', VERSION_INDEX()]]) {
      const { rows } = await c1.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${idx}`]);
      if (!rows[0].ok) await c1.query(sql); // a failed control must not leave an index dropped
    }
  }
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
});

describe('B8 one active version', () => {
  it('approve v1, then v2 -> exactly ONE active (v2); v1 deprecated', async () => {
    const n = newName();
    const v1 = await tpl(db, n, 1); const v2 = await tpl(db, n, 2);
    expect(await apply(db, v1, 'APPROVED', '2026-11-12T10:00:00Z')).toBe('applied');
    expect(await apply(db, v2, 'APPROVED', '2026-11-12T10:05:00Z')).toBe('applied');
    expect(await activeVersions(n)).toEqual([2]);
    expect(await state(v1)).toBe('DEPRECATED/false');
  });

  it('TWO CONNECTIONS approve two versions at once: the second WAITS, then applies - exactly one active', async () => {
    const n = newName();
    const v1 = await tpl(db, n, 1); const v2 = await tpl(db, n, 2);
    await c1.query('BEGIN');
    expect(await apply(c1, v1, 'APPROVED', '2026-11-12T10:00:00Z')).toBe('applied');
    const second = apply(c2, v2, 'APPROVED', '2026-11-12T10:00:01Z');
    expect(await c2Waits()).toBe(true);
    await c1.query('COMMIT');
    expect(await second).toBe('applied');
    expect(await activeVersions(n)).toEqual([2]);
  });

  it('a direct second activation (another writer): connection 2 WAITS, then fails 23505', async () => {
    const n = newName();
    const v1 = await tpl(db, n, 1); const v2 = await tpl(db, n, 2);
    await c1.query('BEGIN');
    await c1.query(`UPDATE public.whatsapp_templates SET is_active = true WHERE id = $1`, [v1]);
    const second = sqlstate(c2.query(`UPDATE public.whatsapp_templates SET is_active = true WHERE id = $1`, [v2]));
    expect(await c2Waits()).toBe(true);
    await c1.query('COMMIT');
    expect(await second).toBe('23505');
    expect(await activeVersions(n)).toEqual([1]);
  });

  it('CONTROL - whatsapp_templates_one_active DROPPED: both activations commit, TWO active versions', async () => {
    const n = newName();
    const v1 = await tpl(db, n, 1); const v2 = await tpl(db, n, 2);
    await db.query('DROP INDEX public.whatsapp_templates_one_active');
    try {
      expect(await present('whatsapp_templates_one_active')).toBe(false); // arrangement
      await c1.query('BEGIN');
      await c1.query(`UPDATE public.whatsapp_templates SET is_active = true WHERE id = $1`, [v1]);
      expect(await sqlstate(c2.query(`UPDATE public.whatsapp_templates SET is_active = true WHERE id = $1`, [v2]))).toBe('ok');
      await c1.query('COMMIT');
      expect(await activeVersions(n)).toEqual([1, 2]);
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await db.query(`UPDATE public.whatsapp_templates SET is_active = false WHERE template_name = $1`, [n]);
      await db.query(ACTIVE_INDEX());
    }
    expect(await present('whatsapp_templates_one_active')).toBe(true);
  });

  it('a NULL company does not escape: two active NULL-company rows refused', async () => {
    const n = newName();
    await tpl(db, n, 1, { company: null, active: true, status: 'APPROVED' });
    expect(await sqlstate(tpl(db, n, 2, { company: null, active: true, status: 'APPROVED' }))).toBe('23505');
  });
});

describe('B9 event order', () => {
  it('PAUSED at 10:10, then a LATE APPROVED stamped 10:07 -> stale; stays paused; a later APPROVED applies', async () => {
    const n = newName();
    const v = await tpl(db, n, 1);
    expect(await apply(db, v, 'PAUSED', '2026-11-12T10:10:00Z')).toBe('applied');
    expect(await apply(db, v, 'APPROVED', '2026-11-12T10:07:00Z')).toBe('stale');
    expect(await state(v)).toBe('PAUSED/false');
    expect(await apply(db, v, 'APPROVED', '2026-11-12T10:20:00Z')).toBe('applied');
    expect(await state(v)).toBe('APPROVED/true');
  });

  it('equal time: the MORE RESTRICTIVE wins (REJECTED beats APPROVED); a duplicate re-applies', async () => {
    const n = newName();
    const a = await tpl(db, n, 1);
    const T = '2026-11-12T11:00:00Z';
    expect(await apply(db, a, 'REJECTED', T)).toBe('applied');
    expect(await apply(db, a, 'APPROVED', T)).toBe('stale');
    expect(await state(a)).toBe('REJECTED/false');
    expect(await apply(db, a, 'REJECTED', T)).toBe('applied');
    expect(await apply(db, a, 'DISABLED', T)).toBe('applied');
    expect(await apply(db, a, 'REJECTED', T)).toBe('stale');
    expect(await state(a)).toBe('DISABLED/false');
  });

  it('an unknown template -> not_found; an invalid event raises', async () => {
    expect(await apply(db, randomUUID(), 'APPROVED', '2026-11-12T10:00:00Z')).toBe('not_found');
    const v = await tpl(db, newName(), 1);
    expect(await sqlstate(apply(db, v, 'DELETED', '2026-11-12T10:00:00Z'))).toBe('22023');
  });
});

describe('B7 one row per version', () => {
  it('the same version twice -> 23505; TWO CONNECTIONS: the second waits, then 23505', async () => {
    const n = newName();
    await tpl(db, n, 1);
    expect(await sqlstate(tpl(db, n, 1))).toBe('23505');
    await c1.query('BEGIN');
    await tpl(c1, n, 2);
    const second = sqlstate(tpl(c2, n, 2));
    expect(await c2Waits()).toBe(true);
    await c1.query('COMMIT');
    expect(await second).toBe('23505');
  });

  it('CONTROL - whatsapp_templates_version_unique DROPPED: both inserts of one version commit', async () => {
    const n = newName();
    await db.query('DROP INDEX public.whatsapp_templates_version_unique');
    try {
      expect(await present('whatsapp_templates_version_unique')).toBe(false); // arrangement
      await tpl(db, n, 1);
      expect(await sqlstate(tpl(db, n, 1))).toBe('ok');
      const { rows } = await db.query(`SELECT count(*)::int AS c FROM public.whatsapp_templates WHERE template_name = $1 AND version = 1`, [n]);
      expect(rows[0].c).toBe(2);
    } finally {
      await db.query(`DELETE FROM public.whatsapp_templates WHERE template_name = $1`, [n]);
      await db.query(VERSION_INDEX());
    }
    expect(await present('whatsapp_templates_version_unique')).toBe(true);
  });
});
