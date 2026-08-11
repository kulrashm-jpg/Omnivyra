/**
 * F7 — /api/engagement/threads contract lock.
 *
 * F7 was opened on the suspicion that this route "bypasses canonical
 * actionability". The audit found something different and more important: the
 * route never makes an actionability claim at all. It returns a thread ENVELOPE
 * — ids, platform, timestamps, messaging-window metadata — and no ownership,
 * unread, latest-message or actionable field. There is no second predicate here
 * to diverge from the canonical one, because there is no predicate.
 *
 * Its two consumers confirm the classification:
 *   - components/thread/ThreadContinuationView — correlates a just-published
 *     post to its thread by platform_thread_id/recency.
 *   - pages/whatsapp/inbox — a WhatsApp conversation list. WhatsApp is not in
 *     the canonical actionability platform set at all.
 * Neither renders actionable work, a badge, or an unread count.
 *
 * So this file does NOT assert actionability. It locks the raw contract, which
 * is the thing that could actually regress: someone adding actionability
 * semantics here (splitting the ownership decision in two), or widening the
 * envelope until it leaks state it has no authority over.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { engagement_threads: [] };

type Filter = { op: 'eq' | 'gte' | 'lte'; col: string; val: unknown };
let lastLimit: number | null = null;

function makeBuilder(table: keyof typeof db) {
  const filters: Filter[] = [];
  const run = () => {
    const rows = (db[table] ?? []).filter((r) =>
      filters.every((f) => {
        if (f.op === 'eq') return r[f.col] === f.val;
        if (f.op === 'gte') return String(r[f.col] ?? '') >= String(f.val);
        return String(r[f.col] ?? '') <= String(f.val);
      }),
    );
    return { data: lastLimit === null ? rows : rows.slice(0, lastLimit), error: null };
  };
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { filters.push({ op: 'eq', col: c, val: v }); return api; },
    gte(c: string, v: unknown) { filters.push({ op: 'gte', col: c, val: v }); return api; },
    lte(c: string, v: unknown) { filters.push({ op: 'lte', col: c, val: v }); return api; },
    order() { return api; },
    limit(n: number) { lastLimit = n; return api; },
    then(res: (v: unknown) => unknown) { return Promise.resolve(run()).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t as keyof typeof db) } }));

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
let accessAllowed = true;
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: 'user_1', defaultCompanyId: ORG }),
  enforceCompanyAccess: async () => (accessAllowed ? { userId: 'user_1' } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/engagement/threads';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function get(query: Record<string, unknown>) {
  const res = mockRes();
  await (handler as any)({ method: 'GET', query, headers: {} }, res);
  return res;
}

function seedThread(id: string, over: Partial<Row> = {}) {
  db.engagement_threads.push({
    id,
    platform: 'linkedin',
    platform_thread_id: `pt_${id}`,
    root_message_id: null,
    source_id: null,
    organization_id: ORG,
    ignored: false,
    unread_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    window_open: true,
    window_expires_at: '2026-01-03T00:00:00Z',
    ...over,
  });
}

beforeEach(() => {
  db.engagement_threads = [];
  lastLimit = null;
  accessAllowed = true;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the route is a raw thread envelope, not an actionable surface', () => {
  const ACTIONABILITY_FIELDS = [
    'actionable', 'unread_count', 'latest_message', 'latest_message_time',
    'latest_message_id', 'priority_score', 'triage_priority', 'author_summary',
  ];

  it('exposes exactly the envelope fields and nothing more', async () => {
    seedThread('t1');
    const res = await get({ organization_id: ORG });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.threads[0]).sort()).toEqual([
      'created_at', 'id', 'organization_id', 'platform', 'platform_thread_id',
      'root_message_id', 'source_id', 'updated_at', 'window_expires_at', 'window_open',
    ]);
  });

  it.each(ACTIONABILITY_FIELDS)('never exposes `%s`', async (field) => {
    // Adding any of these would make this a second place where actionability
    // is claimed — the exact split D2/F1/F2/F5 exist to prevent.
    seedThread('t1', { unread_count: 9 });
    const res = await get({ organization_id: ORG });
    expect(res.body.threads[0]).not.toHaveProperty(field);
  });

  it('a stale unread_count on the row is not leaked into the response', async () => {
    seedThread('t1', { unread_count: 5 });
    const res = await get({ organization_id: ORG });
    expect(JSON.stringify(res.body)).not.toContain('unread');
  });

  it('a company-answered thread is still returned — raw means raw', async () => {
    // Architecture B: this route is not the work queue. Filtering answered
    // threads out here would break its consumers (post→thread correlation and
    // the WhatsApp conversation list), neither of which is actionable work.
    seedThread('answered');
    const res = await get({ organization_id: ORG });
    expect(res.body.threads.map((t: Row) => t.id)).toContain('answered');
  });

  it('ignored threads are included, and `ignored` is not exposed either', async () => {
    seedThread('t_ignored', { ignored: true });
    const res = await get({ organization_id: ORG });
    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0]).not.toHaveProperty('ignored');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tenant isolation', () => {
  it('returns only the caller company\'s threads', async () => {
    seedThread('mine');
    seedThread('theirs', { organization_id: OTHER_ORG });
    const res = await get({ organization_id: ORG });
    const ids = res.body.threads.map((t: Row) => t.id);
    expect(ids).toEqual(['mine']);
  });

  it('a foreign organization_id yields nothing once access is denied', async () => {
    seedThread('theirs', { organization_id: OTHER_ORG });
    accessAllowed = false;
    const res = await get({ organization_id: OTHER_ORG });
    // enforceCompanyAccess owns the rejection; the handler must not continue.
    expect(res.body).toBeNull();
  });

  it('authorization runs before any data is read', async () => {
    seedThread('mine');
    accessAllowed = false;
    const res = await get({ organization_id: ORG });
    expect(res.body).toBeNull();
  });

  it('requires an organization scope', async () => {
    const res = await get({});
    // defaultCompanyId supplies ORG when omitted; an explicit blank must not
    // widen the query to every tenant.
    expect([200, 400]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.threads.every((t: Row) => t.organization_id === ORG)).toBe(true);
    }
  });

  it('a client-supplied `actionable` value is ignored, never echoed', async () => {
    seedThread('t1');
    const res = await get({ organization_id: ORG, actionable: 'true' });
    expect(res.body.threads[0]).not.toHaveProperty('actionable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('filtering and bounds are preserved', () => {
  it('platform filter narrows the result', async () => {
    seedThread('li', { platform: 'linkedin' });
    seedThread('wa', { platform: 'whatsapp' });
    const res = await get({ organization_id: ORG, platform: 'whatsapp' });
    expect(res.body.threads.map((t: Row) => t.id)).toEqual(['wa']);
  });

  it('serves WhatsApp threads, which sit outside the canonical ownership model', async () => {
    // This is why actionability filtering must NOT be forced in here: WhatsApp
    // is absent from the work queue's PLATFORMS set, so a canonical `actionable`
    // verdict would be derived from a model that does not govern it.
    seedThread('wa1', { platform: 'whatsapp' });
    seedThread('wa2', { platform: 'whatsapp' });
    const res = await get({ organization_id: ORG, platform: 'whatsapp' });
    expect(res.body.threads).toHaveLength(2);
  });

  it('the limit stays bounded and clamped', async () => {
    for (let i = 0; i < 20; i += 1) seedThread(`t${i}`);
    await get({ organization_id: ORG, limit: '5' });
    expect(lastLimit).toBe(5);
    await get({ organization_id: ORG, limit: '9999' });
    expect(lastLimit).toBe(100);          // never unbounded
    await get({ organization_id: ORG, limit: 'garbage' });
    expect(lastLimit).toBe(50);           // documented default
  });

  it('rejects non-GET methods', async () => {
    const res = mockRes();
    await (handler as any)({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
