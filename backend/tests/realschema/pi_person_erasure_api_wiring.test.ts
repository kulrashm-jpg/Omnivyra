/**
 * PI / person erasure — the APPLICATION WIRING (personErasureRequests.ts →
 * erasePerson → ledger 20270112000003 → completion verification
 * 20270115000000), end to end against real PostgreSQL.
 *
 * Nothing about erasure is stubbed: the real service calls the real
 * `erasePerson`, whose whole graph reaches the database only through
 * `ownedDbTable` / `ownedDbRpc`, which the adapter below binds to the test
 * connection. The adapter can INJECT a failure at any table operation or RPC,
 * which is how the "failure at each step" and "interrupted + retry" cases are
 * produced on the real code path.
 *
 * WHAT A GREEN RUN DOES NOT TELL YOU: it concerns a disposable database built
 * from the committed baseline plus replayed migrations, not production.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, newPerson, newLead } from './setup';

type Fault = { kind: 'table' | 'rpc'; name: string; op?: string; step?: string; code: string; times: number };
const faults: Fault[] = [];
const injectFault = (f: Omit<Fault, 'times'> & { times?: number }) => faults.push({ times: 1, ...f });
const takeFault = (kind: Fault['kind'], name: string, op?: string, step?: string) => {
  const f = faults.find((x) => x.kind === kind && x.name === name && x.times > 0
    && (x.op === undefined || x.op === op) && (x.step === undefined || x.step === step));
  if (!f) return null;
  f.times -= 1;
  return { code: f.code, message: `injected fault at ${kind}:${name}${op ? `.${op}` : ''}${step ? `:${step}` : ''}` };
};
(globalThis as { __erasureFaults?: typeof takeFault }).__erasureFaults = takeFault;

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    const fault = (globalThis as any).__erasureFaults as (k: string, n: string, o?: string) => { code: string; message: string } | null;
    type Filter = { col: string; op: 'eq' | 'is' | 'in' | 'not_is_null'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], limit: null as number | null, order: null as { col: string; asc: boolean } | null,
      mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'not_is_null') return `"${f.col}" IS NOT NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return list.length ? `"${f.col}" IN (${list.join(', ')})` : 'false';
        }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const injected = fault('table', table, st.op);
      if (injected) return { data: null, error: injected };
      const params: unknown[] = [];
      const row = st.payload ?? {};
      const bind = (k: string) => {
        const v = row[k];
        params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `$${params.length}`;
      };
      let sql: string;
      if (st.op === 'insert') {
        const keys = Object.keys(row);
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) `
          + `VALUES (${keys.map(bind).join(', ')}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const sets = Object.keys(row).map((k) => `"${k}" = ${bind(k)}`).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') {
          if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
          return { data: out[0] ?? null, error: null };
        }
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (r: Record<string, unknown>) => { st.op = 'insert'; st.payload = r; return b; },
      update: (r: Record<string, unknown>) => { st.op = 'update'; st.payload = r; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      not: (col: string, op: string, val: unknown) => {
        if (op !== 'is' || val !== null) throw new Error(`adapter: unsupported not(${col}, ${op})`);
        st.filters.push({ col, op: 'not_is_null', val: null });
        return b;
      },
      order: (col: string, o?: { ascending?: boolean }) => { st.order = { col, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec().then(r, j),
    };
    return b;
  },
  ownedDbRpc: async (fn: string, args: Record<string, unknown>) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    const fault = (globalThis as any).__erasureFaults as (k: string, n: string, o?: string, s?: string) => { code: string; message: string } | null;
    const injected = fault('rpc', fn, undefined, typeof args.p_step === 'string' ? args.p_step : undefined);
    if (injected) return { data: null, error: injected };
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
    });
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    await client.query('SAVEPOINT pg_rpc');
    try {
      if (fn === 'pi_person_erasure_inconsistencies') {   // set-returning: PostgREST answers rows
        const res = await client.query(`SELECT * FROM public."${fn}"(${named})`, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_rpc');
        return { data: res.rows, error: null };
      }
      const res = await client.query(`SELECT public."${fn}"(${named}) AS result`, params) as { rows: Array<{ result: unknown }> };
      await client.query('RELEASE SAVEPOINT pg_rpc');
      return { data: res.rows[0]?.result ?? null, error: null };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT pg_rpc');
      return { data: null, error: err };
    }
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/prospectIdentity/personErasureRequests') as typeof import('../../services/prospectIdentity/personErasureRequests');

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
const one = async (sql: string, params: unknown[] = [], c: Q = db) => (await c.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = [], c: Q = db) => Number((await one(sql, params, c)).n);

/** A person with the full erasure-relevant graph: claim, live governance, legacy lead, prospect, score. */
async function richPerson(org: string, c: Q = db): Promise<{ person: string; lead: string; prospect: string }> {
  const person = (await one('INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [org], c)).id;
  const email = `p-${person.slice(0, 8)}@example.test`;
  await c.query(`INSERT INTO public.identity_claims (organization_id, person_id, claim_type, normalized_value, source)
                 VALUES ($1,$2,'email',$3,'wiring-test')`, [org, person, email]);
  await c.query(`INSERT INTO public.contact_governance_records (organization_id, person_id, target_normalized, channel, governance_type, source)
                 VALUES ($1,$2,NULL,'email','unsubscribe','wiring-test')`, [org, person]);
  const lead = (await one(`INSERT INTO public.leads (company_id, name, email, phone, unified_person_id)
                           VALUES ($1,'Jane Wiring',$2,'+15550000000',$3) RETURNING id`, [org, email, person], c)).id;
  const user = (await one(`INSERT INTO public.canonical_users (company_id, user_type, device, email, full_name)
                           VALUES ($1,'known','unknown',$2,'Jane Wiring') RETURNING id`, [org, email], c)).id;
  const prospect = (await one(`INSERT INTO public.canonical_leads (company_id, user_id, source, unified_person_id, external_lead_key)
                               VALUES ($1,$2,'manual',$3,'ext-key-1') RETURNING id`, [org, user, person], c)).id;
  await c.query(`INSERT INTO public.prospect_score_evaluations
                   (organization_id, prospect_id, person_id, rules_version, scored_at, score_overall, confidence,
                    contributions, evidence, reasoning, facets, context_gaps, input_digest)
                 VALUES ($1,$2,$3,'rules-v1',now(),0.5,0.7,'[{"note":"CTO at Example"}]','[]','[]','{"seniority":"cxo"}','[]',$4)`,
  [org, prospect, person, randomUUID()]);
  return { person, lead, prospect };
}

const start = (org: string, personId: string) =>
  svc.startPersonErasure({ organizationId: org, personId, reason: 'data_subject_request ref=T-1', requestedBy: 'erasure-api:company_admin' });

const personExists = (id: string) => count('SELECT count(*) n FROM public.unified_persons WHERE id=$1', [id]);
const ledgerRow = (id: string) => one('SELECT * FROM public.person_erasure_requests WHERE id=$1', [id]);
const inventoryRows = (id: string) => count('SELECT count(*) n FROM public.person_erasure_inventories WHERE request_id=$1', [id]);

afterEach(() => { faults.length = 0; });

describe('success path — real erasePerson, real ledger, real verification', () => {
  it('erases a person with the full graph, verifies clean, reports COMPLETED, purges the inventory', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person, lead, prospect } = await richPerson(ORG_A);
      const out = await start(ORG_A, person);
      expect(out.kind).toBe('request');
      if (out.kind !== 'request') return;
      expect(out.errorCode).toBeNull();
      expect(out.view.status).toBe('COMPLETED');
      expect(out.view.personId).toBeNull();
      expect(out.view.verification?.outcome).toBe('clean');
      expect(out.view.verification?.residual).toEqual([]);
      expect(out.view.steps).toEqual({ governanceReanchored: true, governanceRevoked: true, evidenceLinksCleared: true, provenanceErased: true, personDeleted: true });

      const reqId = out.view.requestId!;
      expect(await personExists(person)).toBe(0);
      expect((await ledgerRow(reqId)).person_id).toBeNull();
      expect(await inventoryRows(reqId)).toBe(0);
      // RC carries option S (20270112000004) and the decision-ref null hook (…05): merged behaviour.
      expect(out.view.policies).toMatchObject({ legacy_lead_fields: 'redact', outreach_decision_person_ref: 'null' });
      const l = await one('SELECT name, email, phone, unified_person_id, person_erased_at FROM public.leads WHERE id=$1', [lead]);
      expect(l).toMatchObject({ name: 'redacted', email: `redacted:${lead}`, phone: null, unified_person_id: null });
      expect(l.person_erased_at).not.toBeNull();
      const cl = await one('SELECT unified_person_id, external_lead_key FROM public.canonical_leads WHERE id=$1', [prospect]);
      expect(cl).toEqual({ unified_person_id: null, external_lead_key: null });
      // suppression survives as a TARGET-anchored record (erasePerson's contract)
      expect(await count(`SELECT count(*) n FROM public.contact_governance_records
                           WHERE organization_id=$1 AND person_id IS NULL AND revoked_at IS NULL AND source='person_erasure'`, [ORG_A])).toBe(1);
      // the verification record holds no person id and no value
      const v = await one('SELECT checks::text t, policies::text p FROM public.person_erasure_verifications WHERE request_id=$1', [reqId]);
      expect(v.t).not.toContain(person);
      expect(v.t).not.toMatch(/@|Jane/);
      expect(v.p).not.toContain(person);
      // every catalog FK to unified_persons was checked
      const fkChecks = JSON.parse(v.t).filter((c: any) => c.check.startsWith('fk:'));
      const fkCount = await count(`SELECT count(*) n FROM pg_constraint WHERE contype='f' AND confrelid='public.unified_persons'::regclass`);
      expect(fkChecks.length).toBe(fkCount);
    });
  });

  it('GET status and list read the same state; the list carries the inconsistency report', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      const view = await svc.getErasureRequest(ORG_A, out.view.requestId!);
      expect(view?.status).toBe('COMPLETED');
      const list = await svc.listErasureRequests(ORG_A);
      expect(list.requests.map((r) => r.requestId)).toContain(out.view.requestId);
      expect(Array.isArray(list.inconsistencies)).toBe(true);
      // tenant isolation of reads
      expect(await svc.getErasureRequest(ORG_B, out.view.requestId!)).toBeNull();
      expect((await svc.listErasureRequests(ORG_B)).requests.map((r) => r.requestId)).not.toContain(out.view.requestId);
    });
  });
});

describe('subject validation — tenant-first, no arbitrary ids', () => {
  it('unknown person → subject_not_found; no ledger row is opened', async () => {
    await inRollback(async () => {
      await seedTenants();
      const before = await count('SELECT count(*) n FROM public.person_erasure_requests');
      expect((await start(ORG_A, randomUUID())).kind).toBe('subject_not_found');
      expect(await count('SELECT count(*) n FROM public.person_erasure_requests')).toBe(before);
    });
  });

  it('another tenant\'s person → subject_not_found (same answer as unknown); that person is untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person, lead } = await richPerson(ORG_B);
      expect((await start(ORG_A, person)).kind).toBe('subject_not_found');
      expect(await personExists(person)).toBe(1);
      expect((await one('SELECT name FROM public.leads WHERE id=$1', [lead])).name).toBe('Jane Wiring');
      expect(await count('SELECT count(*) n FROM public.person_erasure_requests WHERE person_id=$1', [person])).toBe(0);
    });
  });

  it('retry by a request id of another tenant → request_not_found', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      expect((await svc.retryErasureRequest(ORG_B, out.view.requestId!, 'erasure-api:company_admin')).kind).toBe('request_not_found');
    });
  });

  it('malformed ids never reach the database', async () => {
    expect((await start(ORG_A, 'not-a-uuid')).kind).toBe('subject_not_found');
    expect((await svc.retryErasureRequest(ORG_A, "x' OR 1=1", 'erasure-api:x')).kind).toBe('request_not_found');
    expect(await svc.getErasureRequest(ORG_A, 'nope')).toBeNull();
  });
});

describe('duplicate and repeat requests', () => {
  it('a repeat POST after completion finds no person (404); a retry by request id re-reads the clean verification, erases nothing new', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      const first = await start(ORG_A, person);
      if (first.kind !== 'request') throw new Error('expected request');
      expect((await start(ORG_A, person)).kind).toBe('subject_not_found');
      const again = await svc.retryErasureRequest(ORG_A, first.view.requestId!, 'erasure-api:company_admin');
      expect(again.kind === 'request' && again.view.status).toBe('COMPLETED');
      expect(await count('SELECT count(*) n FROM public.person_erasure_requests WHERE organization_id=$1', [ORG_A])).toBe(1);
    });
  });
});

describe('failure injected at each step → never COMPLETED, person intact (until finalize), retry completes', () => {
  const steps: Array<[string, Omit<Fault, 'times'>, { personSurvives: boolean; ledgerRow: boolean }]> = [
    ['open', { kind: 'rpc', name: 'pi_person_erasure_open', code: 'XX000' }, { personSurvives: true, ledgerRow: false }],
    ['step 1 read contact points', { kind: 'table', name: 'identity_claims', op: 'select', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 2 read governance', { kind: 'table', name: 'contact_governance_records', op: 'select', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 3 re-anchor write', { kind: 'table', name: 'contact_governance_records', op: 'insert', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 3 marker', { kind: 'rpc', name: 'pi_person_erasure_mark', step: 'governance_reanchored', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 4 revoke', { kind: 'table', name: 'contact_governance_records', op: 'update', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 4 marker', { kind: 'rpc', name: 'pi_person_erasure_mark', step: 'governance_revoked', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 5 clear employer leg', { kind: 'table', name: 'source_assertions', op: 'update', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['step 5 marker', { kind: 'rpc', name: 'pi_person_erasure_mark', step: 'evidence_links_cleared', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['inventory capture', { kind: 'rpc', name: 'pi_person_erasure_capture_inventory', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['finalize (steps 6-7)', { kind: 'rpc', name: 'pi_person_erasure_finalize', code: '08006' }, { personSurvives: true, ledgerRow: true }],
    ['verification', { kind: 'rpc', name: 'pi_person_erasure_verify', code: '08006' }, { personSurvives: false, ledgerRow: true }],
  ];

  it.each(steps)('%s', async (_label, fault, expectation) => {
    await inRollback(async () => {
      await seedTenants();
      const { person, lead } = await richPerson(ORG_A);
      injectFault(fault);
      const out = await start(ORG_A, person);
      expect(out.kind).toBe('request');
      if (out.kind !== 'request') return;
      expect(out.view.status).not.toBe('COMPLETED');
      expect(out.errorCode).not.toBeNull();
      expect(await personExists(person)).toBe(expectation.personSurvives ? 1 : 0);
      if (expectation.personSurvives) {
        // nothing of steps 6-7 happened: lead still linked and unredacted
        expect((await one('SELECT name, unified_person_id FROM public.leads WHERE id=$1', [lead])))
          .toEqual({ name: 'Jane Wiring', unified_person_id: person });
      }
      if (expectation.ledgerRow) {
        expect(out.view.requestId).not.toBeNull();
        expect(['RETRY_REQUIRED', 'PARTIALLY_COMPLETED']).toContain(out.view.status);
      } else {
        expect(out.view.requestId).toBeNull();
        expect(out.view.status).toBe('RETRY_REQUIRED');
      }

      // RETRY — the same entry point (person still present) or by request id (person gone).
      const retried = expectation.personSurvives
        ? await start(ORG_A, person)
        : await svc.retryErasureRequest(ORG_A, out.view.requestId!, 'erasure-api:company_admin');
      expect(retried.kind === 'request' && retried.view.status).toBe('COMPLETED');
      expect(await personExists(person)).toBe(0);
      expect(await count('SELECT count(*) n FROM public.person_erasure_requests WHERE organization_id=$1', [ORG_A])).toBe(1);
      // resumed, not duplicated: exactly one carried-forward record per instruction x address
      expect(await count(`SELECT count(*) n FROM public.contact_governance_records
                           WHERE organization_id=$1 AND person_id IS NULL AND source='person_erasure'`, [ORG_A])).toBe(1);
    });
  });
});

describe('interrupted runner (crash: not even the failure could be recorded) and partial recovery', () => {
  it('lease live → IN_PROGRESS; lease expired → PARTIALLY_COMPLETED + inconsistency; retry → COMPLETED', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      injectFault({ kind: 'table', name: 'source_assertions', op: 'update', code: '08006' });
      injectFault({ kind: 'rpc', name: 'pi_person_erasure_mark', step: 'failed', code: '08006' });
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      expect(out.view.status).toBe('IN_PROGRESS');           // lease still held by the "dead" runner
      const reqId = out.view.requestId!;

      // a new attempt while the lease is live is refused, not run twice
      const blocked = await start(ORG_A, person);
      expect(blocked.kind === 'request' && blocked.view.status).toBe('IN_PROGRESS');
      expect(blocked.kind === 'request' && blocked.errorCode).toBe('erasure_in_progress');

      await db.query(`UPDATE public.person_erasure_requests SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id=$1`, [reqId]);
      const view = await svc.getErasureRequest(ORG_A, reqId);
      expect(view?.status).toBe('PARTIALLY_COMPLETED');
      expect(view?.steps.governanceRevoked).toBe(true);
      const list = await svc.listErasureRequests(ORG_A);
      expect(list.inconsistencies).toContainEqual({ requestId: reqId, problem: 'lease_expired_without_outcome' });

      const retried = await svc.retryErasureRequest(ORG_A, reqId, 'erasure-api:company_admin');
      expect(retried.kind === 'request' && retried.view.status).toBe('COMPLETED');
      expect(retried.kind === 'request' && retried.view.attempts).toBe(2);
    });
  });

  it('person deleted OUTSIDE the ledger mid-request → FAILED_REQUIRES_REVIEW, never COMPLETED', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      injectFault({ kind: 'rpc', name: 'pi_person_erasure_finalize', code: '08006' });
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      const reqId = out.view.requestId!;
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [person]);   // a stray delete
      const view = await svc.getErasureRequest(ORG_A, reqId);
      expect(view?.status).toBe('FAILED_REQUIRES_REVIEW');
      const retried = await svc.retryErasureRequest(ORG_A, reqId, 'erasure-api:company_admin');
      expect(retried.kind === 'request' && retried.view.status).toBe('FAILED_REQUIRES_REVIEW');
      expect(retried.kind === 'request' && retried.errorCode).toBe('person_vanished_outside_ledger');
    });
  });
});

describe('concurrent runner holding the lease in ANOTHER session', () => {
  it('the API answers IN_PROGRESS and runs nothing; after the other runner releases, a retry completes', async () => {
    const other = new Client({ connectionString: process.env.W6_DB_URL });
    await other.connect();
    const org = randomUUID();
    try {
      await other.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'wiring concurrency')`, [org]);
      const { person } = await richPerson(org, other);
      const held = (await other.query(`SELECT public.pi_person_erasure_open($1,$2,'data_subject_request','test:other-runner',600) r`, [org, person])).rows[0].r;

      await inRollback(async () => {
        const out = await start(org, person);
        expect(out.kind === 'request' && out.view.status).toBe('IN_PROGRESS');
        expect(out.kind === 'request' && out.errorCode).toBe('erasure_in_progress');
        // nothing ran: the live instruction is still person-anchored and live
        expect(await count(`SELECT count(*) n FROM public.contact_governance_records
                             WHERE organization_id=$1 AND person_id=$2 AND revoked_at IS NULL`, [org, person])).toBe(1);

        await other.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'failed',NULL,'test_release')`, [org, held.request_id, held.lease_token]);
        const retried = await svc.retryErasureRequest(org, held.request_id, 'erasure-api:company_admin');
        expect(retried.kind === 'request' && retried.view.status).toBe('COMPLETED');
      });
    } finally {
      await other.query('DELETE FROM public.companies WHERE id=$1', [org]).catch(() => undefined);
      await other.end();
    }
  });
});

describe('completion verification — residual personal data is detected and blocks COMPLETED', () => {
  it('lead children (ER-GAP) → FAILED_REQUIRES_REVIEW with named checks; inventory kept; owner-accept switch is the only way to COMPLETED', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person, lead } = await richPerson(ORG_A);
      await db.query(`INSERT INTO public.form_conversions (company_id, lead_id, metadata) VALUES ($1,$2,'{"field":"Jane"}')`, [ORG_A, lead]);
      await db.query(`INSERT INTO public.lead_attributions (company_id, lead_id, referrer) VALUES ($1,$2,'https://ref.example')`, [ORG_A, lead]);
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      expect(out.view.steps.personDeleted).toBe(true);
      expect(out.view.status).toBe('FAILED_REQUIRES_REVIEW');
      expect(out.view.verification?.outcome).toBe('residual');
      const names = out.view.verification!.residual.map((r) => `${r.check}:${r.category}:${r.count}:${r.accepted}`).sort();
      expect(names).toEqual(['form_conversions.rows:known_gap:1:false', 'lead_attributions.rows:known_gap:1:false']);
      const reqId = out.view.requestId!;
      expect(await inventoryRows(reqId)).toBe(1);

      // The switch (an owner decision) is honoured for known gaps…
      const row = await one(`SELECT id, organization_id, person_id, reason, requested_by, status, attempts,
          lease_expires_at, governance_reanchored_at, governance_revoked_at, evidence_links_cleared_at,
          provenance_erased_at, person_deleted_at, finalize_counts, last_error_code, last_attempt_at, created_at, completed_at
          FROM public.person_erasure_requests WHERE id=$1`, [reqId]);
      const ver = await one('SELECT id, request_id, verified_at, outcome, checks, policies, inventory_purged FROM public.person_erasure_verifications WHERE request_id=$1', [reqId]);
      const accepted = new Set(['form_conversions.rows', 'lead_attributions.rows']);
      expect(svc.deriveErasureStatus(row, ver, Date.now(), accepted)).toBe('COMPLETED');
      expect(svc.deriveErasureStatus(row, ver, Date.now(), new Set(['form_conversions.rows']))).toBe('FAILED_REQUIRES_REVIEW');
      // …and the shipped default accepts nothing
      expect(svc.ACCEPTED_RESIDUAL_CHECKS.size).toBe(0);

      // Operator remediation then re-verification by request id → clean, purged
      await db.query('DELETE FROM public.form_conversions WHERE lead_id=$1', [lead]);
      await db.query('DELETE FROM public.lead_attributions WHERE lead_id=$1', [lead]);
      const again = await svc.retryErasureRequest(ORG_A, reqId, 'erasure-api:company_admin');
      expect(again.kind === 'request' && again.view.status).toBe('COMPLETED');
      expect(await inventoryRows(reqId)).toBe(0);
      expect(await count('SELECT count(*) n FROM public.person_erasure_verifications WHERE request_id=$1', [reqId])).toBe(2);
    });
  });

  it('a VIOLATION (re-identified prospect after completion) is never acceptable, whatever the switch says', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person, prospect } = await richPerson(ORG_A);
      await db.query(`INSERT INTO public.form_conversions (company_id, lead_id) SELECT $1, id FROM public.leads WHERE unified_person_id=$2`, [ORG_A, person]);
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      const reqId = out.view.requestId!;
      // tamper: something writes the external key back onto the redacted prospect
      await db.query(`UPDATE public.canonical_leads SET external_lead_key='ext-key-1' WHERE id=$1`, [prospect]);
      const again = await svc.retryErasureRequest(ORG_A, reqId, 'erasure-api:company_admin');
      if (again.kind !== 'request') throw new Error('expected request');
      expect(again.view.status).toBe('FAILED_REQUIRES_REVIEW');
      const v = again.view.verification!.residual.find((r) => r.check === 'canonical_leads.unredacted');
      expect(v).toMatchObject({ category: 'violation', count: 1, accepted: false });
      const row = await one(`SELECT * FROM public.person_erasure_requests WHERE id=$1`, [reqId]);
      const ver = (await db.query('SELECT * FROM public.person_erasure_verifications WHERE request_id=$1 ORDER BY verified_at DESC LIMIT 1', [reqId])).rows[0];
      expect(svc.deriveErasureStatus(row, ver, Date.now(), new Set(['canonical_leads.unredacted', 'form_conversions.rows']))).toBe('FAILED_REQUIRES_REVIEW');
    });
  });

  it('residual polymorphic reference to the person uuid is reported (activity_feed.entity_id)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      // activity_feed has no tenant column; entity_id is a polymorphic uuid.
      await db.query(`INSERT INTO public.activity_feed (user_id, action_type, entity_type, entity_id)
                      VALUES ($1, 'viewed', 'person', $2)`, [randomUUID(), person]);
      const out = await start(ORG_A, person);
      if (out.kind !== 'request') throw new Error('expected request');
      expect(out.view.status).toBe('FAILED_REQUIRES_REVIEW');
      expect(out.view.verification!.residual).toContainEqual(
        { check: 'polymorphic:activity_feed.entity_id', category: 'known_gap', count: 1, accepted: false });
    });
  });
});

describe('permission and trigger protection of the new objects (and the merged ones)', () => {
  async function asRole(role: string, sql: string, params: unknown[] = []): Promise<string> {
    await db.query('SAVEPOINT r');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role]);
      await db.query(`SET LOCAL ROLE ${role}`);
      await db.query(sql, params);
      await db.query('RESET ROLE');
      await db.query('ROLLBACK TO SAVEPOINT r');
      return 'ok';
    } catch (e: any) {
      await db.query('ROLLBACK TO SAVEPOINT r');
      return e.code ?? 'unknown';
    }
  }

  it('anon / authenticated can execute neither function nor read either table', async () => {
    await inRollback(async () => {
      for (const role of ['anon', 'authenticated']) {
        expect(await asRole(role, `SELECT public.pi_person_erasure_verify($1,$2)`, [ORG_A, randomUUID()])).toBe('42501');
        expect(await asRole(role, `SELECT public.pi_person_erasure_capture_inventory($1,$2,$3)`, [ORG_A, randomUUID(), randomUUID()])).toBe('42501');
        expect(await asRole(role, 'SELECT 1 FROM public.person_erasure_inventories')).toBe('42501');
        expect(await asRole(role, 'SELECT 1 FROM public.person_erasure_verifications')).toBe('42501');
      }
    });
  });

  it('service_role cannot read the inventory (it holds the erased uuid) nor write verifications', async () => {
    await inRollback(async () => {
      expect(await asRole('service_role', 'SELECT 1 FROM public.person_erasure_inventories')).toBe('42501');
      expect(await asRole('service_role', `INSERT INTO public.person_erasure_verifications (request_id, organization_id, outcome, checks)
                                            VALUES ($1,$2,'clean','[]')`, [randomUUID(), ORG_A])).toBe('42501');
      expect(await asRole('service_role', 'UPDATE public.person_erasure_verifications SET outcome=\'clean\'')).toBe('42501');
    });
  });

  it('capture refuses a wrong lease, another tenant, a completed request; verify refuses a pending request', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const req = (await one(`SELECT public.pi_person_erasure_open($1,$2,'data_subject_request','test',600) r`, [ORG_A, person])).r;
      const probe = async (sql: string, params: unknown[]) => {
        await db.query('SAVEPOINT p');
        try { await db.query(sql, params); await db.query('ROLLBACK TO SAVEPOINT p'); return 'ok'; } catch (e: any) { await db.query('ROLLBACK TO SAVEPOINT p'); return e.code; }
      };
      expect(await probe('SELECT public.pi_person_erasure_capture_inventory($1,$2,$3)', [ORG_A, req.request_id, randomUUID()])).toBe('55P03');
      expect(await probe('SELECT public.pi_person_erasure_capture_inventory($1,$2,$3)', [ORG_B, req.request_id, req.lease_token])).toBe('42501');
      expect(await probe('SELECT public.pi_person_erasure_verify($1,$2)', [ORG_A, req.request_id])).toBe('55000');
      expect(await probe('SELECT public.pi_person_erasure_capture_inventory($1,$2,$3)', [ORG_A, req.request_id, req.lease_token])).toBe('ok');
    });
  });

  it('merged guard still holds: service_role cannot redact a score evaluation outside the erasure flow', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { person } = await richPerson(ORG_A);
      // Grant as much as possible (inside the rolled-back transaction), so it is
      // the TRIGGER, not a missing privilege, that refuses. The literal marker is
      // used so no function EXECUTE is needed.
      await db.query('GRANT ALL ON public.prospect_score_evaluations TO service_role');
      expect(await asRole('service_role', `UPDATE public.prospect_score_evaluations
          SET person_id=NULL, contributions='[]', evidence='[]', reasoning='[]', context_gaps='[]',
              facets='{"redacted": true, "reason": "person_erased"}'::jsonb WHERE person_id=$1`, [person])).toBe('23514');
    });
  });
});

it('fixture sanity: newLead helper still links a prospect to a person (shared harness unchanged)', async () => {
  await inRollback(async () => {
    await seedTenants();
    const p = await newPerson(ORG_A);
    const l = await newLead(ORG_A, { personId: p });
    expect((await one('SELECT unified_person_id FROM public.canonical_leads WHERE id=$1', [l])).unified_person_id).toBe(p);
  });
});
