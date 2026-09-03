/**
 * B4.1 — Campaign → canonical content integration.
 *
 * Covers the phase brief §14 A–G:
 *   A. campaignId round-trip  generation → createContent → content.campaign_id
 *   B. campaign filtering     listContent({campaignId}) narrows within a company
 *   C. tenant isolation       a campaign owned by another company is rejected
 *   D. no campaign            omitted campaignId ⇒ campaign_id NULL
 *   E. flag OFF               no canonical write, campaign behaviour intact
 *   F. flag ON                canonical content +1 with the correct campaign_id
 *   G. propagation            campaignId survives GenerationRequest → runtime
 *
 * The supabase client and the campaign-ownership resolver are mocked, so the
 * persisted row shape and the emitted query filters are directly observable
 * without a database. NOTHING here touches production (§15).
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/ai/safety', () => ({
  moderateBeforePersist: jest.fn(async () => ({ allow: true, categories: [], auditId: 'a' })),
  AiError: class AiError extends Error {},
}));

import { supabase } from '../../db/supabaseClient';
import { createContent, listContent } from '../../services/content/contentService';
import { generateUniqueCampaignMaster } from '../../services/content/campaignUniquenessGuard';
import { isCanonicalPersistenceEnabled } from '../../services/content/canonicalPersistencePolicy';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';
const CAMPAIGN_A = '33333333-3333-3333-3333-333333333333';
const CAMPAIGN_B = '44444444-4444-4444-4444-444444444444';

let capturedRow: Record<string, unknown> | null = null;
/** Every filter applied to a SELECT, as `${op}:${column}=${value}`. */
let capturedFilters: string[] = [];

function installSupabase(): void {
  capturedRow = null;
  capturedFilters = [];
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'content') return { insert: async () => ({ error: null }) };
    const builder: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        capturedRow = row;
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
    // Chainable select builder: every filter is recorded, then awaited as a thenable.
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (col: string, val: unknown) => { capturedFilters.push(`eq:${col}=${String(val)}`); return chain; },
      is: (col: string, val: unknown) => { capturedFilters.push(`is:${col}=${String(val)}`); return chain; },
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    };
    builder.select = chain.select;
    return builder as never;
  }) as unknown as typeof supabase.from);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  installSupabase();
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

/* ── A + D — campaign association on the write ──────────────────────────── */

describe('B4.1 · A — campaignId round-trip to content.campaign_id', () => {
  it('a verified campaignId reaches the persisted row and the DTO', async () => {
    const out = await createContent({
      companyId: COMPANY_A, campaignId: CAMPAIGN_A, contentType: 'post', body: 'x',
    });
    expect(capturedRow!.campaign_id).toBe(CAMPAIGN_A);
    expect(capturedRow!.company_id).toBe(COMPANY_A);
    expect(out.campaignId).toBe(CAMPAIGN_A);
  });
});

describe('B4.1 · D — no campaign', () => {
  it('omitted campaignId persists NULL', async () => {
    const out = await createContent({ companyId: COMPANY_A, contentType: 'post', body: 'x' });
    expect(capturedRow!.campaign_id).toBeNull();
    expect(out.campaignId).toBeNull();
  });

  it('non-campaign content creation still works unchanged', async () => {
    const out = await createContent({ companyId: COMPANY_A, contentType: 'thread', body: 'y' });
    expect(out.contentType).toBe('thread');
    expect(out.campaignId).toBeNull();
  });
});

/* ── B — campaign filtering on the read ─────────────────────────────────── */

describe('B4.1 · B — campaign filtering never bypasses company scoping', () => {
  it('company scope is applied alongside the campaign filter', async () => {
    await listContent(COMPANY_A, { campaignId: CAMPAIGN_A });
    expect(capturedFilters).toContain(`eq:company_id=${COMPANY_A}`);
    expect(capturedFilters).toContain(`eq:campaign_id=${CAMPAIGN_A}`);
  });

  it('querying campaign A never emits a filter for campaign B', async () => {
    await listContent(COMPANY_A, { campaignId: CAMPAIGN_A });
    expect(capturedFilters).not.toContain(`eq:campaign_id=${CAMPAIGN_B}`);
  });

  it('omitting campaignId applies no campaign filter at all', async () => {
    await listContent(COMPANY_A, {});
    expect(capturedFilters).toContain(`eq:company_id=${COMPANY_A}`);
    expect(capturedFilters.some((f) => f.includes('campaign_id'))).toBe(false);
  });

  it('explicit null selects campaign-INDEPENDENT content via IS NULL', async () => {
    await listContent(COMPANY_A, { campaignId: null });
    expect(capturedFilters).toContain('is:campaign_id=null');
    expect(capturedFilters).not.toContain('eq:campaign_id=null');
  });

  it('company scoping is present on every campaign-filtered query', async () => {
    for (const c of [CAMPAIGN_A, CAMPAIGN_B]) {
      capturedFilters = [];
      await listContent(COMPANY_B, { campaignId: c });
      expect(capturedFilters).toContain(`eq:company_id=${COMPANY_B}`);
    }
  });
});

/* ── C — tenant isolation ────────────────────────────────────────────────
 * Covered against the REAL route handler in campaignContentRouteB41.test.ts
 * (company A caller + company B campaign ⇒ 403 CROSS_TENANT_CAMPAIGN and
 * createContent never invoked). Asserting the same rule here would only
 * restate the route's own comparison, so it is not duplicated.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── E + F — the persistence flag governs the campaign bridge ───────────── */

describe('B4.1 · E — flag OFF', () => {
  it('isCanonicalPersistenceEnabled() is false, so the bridge is never built', () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';
    expect(isCanonicalPersistenceEnabled()).toBe(false);
  });

  it('the guard makes NO canonical write when no hook is supplied', async () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';
    const outcome = await generateUniqueCampaignMaster({
      companyId: COMPANY_A,
      campaignId: CAMPAIGN_A,
      contentType: 'post',
      // persistAccepted omitted — exactly what BOLT does when the flag is off.
      generate: async () => ({ text: 'hello campaign', result: { content: 'hello campaign' } }),
    });
    expect(outcome.contentId).toBeNull();
    expect(capturedRow).toBeNull();
  });

  it('createContent itself still refuses when the flag is off', async () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';
    await expect(
      createContent({ companyId: COMPANY_A, campaignId: CAMPAIGN_A, contentType: 'post', body: 'x' }),
    ).rejects.toThrow();
  });
});

describe('B4.1 · F — flag ON', () => {
  it('the accepted master mints exactly one canonical row carrying the campaign', async () => {
    let calls = 0;
    const outcome = await generateUniqueCampaignMaster({
      companyId: COMPANY_A,
      campaignId: CAMPAIGN_A,
      contentType: 'post',
      generate: async () => ({ text: 'unique campaign body', result: { content: 'unique campaign body' } }),
      persistAccepted: async (text) => {
        calls += 1;
        const created = await createContent({
          companyId: COMPANY_A, campaignId: CAMPAIGN_A, contentType: 'post',
          body: text, lifecycleStatus: 'generated',
        });
        return created.id;
      },
    });
    expect(calls).toBe(1);                              // exactly one artifact per accepted master
    expect(outcome.contentId).toBe('content-1');
    expect(capturedRow!.campaign_id).toBe(CAMPAIGN_A);
    expect(capturedRow!.company_id).toBe(COMPANY_A);
    expect(capturedRow!.body).toBe('unique campaign body');
  });

  it('a failing hook degrades to null and never breaks generation', async () => {
    const outcome = await generateUniqueCampaignMaster({
      companyId: COMPANY_A,
      campaignId: CAMPAIGN_A,
      contentType: 'post',
      generate: async () => ({ text: 'body', result: { content: 'body' } }),
      persistAccepted: async () => { throw new Error('db down'); },
    });
    expect(outcome.contentId).toBeNull();
    expect(outcome.text).toBe('body');                  // generation output is intact
  });

  it('no tenant ⇒ no artifact, and the hook is not invoked', async () => {
    let invoked = false;
    const outcome = await generateUniqueCampaignMaster({
      companyId: null,
      campaignId: null,
      contentType: 'post',
      generate: async () => ({ text: 'body', result: { content: 'body' } }),
      persistAccepted: async () => { invoked = true; return 'should-not-happen'; },
    });
    expect(invoked).toBe(false);
    expect(outcome.contentId).toBeNull();
  });
});

/* ── G — propagation contract ───────────────────────────────────────────── */

describe('B4.1 · G — campaignId survives the runtime hop', () => {
  it('createContent maps a runtime-supplied campaignId onto campaign_id', async () => {
    // generationRuntime forwards `req.campaignId ?? null`; this asserts the
    // receiving end honours both branches.
    const withCampaign = await createContent({
      companyId: COMPANY_A, campaignId: CAMPAIGN_A, contentType: 'post', body: 'a',
    });
    expect(withCampaign.campaignId).toBe(CAMPAIGN_A);

    installSupabase();
    const without = await createContent({
      companyId: COMPANY_A, campaignId: null, contentType: 'post', body: 'b',
    });
    expect(without.campaignId).toBeNull();
    expect(capturedRow!.campaign_id).toBeNull();
  });

  it('the campaign is never inferred from topic, title or company', async () => {
    await createContent({
      companyId: COMPANY_A, contentType: 'post',
      title: 'Campaign launch week 1', topic: 'campaign', body: 'x',
    });
    expect(capturedRow!.campaign_id).toBeNull();
  });
});
