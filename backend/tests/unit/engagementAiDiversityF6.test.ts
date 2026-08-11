/**
 * F6 — Engagement Center AI response diversity (conversation context).
 *
 * The defect this file locks down is a CONTEXT defect, not a style defect:
 *
 *   1. Comment threads reached the model with no conversation history at all.
 *      `conversationTurns` was built only for DMs, and the comment branch of the
 *      prompt builder surfaced the post, the parent comment and the target
 *      comment — never what the company had already replied. Since
 *      /api/engagement/reply mirrors every sent comment back into
 *      engagement_messages, that history existed; it was simply withheld. A
 *      model that cannot see its own previous reply has no way to avoid
 *      reissuing it.
 *
 *   2. Self-detection for prompt labelling read `direction` alone — one of the
 *      five signals the canonical predicate accepts. A company turn carrying
 *      `raw_payload.author_self` or a "You:" prefix but no direction was
 *      labelled as the other person, so the model attributed the company's own
 *      words to the counterparty.
 *
 * These assertions are about what the model is TOLD, which is deterministic.
 * They deliberately make no claim about what the model then writes.
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

// Force the direct-LLM path: this is what runs in the deployed configuration
// (USE_OMNIVYRA unset) and it is the path that assembles the prompt under test.
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: () => false,
  evaluateCommunityAiEngagement: async () => ({ status: 'error' }),
}));

/** Captures the exact system+user prompt handed to the canonical AI gateway. */
const capturedCalls: Array<{ system: string; user: string; operation: string }> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: async (req: any) => {
    const sys = req.messages.find((m: any) => m.role === 'system')?.content ?? '';
    const usr = req.messages.find((m: any) => m.role === 'user')?.content ?? '';
    capturedCalls.push({ system: sys, user: usr, operation: req.operation });
    return { output: JSON.stringify({ replies: [{ text: 'ok', tone: 'professional' }] }) };
  },
}));
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: async () => ({ brand_voice: 'professional' }),
}));
jest.mock('@/backend/services/context/canonicalContentContextResolver', () => ({
  resolveCompanyGroundingGuard: async () => ({ directive: 'GROUNDING' }),
}));
jest.mock('../../services/intelligence/coordination/adoption/engagementSemanticShadow', () => ({
  observeEngagementSemanticShadow: async () => undefined,
}));
jest.mock('../../services/ai/safety', () => ({
  hardenText: (_k: string, v: string) => v,
  hardenBlock: (_k: string, v: string) => v,
  moderateBeforePersist: async () => ({ allow: true }),
}));
// engagementThreadService → leadThreadScoring → bullmqClient constructs a Redis
// connection at import time. Lead scores are irrelevant to prompt assembly, so
// the chain is cut here rather than by faking Redis configuration.
jest.mock('../../services/leadThreadScoring', () => ({
  computeThreadLeadScoresBatch: async () => new Map(),
}));
jest.mock('@/config', () => ({
  config: {
    OPENAI_API_KEY: 'test-key',
    OPENAI_RESPONSES_MODEL: 'gpt-4o-mini',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

import { generateReplySuggestions } from '../../services/engagementAiAssistantService';

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
const USER = 'user_1';
const ACCOUNT = 'connected-member-A';
const AUTHOR_SELF = 'author_connected';
const AUTHOR_EXT = 'author_external';

const COMPANY_PRIOR_REPLY = 'Appreciate you flagging that — we ship weekly, so it is already in review.';
const EXTERNAL_FIRST = 'Does the export actually handle nested folders?';
const EXTERNAL_FOLLOWUP = 'Any update on that this week?';
const POST_TEXT = 'We rebuilt our export pipeline from scratch.';

function seedIdentity(org = ORG) {
  db.user_company_roles = [{ user_id: USER, company_id: org, status: 'active' }];
  db.social_accounts = [{ user_id: USER, platform: 'linkedin', platform_user_id: ACCOUNT, is_active: true }];
  db.engagement_authors = [
    { id: AUTHOR_SELF, platform: 'linkedin', platform_user_id: ACCOUNT },
    { id: AUTHOR_EXT, platform: 'linkedin', platform_user_id: 'someone-else-xyz', display_name: 'Priya' },
  ];
}

function seedThread(id: string, org = ORG, postText: string | null = POST_TEXT) {
  db.engagement_threads.push({
    id, platform: 'linkedin', organization_id: org, ignored: false,
    priority_score: 10, unread_count: 1,
    raw_payload: postText ? { post_text_preview: postText } : null,
    platform_thread_id: `pt_${id}`, source_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
}

/**
 * `msgs` are supplied NEWEST FIRST (the ordering engagementThreadService reads);
 * getThreadMessages re-sorts ascending, so timestamps are assigned accordingly.
 */
function setMessages(threadId: string, type: 'comment' | 'dm', msgs: Array<Partial<Row>>) {
  const others = db.engagement_messages.filter((m) => m.thread_id !== threadId);
  db.engagement_messages = [
    ...others,
    ...msgs.map((m, i) => ({
      id: `m_${threadId}_${i}`, thread_id: threadId, author_id: null, platform: 'linkedin',
      platform_message_id: null, direction: null, raw_payload: null, content: null,
      message_type: type, parent_message_id: null,
      platform_created_at: new Date(Date.UTC(2026, 0, 10) - i * 60000).toISOString(),
      ...m,
    })),
  ];
}

const extAuthorJoin = { engagement_authors: { id: AUTHOR_EXT, username: 'priya', display_name: 'Priya', profile_url: null, avatar_url: null } };

function lastPrompt() { return capturedCalls[capturedCalls.length - 1]; }

beforeEach(() => {
  db.engagement_threads = []; db.engagement_messages = [];
  db.engagement_thread_classification = [];
  capturedCalls.length = 0;
  seedIdentity();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T1/T2 — comment thread: the company\'s own prior reply is visible', () => {
  /** external → company replied → external follows up (thread is actionable). */
  function seedAnsweredCommentThread(id = 't1') {
    seedThread(id);
    setMessages(id, 'comment', [
      { author_id: AUTHOR_EXT, content: EXTERNAL_FOLLOWUP, ...extAuthorJoin },      // newest, target
      { direction: 'outgoing', raw_payload: { author_self: true }, content: COMPANY_PRIOR_REPLY },
      { author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin },
    ]);
  }

  it('T1: the prior company reply reaches the model', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    expect(lastPrompt().user).toContain(COMPANY_PRIOR_REPLY);
  });

  it('T1b: it is attributed to the company, not to the commenter', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    const { user } = lastPrompt();
    const line = user.split('\n').find((l) => l.includes(COMPANY_PRIOR_REPLY)) ?? '';
    expect(line).toContain('YOU (the creator)');
    expect(line).not.toContain('Priya');
  });

  it('T2: earlier external turns are present too, so progression is legible', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    const { user } = lastPrompt();
    expect(user).toContain(EXTERNAL_FIRST);
    expect(user).toContain(EXTERNAL_FOLLOWUP);
  });

  it('T2b: the message being replied to is not duplicated into the history block', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    const { user } = lastPrompt();
    const historyBlock = user.split('COMMENT TO REPLY TO')[0];
    // Echoing the target into history invites the model to reply to it twice.
    expect(historyBlock).not.toContain(EXTERNAL_FOLLOWUP);
    expect(user).toContain(`COMMENT TO REPLY TO`);
  });

  it('the model is instructed not to mechanically reuse its own opener/ask', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    expect(lastPrompt().system).toMatch(/do not reuse its opening line/i);
  });

  it('§12: the instruction permits a repeated phrase when context warrants it', async () => {
    seedAnsweredCommentThread();
    await generateReplySuggestions('m_t1_0', ORG);
    // Diversity must not be pursued at the cost of naturalness.
    expect(lastPrompt().system).toMatch(/do not reach for an odd wording just to be different/i);
  });

  it('a first-touch comment thread carries no history block at all', async () => {
    seedThread('t2');
    setMessages('t2', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t2_0', ORG);
    expect(lastPrompt().user).not.toContain('ALREADY SAID IN THIS THREAD');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('self-detection uses the canonical signal set, not `direction` alone', () => {
  const cases: Array<[string, Partial<Row>]> = [
    ['direction=outgoing', { direction: 'outgoing' }],
    ['raw_payload.author_self', { raw_payload: { author_self: true } }],
    ['raw_payload.sender_self', { raw_payload: { sender_self: true } }],
    ['author_id ↔ connected account', { author_id: AUTHOR_SELF }],
  ];

  it.each(cases)('a company turn identified by %s is labelled as the company', async (_label, signal) => {
    seedThread('t1');
    setMessages('t1', 'comment', [
      { author_id: AUTHOR_EXT, content: EXTERNAL_FOLLOWUP, ...extAuthorJoin },
      { content: COMPANY_PRIOR_REPLY, ...signal },
      { author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin },
    ]);
    await generateReplySuggestions('m_t1_0', ORG);
    const line = lastPrompt().user.split('\n').find((l) => l.includes(COMPANY_PRIOR_REPLY)) ?? '';
    expect(line).toContain('YOU (the creator)');
  });

  it('an external turn is never mislabelled as the company', async () => {
    seedThread('t1');
    setMessages('t1', 'comment', [
      { author_id: AUTHOR_EXT, content: EXTERNAL_FOLLOWUP, ...extAuthorJoin },
      { author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin },
    ]);
    await generateReplySuggestions('m_t1_0', ORG);
    const line = lastPrompt().user.split('\n').find((l) => l.includes(EXTERNAL_FIRST)) ?? '';
    expect(line).not.toContain('YOU (the creator)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T3/T4 — surface-appropriate context', () => {
  it('T3: comment generation still receives the original post', async () => {
    seedThread('t1');
    setMessages('t1', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t1_0', ORG);
    expect(lastPrompt().user).toContain(POST_TEXT);
  });

  it('T4: DM generation receives the back-and-forth with company turns marked', async () => {
    seedThread('t1', ORG, null);
    setMessages('t1', 'dm', [
      { author_id: AUTHOR_EXT, content: EXTERNAL_FOLLOWUP, ...extAuthorJoin },
      { raw_payload: { author_self: true }, content: COMPANY_PRIOR_REPLY },
      { author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin },
    ]);
    await generateReplySuggestions('m_t1_0', ORG);
    const { user, system } = lastPrompt();
    expect(user).toContain('CONVERSATION SO FAR');
    const line = user.split('\n').find((l) => l.includes(COMPANY_PRIOR_REPLY)) ?? '';
    expect(line).toContain('YOU (the creator)');
    expect(system).toMatch(/do NOT greet again/i);
  });

  it('DM and comment surfaces get materially different system rules', async () => {
    seedThread('t1', ORG, null);
    setMessages('t1', 'dm', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t1_0', ORG);
    const dmSystem = lastPrompt().system;

    seedThread('t2');
    setMessages('t2', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t2_0', ORG);
    const commentSystem = lastPrompt().system;

    expect(dmSystem).not.toBe(commentSystem);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T6/T8 — batch independence and tenant isolation', () => {
  it('T6: two threads generated back-to-back keep independent context', async () => {
    seedThread('tA');
    setMessages('tA', 'comment', [{ author_id: AUTHOR_EXT, content: 'Question about pricing tiers', ...extAuthorJoin }]);
    seedThread('tB');
    setMessages('tB', 'comment', [{ author_id: AUTHOR_EXT, content: 'Where is the API changelog?', ...extAuthorJoin }]);

    await generateReplySuggestions('m_tA_0', ORG);
    await generateReplySuggestions('m_tB_0', ORG);

    const [a, b] = capturedCalls;
    expect(a.user).toContain('pricing tiers');
    expect(a.user).not.toContain('API changelog');
    expect(b.user).toContain('API changelog');
    expect(b.user).not.toContain('pricing tiers');
  });

  it('T8: another company\'s conversation never enters this company\'s prompt', async () => {
    seedThread('t_mine');
    setMessages('t_mine', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    seedThread('t_theirs', OTHER_ORG);
    db.engagement_messages.push({
      id: 'm_rival', thread_id: 't_theirs', author_id: AUTHOR_EXT, platform: 'linkedin',
      direction: null, raw_payload: null, content: 'RIVAL_COMPANY_SECRET_THREAD',
      message_type: 'comment', parent_message_id: null,
      platform_created_at: '2026-01-10T00:00:00Z',
    });

    await generateReplySuggestions('m_t_mine_0', ORG);
    expect(lastPrompt().user).not.toContain('RIVAL_COMPANY_SECRET_THREAD');
  });

  it('T8b: history is scoped to the thread, so no unrelated own-thread text leaks in', async () => {
    seedThread('tA');
    setMessages('tA', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    seedThread('tB');
    setMessages('tB', 'comment', [{ direction: 'outgoing', content: 'UNRELATED_OTHER_THREAD_REPLY' }]);

    await generateReplySuggestions('m_tA_0', ORG);
    expect(lastPrompt().user).not.toContain('UNRELATED_OTHER_THREAD_REPLY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T9 + gateway invariants', () => {
  it('T9: F5 still blocks generation on a thread the company already answered', async () => {
    seedThread('t1');
    // Latest turn is ours ⇒ non-actionable ⇒ no generation, no prompt at all.
    setMessages('t1', 'comment', [
      { direction: 'outgoing', content: COMPANY_PRIOR_REPLY },
      { author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin },
    ]);
    await expect(generateReplySuggestions('m_t1_0', ORG)).rejects.toMatchObject({
      code: 'THREAD_NOT_ACTIONABLE',
    });
    expect(capturedCalls).toHaveLength(0);
  });

  it('generation still routes through the canonical gateway operation', async () => {
    seedThread('t1');
    setMessages('t1', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t1_0', ORG);
    // Usage accounting, tenant context and cost attribution all hang off this.
    expect(lastPrompt().operation).toBe('engagement_reply_suggestions');
  });

  it('the company-grounding directive still leads the system prompt', async () => {
    seedThread('t1');
    setMessages('t1', 'comment', [{ author_id: AUTHOR_EXT, content: EXTERNAL_FIRST, ...extAuthorJoin }]);
    await generateReplySuggestions('m_t1_0', ORG);
    expect(lastPrompt().system.startsWith('GROUNDING')).toBe(true);
  });

  it('history is capped so a long thread cannot unbound the prompt', async () => {
    seedThread('t1');
    const many = Array.from({ length: 30 }, (_, i) => ({
      author_id: AUTHOR_EXT, content: `turn number ${i}`, ...extAuthorJoin,
    }));
    setMessages('t1', 'comment', many);
    await generateReplySuggestions('m_t1_0', ORG);
    const block = lastPrompt().user.split('ALREADY SAID IN THIS THREAD')[1]?.split('COMMENT TO REPLY TO')[0] ?? '';
    // [0] is the remainder of the header line itself; the turns follow it.
    const turnLines = block.trim().split('\n').filter(Boolean).slice(1);
    expect(turnLines.length).toBe(8);
    // WHICH 8 is not asserted here: this harness's `.order()` is a no-op, so
    // row order comes from insertion rather than platform_created_at. Asserting
    // recency would be asserting the fixture, not the product. The cap itself
    // is what this test exists to hold.
  });
});
