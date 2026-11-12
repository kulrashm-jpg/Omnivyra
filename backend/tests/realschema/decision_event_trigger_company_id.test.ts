/**
 * decision_event_trigger_company_id — REAL-POSTGRES proof (e9, 2026-11-12; found by 05, MIG-2R).
 *
 * In prod, 20260430 applied only in part: decision_events.company_id is NOT NULL, but
 * public.omnivyra_log_decision_event() kept the 20260411 body, which omits company_id. The AFTER
 * trigger on decision_objects then raises 23502 and aborts every decision_objects write.
 *
 * This suite runs on the replayed schema WITH the new migration installed:
 *   - CONTROL: inside a rolled-back transaction, the 20260411 body (read from its migration file)
 *     is installed and a decision_objects insert raises 23502. That reproduces prod.
 *   - FIX: an insert writes a `created` decision_events row with the decision's
 *     company_id; resolve and reopen write their events with it too.
 *   - CATALOG: SECURITY INVOKER, proconfig exactly {search_path=pg_catalog, public} (what
 *     20270111000003 expects), no EXECUTE for anon/authenticated.
 * decision_objects refuses DELETE (a guard trigger), so every write here is ROLLED BACK.
 * The writes run as the connection's OWN role, not service_role (CI-99): this suite tests the
 * TRIGGER's behaviour, not grants. The replayed baseline carries no grants and 20270111000003 revokes
 * PUBLIC, so service_role there is denied (42501) on tables and functions the trigger path touches,
 * a state that says nothing about the trigger. Grants are asserted in the CATALOG case above and in
 * the migration's own $verify$.
 *
 *     npm run test:realschema -- decision_event_trigger_company_id
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const CO = '0de0e000-0000-4000-8000-0000000000c1';
const FN = 'public.omnivyra_log_decision_event()';
const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');

/** The 20260411 function body (the defect), read from its migration, not copied. */
function body0411(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS, '20260411_decision_intelligence_stabilization.sql'), 'utf8');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION omnivyra_log_decision_event()');
  if (start < 0) throw new Error('20260411 omnivyra_log_decision_event body not found');
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end + 3).replace('CREATE OR REPLACE FUNCTION omnivyra_log_decision_event()', `CREATE OR REPLACE FUNCTION ${FN}`);
}

const INSERT_DECISION = `
  INSERT INTO public.decision_objects
    (company_id, entity_type, entity_id, issue_type, title, description,
     impact_traffic, impact_conversion, impact_revenue, confidence_score,
     recommendation, action_type, report_tier, source_service, last_changed_by)
  VALUES ($1, 'global', NULL, 'dec_evt_test', 'title', 'description',
          10, 10, 10, 0.5, 'recommendation', 'improve_content', 'snapshot', 'dec_evt_test', 'user')
  RETURNING id`;

/** One rolled-back transaction as `role`; returns what `body` returned, or the error. */
async function inRolledBackTx<T>(role: string | null, body: (c: Client) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    try {
      return { ok: true, value: await body(c) };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code ?? '?', message: err.message ?? '' };
    }
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

beforeAll(async () => {
  const fn = (await db.query(`SELECT to_regprocedure($1) AS f`, [FN])).rows[0];
  if (!fn?.f) throw new Error(`${FN} is not installed in this database`);
  // No GRANT here: the cases run as the connection's own role (see the header), and a GRANT would
  // change privileges in the shared CI database for every other suite.
  await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'dec-evt tenant') ON CONFLICT (id) DO NOTHING`, [CO]);
  await db.query(`INSERT INTO public.action_registry (action_type, handler_key, required_payload_fields, is_active)
                  VALUES ('improve_content', 'ContentService.generate', ARRAY[]::text[], TRUE)
                  ON CONFLICT (action_type) DO NOTHING`);
});

describe('catalog', () => {
  it('INVOKER, proconfig exactly {search_path=pg_catalog, public}, no client EXECUTE', async () => {
    const r = (await db.query(
      `SELECT prosecdef, proconfig, proacl IS NULL AS default_acl,
              has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x
         FROM pg_proc WHERE oid = $1::regprocedure`, [FN])).rows[0];
    expect(r.prosecdef).toBe(false);
    expect(r.proconfig).toEqual(['search_path=pg_catalog, public']);
    expect(r.default_acl).toBe(false);
    expect(r.anon_x).toBe(false);
    expect(r.auth_x).toBe(false);
  });

  it('the AFTER INSERT OR UPDATE trigger still calls it', async () => {
    const r = (await db.query(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgrelid = 'public.decision_objects'::regclass
          AND tgname = 'trg_decision_objects_log_events' AND tgfoid = $1::regprocedure`, [FN])).rows[0];
    expect(r.n).toBe(1);
  });
});

describe('CONTROL: the 20260411 body (prod today) aborts every decision write', () => {
  it('a decision_objects insert raises 23502 on decision_events.company_id', async () => {
    const out = await inRolledBackTx(null, async (c) => {
      await c.query(body0411());
      return c.query(INSERT_DECISION, [CO]);
    });
    expect(out.ok).toBe(false);
    // Explicit narrowing: the backend-tests compiler settings do not narrow `!out.ok` on this union.
    const failure = out as { ok: false; code: string; message: string };
    expect(failure.code).toBe('23502');
    expect(failure.message).toMatch(/company_id/);
  });
});

describe('FIX: decision writes succeed and every event carries company_id', () => {
  it('insert writes a `created` event with the decision company_id', async () => {
    const out = await inRolledBackTx(null, async (c) => {
      const id = (await c.query(INSERT_DECISION, [CO])).rows[0].id;
      return (await c.query(`SELECT event_type, company_id, changed_by FROM public.decision_events WHERE decision_id = $1`, [id])).rows;
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toEqual([{ event_type: 'created', company_id: CO, changed_by: 'user' }]);
    }
  });

  it('resolve and reopen write `resolved` and `reopened` events with company_id', async () => {
    const out = await inRolledBackTx(null, async (c) => {
      const id = (await c.query(INSERT_DECISION, [CO])).rows[0].id;
      await c.query(`UPDATE public.decision_objects SET status = 'resolved', resolved_at = now() WHERE id = $1`, [id]);
      await c.query(`UPDATE public.decision_objects SET status = 'open', resolved_at = NULL WHERE id = $1`, [id]);
      return (await c.query(`SELECT event_type, company_id FROM public.decision_events WHERE decision_id = $1`, [id])).rows;
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.map((r: { event_type: string }) => r.event_type).sort()).toEqual(['created', 'reopened', 'resolved']);
      expect(out.value.every((r: { company_id: string }) => r.company_id === CO)).toBe(true);
    }
  });
});

// ── The migration itself, on the replayed schema (05/e9 rule: sandbox-only evidence does not close a
// unit; every sandbox case lives here too). Each case runs the migration's OWN SQL, read from its file
// with the file's BEGIN/COMMIT removed, inside a rolled-back transaction, so nothing leaks into the
// shared CI database. A savepoint captures an expected refusal without aborting the transaction.
const MIGRATION_FILE = '20270217000019_decision_event_trigger_company_id.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'decision_event_trigger_company_id_rollback.sql');
const OWN_BODY_MD5 = '91053ed21f92b1fab46db0cdc09d7ecb';
const PROD_CRLF_MD5 = '64faad0ef8a81658661c1dbef94e5ddf';
const FN_SIG = 'public.omnivyra_log_decision_event()';

/** The file's statements without its own transaction control (the test owns the transaction). */
function unwrapped(file: string): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  const lines = sql.split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

type Attempt = { ok: true } | { ok: false; code: string; message: string };

/** Runs sql; on failure rolls back to a savepoint and returns the error (the transaction stays usable). */
async function attemptSql(c: Client, sql: string): Promise<Attempt> {
  await c.query('SAVEPOINT attempt');
  try {
    await c.query(sql);
    await c.query('RELEASE SAVEPOINT attempt');
    return { ok: true };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT attempt');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? '?', message: err.message ?? '' };
  }
}

const messageOf = (a: Attempt): string => (a as { message?: string }).message ?? '';

const fnState = async (c: Client) => (await c.query(
  `SELECT md5(prosrc) AS md5, prosrc,
          has_function_privilege('service_role', oid, 'EXECUTE') AS sr,
          has_function_privilege('anon', oid, 'EXECUTE') AS anon
     FROM pg_proc WHERE oid = $1::regprocedure`, [FN])).rows[0] as { md5: string; prosrc: string; sr: boolean; anon: boolean };

/** Expects a rolled-back tx body to have succeeded and returns its value. */
function value<T>(out: { ok: true; value: T } | { ok: false; code: string; message: string }): T {
  if (!out.ok) throw new Error(`transaction failed: ${(out as { code: string }).code} ${(out as { message: string }).message}`);
  return (out as { value: T }).value;
}

const UNKNOWN_BODY_MARK = 'created_by_someone_else';

describe('the migration: re-run, accepted bodies, refusals', () => {
  it('RE-RUN on the applied state is a clean no-op (its own body is accepted)', async () => {
    const v = value(await inRolledBackTx(null, async (c) => ({ r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) })));
    expect(v.r).toEqual({ ok: true });
    expect(v.s.md5).toBe(OWN_BODY_MD5);
  });

  it('accepts the 20260411 body in LF (the baseline) and replaces it', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(body0411());
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.r).toEqual({ ok: true });
    expect(v.s.md5).toBe(OWN_BODY_MD5);
  });

  it('accepts the 20260411 body in CRLF (PROD, md5 64faad0e...) and replaces it', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(body0411().split('\n').join('\r\n'));
      const before = await fnState(c);
      return { before, r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.before.md5).toBe(PROD_CRLF_MD5);
    expect(v.r).toEqual({ ok: true });
    expect(v.s.md5).toBe(OWN_BODY_MD5);
  });

  it('REFUSES an unknown body and leaves it in place', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(body0411().replace(`'created'`, `'${UNKNOWN_BODY_MARK}'`));
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.r.ok).toBe(false);
    expect(messageOf(v.r)).toMatch(/unexpected body/);
    expect(v.s.prosrc).toContain(UNKNOWN_BODY_MARK);
  });

  it('REFUSES when decision_events.company_id is nullable (the 20260430 DDL half missing)', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query('ALTER TABLE public.decision_events ALTER COLUMN company_id DROP NOT NULL');
      await c.query(body0411());
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(messageOf(v.r)).toMatch(/decision_events\.company_id must exist and be NOT NULL/);
    expect(v.s.prosrc).not.toContain('NEW.company_id');
  });

  it('REFUSES when the trigger is disabled', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query('ALTER TABLE public.decision_objects DISABLE TRIGGER trg_decision_objects_log_events');
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)) };
    }));
    expect(messageOf(v.r)).toMatch(/trg_decision_objects_log_events/);
  });
});

describe('the rollback, and re-applying after it', () => {
  it('rollback restores the defect (23502); re-applying fixes it again, company_id on the event', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      const rb = await attemptSql(c, unwrapped(ROLLBACK_FILE));
      await c.query('SAVEPOINT insert_attempt');
      let afterRollbackCode = 'none';
      try {
        await c.query(INSERT_DECISION, [CO]);
      } catch (e) {
        afterRollbackCode = (e as { code?: string }).code ?? '?';
      }
      await c.query('ROLLBACK TO SAVEPOINT insert_attempt');
      const reapply = await attemptSql(c, unwrapped(MIGRATION_FILE));
      const id = (await c.query(INSERT_DECISION, [CO])).rows[0].id;
      const ev = (await c.query('SELECT company_id FROM public.decision_events WHERE decision_id = $1', [id])).rows;
      return { rb, afterRollbackCode, reapply, ev, s: await fnState(c) };
    }));
    expect(v.rb).toEqual({ ok: true });
    expect(v.afterRollbackCode).toBe('23502');
    expect(v.reapply).toEqual({ ok: true });
    expect(v.ev).toEqual([{ company_id: CO }]);
    expect(v.s.md5).toBe(OWN_BODY_MD5);
  });
});

describe('search_path: a caller cannot redirect the event insert', () => {
  it('a decision insert under search_path = evil, public writes its event to public.decision_events', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query('CREATE SCHEMA dec_evt_evil');
      await c.query('CREATE TABLE dec_evt_evil.decision_events (LIKE public.decision_events)');
      await c.query('SET LOCAL search_path = dec_evt_evil, public');
      const id = (await c.query(INSERT_DECISION, [CO])).rows[0].id;
      const evil = (await c.query('SELECT count(*)::int AS n FROM dec_evt_evil.decision_events')).rows[0].n;
      const good = (await c.query('SELECT count(*)::int AS n FROM public.decision_events WHERE decision_id = $1', [id])).rows[0].n;
      return { evil, good };
    }));
    expect(v).toEqual({ evil: 0, good: 1 });
  });
});

describe('service_role EXECUTE is exactly as found (never lost, never gained)', () => {
  it('CI shape (no grant, PUBLIC revoked): applies and service_role stays without EXECUTE', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(`REVOKE ALL ON FUNCTION ${FN_SIG} FROM PUBLIC, service_role`);
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.r).toEqual({ ok: true });
    expect(v.s.sr).toBe(false);
  });

  it('PUBLIC-only shape (20270111000003 not run): service_role KEEPS EXECUTE, anon loses it', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(`REVOKE ALL ON FUNCTION ${FN_SIG} FROM service_role`);
      await c.query(`GRANT EXECUTE ON FUNCTION ${FN_SIG} TO PUBLIC`);
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.r).toEqual({ ok: true });
    expect(v.s.sr).toBe(true);
    expect(v.s.anon).toBe(false);
  });

  it('prod shape (explicit grant): applies and service_role keeps EXECUTE', async () => {
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${FN_SIG} TO service_role`);
      return { r: await attemptSql(c, unwrapped(MIGRATION_FILE)), s: await fnState(c) };
    }));
    expect(v.r).toEqual({ ok: true });
    expect(v.s.sr).toBe(true);
  });

  it('CONTROL: a variant that strips service_role before the verify block is refused', async () => {
    const base = unwrapped(MIGRATION_FILE);
    const marker = 'DO $' + 'verify$';
    const sabotage = base.split(marker).join(`REVOKE ALL ON FUNCTION ${FN_SIG} FROM service_role;\n${marker}`);
    const v = value(await inRolledBackTx(null, async (c) => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${FN_SIG} TO service_role`);
      return { r: await attemptSql(c, sabotage) };
    }));
    expect(sabotage).not.toBe(base);
    expect(messageOf(v.r)).toMatch(/service_role EXECUTE changed/);
  });
});
