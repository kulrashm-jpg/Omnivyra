/**
 * F5 — AI ownership + actionability hardening.
 *
 * The defect: every Engagement Center AI path was ownership-blind. Nothing in
 * `generateReplySuggestions` or its callers consulted the canonical
 * actionability the D2/F1/F2/D4 work established, so the AI would happily draft
 * a reply to a thread whose latest turn was the connected company's OWN message
 * — i.e. suggest that you reply to yourself. `thread/bulk-ai-reply` multiplied
 * that across a batch and actually sent the results.
 *
 * The invariant under test:
 *   AI may assist only an actionable external engagement.
 *
 * This file covers the canonical accessor and the generation chokepoint.
 * The send boundary and bulk route live in engagementAiSendBoundaryF5.test.ts.
 *
 * Note on construction: these tests drive the REAL engagementThreadService
 * derivation against an in-memory database. Nothing about ownership is stubbed
 * — that is the whole point. If a second AI-specific predicate were ever added,
 * it would diverge from this fixture and these tests would fail.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_threads: [], engagement_messages: [], engagement_authors: [],
  social_accounts: [], user_company_roles: [], engagement_thread_classification: [],
  engagement_opportunities: [], engagement_thread_intelligence: [], engagement_leads: [],
};

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

// The generation chokepoint pulls in the AI stack. None of it is exercised
// here: every assertion is about whether the ownership gate admits or refuses
// the request, and the gate sits ahead of all of it. These stubs exist purely
// so an ADMITTED request fails on something other than a missing module.
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: () => false,
  evaluateCommunityAiEngagement: async () => ({ suggested_replies: [] }),
}));
jest.mock('../../services/engagementMessageService', () => ({ getThreadMessages: async () => [] }));
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: async () => ({ output: '' }),
}));
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: async () => null,
}));
jest.mock('@/backend/services/context/canonicalContentContextResolver', () => ({
  resolveCompanyGroundingGuard: async () => null,
}));
jest.mock('../../services/intelligence/coordination/adoption/engagementSemanticShadow', () => ({
  observeEngagementSemanticShadow: async () => undefined,
}));

import {
  getThreadActionability,
  isThreadActionable,
} from '../../services/engagementThreadService';
import {
  generateReplySuggestions,
  isThreadNotActionableError,
  ThreadNotActionableError,
} from '../../services/engagementAiAssistantService';

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
const USER = 'user_1';

// Two connected accounts for the SAME company — D4's pooled ownership model.
const ACCOUNT_A = 'connected-member-A';
const ACCOUNT_B = 'connected-member-B';
const AUTHOR_A = 'author_connected_a';
const AUTHOR_B = 'author_connected_b';
const EXTERNAL_AUTHOR_ID = 'author_external';

function seedIdentity() {
  db.user_company_roles = [{ user_id: USER, company_id: ORG, status: 'active' }];
  db.social_accounts = [
    { user_id: USER, platform: 'linkedin', platform_user_id: ACCOUNT_A, is_active: true },
    { user_id: USER, platform: 'linkedin', platform_user_id: ACCOUNT_B, is_active: true },
  ];
  db.engagement_authors = [
    { id: AUTHOR_A, platform: 'linkedin', platform_user_id: ACCOUNT_A },
    { id: AUTHOR_B, platform: 'linkedin', platform_user_id: ACCOUNT_B },
    { id: EXTERNAL_AUTHOR_ID, platform: 'linkedin', platform_user_id: 'someone-else-xyz' },
  ];
}

function seedThread(id: string, org: string = ORG, unread = 1) {
  db.engagement_threads.push({
    id, platform: 'linkedin', organization_id: org, ignored: false,
    priority_score: 10, unread_count: unread, raw_payload: null,
    platform_thread_id: `pt_${id}`, source_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
}

/** Messages are read newest-first by the service; push in that order. */
function setMessages(threadId: string, msgs: Array<Partial<Row>>) {
  const existing = db.engagement_messages.filter((m) => m.thread_id !== threadId);
  db.engagement_messages = [
    ...existing,
    ...msgs.map((m, i) => ({
      id: `m_${threadId}_${i}`, thread_id: threadId, author_id: null, platform: 'linkedin',
      platform_message_id: null, direction: null, raw_payload: null, content: null,
      message_type: 'dm',
      platform_created_at: new Date(Date.UTC(2026, 0, 10) - i * 1000).toISOString(), ...m,
    })),
  ];
}

const EXTERNAL_TURN = { author_id: EXTERNAL_AUTHOR_ID, content: 'Hi, interested in a demo' };
const OUR_TURN = { direction: 'outgoing', content: 'Thanks — booking you in' };

beforeEach(() => {
  db.engagement_threads = []; db.engagement_messages = [];
  db.engagement_thread_classification = [];
  seedIdentity();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('canonical accessor — one predicate, consumed not copied', () => {
  it('reports actionable when the latest turn is external', async () => {
    seedThread('t1');
    setMessages('t1', [EXTERNAL_TURN]);
    expect(await isThreadActionable(ORG, 't1')).toBe(true);
  });

  it('reports NOT actionable once the company has responded', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    expect(await isThreadActionable(ORG, 't1')).toBe(false);
  });

  it('agrees with the value getThreads materialises (no second derivation)', async () => {
    seedThread('t1'); seedThread('t2');
    setMessages('t1', [EXTERNAL_TURN]);
    setMessages('t2', [OUR_TURN, EXTERNAL_TURN]);

    const { getThreads } = await import('../../services/engagementThreadService');
    const summaries = await getThreads({ organization_id: ORG, platform: null, limit: 50 });
    const map = await getThreadActionability(ORG, ['t1', 't2']);

    for (const s of summaries) {
      expect(map.get(s.thread_id)).toBe(s.actionable);
    }
  });

  it('G: another company\'s thread is never reported actionable', async () => {
    seedThread('t_rival', OTHER_ORG);
    setMessages('t_rival', [EXTERNAL_TURN]);
    // Genuinely actionable for its true owner...
    expect(await isThreadActionable(OTHER_ORG, 't_rival')).toBe(true);
    // ...and invisible to everyone else.
    expect(await isThreadActionable(ORG, 't_rival')).toBe(false);
  });

  it('fail-closed: an unknown thread id is NOT actionable', async () => {
    expect(await isThreadActionable(ORG, 'does-not-exist')).toBe(false);
  });

  it('fail-closed: blank and empty inputs are NOT actionable', async () => {
    expect(await isThreadActionable(ORG, '')).toBe(false);
    expect(await isThreadActionable('', 't1')).toBe(false);
    expect((await getThreadActionability(ORG, [])).size).toBe(0);
  });

  it('every requested id appears in the map, even unresolvable ones', async () => {
    seedThread('t1');
    setMessages('t1', [EXTERNAL_TURN]);
    const map = await getThreadActionability(ORG, ['t1', 'ghost', 't1']);
    expect(map.get('t1')).toBe(true);
    expect(map.get('ghost')).toBe(false);
    expect(map.size).toBe(2);           // de-duplicated
  });

  it('resolves a mixed batch independently', async () => {
    seedThread('a'); seedThread('b'); seedThread('c');
    setMessages('a', [EXTERNAL_TURN]);
    setMessages('b', [OUR_TURN, EXTERNAL_TURN]);
    setMessages('c', [EXTERNAL_TURN]);
    const map = await getThreadActionability(ORG, ['a', 'b', 'c']);
    expect([map.get('a'), map.get('b'), map.get('c')]).toEqual([true, false, true]);
  });

  it('H: a reply from connected account B closes a thread received by account A', async () => {
    seedThread('t1');
    setMessages('t1', [
      { author_id: AUTHOR_B, content: 'Picking this up' },   // newest — different account, same company
      { author_id: AUTHOR_A, content: 'assigned' },
      EXTERNAL_TURN,
    ]);
    // Ownership is company-level, not account-level.
    expect(await isThreadActionable(ORG, 't1')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AI generation chokepoint', () => {
  /** Generation is admitted iff it fails for a reason OTHER than actionability. */
  async function generationRefused(messageId: string, org = ORG): Promise<boolean> {
    try {
      await generateReplySuggestions(messageId, org);
      return false;
    } catch (err) {
      return isThreadNotActionableError(err);
    }
  }

  it('A: external message → actionable → AI generation is admitted', async () => {
    seedThread('t1');
    setMessages('t1', [EXTERNAL_TURN]);
    expect(await generationRefused('m_t1_0')).toBe(false);
  });

  it('B: company replies → not actionable → AI generation is refused', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    // Target the company's own newest message — the exact case the UI would hit.
    expect(await generationRefused('m_t1_0')).toBe(true);
  });

  it('B2: refusal holds even when targeting the older external message', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    // Actionability is a property of the THREAD's latest turn, not of the
    // message the caller happens to point at. A stale message_id must not
    // re-open a conversation the company already answered.
    expect(await generationRefused('m_t1_1')).toBe(true);
  });

  it('D: external replies again → actionable → AI is admitted again', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    expect(await generationRefused('m_t1_0')).toBe(true);

    setMessages('t1', [
      { author_id: EXTERNAL_AUTHOR_ID, content: 'Great — Tuesday works' },
      OUR_TURN,
      EXTERNAL_TURN,
    ]);
    expect(await generationRefused('m_t1_0')).toBe(false);
  });

  it('the refusal is typed, carries the thread id, and is not a generic Error', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    await expect(generateReplySuggestions('m_t1_0', ORG)).rejects.toBeInstanceOf(ThreadNotActionableError);
    try {
      await generateReplySuggestions('m_t1_0', ORG);
    } catch (err) {
      expect((err as ThreadNotActionableError).code).toBe('THREAD_NOT_ACTIONABLE');
      expect((err as ThreadNotActionableError).threadId).toBe('t1');
    }
  });

  it('G: cross-tenant generation is refused, and NOT as an actionability refusal', async () => {
    seedThread('t_rival', OTHER_ORG);
    setMessages('t_rival', [EXTERNAL_TURN]);
    // The pre-existing tenant guard must still fire first and stay distinct —
    // collapsing authorization into "not actionable" would hide a security
    // failure behind a product-shaped message.
    await expect(generateReplySuggestions('m_t_rival_0', ORG)).rejects.toThrow(
      /does not belong to the authorized organization/i,
    );
    expect(await generationRefused('m_t_rival_0', ORG)).toBe(false);
  });

  it('I: repeated invocation is stable — refusal does not decay into admission', async () => {
    seedThread('t1');
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    expect(await generationRefused('m_t1_0')).toBe(true);
    expect(await generationRefused('m_t1_0')).toBe(true);
    expect(await generationRefused('m_t1_0')).toBe(true);
  });

  it('I2: repeated invocation on an actionable thread never mutates its state', async () => {
    seedThread('t1');
    setMessages('t1', [EXTERNAL_TURN]);
    await generationRefused('m_t1_0');
    await generationRefused('m_t1_0');
    // Generation is a read. If it ever wrote a message or flipped the thread,
    // actionability would drift and the second click would behave differently.
    expect(await isThreadActionable(ORG, 't1')).toBe(true);
    expect(db.engagement_messages.filter((m) => m.thread_id === 't1')).toHaveLength(1);
  });

  it('J: a refused generation leaves engagement state untouched', async () => {
    seedThread('t1', ORG, 4);
    setMessages('t1', [OUR_TURN, EXTERNAL_TURN]);
    const before = JSON.stringify(db.engagement_threads);
    const beforeMsgs = db.engagement_messages.length;

    expect(await generationRefused('m_t1_0')).toBe(true);

    expect(JSON.stringify(db.engagement_threads)).toBe(before);
    expect(db.engagement_messages).toHaveLength(beforeMsgs);
  });

  it('a missing message still fails before the ownership gate', async () => {
    await expect(generateReplySuggestions('no-such-message', ORG)).rejects.toThrow(/Message not found/i);
  });

  it('an unresolvable author is treated as external, so AI stays available', async () => {
    seedThread('t1');
    setMessages('t1', [{ author_id: null, content: 'ambiguous inbound' }]);
    // The safe direction: never silently withhold assistance on real inbound work.
    expect(await generationRefused('m_t1_0')).toBe(false);
  });
});
