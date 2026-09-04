/**
 * D2 — platform/badge counts must agree with work-queue actionability.
 *
 * `engagement_threads.unread_count` is an ingestion-time cache with no outbound
 * rewrite, so it still reads > 0 after the connected account has replied.
 * `getPlatformCounts` summed that column directly, so the badge kept showing
 * unread on a thread the work queue had correctly gone quiet on.
 *
 * These tests assert the two surfaces agree on the same fixture, which is the
 * actual invariant — a badge that is merely "0 sometimes" is not the point.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_threads: [], engagement_messages: [], engagement_authors: [],
  social_accounts: [], user_company_roles: [], engagement_thread_classification: [],
  engagement_opportunities: [], engagement_thread_intelligence: [], engagement_leads: [],
};

type Filter = { op: 'eq' | 'in' | 'neq' | 'gte' | 'lte'; col: string; val: unknown };
function makeBuilder(table: string) {
  const filters: Filter[] = [];
  const run = () => {
    const rows = (db[table] ?? []).filter((r) => filters.every((f) => {
      if (f.op === 'eq') return r[f.col] === f.val;
      if (f.op === 'neq') return r[f.col] !== f.val;
      if (f.op === 'in') return (f.val as unknown[]).includes(r[f.col]);
      return true;
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
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve(run()).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));

import { getPlatformCounts } from '../../services/engagementInboxService';
import { getDailyWorkQueue } from '../../services/engagementWorkQueueService';

const ORG = 'org_d2';
const USER = 'user_d2';
const CONNECTED_MEMBER = 'connected-member-1';
const CONNECTED_AUTHOR = 'author_connected';
const EXTERNAL_AUTHOR = 'author_external';

function seedIdentity() {
  db.user_company_roles = [{ user_id: USER, company_id: ORG, status: 'active' }];
  db.social_accounts = [{ user_id: USER, platform: 'linkedin', platform_user_id: CONNECTED_MEMBER, is_active: true }];
  db.engagement_authors = [
    { id: CONNECTED_AUTHOR, platform: 'linkedin', platform_user_id: CONNECTED_MEMBER },
    { id: EXTERNAL_AUTHOR, platform: 'linkedin', platform_user_id: 'external-member-9' },
  ];
}

/** A thread plus its messages, newest first. */
function seedThread(
  id: string,
  storedUnread: number,
  msgs: Array<Partial<Row>>,
  platform = 'linkedin',
) {
  db.engagement_threads.push({
    id, platform, organization_id: ORG, ignored: false,
    priority_score: 10, unread_count: storedUnread, raw_payload: null,
    platform_thread_id: `pt_${id}`, source_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
  msgs.forEach((m, i) => {
    db.engagement_messages.push({
      id: `${id}_m${i}`, thread_id: id, platform,
      platform_message_id: null, content: null, author_id: null,
      direction: null, raw_payload: null, message_type: 'dm',
      sentiment_score: null,
      platform_created_at: new Date(Date.UTC(2026, 0, 10) - i * 60_000).toISOString(),
      created_at: new Date(Date.UTC(2026, 0, 10) - i * 60_000).toISOString(),
      ...m,
    });
  });
}

const external = (content: string) => ({ author_id: EXTERNAL_AUTHOR, content });
const connected = (content: string) => ({ direction: 'outgoing', content });

async function badge(platform = 'linkedin') {
  const counts = await getPlatformCounts(ORG);
  return counts[platform] ?? { thread_count: 0, unread_count: 0, max_priority_tier: 'low' };
}
async function queue(platform = 'linkedin') {
  const q = await getDailyWorkQueue(ORG);
  return q.platforms.find((p) => p.platform === platform)!;
}

beforeEach(() => {
  Object.keys(db).forEach((k) => { db[k] = []; });
  seedIdentity();
});

describe('D2 — badge counts agree with work-queue actionability', () => {
  it('T1 external latest, stored unread 1 → badge 1, queue actionable', async () => {
    seedThread('t1', 1, [external('Interested in a demo')]);
    expect((await badge()).unread_count).toBe(1);
    const q = await queue();
    expect(q.actionable_threads).toBe(1);
    expect(q.unread_messages).toBe(1);
  });

  it('T2 PRIMARY REGRESSION — company latest, stale unread 5 → badge 0, queue 0', async () => {
    seedThread('t1', 5, [connected('Thanks, booking you in'), external('Interested in a demo')]);
    const b = await badge();
    const q = await queue();
    expect(b.unread_count).toBe(0);        // was 5 before the fix
    expect(q.actionable_threads).toBe(0);
    expect(q.unread_messages).toBe(0);
    expect(b.unread_count).toBe(q.unread_messages);   // the invariant
  });

  it('T3 external responds again, stale unread 5 → badge reflects the latest external turn', async () => {
    seedThread('t1', 5, [
      external('Tuesday works'),          // newest
      connected('Thanks, booking you in'),
      external('Interested in a demo'),
    ]);
    const b = await badge();
    const q = await queue();
    expect(b.unread_count).toBeGreaterThan(0);
    expect(q.actionable_threads).toBe(1);
    expect(b.unread_count).toBe(q.unread_messages);
  });

  it('T4 refresh — a second query returns the same counts', async () => {
    seedThread('t1', 5, [connected('Replied'), external('Hi')]);
    const first = await badge();
    const second = await badge();
    expect(second).toEqual(first);
    expect(second.unread_count).toBe(0);
  });

  it('T5 re-ingestion of the same message does not double-count', async () => {
    seedThread('t1', 1, [external('Hi'), external('Hi')]);   // duplicate row
    const b = await badge();
    expect(b.thread_count).toBe(1);
    expect((await queue()).actionable_threads).toBe(1);
  });

  it('T6 three threads, one answered → count is 2', async () => {
    seedThread('tA', 1, [external('A asks')]);
    seedThread('tB', 9, [connected('B answered'), external('B asked')]);   // stale 9
    seedThread('tC', 1, [external('C asks')]);
    const b = await badge();
    const q = await queue();
    expect(b.thread_count).toBe(3);          // all three still listed
    expect(q.actionable_threads).toBe(2);    // only A and C are actionable
    expect(b.unread_count).toBe(2);          // B contributes nothing
    expect(b.unread_count).toBe(q.unread_messages);
  });

  it('T7 platform isolation — counts stay separated', async () => {
    seedThread('li', 1, [external('LinkedIn ask')], 'linkedin');
    seedThread('tw', 4, [connected('Twitter answered'), external('Twitter ask')], 'twitter');
    const li = await badge('linkedin');
    const tw = await badge('twitter');
    expect(li.unread_count).toBe(1);
    expect(tw.unread_count).toBe(0);         // answered, despite stale 4
    expect(li.thread_count).toBe(1);
    expect(tw.thread_count).toBe(1);
  });

  it('ownership via author_id mapping is honoured, not just direction', async () => {
    seedThread('t1', 7, [{ author_id: CONNECTED_AUTHOR, content: 'Replied' }, external('Hi')]);
    expect((await badge()).unread_count).toBe(0);
  });

  it('a thread with no ingested messages still reports its stored unread', async () => {
    seedThread('t1', 3, []);
    expect((await badge()).unread_count).toBe(3);   // cache is still the best signal here
  });

  it('an unidentifiable actor stays external — never silently zeroed', async () => {
    seedThread('t1', 1, [{ author_id: null, content: 'ambiguous inbound' }]);
    expect((await badge()).unread_count).toBeGreaterThan(0);
    expect((await queue()).actionable_threads).toBe(1);
  });
});
