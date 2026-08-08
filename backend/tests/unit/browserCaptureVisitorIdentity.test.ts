/**
 * WS-2A — Browser Capture → Visitor Intelligence identity correction.
 *
 * Before this change the capture path supplied neither `visitorId` nor `anonymousId`, so
 * `resolveVisitorId` fell back to the literal `'visitor'` and every event in a tenant — from every
 * author — resolved to ONE synthetic visitor. These tests assert the four properties that matter:
 *
 *   COLLAPSE      distinct authors no longer share a visitor identity
 *   FALLBACK      an event with no author identity still uses the documented fallback
 *   DETERMINISM   the same author always yields the same identity; no clock, no randomness
 *   DISTINCTNESS  the identity survives all the way through resolveVisitorId
 *
 * The engagement writers and `writeOwner` are stubbed so no test performs I/O; the visitor barrel is
 * stubbed so the raw input can be captured, and `resolveVisitorId` is pulled in via requireActual so
 * the end-to-end identity assertion runs against the REAL resolver rather than a double.
 */

jest.mock('../../services/engagementNormalizationService', () => ({
  resolveSource: jest.fn(async () => 'src-1'),
  resolveThread: jest.fn(async () => 'thr-1'),
  resolveAuthor: jest.fn(async () => 'auth-1'),
  insertMessage: jest.fn(async () => 'msg-1'),
}));

jest.mock('../../db/writeOwner', () => ({
  // Complete chain, deliberately: a partial double is exactly the defect class certified repo-wide
  // in WS-4B, where a missing terminator aborted a suite before it asserted anything.
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'update', 'insert', 'contains', 'lte', 'gte']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.upsert = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  },
}));

const shadowCalls: Array<Record<string, unknown>> = [];
jest.mock('../../services/visitorIntelligence', () => ({
  computeVisitorUnderstandingShadow: (raw: Record<string, unknown>) => {
    shadowCalls.push(raw);
    return null; // flag-off shape; this suite asserts the INPUT, not the bundle
  },
}));

import { ingestExtensionEvent } from '../../services/extensionEventIngestionService';

// The real resolver — the identity must survive it, not merely be handed over.
const { resolveVisitorId } = jest.requireActual('../../services/visitorIntelligence/fromRaw') as {
  resolveVisitorId: (raw: { visitorId?: string; anonymousId?: string }) => string;
};

type EventData = {
  author_username?: string | null;
  author_profile_url?: string | null;
  author_name?: string | null;
  created_at?: string | null;
};

const ORG = 'co-1';

const capture = async (data: EventData, messageId = 'm-1') => {
  shadowCalls.length = 0;
  await ingestExtensionEvent({
    platform: 'linkedin',
    event_type: 'dm',
    platform_message_id: messageId,
    organization_id: ORG,
    data: { content: 'hello', created_at: '2026-08-08T00:00:00.000Z', ...data },
  } as Parameters<typeof ingestExtensionEvent>[0]);
  return shadowCalls[0];
};

/** The identity as Visitor Intelligence will actually key it. */
const visitorIdOf = (raw: Record<string, unknown>): string =>
  resolveVisitorId({ visitorId: raw.visitorId as string | undefined, anonymousId: raw.anonymousId as string | undefined });

beforeEach(() => { shadowCalls.length = 0; });

// ── COLLAPSE ───────────────────────────────────────────────────────────────────────────────────────
describe('Browser Capture visitor identity — collapse', () => {
  it('two different authors no longer resolve to the same visitor', async () => {
    const alice = await capture({ author_username: 'alice' }, 'm-1');
    const bob = await capture({ author_username: 'bob' }, 'm-2');

    expect(visitorIdOf(alice)).not.toBe(visitorIdOf(bob));
    // The specific defect: neither may be the synthetic tenant-wide fallback.
    expect(visitorIdOf(alice)).not.toBe('visitor');
    expect(visitorIdOf(bob)).not.toBe('visitor');
  });

  it('a whole tenant of distinct authors yields distinct visitors, not one', async () => {
    const ids: string[] = [];
    for (const u of ['alice', 'bob', 'carol', 'dave']) {
      ids.push(visitorIdOf(await capture({ author_username: u }, `m-${u}`)));
    }
    expect(new Set(ids).size).toBe(4);
  });

  it('supplies the identity as anonymousId, never as visitorId', async () => {
    // An engagement author on a third-party platform was never IDENTIFIED on our site; claiming
    // `visitorId` would assert an identification that did not happen.
    const raw = await capture({ author_username: 'alice' });
    expect(raw.anonymousId).toBe('alice');
    expect(raw.visitorId).toBeUndefined();
  });
});

// ── FALLBACK ───────────────────────────────────────────────────────────────────────────────────────
describe('Browser Capture visitor identity — fallback', () => {
  it('an event with no author identity still falls back, as documented', async () => {
    const raw = await capture({ author_username: null, author_profile_url: null, author_name: null });
    expect(raw.anonymousId).toBeUndefined();
    expect(visitorIdOf(raw)).toBe('visitor');
  });

  it('blank-only author fields are treated as absent, not as an identity', async () => {
    const raw = await capture({ author_username: '   ', author_profile_url: '', author_name: '  ' });
    expect(raw.anonymousId).toBeUndefined();
    expect(visitorIdOf(raw)).toBe('visitor');
  });

  it('does NOT use the per-message fallback id — that would fragment, not identify', async () => {
    const a = await capture({ author_username: null, author_name: null }, 'msg-AAA');
    const b = await capture({ author_username: null, author_name: null }, 'msg-BBB');
    // `extension_author_${platform_message_id}` is unique per MESSAGE; using it would mint a new
    // visitor for every event. Both events must land on the shared fallback instead.
    expect(a.anonymousId).toBeUndefined();
    expect(b.anonymousId).toBeUndefined();
    expect(visitorIdOf(a)).toBe(visitorIdOf(b));
    expect(String(JSON.stringify(a))).not.toContain('extension_author_');
  });
});

// ── PRECEDENCE (reuses the existing chain — no new algorithm) ──────────────────────────────────────
describe('Browser Capture visitor identity — precedence', () => {
  it('prefers username, then profile URL, then display name', async () => {
    expect((await capture({ author_username: 'alice', author_profile_url: 'https://x/alice', author_name: 'Alice A' })).anonymousId).toBe('alice');
    expect((await capture({ author_username: null, author_profile_url: 'https://x/alice', author_name: 'Alice A' })).anonymousId).toBe('https://x/alice');
    expect((await capture({ author_username: null, author_profile_url: null, author_name: 'Alice A' })).anonymousId).toBe('Alice A');
  });

  it('trims, matching the author chain it reuses', async () => {
    expect((await capture({ author_username: '  alice  ' })).anonymousId).toBe('alice');
  });
});

// ── DETERMINISM ────────────────────────────────────────────────────────────────────────────────────
describe('Browser Capture visitor identity — determinism', () => {
  it('the same author yields the same identity across events', async () => {
    const first = await capture({ author_username: 'alice' }, 'm-1');
    const second = await capture({ author_username: 'alice' }, 'm-2');
    expect(first.anonymousId).toBe(second.anonymousId);
    expect(visitorIdOf(first)).toBe(visitorIdOf(second));
  });

  it('identity does not depend on the message id, the clock, or call order', async () => {
    const a = await capture({ author_username: 'alice', created_at: '2020-01-01T00:00:00.000Z' }, 'zzz');
    const b = await capture({ author_username: 'alice', created_at: '2031-12-31T23:59:59.000Z' }, 'aaa');
    expect(a.anonymousId).toBe(b.anonymousId);
  });

  it('the shadow input carries the tenant and no generated identifier', async () => {
    const raw = await capture({ author_username: 'alice' });
    expect(raw.companyId).toBe(ORG);
    // Nothing invented: the identity is a verbatim payload field.
    expect(raw.anonymousId).toBe('alice');
  });
});

// ── DISTINCTNESS THROUGH THE REAL RESOLVER ─────────────────────────────────────────────────────────
describe('Browser Capture visitor identity — end to end', () => {
  it('resolveVisitorId slugs the supplied identity deterministically', async () => {
    const raw = await capture({ author_username: null, author_profile_url: 'https://www.linkedin.com/in/Alex/' });
    expect(visitorIdOf(raw)).toBe('https-www-linkedin-com-in-alex');
  });

  it('two authors whose identities differ only in case still resolve distinctly from the fallback', async () => {
    const upper = await capture({ author_username: 'ALICE' });
    const lower = await capture({ author_username: 'alice' });
    // Same person under the resolver's documented lowercase slug — and crucially not 'visitor'.
    expect(visitorIdOf(upper)).toBe(visitorIdOf(lower));
    expect(visitorIdOf(upper)).toBe('alice');
  });
});
