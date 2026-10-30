/**
 * PI WS-3H — the eligible-messages picker: the service AND the endpoint.
 *
 * The property under test is not "does it return a list". It is that the list
 * cannot contain a message the capture path would refuse, cannot contain another
 * tenant's message, cannot contain a third party's identity, and cannot be
 * widened by anything a caller sends.
 *
 * So the DEFAULT PORTS run against a stub database rather than being doubled
 * away: the tenant predicates ARE the security property, and one of them cannot
 * exist — `engagement_messages.organization_id` may not be present, so that
 * table's isolation depends entirely on the thread ids it is handed. A suite
 * that mocked `loadMessages` would prove nothing about it. The injected-ports
 * form is used only where a stub query cannot produce the row at all: the
 * fail-open case where a widened query returns a foreign thread.
 *
 * The endpoint half runs the REAL service through the same stub, so "the service
 * receives the verified tenant" is asserted as a tenant predicate that actually
 * reached a table, not as an argument to a mock.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string; code?: string } | undefined>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  selects: [] as Array<{ table: string; columns: string }>,
  orders: [] as Array<{ table: string; column: string; options: unknown }>,
  limits: [] as Array<{ table: string; value: number }>,
  writeOps: [] as string[],
};

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const requireTenantAccess = jest.fn();
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let sortCol: string | null = null;
    let cap: number | null = null;
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      let matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c] as never)));
      if (sortCol !== null) {
        const col = sortCol;
        // Descending, NULLS LAST — what the production call asks for explicitly.
        matched = [...matched].sort((a, b) => {
          const x = a[col] === null || a[col] === undefined ? null : String(a[col]);
          const y = b[col] === null || b[col] === undefined ? null : String(b[col]);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return y.localeCompare(x);
        });
      }
      if (cap !== null) matched = matched.slice(0, cap);
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: (columns?: string) => { db.selects.push({ table, columns: columns ?? '' }); return api; },
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      // `IS NULL` is a real predicate, not a no-op: `revoked_at IS NULL` is the
      // whole definition of an ACTIVE attestation, so it is recorded and
      // applied exactly like `eq` — otherwise a suite could not tell an
      // active-rows read from a read of every row ever written.
      is: (c: string, v: unknown) => {
        eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api;
      },
      order: (c: string, options?: unknown) => {
        sortCol = c; db.orders.push({ table, column: c, options }); return api;
      },
      limit: (v: number) => { cap = v; db.limits.push({ table, value: v }); return api; },
      maybeSingle: () => run().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        run().then(resolve, reject),
    };
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      api[op] = () => { db.writeOps.push(`${table}.${op}`); return api; };
    }
    return api;
  },
}));

import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
} from '../../services/engagementIdentity/attestedIdentityContract';
import {
  ELIGIBLE_PROSPECT_MESSAGES_VERSION,
  ELIGIBLE_PROSPECT_MESSAGES_PERFORMS_NO_WRITE,
  ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT,
  ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX,
  ELIGIBLE_PROSPECT_MESSAGES_RELATIONS,
  ELIGIBLE_MESSAGE_PREVIEW_MAX,
  resolveEligibleMessagesLimit,
  readEligibleProspectMessages,
  defaultEligibleProspectMessagesPorts,
  type EligibleProspectMessagesPorts,
} from '../../services/prospectProblems/eligibleProspectMessages';
import handler from '../../../pages/api/prospects/[id]/eligible-messages';
import { PROSPECT_API_VERSION } from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { PROBLEM_OBSERVATION_CONTRACT_VERSION } from '../../services/prospectProblems/types';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SERVICE_FILE = 'backend/services/prospectProblems/eligibleProspectMessages.ts';
const ROUTE_FILE = 'pages/api/prospects/[id]/eligible-messages.ts';
const readSource = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const ORG_A = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ORG_B = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const PROSPECT = 'bb2cf3d9-9d2e-4d8a-9a3e-0cf3b5d8e111';
const PERSON = 'c1a2b3c4-d5e6-4f70-8a91-b2c3d4e5f601';
const ACCOUNT = 'd2b3c4d5-e6f7-4081-9ab2-c3d4e5f60712';
const THREAD = 'e3c4d5e6-f708-4192-abc3-d4e5f6071823';
const THREAD_B = 'f4d5e6f7-0819-42a3-bcd4-e5f607182934';
const AUTHOR = 'a5e6f708-192a-43b4-cde5-f60718293a45';
const AUTHOR_OTHER = 'b6f70819-2a3b-44c5-def6-0718293a4b56';

const MSG = (n: number): string => `0${n}000000-0000-4000-8000-00000000000${n}`;

const STATEMENT = 'our three dashboards disagree and nobody can say which one to take to the board';
const LONG = `${'a'.repeat(ELIGIBLE_MESSAGE_PREVIEW_MAX + 50)}`;

function seed(): void {
  db.tables = {
    canonical_leads: [
      { id: PROSPECT, company_id: ORG_A, unified_person_id: PERSON },
    ],
    unified_persons: [
      { id: PERSON, company_id: ORG_A, account_id: ACCOUNT },
    ],
    prospect_accounts: [
      { id: ACCOUNT, organization_id: ORG_A },
    ],
    engagement_threads: [
      { id: THREAD, platform: 'linkedin', organization_id: ORG_A, unified_person_id: PERSON },
      // ANOTHER TENANT's thread for the SAME globally-unique person id. A person
      // id is not authorisation, and this row must never contribute a message.
      { id: THREAD_B, platform: 'linkedin', organization_id: ORG_B, unified_person_id: PERSON },
    ],
    engagement_authors: [
      { id: AUTHOR, platform: 'linkedin', platform_user_id: 'prospect-123', display_name: 'Ada Prospect' },
      { id: AUTHOR_OTHER, platform: 'linkedin', platform_user_id: 'colleague-999', display_name: 'Bo Colleague' },
    ],
    contacts: [
      {
        id: 'contact-a', organization_id: ORG_A, unified_person_id: PERSON,
        platform: 'linkedin', platform_user_id: 'prospect-123',
      },
    ],
    engagement_messages: [
      // ELIGIBLE — newest.
      {
        id: MSG(1), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:1', direction: 'inbound',
        content: STATEMENT, raw_payload: {}, platform_created_at: '2026-09-20T10:00:00.000Z',
        sentiment_score: 0.4, like_count: 3, reply_count: 1,
      },
      // ELIGIBLE — older, and long enough to be truncated.
      {
        id: MSG(2), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:2', direction: 'inbound',
        content: LONG, raw_payload: {}, platform_created_at: '2026-09-10T10:00:00.000Z',
      },
      // A THIRD PARTY in the prospect's thread. `message_type` defaults to
      // 'comment', so this is ordinary, and it is not the prospect speaking.
      {
        id: MSG(3), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR_OTHER,
        platform_message_id: 'urn:li:comment:3', direction: 'inbound',
        content: 'we also looked at a competitor', raw_payload: {},
        platform_created_at: '2026-09-19T10:00:00.000Z',
      },
      // NO AUTHOR AT ALL.
      {
        id: MSG(4), thread_id: THREAD, platform: 'linkedin', author_id: null,
        platform_message_id: 'urn:li:comment:4', direction: 'inbound',
        content: 'anonymous words', raw_payload: {},
        platform_created_at: '2026-09-18T10:00:00.000Z',
      },
      // OURS. The author identity matches the prospect, but the row is a sent
      // message — `isAuthorSelf` is what excludes it.
      {
        id: MSG(5), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:5', direction: 'outgoing',
        content: 'does any of that sound right?', raw_payload: {},
        platform_created_at: '2026-09-17T10:00:00.000Z',
      },
      // NO SOURCE INSTANT. Our ingest clock is never substituted.
      {
        id: MSG(6), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:6', direction: 'inbound',
        content: 'said at an unknown time', raw_payload: {},
        platform_created_at: null, created_at: '2026-09-16T10:00:00.000Z',
      },
      // NO TEXT once the platform's sender prefix is stripped.
      {
        id: MSG(7), thread_id: THREAD, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:7', direction: 'inbound',
        content: 'Ada:   ', raw_payload: {},
        platform_created_at: '2026-09-15T10:00:00.000Z',
      },
      // ANOTHER TENANT's message, on another tenant's thread.
      {
        id: MSG(8), thread_id: THREAD_B, platform: 'linkedin', author_id: AUTHOR,
        platform_message_id: 'urn:li:comment:8', direction: 'inbound',
        content: 'tenant B words', raw_payload: {},
        platform_created_at: '2026-09-21T10:00:00.000Z',
      },
    ],
  };
  db.errors = {};
  db.filters = [];
  db.selects = [];
  db.orders = [];
  db.limits = [];
  db.writeOps = [];
}

function makeRes() {
  const res: Record<string, unknown> = { _status: 0, _json: null, _headers: {} };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.setHeader = (k: string, v: unknown) => { (res._headers as Record<string, unknown>)[k] = v; };
  res.end = () => res;
  return res as never;
}

const call = async (over: Record<string, unknown> = {}) => {
  const req = {
    method: 'GET',
    query: { companyId: ORG_A, id: PROSPECT },
    url: '/api/prospects/[id]/eligible-messages',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res as unknown as { _status: number; _json: Record<string, unknown>; _headers: Record<string, unknown> };
};

const read = (over: Record<string, unknown> = {}) => readEligibleProspectMessages({
  organizationId: ORG_A, prospectId: PROSPECT, subjectType: 'person', ...over,
} as never);

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: 'user-a' });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · ELIGIBILITY IS THE CAPTURE PATH'S OWN SET OF ASSERTIONS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3H service · only messages the capture path would accept', () => {
  it('lists the prospect-authored, dated, non-empty messages and NOTHING else', async () => {
    const r = await read() as never as { ok: boolean; messages: Array<Record<string, unknown>> };

    expect(r.ok).toBe(true);
    expect(r.messages.map((m) => m.messageId)).toEqual([MSG(1), MSG(2)]);
  });

  it('newest SOURCE time first — chronology, never a ranking', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(r.messages.map((m) => m.observedAt)).toEqual([
      '2026-09-20T10:00:00.000Z', '2026-09-10T10:00:00.000Z',
    ]);
  });

  it('counts every exclusion by the FIRST requirement it failed, with no ids and no text', async () => {
    const r = await read() as never as { ineligible: Record<string, number> };

    expect(r.ineligible).toEqual({
      examined: 7,                 // tenant B's message was never read at all
      subjectMismatch: 0,
      notProspectAuthored: 3,      // third party, no author, our own sent message
      observationTimeAbsent: 1,
      statementAbsent: 1,
    });
    // Counts account for exactly the window: 2 eligible + 5 excluded = 7.
    expect(r.ineligible.examined).toBe(2
      + r.ineligible.notProspectAuthored
      + r.ineligible.observationTimeAbsent
      + r.ineligible.statementAbsent
      + r.ineligible.subjectMismatch);
    expect(JSON.stringify(r.ineligible)).not.toMatch(/0{7}-0000/);  // no message ids
    expect(JSON.stringify(r.ineligible)).not.toMatch(/competitor|anonymous|unknown time/);
  });

  it('`direction` is NEVER proof: an inbound row with no author is still refused', async () => {
    // MSG(4) is `direction: 'inbound'` — the column DEFAULT — and is excluded.
    // The default standing in for evidence is the whole failure mode here.
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(r.messages.map((m) => m.messageId)).not.toContain(MSG(4));
  });

  it('a third party posting in the prospect thread is not the prospect speaking', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(r.messages.map((m) => m.messageId)).not.toContain(MSG(3));
  });

  it('our OWN sent message is excluded even though the author identity matches', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(r.messages.map((m) => m.messageId)).not.toContain(MSG(5));
  });

  it('a message whose author resolves to no contact in THIS tenant is refused', async () => {
    // Remove the subject's only platform identity: authorship can no longer be
    // established positively, so NOTHING is eligible. Fail closed, not open.
    db.tables.contacts = [];
    const r = await read() as never as { messages: unknown[]; ineligible: Record<string, number> };
    expect(r.messages).toEqual([]);
    // EVERY message in the window, because authorship is asserted before the
    // timestamp and the text are looked at — a row nobody can attribute to the
    // prospect is refused for that, not for whatever else is also wrong with it.
    expect(r.ineligible.notProspectAuthored).toBe(7);
  });

  it('a contact row from ANOTHER tenant cannot establish authorship', async () => {
    db.tables.contacts = [{
      id: 'contact-b', organization_id: ORG_B, unified_person_id: PERSON,
      platform: 'linkedin', platform_user_id: 'prospect-123',
    }];
    const r = await read() as never as { messages: unknown[] };
    expect(r.messages).toEqual([]);
  });

  it('no query parameter widens eligibility — only `limit`, and it only narrows', async () => {
    const widened = await read({
      includeOutbound: true, includeUndated: true, relaxAuthorship: true,
      subjectId: ACCOUNT, organizationId: ORG_A,
    }) as never as { messages: Array<Record<string, unknown>> };
    expect(widened.messages.map((m) => m.messageId)).toEqual([MSG(1), MSG(2)]);

    const narrowed = await read({ limit: 1 }) as never as { messages: unknown[] };
    expect(db.limits.filter((l) => l.table === 'engagement_messages').pop()?.value).toBe(1);
    expect(narrowed.messages.length).toBeLessThanOrEqual(1);
  });

  it('clamps the bound: a caller may ask for fewer, never for more', async () => {
    expect(resolveEligibleMessagesLimit(undefined)).toBe(ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT);
    expect(resolveEligibleMessagesLimit(0)).toBe(ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT);
    expect(resolveEligibleMessagesLimit(-5)).toBe(ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT);
    expect(resolveEligibleMessagesLimit(10)).toBe(10);
    expect(resolveEligibleMessagesLimit(10_000)).toBe(ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX);

    await read({ limit: 10_000 });
    expect(db.limits.find((l) => l.table === 'engagement_messages')?.value)
      .toBe(ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX);
  });

  it('asks the store for the newest SOURCE time with NULLS LAST, explicitly', async () => {
    await read();
    const order = db.orders.find((o) => o.table === 'engagement_messages');
    // Postgres orders DESC as NULLS FIRST, which would fill the window with rows
    // that are ineligible for having no source time.
    expect(order).toMatchObject({
      column: 'platform_created_at', options: { ascending: false, nullsFirst: false },
    });
  });

  it('a foreign thread returned by a widened query is refused on the DATA', async () => {
    // The stub query cannot produce this, which is the point: if `loadMessages`
    // were ever edited to drop its `.in('thread_id')`, the row must still not
    // reach a caller.
    const ports: EligibleProspectMessagesPorts = {
      loadThreads: async () => [
        { id: THREAD, platform: 'linkedin', organization_id: ORG_A, unified_person_id: PERSON },
      ],
      loadMessages: async () => [
        {
          id: MSG(9), thread_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', platform: 'linkedin',
          author_id: AUTHOR, platform_message_id: 'x', direction: 'inbound',
          content: STATEMENT, raw_payload: {}, platform_created_at: '2026-09-20T10:00:00.000Z',
        },
      ],
      loadAuthors: async () => [{ id: AUTHOR, platform: 'linkedin', platform_user_id: 'prospect-123' }],
      loadSubjectPlatformIdentities: async () => [{ platform: 'linkedin', platform_user_id: 'prospect-123' }],
      // A legible, empty registry: this case is about the thread predicate, and
      // an unregistered author must not change what it proves.
      loadOwnedIdentities: async () => ({ legible: true, detail: null, ownedKeys: new Set<string>() }),
    };

    const r = await readEligibleProspectMessages(
      { organizationId: ORG_A, prospectId: PROSPECT, subjectType: 'person' }, ports,
    ) as never as { messages: unknown[]; ineligible: Record<string, number> };

    expect(r.messages).toEqual([]);
    expect(r.ineligible.subjectMismatch).toBe(1);
  });

  it('a thread whose tenant does not re-assert is refused on the DATA too', async () => {
    const ports: EligibleProspectMessagesPorts = {
      // A query that lost its tenant predicate.
      loadThreads: async () => [
        { id: THREAD_B, platform: 'linkedin', organization_id: ORG_B, unified_person_id: PERSON },
      ],
      loadMessages: async () => { throw new Error('must not be reached'); },
      loadAuthors: async () => [],
      loadSubjectPlatformIdentities: async () => [],
      loadOwnedIdentities: async () => { throw new Error('must not be reached'); },
    };

    const r = await readEligibleProspectMessages(
      { organizationId: ORG_A, prospectId: PROSPECT, subjectType: 'person' }, ports,
    ) as never as { ok: boolean; messages: unknown[]; reason: string };

    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([]);
    expect(r.reason).toMatch(/no engagement thread/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE PROJECTION — SAFETY BEFORE RICHNESS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3H service · the projection publishes nothing it should not', () => {
  it('emits EXACTLY the eight agreed keys per message', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(Object.keys(r.messages[0]).sort()).toEqual([
      'channel', 'messageId', 'observedAt', 'preview', 'subjectId', 'subjectType',
      'threadId', 'truncated',
    ]);
  });

  it('never carries raw_payload, an author identity, or an engagement metric', async () => {
    const r = await read();
    const serialized = JSON.stringify(r);
    for (const forbidden of [
      'raw_payload', 'rawPayload', 'sender_username', 'sender_profile_url', 'sender_name',
      'author_id', 'authorId', 'authorName', 'display_name', 'displayName', 'username',
      'profile_url', 'profileUrl', 'avatar_url', 'avatarUrl',
      'sentiment_score', 'sentimentScore', 'like_count', 'likeCount',
      'reply_count', 'replyCount',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // And not the third party's literal name either, which is the harm the key
    // list is a proxy for.
    expect(serialized).not.toMatch(/Ada Prospect|Bo Colleague/);
  });

  it('does not even SELECT the columns it must not publish', async () => {
    await read();
    const cols = (table: string): string =>
      db.selects.filter((s) => s.table === table).map((s) => s.columns).join(' | ');

    expect(cols('engagement_authors')).toBe('id, platform, platform_user_id');
    for (const forbidden of ['display_name', 'username', 'profile_url', 'avatar_url']) {
      expect(cols('engagement_authors')).not.toContain(forbidden);
    }
    for (const forbidden of ['sentiment_score', 'like_count', 'reply_count']) {
      expect(cols('engagement_messages')).not.toContain(forbidden);
    }
  });

  it('caps the preview and SAYS it is capped', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    const short = r.messages[0];
    const long = r.messages[1];

    expect(short.preview).toBe(STATEMENT);
    expect(short.truncated).toBe(false);
    expect(String(long.preview)).toHaveLength(ELIGIBLE_MESSAGE_PREVIEW_MAX);
    // An operator must never mistake a shortened preview for the statement.
    expect(long.truncated).toBe(true);
  });

  it('names the subject the statement would be attributed to', async () => {
    const r = await read() as never as {
      subjectType: string; subjectId: string; messages: Array<Record<string, unknown>>;
    };
    expect(r.subjectType).toBe('person');
    expect(r.subjectId).toBe(PERSON);
    expect(r.messages[0]).toMatchObject({ subjectType: 'person', subjectId: PERSON });
  });

  it('exposes nothing that implies a score, a weight or a fit verdict', async () => {
    const serialized = JSON.stringify(await read());
    for (const key of ['score', 'scorable', 'fit', 'problemFit', 'weight', 'priority', 'dimension', 'rank']) {
      expect(serialized).not.toMatch(new RegExp(`"${key}"`, 'i'));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · TENANCY, AND THE TABLE THAT HAS NO TENANT COLUMN
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3H service · tenancy is never inherited from an id', () => {
  it('never filters or selects engagement_messages.organization_id', async () => {
    await read();
    // The column exists only after 20261221000000, whose applied state is not
    // verified. Reading it would turn an unapplied migration into a 503 — or,
    // worse, into a silently empty list.
    expect(db.filters.filter((f) => f.table === 'engagement_messages')
      .every((f) => f.column === 'thread_id')).toBe(true);
    expect(db.selects.filter((s) => s.table === 'engagement_messages')
      .every((s) => !s.columns.includes('organization_id'))).toBe(true);
  });

  it('reaches messages ONLY through tenant-scoped thread ids', async () => {
    await read();
    const threadIn = db.filters.find((f) => f.table === 'engagement_messages' && f.column === 'thread_id');
    expect(threadIn?.value).toEqual([THREAD]);
    expect(threadIn?.value).not.toContain(THREAD_B);
  });

  it('a globally unique person id does NOT authorise another tenant\'s threads', async () => {
    const r = await read() as never as { messages: Array<Record<string, unknown>> };
    expect(r.messages.map((m) => m.messageId)).not.toContain(MSG(8));
  });

  it('EVERY tenant-capable read carries its tenant column', async () => {
    await read();
    for (const table of ['canonical_leads', 'engagement_threads', 'contacts']) {
      const used = db.filters.filter((f) => f.table === table);
      expect(used.length).toBeGreaterThan(0);
      expect(used.some((f) => f.column === 'organization_id' || f.column === 'company_id')).toBe(true);
    }
  });

  it('Tenant B cannot read Tenant A\'s prospect at all', async () => {
    const r = await read({ organizationId: ORG_B }) as never as { ok: boolean; refusal: string };
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('subject_not_found');
  });

  it('refuses a tenant-less call rather than reading globally', async () => {
    await expect(read({ organizationId: '' })).rejects.toThrow(/organizationId is required/);
    await expect(read({ organizationId: '   ' })).rejects.toThrow(/organizationId is required/);
  });

  it('reads the canonical subject through the EXISTING resolver, not a fork', async () => {
    await read();
    // The observations relation is deliberately NOT consulted: whether this
    // prospect has stated problems before has nothing to do with which messages
    // are capturable.
    expect(db.selects.some((s) => s.table === 'prospect_problem_observations')).toBe(false);
    expect(db.selects.some((s) => s.table === 'canonical_leads')).toBe(true);
    expect(db.selects.some((s) => s.table === 'unified_persons')).toBe(true);
  });

  it('names exactly five relations, and the declared set matches what it reads', async () => {
    await read();
    const touched = Array.from(new Set(db.selects.map((s) => s.table)))
      .filter((t) => ELIGIBLE_PROSPECT_MESSAGES_RELATIONS.indexOf(t) !== -1);
    expect(touched.sort()).toEqual([...ELIGIBLE_PROSPECT_MESSAGES_RELATIONS].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · IT WRITES NOTHING, AND ABSENCE IS NOT UNREADABILITY
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3H service · reads only, and never fails open', () => {
  it('performs no mutation, structurally', async () => {
    await read();
    expect(db.writeOps).toEqual([]);
    expect(ELIGIBLE_PROSPECT_MESSAGES_PERFORMS_NO_WRITE).toBe(true);
    const code = readSource(SERVICE_FILE)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      expect(code).not.toMatch(new RegExp(`\\.\\s*${verb}\\s*\\(`));
    }
  });

  it('repeated reads are idempotent and create nothing', async () => {
    const a = await read();
    const b = await read();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(db.writeOps).toEqual([]);
  });

  it.each([
    'engagement_threads', 'engagement_messages', 'engagement_authors', 'contacts',
    // An unreadable attested-identity registry is NOT an empty registry: a list
    // computed without the ownership check is a list this module cannot stand
    // behind, so it refuses the WHOLE answer rather than counting a row.
    ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  ])(
    'an unreadable %s is store_unavailable, NEVER an empty list', async (table) => {
      db.errors[table] = { message: `relation "${table}" does not exist`, code: '42P01' };

      const r = await read() as never as { ok: boolean; refusal: string; messages?: unknown };

      expect(r.ok).toBe(false);
      expect(r.refusal).toBe('store_unavailable');
      expect(r.messages).toBeUndefined();
    },
  );

  it('an unreadable canonical spine is store_unavailable, not "no such prospect"', async () => {
    db.errors.canonical_leads = { message: 'schema cache', code: 'PGRST205' };
    const r = await read() as never as { ok: boolean; refusal: string };
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('store_unavailable');
  });

  it('a prospect with no resolved person is subject_not_found, not an empty list', async () => {
    db.tables.canonical_leads = [{ id: PROSPECT, company_id: ORG_A, unified_person_id: null }];
    const r = await read() as never as { ok: boolean; refusal: string };
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('subject_not_found');
  });

  it('no threads is a REAL empty list, with the reason stated', async () => {
    db.tables.engagement_threads = [];
    const r = await read() as never as { ok: boolean; messages: unknown[]; reason: string };
    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([]);
    expect(r.reason).toMatch(/no engagement thread in this tenant links to this prospect/);
    expect(db.filters.some((f) => f.table === 'engagement_messages')).toBe(false);
  });

  it('an account subject is an empty list with the reason, never invented messages', async () => {
    const r = await read({ subjectType: 'account' }) as never as {
      ok: boolean; subjectType: string; subjectId: string; messages: unknown[]; reason: string;
    };
    expect(r.ok).toBe(true);
    expect(r.subjectType).toBe('account');
    expect(r.subjectId).toBe(ACCOUNT);
    expect(r.messages).toEqual([]);
    expect(r.reason).toMatch(/attributable to a person/);
    // It did not go looking for threads on an account subject.
    expect(db.filters.some((f) => f.table === 'engagement_threads')).toBe(false);
  });

  it('stamps its own eligibility version so a client can pin the rules it got', async () => {
    const r = await read() as never as { version: string };
    expect(r.version).toBe(ELIGIBLE_PROSPECT_MESSAGES_VERSION);
    expect(ELIGIBLE_PROSPECT_MESSAGES_VERSION).toBe('pi-problem-obs-eligible.1');
  });

  it('the default ports are the ones in use', () => {
    expect(typeof defaultEligibleProspectMessagesPorts.loadThreads).toBe('function');
    expect(typeof defaultEligibleProspectMessagesPorts.loadMessages).toBe('function');
    expect(typeof defaultEligibleProspectMessagesPorts.loadAuthors).toBe('function');
    expect(typeof defaultEligibleProspectMessagesPorts.loadSubjectPlatformIdentities).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · THE ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3H route · only GET exists, and nothing else executes', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    '%s is 405 and executes NOTHING', async (method) => {
      const res = await call({ method });

      expect(res._status).toBe(405);
      expect(res._headers.Allow).toBe('GET');
      expect(res._json).toMatchObject({ error: 'method_not_allowed' });
      expect(requireTenantAccess).not.toHaveBeenCalled();
      expect(db.selects).toEqual([]);
    },
  );
});

describe('WS-3H route · guard order, and the tenant it hands the service', () => {
  it('a missing tenant is 400 BEFORE the membership guard runs', async () => {
    const res = await call({ query: { id: PROSPECT } });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/companyId is required/);
    expect(requireTenantAccess).not.toHaveBeenCalled();
    expect(db.selects).toEqual([]);
  });

  it('a malformed tenant is 400 BEFORE requireTenantAccess — not a 403 from a 22P02', async () => {
    for (const companyId of ['not-a-uuid', '12345', `${ORG_A}x`]) {
      jest.clearAllMocks();
      seed();
      const res = await call({ query: { companyId, id: PROSPECT } });
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/companyId must be a uuid/);
      expect(requireTenantAccess).not.toHaveBeenCalled();
    }
  });

  it('a malformed prospect id is 400 AFTER the tenant is verified', async () => {
    for (const id of [undefined, '', 'not-a-uuid']) {
      jest.clearAllMocks();
      seed();
      requireTenantAccess.mockResolvedValue({ organizationId: ORG_A });
      const res = await call({ query: { companyId: ORG_A, id } });
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toMatch(/prospect id/);
      expect(db.selects).toEqual([]);
    }
  });

  it('a membership guard that returns null leaves the response UNTOUCHED', async () => {
    requireTenantAccess.mockResolvedValue(null);
    const res = await call();
    expect(res._status).toBe(0);
    expect(res._json).toBeNull();
    expect(db.selects).toEqual([]);
  });

  it('accepts the snake_case spelling of the tenant parameter', async () => {
    const res = await call({ query: { company_id: ORG_A, id: PROSPECT } });
    expect(res._status).toBe(200);
    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_A);
  });

  it('takes the first value of a repeated path id rather than an array', async () => {
    const res = await call({ query: { companyId: ORG_A, id: [PROSPECT, 'other'] } });
    expect(res._status).toBe(200);
  });

  it('hands the service the VERIFIED tenant, which reaches the tables as a predicate', async () => {
    await call();
    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_A);
    expect(db.filters).toEqual(expect.arrayContaining([
      { table: 'canonical_leads', column: 'company_id', value: ORG_A },
      { table: 'engagement_threads', column: 'organization_id', value: ORG_A },
      { table: 'contacts', column: 'organization_id', value: ORG_A },
    ]));
    expect(db.filters.some((f) => f.value === ORG_B)).toBe(false);
  });

  it('REQUIRES NO CAPABILITY — and none is minted for a read', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    // The sibling GET on `problems.ts` sets the precedent, and this read is
    // strictly weaker than one that already ships. The absence is structural:
    // the route does not import the capability guard at all. Comments are
    // stripped first — the header EXPLAINS the decision and names the grant it
    // declines, and prose must not be mistaken for a gate.
    const code = readSource(ROUTE_FILE)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/requireCapability/);
    expect(code).not.toMatch(/PROSPECT_INGEST|PROSPECT_ENRICH_EXECUTE/);
    expect(code).toMatch(/requireTenantAccess/);
  });

  it('an unknown query parameter is ignored and widens NOTHING', async () => {
    const plain = await call();
    const noisy = await call({
      query: {
        companyId: ORG_A, id: PROSPECT,
        includeOutbound: 'true', includeUndated: 'true', relaxAuthorship: '1',
        subjectId: ACCOUNT, organizationId: ORG_B, statement: 'x',
      },
    });

    expect(noisy._status).toBe(200);
    expect(JSON.stringify(noisy._json.messages)).toBe(JSON.stringify(plain._json.messages));
    expect(JSON.stringify(noisy._json.ineligible)).toBe(JSON.stringify(plain._json.ineligible));
    // And the body it did answer with carries no echo of the attempt.
    expect(JSON.stringify(noisy._json)).not.toContain(ORG_B);
  });
});

describe('WS-3H route · the answers, and the ones it refuses to distinguish', () => {
  it('200 carries the version, the contract, the subject, the reason, the list and the counts', async () => {
    const res = await call();

    expect(res._status).toBe(200);
    expect(Object.keys(res._json).slice(0, 2)).toEqual(['version', 'contract']);
    expect(res._json.version).toBe(PROSPECT_API_VERSION);
    expect(res._json.contract).toBe(PROBLEM_OBSERVATION_CONTRACT_VERSION);
    expect(res._json).toMatchObject({
      eligibility: ELIGIBLE_PROSPECT_MESSAGES_VERSION,
      subjectType: 'person',
      subjectId: PERSON,
    });
    expect((res._json.messages as unknown[]).length).toBe(2);
    expect(res._json.ineligible).toMatchObject({ examined: 7 });
  });

  it('refuses a bad subjectType or limit with a plain sentence, before any read', async () => {
    for (const query of [
      { companyId: ORG_A, id: PROSPECT, subjectType: 'company' },
      { companyId: ORG_A, id: PROSPECT, limit: '0' },
      { companyId: ORG_A, id: PROSPECT, limit: '-5' },
      { companyId: ORG_A, id: PROSPECT, limit: 'many' },
    ]) {
      jest.clearAllMocks();
      seed();
      requireTenantAccess.mockResolvedValue({ organizationId: ORG_A });
      const res = await call({ query });
      expect(res._status).toBe(400);
      expect(typeof res._json.error).toBe('string');
      expect(db.selects).toEqual([]);
    }
  });

  it('a prospect in ANOTHER TENANT is answered BYTE-IDENTICALLY to an absent one', async () => {
    db.tables.canonical_leads = [];
    const absent = await call();

    seed();
    db.tables.canonical_leads = [{ id: PROSPECT, company_id: ORG_B, unified_person_id: PERSON }];
    const foreign = await call();

    expect(absent._status).toBe(404);
    expect(foreign._status).toBe(404);
    expect(absent._json).toEqual({
      version: PROSPECT_API_VERSION,
      contract: PROBLEM_OBSERVATION_CONTRACT_VERSION,
      error: 'prospect_not_found',
    });
    expect(JSON.stringify(foreign._json)).toBe(JSON.stringify(absent._json));
    expect(JSON.stringify(foreign._json)).not.toMatch(/tenant/);
  });

  it('an unreadable store is 503 and retryable — NEVER an empty 200', async () => {
    db.errors.engagement_messages = { message: 'relation does not exist: companyId=secret', code: '42P01' };

    const res = await call();

    expect(res._status).toBe(503);
    expect(res._json).toMatchObject({ error: 'eligible_messages_unavailable', retryable: true });
    expect(res._json.messages).toBeUndefined();
    // Nothing from the failure reaches the caller: a store message can echo input.
    expect(JSON.stringify(res._json)).not.toMatch(/secret/);
  });

  it('a prospect with messages but none eligible is a 200 with an empty list and counts', async () => {
    db.tables.contacts = [];
    const res = await call();

    expect(res._status).toBe(200);
    expect(res._json.messages).toEqual([]);
    expect(res._json.ineligible).toMatchObject({ examined: 7, notProspectAuthored: 7 });
    expect(String(res._json.reason)).toMatch(/none of them can be verified/);
  });

  it('subjectType=account is a 200 with an empty list and a stated reason', async () => {
    const res = await call({ query: { companyId: ORG_A, id: PROSPECT, subjectType: 'account' } });

    expect(res._status).toBe(200);
    expect(res._json.messages).toEqual([]);
    expect(res._json.subjectType).toBe('account');
    expect(String(res._json.reason)).toMatch(/attributable to a person/);
  });

  it('did NOT bump the prospect API version — a new subresource is not a new API', () => {
    expect(PROSPECT_API_VERSION).toBe('ws10.1');
    expect(PROBLEM_OBSERVATION_CONTRACT_VERSION).toBe('pi-problem-obs.1');
  });

  it('is a GET, so it is not wrapped in withIdempotency', () => {
    const code = readSource(ROUTE_FILE)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/withIdempotency/);
  });

  it('every answer leads with the version, then the contract', async () => {
    const answers = [
      await call({ method: 'POST' }),
      await call({ query: { id: PROSPECT } }),
      await call(),
    ];
    for (const res of answers) {
      expect(Object.keys(res._json).slice(0, 2)).toEqual(['version', 'contract']);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · THE PICKER EXCLUDES THIS WORKSPACE'S OWN ATTESTED IDENTITIES
// ═══════════════════════════════════════════════════════════════════════════
/**
 * The picker must never be LOOSER than the capture path. Capture refuses an
 * author this tenant has attested as one of its own engagement identities, so
 * a listed message with that author would be a message the operator is invited
 * to capture and then refused on — the exact failure this module exists to
 * remove.
 *
 * MODELLED, NOT VERIFIED: `attested_engagement_identities` has no migration in
 * this tree. Its columns and its uniqueness are the double's; what is verified
 * is this module's behaviour given each answer the relation can give.
 */
describe('WS-3H service · an attested owned identity is not the prospect speaking', () => {
  const REGISTRY = ATTESTED_ENGAGEMENT_IDENTITY_RELATION;

  /** One attestation, ACTIVE unless `revoked_at` is overridden. */
  const attestation = (over: Row = {}): Row => ({
    id: 'att-a',
    organization_id: ORG_A,
    platform: 'linkedin',
    platform_user_id: 'prospect-123',
    attested_as: 'tenant_own',
    revoked_at: null,
    ...over,
  });

  const registrySelects = () => db.selects.filter((s) => s.table === REGISTRY);
  const registryFilters = () => db.filters.filter((f) => f.table === REGISTRY);

  it('excludes every message by an attested author, counted under notProspectAuthored', async () => {
    // The adversarial world: `contacts` DOES map this identity to the selected
    // person, so the positive authorship check passes and the registry is the
    // only thing that excludes it.
    db.tables[REGISTRY] = [attestation()];

    const r = await read() as never as {
      ok: boolean; messages: unknown[]; ineligible: Record<string, number>;
    };

    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([]);
    // EXACTLY the agreed counter set — no key was added for this exclusion.
    expect(r.ineligible).toEqual({
      examined: 7,
      subjectMismatch: 0,
      notProspectAuthored: 7,
      observationTimeAbsent: 0,
      statementAbsent: 0,
    });
  });

  it('SAME WORLD, OPPOSITE VERDICTS: only the registry row differs', async () => {
    const unregistered = await read() as never as { messages: Array<Record<string, unknown>> };

    db.tables[REGISTRY] = [attestation()];
    const registered = await read() as never as { messages: Array<Record<string, unknown>> };

    expect(unregistered.messages.map((m) => m.messageId)).toEqual([MSG(1), MSG(2)]);
    expect(registered.messages).toEqual([]);
  });

  it('an empty registry changes nothing versus the baseline', async () => {
    const baseline = await read();
    db.tables[REGISTRY] = [];
    const withEmptyRegistry = await read();

    expect(JSON.stringify(withEmptyRegistry)).toBe(JSON.stringify(baseline));
    // It still ASKED, once, both times.
    expect(registrySelects()).toHaveLength(2);
  });

  it('asks ONCE per call, under this tenant, for ACTIVE rows, bounded to the identities in hand', async () => {
    await read();

    expect(registrySelects()).toHaveLength(1);
    expect(registrySelects()[0].columns).not.toContain('*');
    const filters = registryFilters();
    expect(filters[0]).toEqual({ table: REGISTRY, column: 'organization_id', value: ORG_A });
    // `= NULL` is never true in SQL, so active-ness is an IS predicate.
    expect(filters).toContainEqual({ table: REGISTRY, column: 'revoked_at', value: null });
    // Bounded to the window's own authors — not the whole registry.
    const platforms = filters.find((f) => f.column === 'platform')?.value as string[];
    const identities = filters.find((f) => f.column === 'platform_user_id')?.value as string[];
    expect([...platforms].sort()).toEqual(['linkedin']);
    expect([...identities].sort()).toEqual(['colleague-999', 'prospect-123']);
  });

  it('another tenant\'s attestation does not exclude here', async () => {
    // An attestation is one organization's statement about its own accounts, not
    // a global blocklist; honouring ORG_B's here would let it suppress ORG_A's
    // evidence. The row is also re-asserted on the DATA, so a widened query
    // cannot fail open.
    db.tables[REGISTRY] = [attestation({ id: 'att-b', organization_id: ORG_B })];

    const r = await read() as never as { messages: Array<Record<string, unknown>> };

    expect(r.messages.map((m) => m.messageId)).toEqual([MSG(1), MSG(2)]);
    expect(registryFilters()).toContainEqual({
      table: REGISTRY, column: 'organization_id', value: ORG_A,
    });
    expect(registryFilters().some((f) => f.value === ORG_B)).toBe(false);
  });

  it('REVOCATION flips the list within one world, with no table reset and no stale set', async () => {
    const row = attestation();
    db.tables[REGISTRY] = [row];

    const whileActive = await read() as never as { messages: unknown[] };
    expect(whileActive.messages).toEqual([]);

    // Revoked IN PLACE. A cached owned set would keep the list empty.
    row.revoked_at = '2026-10-28T12:00:00.000Z';

    const afterRevocation = await read() as never as { messages: Array<Record<string, unknown>> };

    expect(afterRevocation.messages.map((m) => m.messageId)).toEqual([MSG(1), MSG(2)]);
    expect(db.tables[REGISTRY]).toHaveLength(1);
    expect(registrySelects()).toHaveLength(2);
  });

  it('an unreadable registry refuses the WHOLE answer — no list, no counts', async () => {
    db.errors[REGISTRY] = { message: 'relation does not exist', code: '42P01' };

    const r = await read() as never as {
      ok: boolean; refusal: string; messages?: unknown; ineligible?: unknown;
    };

    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('store_unavailable');
    // Not a per-row counter bump: a list computed without the check is not a
    // list, and a count of rows it could not check is not information.
    expect(r.messages).toBeUndefined();
    expect(r.ineligible).toBeUndefined();
  });

  it('an illegible answer from the port is store_unavailable, not an empty owned set', async () => {
    // `legible: false` is "the question could not be asked". A caller that read
    // it as "nothing is owned" would reintroduce the fail-open.
    const ports: EligibleProspectMessagesPorts = {
      ...defaultEligibleProspectMessagesPorts,
      loadOwnedIdentities: async () => ({
        legible: false, detail: 'registry unreachable', ownedKeys: new Set<string>(),
      }),
    };

    const r = await readEligibleProspectMessages(
      { organizationId: ORG_A, prospectId: PROSPECT, subjectType: 'person' }, ports,
    ) as never as { ok: boolean; refusal: string; messages?: unknown };

    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('store_unavailable');
    expect(r.messages).toBeUndefined();
  });

  it('the route answers 503 for an unreadable registry, never an empty 200', async () => {
    db.errors[REGISTRY] = { message: 'relation does not exist: companyId=secret', code: '42P01' };

    const res = await call();

    expect(res._status).toBe(503);
    expect(res._json).toMatchObject({ error: 'eligible_messages_unavailable', retryable: true });
    expect(res._json.messages).toBeUndefined();
    expect(JSON.stringify(res._json)).not.toMatch(/secret/);
  });

  it('the key is the CONTRACT\'s key, and the OAuth tables are not reachable from here', async () => {
    db.tables[REGISTRY] = [attestation()];
    await read();

    // The excluded identity is the one `engagement_authors` holds, keyed by the
    // shared contract function — not a value rewritten by a display helper.
    expect(engagementIdentityKey('linkedin', 'prospect-123'))
      .toBe(engagementIdentityKey('LinkedIn ', ' prospect-123'));
    const code = readSource(SERVICE_FILE)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['getOrgAuthorIds', 'social_accounts', 'user_company_roles']) {
      expect(code).not.toContain(forbidden);
    }
    expect(code).not.toMatch(/constants\/platforms/);
    expect(code).toContain('engagementIdentityKey');
    // Still a read-only module.
    expect(db.writeOps).toEqual([]);
    expect(ELIGIBLE_PROSPECT_MESSAGES_PERFORMS_NO_WRITE).toBe(true);
  });

  it('the declared relation set carries the registry, so it cannot be read undeclared', () => {
    expect(ELIGIBLE_PROSPECT_MESSAGES_RELATIONS).toContain(REGISTRY);
    expect(ELIGIBLE_PROSPECT_MESSAGES_RELATIONS).toHaveLength(5);
  });
});
