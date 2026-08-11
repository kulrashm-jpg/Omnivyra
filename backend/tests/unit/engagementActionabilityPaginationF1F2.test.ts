/**
 * F1/F2 — materialised actionability and pagination correctness.
 *
 * F1: `getThreads` truncated during the build loop (`results.length >= limit`)
 *     and sorted afterwards. Because a company reply bumps `updated_at`, the
 *     answered threads ranked first in the `updated_at DESC` candidate window,
 *     filled the page, and pushed genuinely actionable work off it.
 * F2: nothing materialised "does this need a reply?", so consumers inferred it
 *     from `unread_count` and the query could neither filter nor order on it.
 *
 * The critical regression is T4: 15 answered + 5 actionable at limit 10 must
 * still return all 5.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_threads: [], engagement_messages: [], engagement_authors: [],
  social_accounts: [], user_company_roles: [], engagement_thread_classification: [],
  engagement_opportunities: [], engagement_thread_intelligence: [], engagement_leads: [],
};

type Filter = { op: 'eq' | 'in' | 'neq'; col: string; val: unknown };
function makeBuilder(table: string) {
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
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));

import { getThreads } from '../../services/engagementThreadService';
import { getPlatformCounts } from '../../services/engagementInboxService';
import { getDailyWorkQueue } from '../../services/engagementWorkQueueService';

const ORG = 'org_f1';
const USER = 'user_f1';
const MEMBER = 'connected-member';
const CONNECTED_AUTHOR = 'author_connected';
const EXTERNAL_AUTHOR = 'author_external';

function seedIdentity() {
  db.user_company_roles = [{ user_id: USER, company_id: ORG, status: 'active' }];
  db.social_accounts = [{ user_id: USER, platform: 'linkedin', platform_user_id: MEMBER, is_active: true }];
  db.engagement_authors = [
    { id: CONNECTED_AUTHOR, platform: 'linkedin', platform_user_id: MEMBER },
    { id: EXTERNAL_AUTHOR, platform: 'linkedin', platform_user_id: 'external-9' },
  ];
}

/**
 * @param updatedAt drives the candidate-window ordering the defect exploited —
 *        answered threads are given FRESHER timestamps on purpose.
 */
function seedThread(opts: {
  id: string; latest: 'external' | 'company'; unread?: number;
  priority?: number; triage?: number; updatedAt: string; platform?: string;
}) {
  const platform = opts.platform ?? 'linkedin';
  db.engagement_threads.push({
    id: opts.id, platform, organization_id: ORG, ignored: false,
    priority_score: opts.priority ?? 10, unread_count: opts.unread ?? 1,
    raw_payload: null, platform_thread_id: `pt_${opts.id}`, source_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: opts.updatedAt,
  });
  if (opts.triage !== undefined) {
    db.engagement_thread_classification.push({
      thread_id: opts.id, organization_id: ORG, triage_priority: opts.triage,
      classification_category: null, sentiment: null,
    });
  }
  const base = {
    thread_id: opts.id, platform, platform_message_id: null, raw_payload: null,
    message_type: 'dm', sentiment_score: null,
    platform_created_at: opts.updatedAt, created_at: opts.updatedAt,
  };
  if (opts.latest === 'external') {
    db.engagement_messages.push({ ...base, id: `${opts.id}_m0`, author_id: EXTERNAL_AUTHOR, direction: null, content: 'Can you help?' });
  } else {
    // Newest turn is ours; the external message underneath is older.
    db.engagement_messages.push({ ...base, id: `${opts.id}_m0`, author_id: null, direction: 'outgoing', content: 'Replied' });
    db.engagement_messages.push({
      ...base, id: `${opts.id}_m1`, author_id: EXTERNAL_AUTHOR, direction: null, content: 'Original ask',
      platform_created_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
    });
  }
}

const ts = (min: number) => new Date(Date.UTC(2026, 1, 1, 0, min)).toISOString();

beforeEach(() => {
  Object.keys(db).forEach((k) => { db[k] = []; });
  seedIdentity();
});

describe('F2 — actionable is materialised on ThreadSummary', () => {
  it('T1 external latest → actionable true, appears', async () => {
    seedThread({ id: 't1', latest: 'external', updatedAt: ts(1) });
    const [t] = await getThreads({ organization_id: ORG, limit: 50, exclude_ignored: true });
    expect(t.actionable).toBe(true);
    expect(t.unread_count).toBeGreaterThan(0);
  });

  it('T2 company latest with stale unread 5 → actionable false, unread 0', async () => {
    seedThread({ id: 't1', latest: 'company', unread: 5, updatedAt: ts(1) });
    const [t] = await getThreads({ organization_id: ORG, limit: 50, exclude_ignored: true });
    expect(t.actionable).toBe(false);
    expect(t.unread_count).toBe(0);
  });

  it('T3 external re-response → actionable true again', async () => {
    seedThread({ id: 't1', latest: 'company', unread: 5, updatedAt: ts(1) });
    // External replies after us — newest turn is theirs.
    db.engagement_messages.unshift({
      id: 't1_m_new', thread_id: 't1', platform: 'linkedin', author_id: EXTERNAL_AUTHOR,
      direction: null, raw_payload: null, content: 'Following up', message_type: 'dm',
      platform_message_id: null, sentiment_score: null,
      platform_created_at: ts(9), created_at: ts(9),
    });
    const [t] = await getThreads({ organization_id: ORG, limit: 50, exclude_ignored: true });
    expect(t.actionable).toBe(true);
  });
});

describe('F1 — pagination operates on actionable work', () => {
  it('T4 CRITICAL — 15 answered (fresher) + 5 actionable, limit 10 → all 5 returned', async () => {
    // Answered threads get the FRESHEST updated_at, exactly as a real company
    // reply would, so they dominate the candidate ordering.
    for (let i = 0; i < 15; i++) {
      seedThread({ id: `answered_${i}`, latest: 'company', unread: 3, updatedAt: ts(100 + i) });
    }
    for (let i = 0; i < 5; i++) {
      seedThread({ id: `actionable_${i}`, latest: 'external', unread: 1, updatedAt: ts(i) });
    }

    const page = await getThreads({
      organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true,
    });

    expect(page).toHaveLength(5);
    expect(page.every((t) => t.actionable)).toBe(true);
    expect(page.filter((t) => t.thread_id.startsWith('answered_'))).toHaveLength(0);
    expect(new Set(page.map((t) => t.thread_id)).size).toBe(5);
  });

  it('T5 a top-priority answered thread does not displace a lower-priority actionable one', async () => {
    seedThread({ id: 'answered_hi', latest: 'company', priority: 99, triage: 10, unread: 9, updatedAt: ts(50) });
    seedThread({ id: 'actionable_lo', latest: 'external', priority: 1, triage: 0, unread: 1, updatedAt: ts(1) });

    const page = await getThreads({
      organization_id: ORG, limit: 1, exclude_ignored: true, actionable_only: true,
    });
    expect(page).toHaveLength(1);
    expect(page[0].thread_id).toBe('actionable_lo');
  });

  it('T6 recency ordering among actionable threads is preserved', async () => {
    seedThread({ id: 'old',  latest: 'external', priority: 5, updatedAt: ts(1) });
    seedThread({ id: 'mid',  latest: 'external', priority: 5, updatedAt: ts(5) });
    seedThread({ id: 'new',  latest: 'external', priority: 5, updatedAt: ts(9) });
    const page = await getThreads({
      organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true,
    });
    expect(page.map((t) => t.thread_id)).toEqual(['new', 'mid', 'old']);
  });

  it('triage priority still outranks recency among actionable threads', async () => {
    // NB: the returned `priority_score` is COMPUTED by scoreThreadPriority from
    // message content/sentiment/lead signals — it is not the stored
    // engagement_threads.priority_score column. `triage_priority` is the real
    // pass-through first sort key, so that is what this asserts.
    seedThread({ id: 'low_recent', latest: 'external', triage: 0, updatedAt: ts(9) });
    seedThread({ id: 'high_older', latest: 'external', triage: 9, updatedAt: ts(1) });
    const page = await getThreads({
      organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true,
    });
    expect(page[0].thread_id).toBe('high_older');   // triage beats recency
  });

  it('T7 duplicate ingestion yields one actionable thread', async () => {
    seedThread({ id: 't1', latest: 'external', updatedAt: ts(1) });
    db.engagement_messages.push({ ...db.engagement_messages[0] });   // exact duplicate row
    const page = await getThreads({
      organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true,
    });
    expect(page).toHaveLength(1);
  });

  it('T8 refresh — identical result set on a second call', async () => {
    for (let i = 0; i < 6; i++) seedThread({ id: `a${i}`, latest: 'external', updatedAt: ts(i) });
    seedThread({ id: 'answered', latest: 'company', unread: 4, updatedAt: ts(99) });
    const first = await getThreads({ organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true });
    const second = await getThreads({ organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true });
    expect(second.map((t) => t.thread_id)).toEqual(first.map((t) => t.thread_id));
    expect(first).toHaveLength(6);
  });

  it('T9 re-ingesting the company response keeps the thread absent', async () => {
    seedThread({ id: 't1', latest: 'company', unread: 5, updatedAt: ts(1) });
    const before = await getThreads({ organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true });
    expect(before).toHaveLength(0);
    db.engagement_messages.push({ ...db.engagement_messages[0] });   // re-ingest the same reply
    const after = await getThreads({ organization_id: ORG, limit: 10, exclude_ignored: true, actionable_only: true });
    expect(after).toHaveLength(0);
  });

  it('default (actionable_only unset) preserves the previous result set', async () => {
    seedThread({ id: 'ext', latest: 'external', updatedAt: ts(1) });
    seedThread({ id: 'ans', latest: 'company', unread: 4, updatedAt: ts(2) });
    const all = await getThreads({ organization_id: ORG, limit: 10, exclude_ignored: true });
    expect(all).toHaveLength(2);                       // no silent behaviour change
    expect(all.find((t) => t.thread_id === 'ans')!.actionable).toBe(false);
  });
});

describe('T10 — platform isolation and consumer consistency', () => {
  it('counts stay separated by platform and consumers agree', async () => {
    seedThread({ id: 'li_ext', latest: 'external', unread: 1, updatedAt: ts(1), platform: 'linkedin' });
    seedThread({ id: 'li_ans', latest: 'company',  unread: 6, updatedAt: ts(2), platform: 'linkedin' });
    seedThread({ id: 'tw_ext', latest: 'external', unread: 1, updatedAt: ts(3), platform: 'twitter' });

    const counts = await getPlatformCounts(ORG);
    const queue = await getDailyWorkQueue(ORG);
    const li = queue.platforms.find((p) => p.platform === 'linkedin')!;
    const tw = queue.platforms.find((p) => p.platform === 'twitter')!;

    expect(counts.linkedin.thread_count).toBe(2);      // denominator unchanged
    expect(counts.linkedin.unread_count).toBe(1);      // answered contributes 0
    expect(li.actionable_threads).toBe(1);
    expect(counts.linkedin.unread_count).toBe(li.unread_messages);

    expect(counts.twitter.unread_count).toBe(1);
    expect(tw.actionable_threads).toBe(1);
    expect(queue.total_actionable_threads).toBe(2);
  });

  it('platform filter restricts the page', async () => {
    seedThread({ id: 'li', latest: 'external', updatedAt: ts(1), platform: 'linkedin' });
    seedThread({ id: 'tw', latest: 'external', updatedAt: ts(2), platform: 'twitter' });
    const page = await getThreads({
      organization_id: ORG, platform: 'linkedin', limit: 10, exclude_ignored: true, actionable_only: true,
    });
    expect(page.map((t) => t.thread_id)).toEqual(['li']);
  });
});
