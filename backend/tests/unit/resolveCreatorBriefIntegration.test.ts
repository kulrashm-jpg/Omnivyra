/**
 * PHASE CREATOR-BRIEF-INTEGRATION-LOCK — integration coverage for the ACTUAL
 * resolve.ts handler path (not just the pure synthesizeCreatorBrief helper).
 *
 * Drives the real handler with mocked DATA SOURCES only. The synthesis module
 * (creatorBriefSynthesis.ts) and weekly-structure-helpers.ts are NOT mocked —
 * the real synthesis runs, so this exercises:
 *   isCreatorRow gate → effectiveCreatorCard / effectiveIntent → payload.
 *
 * Test-only: production code is unchanged.
 */

// ── Mock every data source resolve.ts touches (NOT the synthesis module) ──────
const dailyPlanRowRef: { value: any } = { value: null };
const getExecutionItemRef: { value: any } = { value: null };

const supabaseMock = {
  from: (_table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      limit: () => chain,
      // scheduled_posts path awaits `.eq()` directly → resolve to empty set.
      then: (resolve: (v: any) => any) => resolve({ data: [] }),
      maybeSingle: async () => ({ data: dailyPlanRowRef.value }),
    };
    return chain;
  },
};

jest.mock('@/backend/db/supabaseClient', () => ({ supabase: supabaseMock }));
jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'u1' })),
}));
jest.mock('@/backend/services/contentArchitectService', () => ({
  isContentArchitectSession: () => false,
  checkContentArchitectAccess: () => ({}),
}));
jest.mock('@/backend/services/orchestration', () => ({
  canonicalExecutionAdapter: {
    getExecutionItem: jest.fn(async () => getExecutionItemRef.value),
    getExecutionItems: jest.fn(async () => []),
  },
  resolveAuthoritativeWorkspace: jest.fn(async () => ({ projection: null })),
}));
jest.mock('@/lib/planning/unifiedExecutionAdapter', () => ({ blueprintItemToUnifiedExecutionUnit: () => ({}) }));
jest.mock('@/lib/planning/repurposingContext', () => ({ buildRepurposingContext: () => null }));
jest.mock('@/lib/planning/masterContentDocument', () => ({ buildMasterContentDocument: () => null }));
jest.mock('@/backend/services/creator/intelligence/workspace', () => ({ loadCreatorWorkspace: () => ({ ok: false }) }));

// Import AFTER mocks. Real synthesis module is intentionally NOT mocked.
import handler from '../../../pages/api/activity-workspace/resolve';

const CAMPAIGN = '11111111-1111-1111-1111-111111111111';
const EXEC = 'exec-abc';

/** Build a canonical adapter item whose __legacy_raw is the row I control. */
function canonical(legacyRaw: Record<string, any>) {
  return {
    metadata: { __legacy_raw: legacyRaw },
    title: legacyRaw.title ?? legacyRaw.topic ?? 'Untitled',
    topic: legacyRaw.topic ?? legacyRaw.title,
    platform: legacyRaw.platform ?? 'linkedin',
    content_type: legacyRaw.content_type ?? 'post',
    execution_id: EXEC,
    theme: legacyRaw.theme,
    objective: legacyRaw.objective,
    intent: legacyRaw.intent,
    week_id: 'wk1',
    day_id: 'Monday',
  };
}

/** Invoke the handler and return the parsed JSON payload. */
async function run(legacyRaw: Record<string, any>, dailyPlanRow: any = null) {
  getExecutionItemRef.value = canonical(legacyRaw);
  dailyPlanRowRef.value = dailyPlanRow;
  const req: any = { method: 'GET', query: { campaignId: CAMPAIGN, executionId: EXEC, companyId: 'co1' } };
  let statusCode = 0;
  let body: any = null;
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { body = payload; return this; },
    setHeader() { return this; },
  };
  await handler(req, res);
  return { statusCode, payload: body?.payload };
}

const nz = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

describe('resolve.ts integration — creator brief recovery (real handler path)', () => {
  it('A. empty creator row → synthesized objective/audience/pain/outcome/summary/CTA', async () => {
    const { statusCode, payload } = await run({
      title: 'Why content velocity stalls', content_type: 'video',
    });
    expect(statusCode).toBe(200);
    const cc = payload.creator_card;
    expect(nz(cc.objective).length).toBeGreaterThan(0);
    expect(nz(cc.target_audience).length).toBeGreaterThan(0);
    expect(nz(cc.summary).length).toBeGreaterThan(0);
    expect(nz(cc.intent.pain_point).length).toBeGreaterThan(0);
    expect(nz(cc.intent.outcome_promise).length).toBeGreaterThan(0);
    expect(nz(cc.intent.cta_type).length).toBeGreaterThan(0);
    // surfaced on dailyExecutionItem too (what the renderer reads)
    expect(nz(payload.dailyExecutionItem.creator_card.intent.pain_point).length).toBeGreaterThan(0);
    expect(nz(payload.dailyExecutionItem.intent.outcome_promise).length).toBeGreaterThan(0);
  });

  it('B. historical creator row (partial creator_card, legacy fields) → no "-"-capable field remains', async () => {
    const { payload } = await run({
      title: 'Pricing strategy', content_type: 'reel',
      creator_card: { objective: 'Explain value-based pricing' }, // partial, legacy
    });
    const cc = payload.creator_card;
    expect(cc.objective).toBe('Explain value-based pricing'); // preserved
    expect(nz(cc.target_audience).length).toBeGreaterThan(0);  // filled
    expect(nz(cc.intent.pain_point).length).toBeGreaterThan(0);
    expect(nz(cc.intent.outcome_promise).length).toBeGreaterThan(0);
    expect(nz(cc.intent.narrative_style).length).toBeGreaterThan(0);
  });

  it('C. upload-created row (creator_asset present, no creator_card/intent) → detected + synthesized', async () => {
    const { payload } = await run(
      { title: 'Behind the scenes', content_type: 'post' /* not a creator format */ },
      { creator_asset: { type: 'video', url: 'https://x/v.mp4' }, content_status: 'creator_ready' },
    );
    // detection via creator_asset (NOT content_type)
    const cc = payload.creator_card;
    expect(nz(cc.objective).length).toBeGreaterThan(0);
    expect(nz(cc.intent.pain_point).length).toBeGreaterThan(0);
  });

  it('D. populated creator row → byte-identical values preserved (no overwrite)', async () => {
    const fullCard = {
      objective: 'Drive demo signups', target_audience: 'RevOps leaders', summary: 'Show the workflow',
      intent: {
        objective: 'Drive demo signups', target_audience: 'RevOps leaders', brief_summary: 'Show the workflow',
        pain_point: 'Manual handoffs leak revenue', outcome_promise: 'Automated routing in minutes',
        cta_type: 'Book a demo', narrative_style: 'crisp and concrete',
      },
    };
    const { payload } = await run({ title: 'Routing', content_type: 'video', creator_card: fullCard });
    const cc = payload.creator_card;
    expect(cc.objective).toBe('Drive demo signups');
    expect(cc.target_audience).toBe('RevOps leaders');
    expect(cc.intent.pain_point).toBe('Manual handoffs leak revenue');
    expect(cc.intent.outcome_promise).toBe('Automated routing in minutes');
    expect(cc.intent.cta_type).toBe('Book a demo');
    expect(cc.intent.narrative_style).toBe('crisp and concrete');
  });

  it('E. precedence row > card > intent > synth (through the real payload)', async () => {
    const { payload } = await run({
      title: 'Topic', content_type: 'video',
      // row-level fields win over creator_card / intent
      dailyObjective: 'ROW-OBJ', whatProblemAreWeAddressing: 'ROW-PAIN',
      creator_card: { objective: 'CARD-OBJ', intent: { pain_point: 'CARD-PAIN' } },
      intent: { objective: 'INTENT-OBJ', pain_point: 'INTENT-PAIN' },
    });
    const cc = payload.creator_card;
    expect(cc.objective).toBe('ROW-OBJ');
    expect(cc.intent.pain_point).toBe('ROW-PAIN');
  });
});

describe('resolve.ts integration — writer isolation (synthesis never runs)', () => {
  const WRITER_FORMATS = ['post', 'article', 'blog', 'newsletter', 'guide', 'whitepaper', 'case-study', 'thread', 'tweet', 'poll'];
  for (const ct of WRITER_FORMATS) {
    it(`${ct} → creator brief NOT synthesized (payload unchanged)`, async () => {
      const { payload } = await run({
        title: `A ${ct}`, content_type: ct,
        // an empty creator_card-shaped object that synthesis WOULD fill if it ran
        creator_card: { objective: '' },
      });
      // synthesis skipped → the empty objective stays empty (not filled)
      expect(payload.creator_card.objective).toBe('');
      expect(payload.creator_card.intent).toBeUndefined();
    });
  }
});

describe('resolve.ts integration — guard routes (Section 3)', () => {
  it('route 1: creator content_type triggers synthesis', async () => {
    const { payload } = await run({ title: 'T', content_type: 'carousel' });
    expect(nz(payload.creator_card?.intent?.pain_point).length).toBeGreaterThan(0);
  });
  it('route 2: intent_type=creator triggers synthesis (non-creator content_type)', async () => {
    const { payload } = await run({ title: 'T', content_type: 'post', intent_type: 'creator' });
    expect(nz(payload.creator_card?.intent?.pain_point).length).toBeGreaterThan(0);
  });
  it('route 3: creator_asset present triggers synthesis', async () => {
    const { payload } = await run(
      { title: 'T', content_type: 'post' },
      { creator_asset: { type: 'video' }, content_status: 'creator_ready' },
    );
    expect(nz(payload.creator_card?.intent?.pain_point).length).toBeGreaterThan(0);
  });
  it('all three false → synthesis prevented (no creator_card produced)', async () => {
    const { payload } = await run({ title: 'T', content_type: 'post' });
    expect(payload.creator_card).toBeUndefined();
  });
});
