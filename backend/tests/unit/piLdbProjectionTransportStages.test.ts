/**
 * PI-LDB · a projection write's verdict must match WHAT THE FAILURE PROVES.
 *
 * ─── WHAT THIS SUITE EXISTS TO CATCH ──────────────────────────────────────
 * `classifyWriteError` was built for a libpq-shaped error and did not cover
 * this code's own transport. Production writes go over HTTP through
 * supabase-js, and @supabase/postgrest-js NEVER rejects when
 * `shouldThrowOnError` is false — the default, and nothing on this path calls
 * `.throwOnError()`. It catches the fetch and RESOLVES with
 *
 *   { data: null, error: { message, details, hint, code: '' }, status: 0 }
 *
 * so a refused connect, a reset socket and an aborted fetch all arrived with
 * `code === ''` — an empty string, not undefined — matched no code set, and
 * were flattened to `failed('write_failed')`. A socket that died AFTER the
 * POST was transmitted was being reported as a definitive failure, which is
 * the direction `projectionResult.ts` itself calls dangerous: it tells an
 * operator the lead is missing and sends them to re-enter data that may
 * already be there.
 *
 * The non-JSON gateway half was the same defect wearing a different hat: a
 * proxy answering `504` with an HTML body cannot be JSON-parsed, so
 * `processResponse` falls back to `error = { message: body }` with no `code`
 * property at all — and that, too, was a definitive failure, for a timeout
 * that says nothing about whether PostgREST committed.
 *
 * ─── WHY THE SEAM IS HERE AND NOT AT writeOwner ───────────────────────────
 * `piLdbProjectionTruthfulness` doubles `backend/db/writeOwner` with a
 * hand-written `{ data, error }` fake. That is the right seam for the
 * code-driven half and the WRONG seam for this one: a transport failure is
 * DEFINED by `status` and `details`, and a `{ data, error }` fake cannot
 * produce either. So this suite doubles `backend/db/supabaseClient` instead —
 * one layer lower — and lets the REAL postgrest-js builder run against a REAL
 * local HTTP server. Every error object asserted on below is one postgrest-js
 * actually composed, not one a test author imagined. `ownedDbTable`,
 * `observeTable`, the repository, its reconciliation read, the sink's throw
 * and the runtime's catch are all production code.
 *
 * No credential is read: `PostgrestClient` is constructed directly, so
 * `getSupabaseConfig()` never runs and SUPABASE_URL / SUPABASE_SECRET_KEY are
 * never touched. No network beyond loopback.
 *
 * NOTE ON REACH. There is NO PostgREST instance in the test environment, so
 * PGRST204 / PGRST205 / PGRST301 and friends are reachable here only by the
 * local server answering with the JSON body PostgREST would send. That is as
 * far as a unit test can go, and nothing below should be read as an
 * integration-level demonstration of them.
 */

import type { AddressInfo } from 'node:net';
import http from 'node:http';

/* ── the server under the client ───────────────────────────────────────────*/

type Reply =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'text'; status: number; body: string; contentType?: string }
  /** Consume the request, then reset the socket: transmitted, no response. */
  | { kind: 'reset' }
  /** Consume the request, then close gracefully with no response. */
  | { kind: 'close' }
  /** Serve from the keyed store below, as a real upsert/select would. */
  | { kind: 'store' };

interface Observed {
  method: string;
  path: string;
  query: string;
  body: string;
  /** The `Prefer` header, where `resolution=merge-duplicates` actually lives. */
  prefer: string;
}

/** Every request the client actually made, in order. The reachability witness. */
const requests: Observed[] = [];
/** Rows that actually "landed", keyed exactly as `lead_intelligence_dedupe_unique` is. */
const store = new Map<string, { id: string }>();
/** Timeline rows, so a duplicated provenance append is visible. */
const events: Array<Record<string, unknown>> = [];

let upsertReply: Reply = { kind: 'store' };
let readReply: Reply = { kind: 'store' };

const BASE = { url: '' };

/**
 * `supabase` is a real `PostgrestClient` pointed at the local server.
 *
 * The factory closes over `BASE` but does not DEREFERENCE it until `from` is
 * called, which only happens inside a test — by then `beforeAll` has set it.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostgrestClient } = require('@supabase/postgrest-js');
      return new PostgrestClient(BASE.url).from(table);
    },
  },
}));

const warn = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  buildAttributionContract,
  classifyWriteOutcome,
  computeLeadDedupeKey,
  isProjected,
  needsAttention,
  writeStageOf,
  type CanonicalLead,
} from '../../../lib/leadIntelligence';
import {
  durableLeadIntelligenceSink,
  LeadProjectionFailure,
} from '../../services/leadIntelligence/durableLeadIntelligenceSink';
import {
  findCanonicalLeadIdByDedupeKey,
  upsertCanonicalLeadWithOutcome,
} from '../../services/leadIntelligence/leadIntelligenceRepository';
import { createLeadIntelligenceIngestor } from '../../services/leadIntelligence/leadIntelligenceFacade';
import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import {
  getProvenanceIngestionCounters,
  resetProvenanceIngestionCounters,
} from '../../services/prospectProvenance/ingestion/provenanceTelemetry';

const ORG = '00000000-0000-4000-8000-0000000000aa';

function lead(over: Partial<CanonicalLead> = {}): CanonicalLead {
  const identity = { email: 'ada@example.com', unifiedPersonId: 'person-1' };
  return {
    organizationId: ORG,
    source: 'import',
    identity,
    attribution: buildAttributionContract({ Email: 'ada@example.com' }, identity),
    status: null,
    occurredAt: '2026-11-04T10:00:00.000Z',
    display: { name: 'Ada Lovelace', title: 'Senior Procurement Manager', contentText: null },
    sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
    unifiedPersonId: 'person-1',
    ingestedAt: '2026-11-04T10:00:00.000Z',
    ...over,
  };
}

const keyOf = (l: CanonicalLead) => `${l.organizationId}|${computeLeadDedupeKey(l)}`;
const eqParam = (query: string, column: string) =>
  new URLSearchParams(query).get(column)?.replace(/^eq\./, '') ?? null;

function send(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const [path, query = ''] = String(req.url ?? '').split('?');
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: String(req.method), path, query, body,
        prefer: String(req.headers.prefer ?? ''),
      });

      // The timeline insert. Always accepted, so a duplicated append shows up
      // as a second row rather than as an error.
      if (path === '/lead_intelligence_events') {
        events.push(JSON.parse(body || '{}'));
        send(res, 201, '', 'application/json');
        return;
      }

      const reply = req.method === 'GET' ? readReply : upsertReply;

      if (reply.kind === 'reset') {
        // Transmitted in full, then the socket dies. `status` 0 at the client.
        req.socket.resetAndDestroy();
        return;
      }
      if (reply.kind === 'close') {
        req.socket.end();
        return;
      }
      if (reply.kind === 'json') {
        send(res, reply.status, JSON.stringify(reply.body), 'application/json');
        return;
      }
      if (reply.kind === 'text') {
        send(res, reply.status, reply.body, reply.contentType ?? 'text/plain');
        return;
      }

      // kind: 'store' — behave like the real table.
      if (req.method === 'GET') {
        const hit = store.get(`${eqParam(query, 'company_id')}|${eqParam(query, 'dedupe_key')}`);
        send(res, 200, JSON.stringify(hit ? [hit] : []), 'application/json');
        return;
      }
      const row = JSON.parse(body) as Record<string, unknown>;
      const key = `${String(row.company_id)}|${String(row.dedupe_key)}`;
      const existing = store.get(key);
      const id = existing ? existing.id : `row-${store.size + 1}`;
      store.set(key, { id });
      send(res, 201, JSON.stringify([{ id }]), 'application/json');
    });
  });
  // A reset socket surfaces as an error event on the server too; swallow it so
  // the misbehaviour under test does not fail the run.
  server.on('clientError', (_e, socket) => socket.destroy());
  server.on('error', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  BASE.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests.length = 0;
  events.length = 0;
  store.clear();
  upsertReply = { kind: 'store' };
  readReply = { kind: 'store' };
  warn.mockClear();
  resetProvenanceIngestionCounters();
});

const posts = () => requests.filter((r) => r.path === '/lead_intelligence' && r.method === 'POST');
const gets = () => requests.filter((r) => r.path === '/lead_intelligence' && r.method === 'GET');

/* ── the seam is real ──────────────────────────────────────────────────────*/

describe('the production transport is actually under test', () => {
  it('a confirmed write goes out over HTTP and comes back as persisted', async () => {
    const out = await durableLeadIntelligenceSink.emit(lead());

    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-1');
    // Reachability: the request REALLY left, as a POST, carrying the real
    // `toRow` payload, keyed by the real `computeLeadDedupeKey`, with the
    // `on_conflict` that makes a retry an update. Without these four, every
    // assertion in this file could be satisfied by code that never ran.
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0].body).dedupe_key).toBe(computeLeadDedupeKey(lead()));
    expect(JSON.parse(posts()[0].body).display).toEqual({
      name: 'Ada Lovelace', title: 'Senior Procurement Manager', contentText: null,
    });
    expect(decodeURIComponent(posts()[0].query)).toContain('on_conflict=company_id,dedupe_key');
    expect(store.size).toBe(1);
  });
});

/* ── 1. an ambiguous transport failure cannot report persistence ───────────*/

describe('an ambiguous transport failure cannot report successful persistence', () => {
  it('a socket reset after the POST was transmitted never reads as persisted', async () => {
    upsertReply = { kind: 'reset' };

    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);

    // `instanceof` AND a positive `reason` pin. Without both, this test passes
    // off a TypeError: delete the code under test and the sink throws one,
    // `.catch` captures it, and `status !== 'persisted'` is trivially true of
    // `undefined`. That is not hypothetical — see
    // `piProvIngestionAdoption.test.ts` on the suite that went green off
    // exactly that.
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;
    expect(out.reason).toBe('unconfirmed_transport');

    expect(out.status).not.toBe('persisted');
    expect(out.leadId).toBeNull();
    expect(isProjected(out)).toBe(false);
    expect(needsAttention(out)).toBe(true);
    // And it really was transmitted, body and all.
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0].body).dedupe_key).toBe(computeLeadDedupeKey(lead()));
  });

  it('nor does a gateway timeout, which carries no code at all', async () => {
    upsertReply = { kind: 'text', status: 504, body: '<html>gateway timeout</html>', contentType: 'text/html' };

    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;
    expect(out.status).toBe('pending_reconciliation');
    expect(out.reason).toBe('unconfirmed_transport');
    expect(isProjected(out)).toBe(false);
    expect(posts()).toHaveLength(1);
  });
});

/* ── 2. it cannot discard the possibility of a committed row ───────────────*/

describe('pre-send and post-send are never collapsed', () => {
  /**
   * BOTH halves in ONE table, on purpose.
   *
   * A classifier that answered `pending_reconciliation` for everything is the
   * natural degeneration of "when in doubt, pend", and it satisfies the
   * post-send rows. It fails the pre-send rows. A classifier that answered
   * `failed` for everything fails the post-send rows. NO CONSTANT PASSES THIS
   * TABLE, and the `writeStageOf` column makes that structural rather than
   * coincidental: the stage is pinned, so two modes cannot agree on a status
   * for different reasons.
   */
  it.each([
    ['socket reset after transmit', { kind: 'reset' } as Reply, 'post_send', 'pending_reconciliation', 'unconfirmed_transport'],
    ['socket closed after transmit', { kind: 'close' } as Reply, 'post_send', 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 504 from a proxy', { kind: 'text', status: 504, body: 'gateway timeout' } as Reply, 'answered', 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 408 from a proxy', { kind: 'text', status: 408, body: 'Request Timeout' } as Reply, 'answered', 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 502 from a proxy', { kind: 'text', status: 502, body: 'Bad Gateway' } as Reply, 'answered', 'pending_reconciliation', 'unconfirmed_transport'],
  ])('%s leaves the outcome open', async (_label, reply, _stage, status, reason) => {
    upsertReply = reply;
    const out = await upsertCanonicalLeadWithOutcome(lead());
    expect(out.status).toBe(status);
    expect(out.reason).toBe(reason);
    expect(posts()).toHaveLength(1);
    // The STAGE claim is asserted in the next describe, against the real
    // captured `{ status, code, details }` rather than against a shape
    // rebuilt here — a hand-built observation would pass whatever the runtime
    // actually produces, which is the one thing it must not do.
  });

  it('a connection that was never established is a DEFINITE failure, not pending', async () => {
    // A port nothing is listening on. The connect is refused, so not one byte
    // of the upsert was transmitted and a row cannot exist. Calling this
    // `pending_reconciliation` would manufacture uncertainty the runtime
    // itself rules out — and would send a reconciliation read after a row that
    // cannot be there.
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const previous = BASE.url;
    BASE.url = `http://127.0.0.1:${deadPort}`;
    try {
      const out = await upsertCanonicalLeadWithOutcome(lead());
      expect(out.status).toBe('failed');
      expect(out.reason).toBe('not_transmitted');
      expect(out.status).not.toBe('pending_reconciliation');
      // Nothing reached a server, so our server saw nothing — including no
      // reconciliation read, which is the point: we do not go looking for a
      // row that cannot exist.
      expect(requests).toHaveLength(0);
    } finally {
      BASE.url = previous;
    }
  });

  it('a DNS failure is also pre-send, and the errno survives a dual-stack AggregateError', async () => {
    // `.invalid` is reserved and never resolves. The discriminator is the
    // trailing `(ERRNO)` postgrest-js appends from `cause.code` — matched as
    // that suffix, NOT as loose message text, because a dual-stack connect
    // failure wraps an AggregateError whose `message` is EMPTY while its
    // `code` survives.
    const previous = BASE.url;
    BASE.url = 'http://no-such-host-omnivyra-pildb.invalid';
    try {
      const out = await upsertCanonicalLeadWithOutcome(lead());
      expect(out.status).toBe('failed');
      expect(out.reason).toBe('not_transmitted');
      expect(requests).toHaveLength(0);
    } finally {
      BASE.url = previous;
    }
  });

});

describe('the pre-send discriminator is the one the runtime really provides', () => {
  it('post-send errnos appear as a trailing (CODE) in error.details, and are not pre-send', async () => {
    upsertReply = { kind: 'reset' };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostgrestClient } = require('@supabase/postgrest-js');
    const res = await new PostgrestClient(BASE.url)
      .from('lead_intelligence')
      .upsert({ company_id: ORG, dedupe_key: 'k' }, { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .maybeSingle();

    // The shape the whole policy rests on, asserted rather than assumed.
    expect(res.status).toBe(0);
    expect(res.error.code).toBe('');
    expect(typeof res.error.details).toBe('string');
    expect(res.error.details).toMatch(/\((ECONNRESET|UND_ERR_SOCKET)\)/);

    expect(writeStageOf({ ...res.error, status: res.status })).toBe('post_send');
    expect(classifyWriteOutcome({ ...res.error, status: res.status }).status).toBe('pending_reconciliation');
  });

  it('a pre-send errno in the SAME field yields a definite failure', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostgrestClient } = require('@supabase/postgrest-js');
    const res = await new PostgrestClient(`http://127.0.0.1:${deadPort}`)
      .from('lead_intelligence')
      .upsert({ company_id: ORG, dedupe_key: 'k' }, { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .maybeSingle();

    expect(res.status).toBe(0);
    expect(res.error.code).toBe('');
    expect(res.error.details).toMatch(/\(ECONNREFUSED\)/);
    // Same `status: 0`, same empty `code`, OPPOSITE verdict. This is the pair
    // that proves `status` alone cannot decide it and `details` is load-bearing.
    expect(writeStageOf({ ...res.error, status: res.status })).toBe('pre_send');
    expect(classifyWriteOutcome({ ...res.error, status: res.status }).reason).toBe('not_transmitted');
  });

  it('an aborted fetch is uncertain — and is unreachable through the production path today', async () => {
    // `upsertCanonicalLeadWithOutcome` passes no `abortSignal`, so this mode
    // cannot be produced through the repository. It is exercised at the
    // classifier against a REAL captured abort error, and labelled as such
    // rather than implied to be live.
    upsertReply = { kind: 'json', status: 201, body: [{ id: 'row-1' }] };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostgrestClient } = require('@supabase/postgrest-js');
    const res = await new PostgrestClient(BASE.url)
      .from('lead_intelligence')
      .upsert({ company_id: ORG, dedupe_key: 'k' }, { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .abortSignal(AbortSignal.abort())
      .maybeSingle();

    expect(res.status).toBe(0);
    expect(res.error.message).toMatch(/^AbortError/);
    // No `Caused by`, so nothing locates it. Safe side.
    expect(classifyWriteOutcome({ ...res.error, status: res.status }).status).toBe('pending_reconciliation');
  });
});

/* ── 3. reconciliation detects an existing row ─────────────────────────────*/

describe('reconciliation detects an existing row', () => {
  it('finds the committed row by the SAME key the write used, and reads rather than re-writes', async () => {
    // Staged as "the write committed and the answer was lost": the row is in
    // the store under the key the upsert carries, and the POST resets.
    const l = lead();
    store.set(keyOf(l), { id: 'row-7' });
    upsertReply = { kind: 'reset' };

    const out = await durableLeadIntelligenceSink.emit(l);

    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-7');
    expect(out.reconciled).toBe(true);
    expect(isProjected(out)).toBe(true);
    expect(out.warnings.join(' ')).toContain('found by its dedupe key');

    // The GET's filters are the POST's key. The server serves the store by
    // that key, so finding `row-7` is only possible if the two keys are ONE
    // key — which is the claim, and it cannot be satisfied by accident.
    expect(gets()).toHaveLength(1);
    expect(eqParam(gets()[0].query, 'company_id')).toBe(ORG);
    expect(eqParam(gets()[0].query, 'dedupe_key')).toBe(computeLeadDedupeKey(l));
    expect(eqParam(gets()[0].query, 'dedupe_key')).toBe(String(JSON.parse(posts()[0].body).dedupe_key));

    // Read, NOT retried. "Never retry a possibly-committed write" asserted as
    // a wire transcript, not as a comment: a second POST fails this.
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /lead_intelligence',
      'GET /lead_intelligence',
    ]);
    expect(store.size).toBe(1);
  });

  it('cannot prove ABSENCE, so a read that finds nothing stays unconfirmed', async () => {
    // The lost write may still be EXECUTING server-side — PostgREST holds its
    // own connection to Postgres and the statement runs to completion whoever
    // is still listening. So an immediate read that misses the row does not
    // prove it is absent, and must not become `failed`.
    upsertReply = { kind: 'reset' };
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    const out = (err as LeadProjectionFailure).result;

    expect(out.status).toBe('pending_reconciliation');
    expect(out.status).not.toBe('failed');
    expect(out.warnings.join(' ')).toContain('did not find it yet');
    expect(gets()).toHaveLength(1);
  });

  it('keeps "could not look" apart from "looked, nothing there"', async () => {
    upsertReply = { kind: 'reset' };
    readReply = { kind: 'json', status: 500, body: { code: '08006', message: 'connection to server lost' } };
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    const out = (err as LeadProjectionFailure).result;
    expect(out.status).toBe('pending_reconciliation');
    expect(out.warnings.join(' ')).toContain('could not read this row back');
  });

  it('the read-back itself is three-valued, so a failed read is never a proven absence', async () => {
    store.set(`${ORG}|k-present`, { id: 'row-9' });
    await expect(findCanonicalLeadIdByDedupeKey(ORG, 'k-present')).resolves.toEqual({ outcome: 'found', leadId: 'row-9' });
    await expect(findCanonicalLeadIdByDedupeKey(ORG, 'k-missing')).resolves.toEqual({ outcome: 'absent' });
    // A non-retryable status, deliberately — see the next test for why 503 is
    // not used here.
    readReply = { kind: 'text', status: 500, body: 'Internal Server Error' };
    await expect(findCanonicalLeadIdByDedupeKey(ORG, 'k-present')).resolves.toEqual({ outcome: 'unknown' });
    // `null` for both of the last two would be the original defect in
    // miniature: a failed READ read as a definite projection failure.
  });

  it('the read-back is a GET, so postgrest-js AUTO-RETRIES it on 503/520 — ~7s worst case', async () => {
    // Worth a test of its own because it is a latency characteristic this
    // reconciliation introduces, and nothing else on this path has it.
    // postgrest-js retries only GET/HEAD/OPTIONS (`RETRYABLE_METHODS`) and
    // only on 503/520 (`RETRYABLE_STATUS_CODES`), with 1s/2s/4s backoff and
    // `DEFAULT_MAX_RETRIES` 3. The upsert is a POST and is therefore NEVER
    // retried — which is what keeps the write idempotency story intact — but
    // the read IS, so a flapping pooler can add seconds per record to an
    // import that reconciles. Pinned so the cost is visible rather than
    // discovered in production.
    readReply = { kind: 'text', status: 503, body: 'Service Unavailable' };
    const started = Date.now();
    await expect(findCanonicalLeadIdByDedupeKey(ORG, 'k-present')).resolves.toEqual({ outcome: 'unknown' });
    expect(gets()).toHaveLength(4); // the original + DEFAULT_MAX_RETRIES
    expect(Date.now() - started).toBeGreaterThan(6000);
    // The retries carry the client's own attempt counter, which is the proof
    // these four requests are one logical read and not four reconciliations.
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(4);
  }, 20000);
});

/* ── 4. duplicate retries duplicate neither identity nor provenance ────────*/

describe('duplicate retries do not create duplicate lead identity or provenance', () => {
  it('collapses retries onto one row, and still gives a DIFFERENT prospect its own', async () => {
    const first = await durableLeadIntelligenceSink.emit(lead());
    const second = await durableLeadIntelligenceSink.emit(lead());
    const third = await durableLeadIntelligenceSink.emit(lead({ status: 'reviewing' }));

    expect(new Set([first.leadId, second.leadId, third.leadId])).toEqual(new Set(['row-1']));
    expect(store.size).toBe(1);

    // THE POSITIVE CONTROL. A fake that dropped every write also yields one
    // identity and zero duplicates, so the assertions above are worthless
    // without this: a distinct prospect MUST get its own row.
    const other = await durableLeadIntelligenceSink.emit(
      lead({ sourceRef: { table: 'canonical_leads', id: 'prospect-2' } }),
    );
    expect(other.leadId).not.toBe('row-1');
    expect(store.size).toBe(2);

    // Every POST carried the conflict target, which is what makes a retry an
    // UPDATE on the wire rather than a property of this fake store.
    expect(posts()).toHaveLength(4);
    expect(posts().every((p) => decodeURIComponent(p.query).includes('on_conflict=company_id,dedupe_key'))).toBe(true);
    // And the resolution that makes the conflict an UPDATE. It is a `Prefer`
    // header, not a query param, so it has to be read off the request.
    expect(posts().every((p) => p.prefer.includes('resolution=merge-duplicates'))).toBe(true);
  });

  it('a reconciled pass appends NO timeline event, so provenance is not duplicated', async () => {
    // Four confirmed writes first, each of which DOES append — so the count
    // below is an increase over zero and proves the append path works. Without
    // that, "events stayed at 4" would also hold if the append were never
    // wired at all.
    await durableLeadIntelligenceSink.emit(lead());
    await durableLeadIntelligenceSink.emit(lead({ sourceRef: { table: 'canonical_leads', id: 'p2' } }));
    await durableLeadIntelligenceSink.emit(lead({ sourceRef: { table: 'canonical_leads', id: 'p3' } }));
    await durableLeadIntelligenceSink.emit(lead({ sourceRef: { table: 'canonical_leads', id: 'p4' } }));
    expect(events).toHaveLength(4);

    // Now the reconciled pass: the row is already there, the write's answer is
    // lost, reconciliation finds it — and appends nothing. `lead_intelligence_
    // events` has NO unique constraint (migration 20260629000000 creates only
    // the non-unique `idx_lead_intelligence_events_lead`), so an append here
    // would duplicate provenance in exactly the case where the first attempt
    // had recorded it.
    upsertReply = { kind: 'reset' };
    const out = await durableLeadIntelligenceSink.emit(lead());
    expect(out.status).toBe('persisted');
    expect(out.reconciled).toBe(true);
    expect(events).toHaveLength(4);
    expect(store.size).toBe(4);
  });
});

/* ── 5. confirmed failure stays distinguishable from uncertain completion ──*/

describe('confirmed failure stays distinguishable from uncertain completion', () => {
  /**
   * One table, both halves. Every row pins `reason` as well as `status`:
   * asserting only `status` would let `failed('write_failed')` stand in for
   * every rejection, which is the defect this programme exists to remove — an
   * operator told "the write failed" goes looking at the data when the answer
   * is an unapplied migration. And a one-sided table is passable by a
   * constant; both halves in one table makes every constant fail a row.
   */
  it.each<[string, Reply, string, string]>([
    // ── PROVES REJECTION ────────────────────────────────────────────────
    ['PGRST204 column not in schema cache', { kind: 'json', status: 400, body: { code: 'PGRST204', message: "Could not find the 'display' column" } }, 'failed', 'schema_not_applied'],
    ['PGRST205 table not in schema cache', { kind: 'json', status: 404, body: { code: 'PGRST205', message: 'table not in cache' } }, 'failed', 'schema_not_applied'],
    ['42703 undefined column', { kind: 'json', status: 400, body: { code: '42703', message: 'column "display" does not exist' } }, 'failed', 'schema_not_applied'],
    ['42P01 undefined table', { kind: 'json', status: 404, body: { code: '42P01', message: 'relation does not exist' } }, 'failed', 'schema_not_applied'],
    ['42501 RLS refusal', { kind: 'json', status: 403, body: { code: '42501', message: 'violates row-level security policy' } }, 'failed', 'denied'],
    ['PGRST301 JWT/role', { kind: 'json', status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, 'failed', 'denied'],
    ['PGRST302 anonymous access disabled', { kind: 'json', status: 401, body: { code: 'PGRST302', message: 'anon disabled' } }, 'failed', 'denied'],
    ['23502 not-null violation', { kind: 'json', status: 400, body: { code: '23502', message: 'null value in column' } }, 'failed', 'invalid'],
    ['23505 unique violation on another constraint', { kind: 'json', status: 409, body: { code: '23505', message: 'duplicate key value' } }, 'failed', 'invalid'],
    ['PGRST000 could not connect to the database', { kind: 'json', status: 503, body: { code: 'PGRST000', message: 'could not connect' } }, 'failed', 'not_reached_database'],
    ['PGRST003 pool wait timed out', { kind: 'json', status: 504, body: { code: 'PGRST003', message: 'pool timeout' } }, 'failed', 'not_reached_database'],
    ['53300 too many connections', { kind: 'json', status: 503, body: { code: '53300', message: 'no connection slots' } }, 'failed', 'not_reached_database'],
    ['HTTP 400 with no code', { kind: 'text', status: 400, body: 'Bad Request' }, 'failed', 'write_failed'],
    ['HTTP 413 with no code', { kind: 'text', status: 413, body: 'Payload Too Large' }, 'failed', 'write_failed'],
    // ── LEAVES THE OUTCOME UNCERTAIN ────────────────────────────────────
    ['57014 statement timeout', { kind: 'json', status: 500, body: { code: '57014', message: 'canceling statement due to statement timeout' } }, 'pending_reconciliation', 'no_row_returned'],
    ['08006 connection failure', { kind: 'json', status: 500, body: { code: '08006', message: 'connection to server lost' } }, 'pending_reconciliation', 'no_row_returned'],
    ['08007 transaction resolution unknown', { kind: 'json', status: 500, body: { code: '08007', message: 'transaction resolution unknown' } }, 'pending_reconciliation', 'no_row_returned'],
    ['40001 serialization failure', { kind: 'json', status: 500, body: { code: '40001', message: 'could not serialize' } }, 'pending_reconciliation', 'no_row_returned'],
    ['PGRST001 internal connection error', { kind: 'json', status: 503, body: { code: 'PGRST001', message: 'connection lost' } }, 'pending_reconciliation', 'no_row_returned'],
    ['PGRST116 maybeSingle saw more than one row', { kind: 'json', status: 406, body: { code: 'PGRST116', message: 'multiple (or no) rows returned' } }, 'pending_reconciliation', 'no_row_returned'],
    ['HTTP 504 gateway timeout, no code', { kind: 'text', status: 504, body: 'gateway timeout' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 408 request timeout, no code', { kind: 'text', status: 408, body: 'Request Timeout' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 502 bad gateway, no code', { kind: 'text', status: 502, body: 'Bad Gateway' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 520 cloudflare, no code', { kind: 'text', status: 520, body: 'unknown error' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 546 pooler, no code', { kind: 'text', status: 546, body: 'connection error' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 503 unavailable, no code', { kind: 'text', status: 503, body: 'Service Unavailable' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 429 rate limited, no code', { kind: 'text', status: 429, body: 'Too Many Requests' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['socket reset after the POST', { kind: 'reset' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['socket closed after the POST', { kind: 'close' }, 'pending_reconciliation', 'unconfirmed_transport'],
    ['HTTP 2xx with an empty body', { kind: 'text', status: 201, body: '', contentType: 'application/json' }, 'pending_reconciliation', 'no_row_returned'],
    ['HTTP 404 with an empty body (rewritten to 204)', { kind: 'text', status: 404, body: '' }, 'pending_reconciliation', 'no_row_returned'],
  ])('%s', async (_label, reply, status, reason) => {
    upsertReply = reply;
    const out = await upsertCanonicalLeadWithOutcome(lead());
    expect(out.status).toBe(status);
    expect(out.reason).toBe(reason);
    expect(out.leadId).toBeNull();
    expect(needsAttention(out)).toBe(true);
    expect(posts()).toHaveLength(1);
    // A definite failure must NOT send a reconciliation read after a row it
    // has already established cannot be there; an uncertain one MUST.
    expect(gets()).toHaveLength(status === 'pending_reconciliation' ? 1 : 0);
  });

  it('every one of those is still exactly one of the FOUR statuses', async () => {
    // The contract has four STATUSES and a wider set of REASONS. This policy
    // adds reasons only; a fifth status would break the aliasing guard in
    // `piLdbProjectionTruthfulness` and widen a contract the import UI reads.
    for (const reply of [
      { kind: 'reset' } as Reply,
      { kind: 'text', status: 504, body: 'x' } as Reply,
      { kind: 'json', status: 400, body: { code: 'PGRST204', message: 'x' } } as Reply,
    ]) {
      upsertReply = reply;
      const out = await upsertCanonicalLeadWithOutcome(lead());
      expect(['persisted', 'skipped', 'failed', 'pending_reconciliation']).toContain(out.status);
    }
  });
});

/* ── 6. the existing adoption telemetry is preserved ───────────────────────*/

describe('lead_adoption:failed telemetry is preserved for every non-persisted outcome', () => {
  /**
   * Deliberately NOT a double of `leadIntelligenceRepository`. The whole chain
   * runs — repository, sink throw, `ingestCanonicalLead`, `adoptLeadAsync`'s
   * catch — with only identity stubbed, exactly as
   * `piProvIngestionAdoption.test.ts` stubs it. That removes the hazard that
   * suite documents: an incomplete module double throws a TypeError, and
   * because `adoptLeadAsync` counts ANY throw as `lead_adoption:failed`, the
   * test that exists to prove the telemetry goes green off the TypeError.
   * Here there is no module double to be incomplete.
   */
  const ingestor = () => createLeadIntelligenceIngestor({
    sink: durableLeadIntelligenceSink,
    identity: { resolve: async () => ({ unifiedPersonId: null }) },
  });

  it.each<[string, Reply, string]>([
    ['an unapplied migration', { kind: 'json', status: 400, body: { code: 'PGRST204', message: "Could not find the 'display' column" } }, 'failed'],
    ['an RLS refusal', { kind: 'json', status: 403, body: { code: '42501', message: 'violates row-level security policy' } }, 'failed'],
    ['a connection that was refused by PostgREST', { kind: 'json', status: 503, body: { code: 'PGRST000', message: 'could not connect' } }, 'failed'],
    ['a socket reset after transmit', { kind: 'reset' }, 'pending_reconciliation'],
    ['a gateway timeout', { kind: 'text', status: 504, body: 'gateway timeout' }, 'pending_reconciliation'],
  ])('%s still reaches the counter', async (_label, reply, _expectedStatus) => {
    upsertReply = reply;

    await expect(
      adoptLeadAsync('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' }, ingestor()),
    ).resolves.toBeUndefined();

    expect(getProvenanceIngestionCounters()['lead_adoption:failed']).toBe(1);
    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('prospect_provenance_side_effect_failed', expect.objectContaining({
      path: 'lead_adoption', outcome: 'failed', source: 'website', organizationId: 'co-1', sourceRowId: 'L1',
    }));

    // The counter must have been reached by a CLASSIFIED verdict, not by the
    // chain exploding. Both halves matter: the message proves a verdict
    // carried, and the negative proves it was not a missing-export TypeError.
    const payload = warn.mock.calls.find((c) => c[0] === 'prospect_provenance_side_effect_failed')?.[1] as { error?: string };
    expect(String(payload?.error)).not.toMatch(/is not a function/);
    // The write really was attempted over the wire on this very call, so the
    // counter was reached through the production chain and not by the chain
    // failing to start. (The verdicts themselves are pinned exhaustively in
    // the matrix above; this test is about the counter.)
    expect(posts()).toHaveLength(1);
  });

  it('a reconciled success is counted as a SUCCESS, because the row is there', async () => {
    // The one case where the counter legitimately moves the other way: the
    // write's answer was lost but the row exists, so `lead_adoption:failed`
    // would be a lie. Nothing that remains non-persisted stops reaching the
    // failure counter — proved by the five rows above.
    upsertReply = { kind: 'reset' };
    readReply = { kind: 'json', status: 200, body: [{ id: 'row-reconciled' }] };

    await adoptLeadAsync('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' }, ingestor());

    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBe(1);
    expect(getProvenanceIngestionCounters()['lead_adoption:failed']).toBeUndefined();
    // And no timeline event, because the reconciled path appends none.
    expect(events).toHaveLength(0);
  });
});
