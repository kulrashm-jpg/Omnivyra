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
 *   - FIX: an insert as service_role writes a `created` decision_events row with the decision's
 *     company_id; resolve and reopen write their events with it too.
 *   - CATALOG: SECURITY INVOKER, proconfig exactly {search_path=pg_catalog, public} (what
 *     20270111000003 expects), no EXECUTE for anon/authenticated.
 * decision_objects refuses DELETE (a guard trigger), so every write here is ROLLED BACK.
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
  // baseline carries no privileges; model the hosted default for the tables under test so the
  // TRIGGER, not a missing table grant, decides the outcomes below.
  await db.query('GRANT SELECT, INSERT, UPDATE ON public.decision_objects, public.decision_events TO service_role');
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
      await c.query('SET LOCAL ROLE service_role');
      return c.query(INSERT_DECISION, [CO]);
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('23502');
      expect(out.message).toMatch(/company_id/);
    }
  });
});

describe('FIX: decision writes succeed and every event carries company_id', () => {
  it('insert writes a `created` event with the decision company_id', async () => {
    const out = await inRolledBackTx('service_role', async (c) => {
      const id = (await c.query(INSERT_DECISION, [CO])).rows[0].id;
      return (await c.query(`SELECT event_type, company_id, changed_by FROM public.decision_events WHERE decision_id = $1`, [id])).rows;
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toEqual([{ event_type: 'created', company_id: CO, changed_by: 'user' }]);
    }
  });

  it('resolve and reopen write `resolved` and `reopened` events with company_id', async () => {
    const out = await inRolledBackTx('service_role', async (c) => {
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
