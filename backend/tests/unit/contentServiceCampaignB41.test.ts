/**
 * B4.1 — the canonical content row must actually carry the campaign.
 *
 * The path tests mock `createContent`, so they prove the bridge PASSES a
 * campaignId; they cannot prove contentService PERSISTS it. This test closes
 * that gap by observing the real insert row.
 *
 * The `content.campaign_id` column already exists in production; this adds no
 * schema of its own.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/ai/safety', () => ({
  moderateBeforePersist: jest.fn(async () => ({ allow: true, categories: [], auditId: 'a' })),
  AiError: class AiError extends Error {},
}));

import { supabase } from '../../db/supabaseClient';
import { createContent } from '../../services/content/contentService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

let insertedRow: Record<string, unknown> | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  insertedRow = null;
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'content') return { insert: async () => ({ error: null }) };
    return {
      insert: (row: Record<string, unknown>) => {
        insertedRow = row;
        return {
          select: () => ({
            single: async () => ({
              data: { id: 'content-1', created_at: 'n', updated_at: 'n', current_revision: 1, ...row },
              error: null,
            }),
          }),
        };
      },
    };
  }) as unknown as typeof supabase.from);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

const COMPANY = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN = '33333333-3333-3333-3333-333333333333';

describe('B4.1 — content.campaign_id round-trip', () => {
  test('a supplied campaignId reaches the persisted row', async () => {
    await createContent({ companyId: COMPANY, campaignId: CAMPAIGN, contentType: 'post', body: 'x' });
    expect(insertedRow!.campaign_id).toBe(CAMPAIGN);
    expect(insertedRow!.company_id).toBe(COMPANY);
  });

  test('the created DTO reports the campaign back to the caller', async () => {
    const created = await createContent({ companyId: COMPANY, campaignId: CAMPAIGN, contentType: 'post', body: 'x' });
    // The bridge hands `created.id` to campaign memory; the campaign must also be
    // readable back rather than silently dropped by the mapper.
    expect(created.campaignId).toBe(CAMPAIGN);
  });

  test('an omitted campaign persists NULL — never an invented one', async () => {
    await createContent({ companyId: COMPANY, contentType: 'post', body: 'x' });
    expect(insertedRow!.campaign_id).toBeNull();
  });

  test('an explicit null campaign persists NULL', async () => {
    await createContent({ companyId: COMPANY, campaignId: null, contentType: 'post', body: 'x' });
    expect(insertedRow!.campaign_id).toBeNull();
  });

  test('the campaign is never inferred from topic, title or company', async () => {
    await createContent({
      companyId: COMPANY, contentType: 'post', body: 'x',
      title: CAMPAIGN, topic: CAMPAIGN,
    });
    expect(insertedRow!.campaign_id).toBeNull();
  });
});
