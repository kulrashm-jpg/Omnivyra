/**
 * PI-LDB Prompt 2C · AN UNCERTAIN PROTECTIVE READ MUST NOT REPLACE A SCORE.
 *
 * ─── THE DEFECT THIS PINS SHUT ─────────────────────────────────────────────
 * Prompt 2B added a read before the canonical upsert so a stored,
 * customer-visible score could be protected from silent recalculation, and
 * gated recalculation behind `LEAD_SCORE_MODEL_TRANSITION`. The read was
 * fail-open: when it came back `unknown` the computed score was written
 * anyway. So the gate was bypassed by precisely the conditions it existed
 * for — an authorization error, a timeout, an ambiguous transport result —
 * and an earlier model's number was replaced with no event, no history row
 * and nothing to tell anyone it had happened.
 *
 * The contract now:
 *
 *   uncertain read + row EXISTS  -> the row still updates, but `scores` is not
 *                                   among the assigned columns.
 *   uncertain read + row is NEW  -> the computed score is written. There was
 *                                   never anything to protect.
 *
 * ─── WHY THE OBSERVATION POINT IS THE WIRE ─────────────────────────────────
 * The claim is about WHICH COLUMNS the database is asked to assign, so it is
 * asserted on the request PostgREST would receive: the method, the `Prefer`
 * header and the body's keys, measured against a real postgrest-js builder
 * over loopback HTTP. A mock's call arguments would not do — a key can be
 * present on an object and dropped by `JSON.stringify`.
 *
 * ─── WHY TWO STATEMENTS AND NOT AN OMITTED COLUMN ──────────────────────────
 * Dropping `scores` from the merge-duplicates upsert body would be smaller,
 * and it depends on PostgREST deriving its `ON CONFLICT DO UPDATE SET` list
 * from the body's keys. That is unverified here (no PostgREST in this
 * environment) and its failure mode is a WIPE to `'{}'::jsonb`, which is worse
 * than the bug. A PATCH assigns exactly the keys in its body, and every
 * partial update in this repository already depends on that. The server below
 * models both semantics, so the test would still catch a regression if the
 * implementation ever changed shape.
 *
 * NOTE ON REACH. There is no PostgREST here. The server is a hand-written
 * stand-in that implements the three behaviours this contract rests on —
 * `resolution=merge-duplicates` assigns the body's keys, a plain INSERT on a
 * taken key raises 23505 naming the constraint, and PATCH assigns the body's
 * keys. Nothing below should be read as an integration-level demonstration of
 * PostgREST itself.
 *
 * No credential is read: `PostgrestClient` is constructed directly, so
 * `getSupabaseConfig()` never runs. No network beyond loopback.
 */

import type { AddressInfo } from 'node:net';
import http from 'node:http';

interface Observed {
  method: string;
  path: string;
  query: string;
  body: string;
  /** Where `resolution=merge-duplicates` actually lives. */
  prefer: string;
}

const requests: Observed[] = [];
/** Rows that actually landed, keyed exactly as `lead_intelligence_dedupe_unique` is. */
const store = new Map<string, Record<string, unknown>>();

/** How the protective read (the one asking for `scores`) should answer. */
type ReadFault = 'none' | 'denied' | 'unavailable';
let readFault: ReadFault = 'none';

const BASE = { url: '' };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostgrestClient } = require('@supabase/postgrest-js');
      return new PostgrestClient(BASE.url).from(table);
    },
  },
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  buildAttributionContract,
  computeLeadDedupeKey,
  LEAD_SCORE_MODEL_VERSION,
  type CanonicalLead,
  type CanonicalLeadScores,
} from '../../../lib/leadIntelligence';
import { upsertCanonicalLeadWithOutcome } from '../../services/leadIntelligence/leadIntelligenceRepository';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const DEDUPE_CONSTRAINT = 'lead_intelligence_dedupe_unique';

function lead(over: Partial<CanonicalLead> = {}): CanonicalLead {
  const identity = { email: 'ada@example.com', unifiedPersonId: 'person-1' };
  return {
    organizationId: ORG,
    source: 'crm',
    identity,
    attribution: buildAttributionContract({ Email: 'ada@example.com' }, identity),
    status: null,
    occurredAt: '2026-11-04T10:00:00.000Z',
    display: { name: 'Ada Lovelace', title: null, contentText: null },
    sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
    unifiedPersonId: 'person-1',
    ingestedAt: '2026-11-04T10:00:00.000Z',
    ...over,
  };
}

const keyOf = (l: CanonicalLead) => `${l.organizationId}|${computeLeadDedupeKey(l)}`;
const eqParam = (q: string, c: string) => new URLSearchParams(q).get(c)?.replace(/^eq\./, '') ?? null;
const isProtectiveRead = (q: string) => (new URLSearchParams(q).get('select') ?? '').includes('scores');

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const [path, query = ''] = String(req.url ?? '').split('?');
      const body = Buffer.concat(chunks).toString('utf8');
      const prefer = String(req.headers.prefer ?? '');
      const method = String(req.method);
      requests.push({ method, path, query, body, prefer });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (path === '/lead_intelligence_events') { json(201, []); return; }

      if (method === 'GET') {
        if (isProtectiveRead(query) && readFault === 'denied') {
          // A definite answer that we may NOT look — which is exactly "I do
          // not know what is stored".
          json(403, { code: '42501', message: 'permission denied for table lead_intelligence', details: null, hint: null });
          return;
        }
        if (isProtectiveRead(query) && readFault === 'unavailable') {
          // 503 is in postgrest-js's `RETRYABLE_STATUS_CODES`. Whether this is
          // answered once or four times is the subject of its own test below.
          json(503, { code: '', message: 'service unavailable', details: null, hint: null });
          return;
        }
        const hit = store.get(`${eqParam(query, 'company_id')}|${eqParam(query, 'dedupe_key')}`);
        const cols = (new URLSearchParams(query).get('select') ?? 'id').split(',').map((c) => c.trim());
        const projected: Record<string, unknown> = {};
        if (hit) for (const c of cols) projected[c] = hit[c] ?? null;
        json(200, hit ? [projected] : []);
        return;
      }

      if (method === 'POST') {
        const row = JSON.parse(body) as Record<string, unknown>;
        const key = `${String(row.company_id)}|${String(row.dedupe_key)}`;
        const existing = store.get(key);

        if (existing && !prefer.includes('resolution=merge-duplicates')) {
          // A PLAIN INSERT onto a taken idempotency key. PostgREST passes the
          // SQLSTATE and the constraint name straight through.
          json(409, {
            code: '23505',
            details: `Key (company_id, dedupe_key)=(${String(row.company_id)}, ${String(row.dedupe_key)}) already exists.`,
            hint: null,
            message: `duplicate key value violates unique constraint "${DEDUPE_CONSTRAINT}"`,
          });
          return;
        }

        // INSERT, or `ON CONFLICT DO UPDATE SET <body columns>`: only the keys
        // PRESENT in the body are assigned. A new row takes the production
        // column default for anything absent — `scores jsonb NOT NULL DEFAULT
        // '{}'::jsonb` (20260629000000_lead_intelligence_store.sql:16).
        const id = existing ? String(existing.id) : `row-${store.size + 1}`;
        store.set(key, { scores: {}, ...(existing ?? {}), ...row, id });
        json(201, [{ id }]);
        return;
      }

      if (method === 'PATCH') {
        // UPDATE … SET <body columns>. Keys absent from the body are not
        // assigned, which is the whole contract under test.
        const patch = JSON.parse(body) as Record<string, unknown>;
        const key = `${eqParam(query, 'company_id')}|${eqParam(query, 'dedupe_key')}`;
        const existing = store.get(key);
        if (!existing) { json(200, []); return; }
        store.set(key, { ...existing, ...patch });
        json(200, [{ id: String(existing.id) }]);
        return;
      }

      json(405, { message: `unexpected ${method}` });
    });
  });
  server.on('clientError', (_e, s) => s.destroy());
  server.on('error', () => undefined);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  BASE.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  requests.length = 0;
  store.clear();
  readFault = 'none';
  delete process.env.LEAD_SCORE_MODEL_TRANSITION;
});

const onTable = (m: string) => requests.filter((r) => r.path === '/lead_intelligence' && r.method === m);
const protectiveReads = () => requests.filter((r) => r.method === 'GET' && isProtectiveRead(r.query));
const reconcileReads = () => requests.filter((r) => r.method === 'GET' && !isProtectiveRead(r.query));
const bodyOf = (r: Observed) => JSON.parse(r.body) as Record<string, unknown>;

const BI_1: CanonicalLeadScores = { intent: 0.35, total: 0.35, modelVersion: 'bi-1' };

function seedExisting(l: CanonicalLead, scores: CanonicalLeadScores = BI_1): void {
  store.set(keyOf(l), {
    id: 'row-existing',
    company_id: ORG,
    dedupe_key: computeLeadDedupeKey(l),
    display: { name: 'stale name', title: null, contentText: null },
    scores,
  });
}

describe('PI-LDB 2C · an uncertain protective read leaves a stored score alone', () => {
  it.each<[string, ReadFault]>([
    ['an authorization refusal', 'denied'],
    ['a gateway that will not answer', 'unavailable'],
  ])('%s does not assign `scores` on the existing row', async (_label, fault) => {
    readFault = fault;
    const l = lead();
    seedExisting(l);

    const out = await upsertCanonicalLeadWithOutcome(l);

    // THE CLAIM, as the database would see it: the update's column list has no
    // `scores` in it. Absent, not null — a null would be ASSIGNED, destroying
    // the score and violating the column's NOT NULL.
    const patch = onTable('PATCH');
    expect(patch).toHaveLength(1);
    expect('scores' in bodyOf(patch[0])).toBe(false);

    // And the stored value is byte-identical afterwards.
    expect(store.get(keyOf(l))!.scores).toEqual(BI_1);

    // The lead still landed. Refusing the projection would be the opposite
    // error — it discards valid canonical intake over a score we did not even
    // need to change.
    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-existing');
  });

  it('every OTHER column still updates — the intake is not discarded', async () => {
    readFault = 'denied';
    const l = lead();
    seedExisting(l);

    await upsertCanonicalLeadWithOutcome(l);

    const patched = store.get(keyOf(l))!;
    expect(patched.display).toEqual({ name: 'Ada Lovelace', title: null, contentText: null });
    expect(patched.identity).toEqual(l.identity);
    expect(patched.source).toBe('crm');
    expect(patched.updated_at).toEqual(expect.any(String));
  });

  it('a genuinely NEW row is written WITH the computed score, in one statement', async () => {
    readFault = 'denied';
    const l = lead();

    const out = await upsertCanonicalLeadWithOutcome(l);

    // Nothing was stored, so nothing needed protecting: the insert carries the
    // score and no second statement is issued.
    const posts = onTable('POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].prefer).not.toContain('resolution=merge-duplicates');
    expect((bodyOf(posts[0]).scores as CanonicalLeadScores).modelVersion).toBe(LEAD_SCORE_MODEL_VERSION);
    expect(onTable('PATCH')).toHaveLength(0);
    expect((store.get(keyOf(l))!.scores as CanonicalLeadScores).modelVersion).toBe(LEAD_SCORE_MODEL_VERSION);
    expect(out.status).toBe('persisted');
  });

  it('the operator is told WHICH thing happened — left unchanged, not replaced', async () => {
    readFault = 'denied';
    seedExisting(lead());

    const out = await upsertCanonicalLeadWithOutcome(lead());
    const w = out.warnings.join(' ');

    expect(w).toContain('could not be read');
    // "may have been replaced" and "was left unchanged" send an operator to
    // different places, so the warning has to state the ACTION.
    expect(w).toContain('LEFT UNCHANGED');
    expect(w.toLowerCase()).not.toContain('may have been replaced');
  });
});

describe('PI-LDB 2C · the certain paths are untouched', () => {
  it('nothing stored and the read works -> ordinary merge-duplicates upsert, score written', async () => {
    const l = lead();

    await upsertCanonicalLeadWithOutcome(l);

    const posts = onTable('POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].prefer).toContain('resolution=merge-duplicates');
    expect((bodyOf(posts[0]).scores as CanonicalLeadScores).modelVersion).toBe(LEAD_SCORE_MODEL_VERSION);
    expect(onTable('PATCH')).toHaveLength(0);
  });

  it('a stored earlier-model score the read CAN see is still preserved by value (the 2B behaviour)', async () => {
    const l = lead();
    seedExisting(l);

    await upsertCanonicalLeadWithOutcome(l);

    // Known, so it can be written back explicitly — and must be, because the
    // upsert assigns every column it carries.
    const posts = onTable('POST');
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0]).scores).toEqual(BI_1);
    expect(store.get(keyOf(l))!.scores).toEqual(BI_1);
  });

  it('an authorized transition still recomputes', async () => {
    process.env.LEAD_SCORE_MODEL_TRANSITION = LEAD_SCORE_MODEL_VERSION;
    const l = lead();
    seedExisting(l);

    await upsertCanonicalLeadWithOutcome(l);

    expect((bodyOf(onTable('POST')[0]).scores as CanonicalLeadScores).modelVersion)
      .toBe(LEAD_SCORE_MODEL_VERSION);
  });

  it('the two keyed reads stay separable BY COLUMN LIST', async () => {
    // `piLdbProjectionTransportStages`, `piLdbSinkNotReached` and
    // `piLdbFalsePersistenceGuard` all depend on being able to tell a
    // score-protection read from a reconciliation read on the wire. Restated
    // here so this contract cannot quietly take that away.
    await upsertCanonicalLeadWithOutcome(lead());

    expect(protectiveReads()).toHaveLength(1);
    expect(new URLSearchParams(protectiveReads()[0].query).get('select')).toBe('id,scores');
    expect(reconcileReads()).toHaveLength(0);
  });
});

describe('PI-LDB 2C · the materialization kill-switch is not a score eraser', () => {
  afterEach(() => { delete process.env.LEAD_SCORE_MATERIALIZATION_ENABLED; });

  it('turning materialization OFF does not blank a stored score', async () => {
    // Found while fixing the uncertain-read path, and the same defect wearing
    // a different hat. With the switch off, `materializeCanonicalScores`
    // returns `lead.scores ?? {}`, and the ingestion orchestrator never
    // supplies `scores` — so the full-row upsert used to assign `'{}'` over a
    // real stored number. The switch is meant to stop the scorer RUNNING, not
    // to erase what earlier runs produced, and it skipped the protective read
    // entirely on the way.
    process.env.LEAD_SCORE_MATERIALIZATION_ENABLED = 'false';
    const l = lead();
    seedExisting(l);

    const out = await upsertCanonicalLeadWithOutcome(l);

    expect(store.get(keyOf(l))!.scores).toEqual(BI_1);
    expect(out.status).toBe('persisted');
    // And the rest of the intake still lands.
    expect(store.get(keyOf(l))!.display).toEqual({ name: 'Ada Lovelace', title: null, contentText: null });
  });

  it('with the switch off, a source-provided score IS still written', async () => {
    // The switch disables THIS scorer, not the data. A System-B score the
    // record actually carries is the record's own fact and must land.
    process.env.LEAD_SCORE_MATERIALIZATION_ENABLED = 'false';
    const scored: CanonicalLeadScores = { intent: 0.9, total: 0.9, modelVersion: 'system-b' };
    const l = lead({ scores: scored });
    seedExisting(l);

    await upsertCanonicalLeadWithOutcome(l);

    expect(store.get(keyOf(l))!.scores).toEqual(scored);
  });

  it('with the switch off, a NEW row still lands', async () => {
    process.env.LEAD_SCORE_MATERIALIZATION_ENABLED = 'false';
    const l = lead();

    const out = await upsertCanonicalLeadWithOutcome(l);

    expect(out.status).toBe('persisted');
    expect(store.get(keyOf(l))!.scores).toEqual({});
  });
});

describe('PI-LDB 2C · the protective read is not retried', () => {
  it('runs through the PRODUCTION builder proxy, so `retry` is exercised where it lives', async () => {
    // `ownedDbTable` is `observeTable(table, supabase.from(table))`, a Proxy
    // that re-wraps every chainable return. `retry` returns `this`, so it
    // passes through — but only if the proxy is actually in the way here.
    // `OBSERVABILITY_ENABLED` and `OBSERVABILITY_DB` both default to true and
    // `dbSampleRate` is 1 outside production, so it is. Asserted rather than
    // assumed: if a future test-env default turns it off, the assertion below
    // says so instead of this suite quietly testing the raw builder.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { domainEnabled, observabilityConfig } = require('../../observability/config') as typeof import('../../observability/config');
    expect(domainEnabled('db')).toBe(true);
    expect(observabilityConfig.dbSampleRate).toBe(1);
  });

  it('a 503 is answered ONCE, not four times', async () => {
    // @supabase/postgrest-js 2.105.3 retries GET/HEAD/OPTIONS on 503/520 up to
    // `DEFAULT_MAX_RETRIES` 3, with 1s/2s/4s backoff. This is the only
    // retryable call on the projection path, so leaving it on costs ~7 s PER
    // RECORD on a degraded gateway — nearly two hours for a 1,000-record
    // import, which then reports success. The read is allowed to answer
    // `unknown`, because `unknown` is handled, so the retries buy nothing.
    readFault = 'unavailable';
    seedExisting(lead());

    const started = Date.now();
    const out = await upsertCanonicalLeadWithOutcome(lead());
    const elapsed = Date.now() - started;

    expect(protectiveReads()).toHaveLength(1);
    // The first backoff alone is 1 s, so this bound cannot pass if any retry
    // happened. It is not a performance assertion.
    expect(elapsed).toBeLessThan(1000);
    // Still fail-open on the PROJECTION, and still protective of the score.
    expect(out.status).toBe('persisted');
    expect(store.get(keyOf(lead()))!.scores).toEqual(BI_1);
  });
});
