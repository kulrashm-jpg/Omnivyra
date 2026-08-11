/**
 * Engagement work queue — connected-account response ownership.
 *
 * The defect: `getDailyWorkQueue` selected only `author_id` for the latest
 * message, so none of the signals `isAuthorSelf` needs survived the query. A
 * LinkedIn reply sent by the connected account normally lands with
 * `author_id = NULL` (it carries direction='outgoing', raw_payload.author_self,
 * a "You:" prefix, or a mailbox-owner URN instead), so `!latest?.author_id`
 * scored it EXTERNAL and the answered thread stayed in the queue. A stale
 * `unread_count` then kept it there even when ownership was resolved correctly.
 *
 * The invariant under test:
 *   external engagement is actionable; connected-account activity is not;
 *   a new external turn makes the thread actionable again.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_threads: [], engagement_messages: [], engagement_authors: [],
  social_accounts: [], user_company_roles: [], engagement_thread_classification: [],
  engagement_opportunities: [], engagement_thread_intelligence: [], engagement_leads: [],
};

// F1/F2: getDailyWorkQueue now consumes ThreadSummary.actionable from
// getThreads instead of issuing its own thread/message queries. The assertions
// below are unchanged — only this harness was widened to support the chain
// getThreads actually uses (.limit/.gte/.lte/.maybeSingle/.single). The previous
// harness mocked the work queue's old internal query shape, which is obsolete
// by design now that ownership is resolved in exactly one place.
type Filter = { op: 'eq' | 'in' | 'neq'; col: string; val: unknown };
function makeBuilder(table: keyof typeof db) {
  const filters: Filter[] = [];
  const run = () => {
    const rows = (db[table] ?? []).filter((r) => filters.every((f) => {
      if (f.op === 'eq') return r[f.col] === f.val;
      if (f.op === 'neq') return r[f.col] !== f.val;
      return (f.val as unknown[]).includes(r[f.col]);
    }));
    return { data: rows, error: null };
  };
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { filters.push({ op: 'eq', col: c, val: v }); return api; },
    neq(c: string, v: unknown) { filters.push({ op: 'neq', col: c, val: v }); return api; },
    in(c: string, v: unknown[]) { filters.push({ op: 'in', col: c, val: v }); return api; },
    gte() { return api; }, lte() { return api; },
    order() { return api; }, limit() { return api; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve(run()).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t as keyof typeof db) } }));

import { getDailyWorkQueue } from '../../services/engagementWorkQueueService';

const ORG = 'org_eng';
const USER = 'user_1';
const CONNECTED_MEMBER_ID = 'connected-member-abc';   // social_accounts.platform_user_id
const CONNECTED_AUTHOR_ID = 'author_connected';
const EXTERNAL_AUTHOR_ID = 'author_external';

function seedIdentity() {
  db.user_company_roles = [{ user_id: USER, company_id: ORG, status: 'active' }];
  db.social_accounts = [{ user_id: USER, platform: 'linkedin', platform_user_id: CONNECTED_MEMBER_ID, is_active: true }];
  db.engagement_authors = [
    { id: CONNECTED_AUTHOR_ID, platform: 'linkedin', platform_user_id: CONNECTED_MEMBER_ID },
    { id: EXTERNAL_AUTHOR_ID, platform: 'linkedin', platform_user_id: 'someone-else-xyz' },
  ];
}
function seedThread(id: string, unread = 1) {
  db.engagement_threads.push({
    id, platform: 'linkedin', organization_id: ORG, ignored: false,
    priority_score: 10, unread_count: unread, raw_payload: null,
    platform_thread_id: `pt_${id}`, source_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
}
/** Messages are read newest-first by the service; push in that order. */
function setMessages(threadId: string, msgs: Array<Partial<Row>>) {
  db.engagement_messages = msgs.map((m, i) => ({
    id: `m_${threadId}_${i}`, thread_id: threadId, author_id: null, platform: 'linkedin',
    platform_message_id: null, direction: null, raw_payload: null, content: null,
    platform_created_at: new Date(Date.now() - i * 1000).toISOString(), ...m,
  }));
}
const linkedin = () => db.engagement_threads.length
  ? undefined : undefined;

async function actionable() {
  const q = await getDailyWorkQueue(ORG);
  const li = q.platforms.find((p) => p.platform === 'linkedin')!;
  return { actionable: li.actionable_threads, unread: li.unread_messages, total: q.total_actionable_threads };
}

beforeEach(() => {
  db.engagement_threads = []; db.engagement_messages = [];
  db.engagement_thread_classification = [];
  seedIdentity(); linkedin();
});

describe('DM ownership — the reported LinkedIn defect', () => {
  it('T1 external → connected account: SHOW', async () => {
    seedThread('t1');
    setMessages('t1', [{ author_id: EXTERNAL_AUTHOR_ID, content: 'Hi, interested in a demo' }]);
    expect((await actionable()).actionable).toBe(1);
  });

  it('T3 connected account replies (direction=outgoing, no author_id): REMOVE', async () => {
    seedThread('t1');
    setMessages('t1', [
      { direction: 'outgoing', content: 'Thanks — booking you in' },   // newest, ours
      { author_id: EXTERNAL_AUTHOR_ID, content: 'Hi, interested in a demo' },
    ]);
    const r = await actionable();
    expect(r.actionable).toBe(0);
    expect(r.unread).toBe(0);          // stale unread_count must not resurrect it
  });

  it('T2 connected-account reply identified by raw_payload.author_self: DO NOT SHOW', async () => {
    seedThread('t1');
    setMessages('t1', [{ raw_payload: { author_self: true }, content: 'On it' }]);
    expect((await actionable()).actionable).toBe(0);
  });

  it('connected-account reply identified by the LinkedIn "You:" preview prefix', async () => {
    seedThread('t1');
    setMessages('t1', [{ content: 'You: sending that over now' }]);
    expect((await actionable()).actionable).toBe(0);
  });

  it('connected-account reply identified by author_id ↔ social_accounts mapping', async () => {
    seedThread('t1');
    setMessages('t1', [{ author_id: CONNECTED_AUTHOR_ID, content: 'Replied' }]);
    expect((await actionable()).actionable).toBe(0);
  });

  it('T4 external responds again: SHOW again', async () => {
    seedThread('t1');
    setMessages('t1', [
      { author_id: EXTERNAL_AUTHOR_ID, content: 'Great — Tuesday works' },  // newest, theirs
      { direction: 'outgoing', content: 'Thanks — booking you in' },
      { author_id: EXTERNAL_AUTHOR_ID, content: 'Hi, interested in a demo' },
    ]);
    const r = await actionable();
    expect(r.actionable).toBe(1);
    expect(r.unread).toBe(1);
  });

  it('T6 the hidden state survives a refresh — it is derived, not session state', async () => {
    seedThread('t1');
    setMessages('t1', [
      { direction: 'outgoing', content: 'Thanks' },
      { author_id: EXTERNAL_AUTHOR_ID, content: 'Hi' },
    ]);
    expect((await actionable()).actionable).toBe(0);
    expect((await actionable()).actionable).toBe(0);   // re-query = re-derive
  });

  it('T5/T12 re-ingesting the same external message yields one actionable thread', async () => {
    seedThread('t1');
    setMessages('t1', [
      { id: 'dup', author_id: EXTERNAL_AUTHOR_ID, content: 'Hi' },
      { id: 'dup', author_id: EXTERNAL_AUTHOR_ID, content: 'Hi' },
    ]);
    expect((await actionable()).actionable).toBe(1);   // thread-level, not row-level
  });
});

describe('counts follow the same ownership logic', () => {
  it('T16 a company response does not increase the actionable count', async () => {
    seedThread('t1', 5);                                // stale unread cache
    setMessages('t1', [{ direction: 'outgoing', content: 'Replied' }]);
    const r = await actionable();
    expect(r.actionable).toBe(0);
    expect(r.unread).toBe(0);
    expect(r.total).toBe(0);
  });

  it('T17 an external response increases the actionable count', async () => {
    seedThread('t1', 2);
    setMessages('t1', [{ author_id: EXTERNAL_AUTHOR_ID, content: 'Any update?' }]);
    const r = await actionable();
    expect(r.actionable).toBe(1);
    expect(r.unread).toBe(2);
  });

  it('mixed threads count independently', async () => {
    seedThread('t1'); seedThread('t2');
    db.engagement_messages = [
      { id: 'a', thread_id: 't1', author_id: EXTERNAL_AUTHOR_ID, platform: 'linkedin', content: 'Hi', platform_created_at: '2026-01-02' },
      { id: 'b', thread_id: 't2', author_id: null, direction: 'outgoing', platform: 'linkedin', content: 'Replied', platform_created_at: '2026-01-02' },
    ];
    const r = await actionable();
    expect(r.actionable).toBe(1);      // only t1
  });
});

describe('identity edge cases', () => {
  it('T23 same display name, different platform id → still external', async () => {
    seedThread('t1');
    db.engagement_authors.push({ id: 'author_impostor', platform: 'linkedin', platform_user_id: 'different-id-999' });
    setMessages('t1', [{ author_id: 'author_impostor', content: 'Hello' }]);
    expect((await actionable()).actionable).toBe(1);   // identity is the id, never the name
  });

  it('T24 unidentifiable actor → treated as external (never silently hidden)', async () => {
    seedThread('t1');
    setMessages('t1', [{ author_id: null, content: 'ambiguous inbound' }]);
    expect((await actionable()).actionable).toBe(1);
  });

  it('an inactive social account no longer counts as the connected identity', async () => {
    db.social_accounts = [{ user_id: USER, platform: 'linkedin', platform_user_id: CONNECTED_MEMBER_ID, is_active: false }];
    seedThread('t1');
    setMessages('t1', [{ author_id: CONNECTED_AUTHOR_ID, content: 'old reply' }]);
    expect((await actionable()).actionable).toBe(1);   // safe direction
  });

  it('a thread with no ingested messages still falls back to stored unread', async () => {
    seedThread('t1', 3);
    setMessages('t1', []);
    const r = await actionable();
    expect(r.actionable).toBe(1);
    expect(r.unread).toBe(3);
  });
});
