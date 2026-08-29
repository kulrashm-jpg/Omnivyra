/**
 * B4.1 — the canonical row must carry the ACCEPTED MASTER's content type.
 *
 * DEFECT THIS PINS: `persistAccepted` hardcoded `contentType: 'post'`, so an
 * accepted `article` master was stored as a `post`. Runtime-confirmed in
 * production (Phase 130): an article-block master persisted as `content_type:
 * 'post'`.
 *
 * The type must come from the CARD (the accepted master), never from platform
 * expansion — expansion happens downstream of this seam and fans one master out
 * to many platform/content-type variants.
 *
 * Harness mirrors campaignCanonicalBlockPathB41: `createContent` is mocked, so
 * the persisted row shape is observable without a database.
 */

type Row = Record<string, unknown>;

let insertCounter = 0;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'scheduled_posts') {
        return {
          insert: () => {
            insertCounter += 1;
            return { select: () => ({ maybeSingle: async () => ({ data: { id: `sp-${insertCounter}` }, error: null }) }) };
          },
        };
      }
      if (table === 'daily_content_plans') {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }
      if (table === 'blogs') return { insert: async () => ({ error: null }) };
      if (table === 'campaigns') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'co-1' } }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async () => undefined),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async () => ({
    id: 'master-gen',
    generated_at: '2026-07-12T00:00:00.000Z',
    content: 'Generated master body with a hook and a CTA.',
    generation_status: 'generated',
    generation_source: 'ai',
  })),
  // Platform expansion deliberately reports 'post' for EVERY variant. If the
  // seam ever reads the type from expansion instead of the master, an article
  // card would silently persist as 'post' again — which is the original defect.
  buildPlatformVariantsFromMaster: jest.fn(async () => ([
    { platform: 'linkedin', content_type: 'post', generated_content: 'LinkedIn-native variant body.', generation_status: 'generated' },
    { platform: 'facebook', content_type: 'post', generated_content: 'Facebook-native variant body.', generation_status: 'generated' },
  ])),
}));

jest.mock('../../services/creator/governanceItemEnricher', () => ({
  enrichItemWithGovernance: jest.fn(async (item: unknown) => item),
}));

jest.mock('../../services/campaign/plannerMetrics', () => ({
  emitPlannerDrop: jest.fn(),
  emitLifecycleTransition: jest.fn(),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(),
}));

import { processBlockSchedule } from '../../services/boltScheduleBlockProcessor';
import { generateMasterContentFromIntent } from '../../services/contentGenerationPipeline';
import { createContent } from '../../services/content/contentService';
import { toCanonicalContentType } from '../../../lib/content/canonicalContent';

const mockedMaster = generateMasterContentFromIntent as jest.Mock;
const mockedCreateContent = createContent as jest.MockedFunction<typeof createContent>;

const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li'], ['facebook', 'acct-fb']]);
const normalize = (p: string) => (['linkedin', 'facebook'].includes(p) ? p : null);
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const row = (contentType: string, over: Row = {}): Row => ({
  id: 'row-1',
  campaign_id: 'camp-1',
  week_number: 3,
  day_of_week: 'Tuesday',
  date: '2099-01-05', // far future → the schedule floor never rewrites it
  platform: 'linkedin',
  content_type: contentType,
  title: 'Signal over noise',
  topic: 'Signal over noise',
  scheduled_time: '09:00',
  content: JSON.stringify({
    execution_id: 'ex-1',
    topic: 'Signal over noise',
    dailyObjective: 'Explain why noisy dashboards hide the real signal',
    whoAreWeWritingFor: 'RevOps leads at Series B companies',
    narrativeStyle: 'Direct, evidence-first, no hype',
  }),
  ...over,
});

const runWith = (rows: Row[]) =>
  processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});

const persistedType = () => mockedCreateContent.mock.calls[0]![0].contentType;

beforeEach(() => {
  jest.clearAllMocks();
  insertCounter = 0;
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  mockedCreateContent.mockResolvedValue({ id: 'content-1' } as never);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

describe('toCanonicalContentType — the column CHECK is the whole contract', () => {
  test('identity on the five values content.content_type accepts', () => {
    for (const t of ['post', 'thread', 'blog', 'article', 'story']) {
      expect(toCanonicalContentType(t)).toBe(t);
    }
  });

  test('every other BOLT card type falls back to post rather than violating the CHECK', () => {
    // These are real CONTENT_TYPE_PRIORITY values. A raw pass-through would make
    // the insert fail the CHECK; the generation path swallows persistence errors
    // and continues with content_id null, so the regression would be SILENT.
    for (const t of ['white_paper', 'newsletter', 'short_story', 'carousel', 'image', 'reel', 'short', 'video', 'poll']) {
      expect(toCanonicalContentType(t)).toBe('post');
    }
  });

  test('normalizes case and padding, and is total over junk input', () => {
    expect(toCanonicalContentType('  ARTICLE ')).toBe('article');
    expect(toCanonicalContentType('Blog')).toBe('blog');
    expect(toCanonicalContentType(undefined)).toBe('post');
    expect(toCanonicalContentType(null)).toBe('post');
    expect(toCanonicalContentType('')).toBe('post');
    expect(toCanonicalContentType('not-a-type')).toBe('post');
  });
});

describe('B4.1 — canonical content_type comes from the accepted master', () => {
  test('an accepted post master persists as post', async () => {
    await runWith([row('post')]);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(persistedType()).toBe('post');
  });

  test('an accepted article master persists as article, NOT post', async () => {
    await runWith([row('article')]);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    // The exact production defect: this was 'post' before the fix.
    expect(persistedType()).toBe('article');
    expect(persistedType()).not.toBe('post');
  });

  test('platform expansion does NOT determine the canonical type', async () => {
    // Every platform variant reports content_type 'post' (see the mock). The
    // card is an article. The master's type must win.
    await runWith([
      row('article', { id: 'row-li', platform: 'linkedin' }),
      row('article', { id: 'row-fb', platform: 'facebook' }),
    ]);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(persistedType()).toBe('article');
  });

  test('platform expansion does not multiply canonical rows', async () => {
    await runWith([
      row('article', { id: 'row-li', platform: 'linkedin' }),
      row('article', { id: 'row-fb', platform: 'facebook' }),
    ]);

    // One card ⇒ one master ⇒ exactly one canonical row, across two platforms.
    expect(mockedMaster).toHaveBeenCalledTimes(1);
    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
  });

  test('two cards of different types mint one correctly-typed row each', async () => {
    await runWith([
      row('post', { id: 'row-post', topic: 'Signal over noise' }),
      row('article', { id: 'row-article', topic: 'A different subject entirely', title: 'A different subject entirely' }),
    ]);

    expect(mockedCreateContent).toHaveBeenCalledTimes(2);
    const types = mockedCreateContent.mock.calls.map((c) => c[0].contentType).sort();
    expect(types).toEqual(['article', 'post']);
  });

  test('identity and source metadata survive the type fix', async () => {
    await runWith([row('article')]);

    const created = mockedCreateContent.mock.calls[0]![0];
    expect(created.contentType).toBe('article');
    expect(created.campaignId).toBe('camp-1');
    expect(created.companyId).toBe('co-1');
    expect(created.lifecycleStatus).toBe('generated');
    expect(created.sourceMetadata).toEqual({
      source: 'boltScheduleBlockProcessor',
      campaign_id: 'camp-1',
      week_number: 3,
      day_of_week: 'Tuesday',
    });
  });

  test('an unrepresentable card type still persists, as post', async () => {
    // 'newsletter' is a legitimate BOLT card type the canonical column cannot
    // represent. It must persist (content_id non-null), not fail the CHECK.
    await runWith([row('newsletter')]);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(persistedType()).toBe('post');
  });
});
