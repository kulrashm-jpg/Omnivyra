/**
 * B3 — Canonical write-contract tests.
 *
 * Covers the B2-certified contract delta:
 *   · CanonicalContentType widened with `poll` + `tweet`
 *   · CreateContentInput accepts optional nullable `campaignId`
 *   · campaignId maps to content.campaign_id (undefined/null ⇒ NULL, never invented)
 *   · feed_post normalises to post at the application boundary
 *
 * The canonical writers are exercised against a MOCKED supabase client so the
 * persisted row shape is directly observable without a database. Test IDs map
 * to the phase brief §10 (A–F) and §11 (negative).
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/ai/safety', () => ({
  moderateBeforePersist: jest.fn(async () => ({ allow: true, categories: [], auditId: 'a' })),
  AiError: class AiError extends Error {},
}));

import { supabase } from '../../db/supabaseClient';
import {
  CANONICAL_CONTENT_TYPES,
  normalizeCanonicalContentType,
  type CanonicalContentType,
} from '../../../lib/content/canonicalContent';
import { createContent } from '../../services/content/contentService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;
const CO = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN = '33333333-3333-3333-3333-333333333333';

/** Capture the row handed to .insert() on the content table. */
let capturedContentRow: Record<string, unknown> | null = null;

function installSupabaseCapture(): void {
  capturedContentRow = null;
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'content') {
      return {
        insert: (row: Record<string, unknown>) => {
          capturedContentRow = row;
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'content-1', created_at: 'now', updated_at: 'now', current_revision: 1, ...row },
                error: null,
              }),
            }),
          };
        },
      };
    }
    // content_revision (and anything else) — accept and ignore.
    return { insert: async () => ({ error: null }) };
  }) as unknown as typeof supabase.from);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true'; // exercise the write path
  installSupabaseCapture();
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

describe('B3 · A — canonical type acceptance', () => {
  it('exposes exactly the seven canonical types', () => {
    expect([...CANONICAL_CONTENT_TYPES].sort()).toEqual(
      ['article', 'blog', 'poll', 'post', 'story', 'thread', 'tweet'],
    );
  });

  it.each(['post', 'thread', 'blog', 'article', 'story', 'poll', 'tweet'] as CanonicalContentType[])(
    'persists content of type %s',
    async (contentType) => {
      const out = await createContent({ companyId: CO, contentType, body: 'x' });
      expect(out.contentType).toBe(contentType);
      expect(capturedContentRow!.content_type).toBe(contentType);
    },
  );

  it('poll and tweet are newly canonical (regression anchor for B2)', () => {
    expect(CANONICAL_CONTENT_TYPES).toContain('poll');
    expect(CANONICAL_CONTENT_TYPES).toContain('tweet');
  });
});

describe('B3 · C — campaignId contract + persistence mapping', () => {
  it('omitted campaignId persists NULL (never invents an association)', async () => {
    const out = await createContent({ companyId: CO, contentType: 'post', body: 'x' });
    expect(capturedContentRow!.campaign_id).toBeNull();
    expect(out.campaignId).toBeNull();
  });

  it('explicit null persists NULL', async () => {
    const out = await createContent({ companyId: CO, contentType: 'post', body: 'x', campaignId: null });
    expect(capturedContentRow!.campaign_id).toBeNull();
    expect(out.campaignId).toBeNull();
  });

  it('a valid id persists to content.campaign_id and round-trips', async () => {
    const out = await createContent({ companyId: CO, contentType: 'poll', body: 'x', campaignId: CAMPAIGN });
    expect(capturedContentRow!.campaign_id).toBe(CAMPAIGN);
    expect(out.campaignId).toBe(CAMPAIGN);
  });

  it('campaignId does not alter company ownership', async () => {
    await createContent({ companyId: CO, contentType: 'post', body: 'x', campaignId: CAMPAIGN });
    // company_id remains the caller-supplied tenant; campaign never substitutes it.
    expect(capturedContentRow!.company_id).toBe(CO);
  });
});

describe('B3 · D — feed_post normalisation', () => {
  it('feed_post normalises to post', () => {
    expect(normalizeCanonicalContentType('feed_post')).toBe('post');
  });

  it('post remains post', () => {
    expect(normalizeCanonicalContentType('post')).toBe('post');
  });

  it('every canonical type normalises to itself', () => {
    for (const t of CANONICAL_CONTENT_TYPES) {
      expect(normalizeCanonicalContentType(t)).toBe(t);
    }
  });

  it('tweet is canonical, NOT an alias of post', () => {
    // formatGovernance makes `tweet` the alias TARGET of twitter_post/x_post/microblog.
    expect(normalizeCanonicalContentType('tweet')).toBe('tweet');
    expect(normalizeCanonicalContentType('twitter_post')).toBe('tweet');
    expect(normalizeCanonicalContentType('x_post')).toBe('tweet');
    expect(normalizeCanonicalContentType('microblog')).toBe('tweet');
  });

  it('normalises the other documented aliases only', () => {
    expect(normalizeCanonicalContentType('linkedin_post')).toBe('post');
    expect(normalizeCanonicalContentType('blog_article')).toBe('article');
  });

  it('is case- and separator-insensitive', () => {
    expect(normalizeCanonicalContentType('FEED_POST')).toBe('post');
    expect(normalizeCanonicalContentType(' feed-post ')).toBe('post');
  });
});

describe('B3 · §11 — negative: non-canonical types must NOT become canonical', () => {
  it.each([
    'newsletter', 'guide', 'case_study', 'whitepaper', 'short_story',
    'image', 'carousel', 'infographic', 'brand_card', 'banner', 'pdf', 'supporting_image',
  ])('%s does not normalise to a canonical type', (t) => {
    expect(normalizeCanonicalContentType(t)).toBeNull();
    expect(CANONICAL_CONTENT_TYPES).not.toContain(t as CanonicalContentType);
  });

  it('unknown / empty input returns null rather than guessing', () => {
    for (const v of ['', '   ', 'nonsense', null, undefined, 42]) {
      expect(normalizeCanonicalContentType(v)).toBeNull();
    }
  });

  it('shortstory alias does NOT leak in (its target is non-canonical)', () => {
    expect(normalizeCanonicalContentType('shortstory')).toBeNull();
  });
});

describe('B3 · F — tenant safety unchanged', () => {
  it('the persistence policy still governs the write', async () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';
    await expect(
      createContent({ companyId: CO, contentType: 'poll', body: 'x', campaignId: CAMPAIGN }),
    ).rejects.toThrow();
    // Denied before any DB call — campaignId does not create a bypass.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * B3.1 — Writer task-policy compatibility.
 *
 * poll/tweet must resolve a policy rather than hit the registry's unknown-task
 * throw. They are MASTER tasks because the long-form window is OPERATION-keyed:
 * aiGatewayCore.ts:308 returns 240_000ms for any call whose operation is in
 * LONG_FORM_OPERATIONS, which contains 'generateMasterContent' — the operation
 * that produces master content for every content type, poll and tweet included.
 * ──────────────────────────────────────────────────────────────────────────── */

import {
  getTaskPolicy,
  ALL_WRITER_TASKS,
  MASTER_TEXT_TEMPERATURE,
  MASTER_MEDIA_TEMPERATURE,
  VARIANT_TEMPERATURE,
  ADAPT_TIGHT_TEMPERATURE,
  ADAPT_LOOSE_TEMPERATURE,
} from '../../services/content/runtime/taskPolicyRegistry';
import type { WriterContentType, WriterTask } from '../../services/content/runtime/contracts';

const LONG_FORM_MS = 240_000;
const SHORT_FORM_MS = 30_000;

describe('B3.1 · A — WriterContentType parity with CanonicalContentType', () => {
  it('accepts all seven canonical types', () => {
    const writerTypes: WriterContentType[] = ['post', 'thread', 'blog', 'article', 'story', 'poll', 'tweet'];
    expect(writerTypes).toHaveLength(CANONICAL_CONTENT_TYPES.length);
    for (const t of CANONICAL_CONTENT_TYPES) {
      expect(writerTypes).toContain(t as WriterContentType);
    }
  });

  it('ALL_WRITER_TASKS covers the seven content types plus variant/adapt', () => {
    expect([...ALL_WRITER_TASKS].sort()).toEqual(
      ['adapt', 'article', 'blog', 'poll', 'post', 'story', 'thread', 'tweet', 'variant'],
    );
  });
});

describe('B3.1 · B — poll/tweet resolve a policy (no unknown-task throw)', () => {
  it.each(['poll', 'tweet'] as WriterTask[])('getTaskPolicy(%s) does not throw', (task) => {
    expect(() => getTaskPolicy(task)).not.toThrow();
  });

  it.each(['poll', 'tweet'] as WriterTask[])('%s receives the master long-form policy', (task) => {
    const p = getTaskPolicy(task);
    expect(p.timeoutMs).toBe(LONG_FORM_MS);          // operation-keyed, per aiGatewayCore:308
    expect(p.temperature).toBe(MASTER_TEXT_TEMPERATURE);
    expect(p.model).toBeTruthy();
    expect(p.streaming).toBe(false);
    expect(p.cache.enabled).toBe(false);
  });

  it('media modifier applies to poll/tweet exactly as to other master tasks', () => {
    expect(getTaskPolicy('poll', { media: true }).temperature).toBe(MASTER_MEDIA_TEMPERATURE);
    expect(getTaskPolicy('tweet', { media: true }).temperature).toBe(MASTER_MEDIA_TEMPERATURE);
  });
});

describe('B3.1 · C — existing task policies unchanged', () => {
  it.each(['post', 'thread', 'blog', 'article', 'story'] as WriterTask[])(
    '%s keeps master long-form policy',
    (task) => {
      const p = getTaskPolicy(task);
      expect(p.timeoutMs).toBe(LONG_FORM_MS);
      expect(p.temperature).toBe(MASTER_TEXT_TEMPERATURE);
    },
  );

  it('variant keeps short-form + temperature 0', () => {
    const p = getTaskPolicy('variant');
    expect(p.timeoutMs).toBe(SHORT_FORM_MS);
    expect(p.temperature).toBe(VARIANT_TEMPERATURE);
  });

  it('adapt keeps short-form with tight/loose temperatures', () => {
    expect(getTaskPolicy('adapt').timeoutMs).toBe(SHORT_FORM_MS);
    expect(getTaskPolicy('adapt').temperature).toBe(ADAPT_LOOSE_TEMPERATURE);
    expect(getTaskPolicy('adapt', { tight: true }).temperature).toBe(ADAPT_TIGHT_TEMPERATURE);
  });
});

describe('B3.1 · D — negative: non-writer types still throw', () => {
  it.each([
    'newsletter', 'guide', 'case_study', 'whitepaper', 'short_story',
    'image', 'carousel', 'infographic', 'brand_card', 'banner', 'pdf', 'supporting_image',
  ])('%s is not a writer task', (t) => {
    // Cast deliberately: proving the RUNTIME backstop still rejects values the
    // type system would refuse, so a widened canonical union cannot smuggle a
    // non-writer type into generation.
    expect(() => getTaskPolicy(t as unknown as WriterTask)).toThrow(/unknown task/);
    expect(ALL_WRITER_TASKS).not.toContain(t as unknown as WriterTask);
  });
});
