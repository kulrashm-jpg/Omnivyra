/**
 * D4 — multi-account company ownership.
 *
 * Intended rule (stated by the product): ownership is POOLED per company. Any
 * active connected account belonging to the company counts as company-authored,
 * so a reply from LinkedIn Account A2 closes a thread that Account A1 was
 * handling. Any account outside the company is external.
 *
 * Identity is `platform + platform_user_id` — never a display name, username,
 * profile URL, or email.
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

const COMPANY_A = 'company_a';
const COMPANY_B = 'company_b';

// Company A: three members, three LinkedIn accounts + one Twitter account.
const A_USERS = ['user_a1', 'user_a2', 'user_a3'];
const A1 = { author: 'auth_a1', member: 'li-member-A1' };
const A2 = { author: 'auth_a2', member: 'li-member-A2' };
const A3 = { author: 'auth_a3', member: 'li-member-A3' };
const A_TW = { author: 'auth_a_tw', member: 'tw-member-A1' };
// Company B.
const B1 = { author: 'auth_b1', member: 'li-member-B1' };
// Unaffiliated.
const EXT = { author: 'auth_ext', member: 'li-member-EXTERNAL' };

function seedIdentity(opts: { a2Active?: boolean } = {}) {
  db.user_company_roles = [
    { user_id: A_USERS[0], company_id: COMPANY_A, status: 'active' },
    { user_id: A_USERS[1], company_id: COMPANY_A, status: 'active' },
    { user_id: A_USERS[2], company_id: COMPANY_A, status: 'active' },
    { user_id: 'user_b1', company_id: COMPANY_B, status: 'active' },
  ];
  db.social_accounts = [
    { user_id: A_USERS[0], platform: 'linkedin', platform_user_id: A1.member, is_active: true },
    { user_id: A_USERS[1], platform: 'linkedin', platform_user_id: A2.member, is_active: opts.a2Active ?? true },
    { user_id: A_USERS[2], platform: 'linkedin', platform_user_id: A3.member, is_active: true },
    { user_id: A_USERS[0], platform: 'twitter',  platform_user_id: A_TW.member, is_active: true },
    { user_id: 'user_b1', platform: 'linkedin', platform_user_id: B1.member, is_active: true },
  ];
  db.engagement_authors = [
    // Display names deliberately identical across every actor — if ownership
    // ever leaned on a name instead of the platform id, these tests would fail.
    { id: A1.author,  platform: 'linkedin', platform_user_id: A1.member,  display_name: 'Alex Morgan', username: 'alexm', profile_url: 'https://linkedin.com/in/alexm' },
    { id: A2.author,  platform: 'linkedin', platform_user_id: A2.member,  display_name: 'Alex Morgan', username: 'alexm', profile_url: 'https://linkedin.com/in/alexm' },
    { id: A3.author,  platform: 'linkedin', platform_user_id: A3.member,  display_name: 'Alex Morgan', username: 'alexm', profile_url: 'https://linkedin.com/in/alexm' },
    { id: A_TW.author, platform: 'twitter', platform_user_id: A_TW.member, display_name: 'Alex Morgan', username: 'alexm' },
    { id: B1.author,  platform: 'linkedin', platform_user_id: B1.member,  display_name: 'Alex Morgan', username: 'alexm', profile_url: 'https://linkedin.com/in/alexm' },
    { id: EXT.author, platform: 'linkedin', platform_user_id: EXT.member, display_name: 'Alex Morgan', username: 'alexm', profile_url: 'https://linkedin.com/in/alexm' },
  ];
}

const ts = (m: number) => new Date(Date.UTC(2026, 2, 1, 0, m)).toISOString();

/** turns are oldest → newest; the service reads the newest as the latest turn. */
function seedThread(id: string, org: string, turns: Array<{ author: string | null; at: number }>, platform = 'linkedin', unread = 1) {
  db.engagement_threads.push({
    id, platform, organization_id: org, ignored: false, priority_score: 10,
    unread_count: unread, raw_payload: null, platform_thread_id: `pt_${id}`,
    source_id: null, created_at: ts(0), updated_at: ts(turns[turns.length - 1]?.at ?? 0),
  });
  turns.forEach((t, i) => {
    db.engagement_messages.push({
      id: `${id}_m${i}`, thread_id: id, platform, author_id: t.author,
      platform_message_id: null, direction: null, raw_payload: null,
      content: 'message body', message_type: 'dm', sentiment_score: null,
      platform_created_at: ts(t.at), created_at: ts(t.at),
    });
  });
}

async function actionableOf(threadId: string, org = COMPANY_A) {
  const rows = await getThreads({ organization_id: org, limit: 100, exclude_ignored: true });
  return rows.find((r) => r.thread_id === threadId)?.actionable;
}

beforeEach(() => {
  Object.keys(db).forEach((k) => { db[k] = []; });
  seedIdentity();
});

// ═══ MULTI-ACCOUNT RESOLUTION ═══════════════════════════════════════════════
describe('D4 — pooled company ownership across connected accounts', () => {
  it('T1 external → A1 : actionable (external is the latest turn)', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('T2 A1 replies : not actionable', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A1.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(false);
  });

  it('T3 external → A1 → external : actionable again', async () => {
    seedThread('t', COMPANY_A, [
      { author: EXT.author, at: 1 }, { author: A1.author, at: 2 }, { author: EXT.author, at: 3 },
    ]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('T4 CRITICAL — external → A1 → A2 : a DIFFERENT company account closes it', async () => {
    seedThread('t', COMPANY_A, [
      { author: EXT.author, at: 1 }, { author: A1.author, at: 2 }, { author: A2.author, at: 3 },
    ]);
    expect(await actionableOf('t')).toBe(false);
  });

  it('T5 external → A2 → A1 : still closed', async () => {
    seedThread('t', COMPANY_A, [
      { author: EXT.author, at: 1 }, { author: A2.author, at: 2 }, { author: A1.author, at: 3 },
    ]);
    expect(await actionableOf('t')).toBe(false);
  });

  it('T7 A1 → A2 → external : actionable', async () => {
    seedThread('t', COMPANY_A, [
      { author: A1.author, at: 1 }, { author: A2.author, at: 2 }, { author: EXT.author, at: 3 },
    ]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('T8 external → A1 → A2 → A3 : all three accounts are company-owned', async () => {
    seedThread('t', COMPANY_A, [
      { author: EXT.author, at: 1 }, { author: A1.author, at: 2 },
      { author: A2.author, at: 3 }, { author: A3.author, at: 4 },
    ]);
    expect(await actionableOf('t')).toBe(false);
  });
});

// ═══ COMPANY ISOLATION ══════════════════════════════════════════════════════
describe('D4 — company isolation', () => {
  it('T6 external → B1 : Company B account is EXTERNAL to Company A', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: B1.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });

  it("Company B's own thread answered by B1 is closed for Company B", async () => {
    seedThread('tb', COMPANY_B, [{ author: EXT.author, at: 1 }, { author: B1.author, at: 2 }]);
    expect(await actionableOf('tb', COMPANY_B)).toBe(false);
  });

  it("Company A's accounts are external to Company B", async () => {
    seedThread('tb', COMPANY_B, [{ author: EXT.author, at: 1 }, { author: A1.author, at: 2 }]);
    expect(await actionableOf('tb', COMPANY_B)).toBe(true);
  });

  it('a company with no members resolves no self-identity', async () => {
    seedThread('t', 'company_empty', [{ author: A1.author, at: 1 }]);
    expect(await actionableOf('t', 'company_empty')).toBe(true);   // safe: external
  });

  it('an inactive company membership does not confer ownership', async () => {
    db.user_company_roles = [{ user_id: A_USERS[0], company_id: COMPANY_A, status: 'inactive' }];
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A1.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });
});

// ═══ PLATFORM ISOLATION ═════════════════════════════════════════════════════
describe('D4 — platform isolation of the identity key', () => {
  it('T9 same platform_user_id on a different platform is NOT the same identity', async () => {
    // A LinkedIn author whose id collides with the company's Twitter member id.
    db.engagement_authors.push({
      id: 'auth_collision', platform: 'linkedin', platform_user_id: A_TW.member,
      display_name: 'Alex Morgan', username: 'alexm',
    });
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: 'auth_collision', at: 2 }]);
    expect(await actionableOf('t')).toBe(true);   // linkedin:tw-member-A1 ≠ twitter:tw-member-A1
  });

  it('the twitter connected account is company-owned on twitter threads', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A_TW.author, at: 2 }], 'twitter');
    expect(await actionableOf('t')).toBe(false);
  });
});

// ═══ ACTIVE / DISCONNECTED ══════════════════════════════════════════════════
describe('D4 — disconnected account semantics (as the code defines them)', () => {
  it('T10 an inactive social account is no longer company-owned', async () => {
    seedIdentity({ a2Active: false });
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A2.author, at: 2 }]);
    // is_active=false is excluded by getOrgAuthorIds → treated as external.
    expect(await actionableOf('t')).toBe(true);
  });

  it('the remaining active accounts still close a thread', async () => {
    seedIdentity({ a2Active: false });
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A1.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(false);
  });
});

// ═══ ADVERSARIAL IDENTITY ═══════════════════════════════════════════════════
describe('D4 — adversarial identity resolution', () => {
  it('identical display name / username / profile URL never confers ownership', async () => {
    // EXT shares name, username AND profile_url with A1 in the fixture.
    seedThread('t', COMPANY_A, [{ author: A1.author, at: 1 }, { author: EXT.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('null author_id stays external — never silently company-owned', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: null, at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('an author id that matches no known author stays external', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: 'auth_unknown', at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });

  it('EMPTY platform_user_id on both sides must not collide into ownership', async () => {
    // Adversarial: a blank connected-account id and a blank author id would
    // both key as "linkedin:" — a false self-classification if the code keys
    // naively. This asserts a blank-id author is NOT treated as the company.
    db.social_accounts.push({ user_id: A_USERS[0], platform: 'linkedin', platform_user_id: '', is_active: true });
    db.engagement_authors.push({ id: 'auth_blank', platform: 'linkedin', platform_user_id: '', display_name: 'Blank' });
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: 'auth_blank', at: 2 }]);
    expect(await actionableOf('t')).toBe(true);
  });
});

// ═══ MEMBERSHIP / CONSUMER CONSISTENCY ══════════════════════════════════════
describe('D4 — membership resolution and consumer agreement', () => {
  it('T11 company resolves accounts of ALL members, not just one user', async () => {
    // A2 belongs to user_a2, not user_a1 — it must still be company-owned.
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A2.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(false);
  });

  it('T12/T13 refresh and re-ingestion keep the same answer', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A2.author, at: 2 }]);
    expect(await actionableOf('t')).toBe(false);
    db.engagement_messages.push({ ...db.engagement_messages[1] });   // re-ingest the A2 reply
    expect(await actionableOf('t')).toBe(false);
  });

  it('T14 duplicate ingestion yields one thread', async () => {
    seedThread('t', COMPANY_A, [{ author: EXT.author, at: 1 }]);
    db.engagement_messages.push({ ...db.engagement_messages[0] });
    const rows = await getThreads({ organization_id: COMPANY_A, limit: 50, exclude_ignored: true, actionable_only: true });
    expect(rows).toHaveLength(1);
  });

  it('T15 badge and work queue agree under multi-account ownership', async () => {
    seedThread('open',   COMPANY_A, [{ author: EXT.author, at: 1 }], 'linkedin', 1);
    seedThread('closed', COMPANY_A, [{ author: EXT.author, at: 1 }, { author: A2.author, at: 2 }], 'linkedin', 7);
    const counts = await getPlatformCounts(COMPANY_A);
    const queue = await getDailyWorkQueue(COMPANY_A);
    const li = queue.platforms.find((p) => p.platform === 'linkedin')!;
    expect(li.actionable_threads).toBe(1);
    expect(counts.linkedin.unread_count).toBe(1);            // stale 7 contributes nothing
    expect(counts.linkedin.unread_count).toBe(li.unread_messages);
  });

  it('T16 pagination excludes company-answered threads regardless of which account replied', async () => {
    for (let i = 0; i < 6; i++) {
      const who = [A1, A2, A3][i % 3];
      seedThread(`closed_${i}`, COMPANY_A, [{ author: EXT.author, at: 1 }, { author: who.author, at: 50 + i }], 'linkedin', 5);
    }
    seedThread('open_1', COMPANY_A, [{ author: EXT.author, at: 2 }]);
    seedThread('open_2', COMPANY_A, [{ author: EXT.author, at: 3 }]);
    const page = await getThreads({
      organization_id: COMPANY_A, limit: 4, exclude_ignored: true, actionable_only: true,
    });
    expect(page.map((t) => t.thread_id).sort()).toEqual(['open_1', 'open_2']);
  });
});
