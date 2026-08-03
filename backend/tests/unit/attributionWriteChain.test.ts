/**
 * INT-001 Phase 0 (P0-B) — characterization of the attribution/session WRITE chain.
 *
 * Pins the CURRENT persistence behaviour of attributionResolverService and
 * leadAttributionService at the payload level, with a table-aware insert/update
 * recorder standing in for ownedDbTable. The single most important pin here is
 * SESSION STARVATION: with no anonymous_id/session_id the resolver returns
 * { sessionId: null } and performs ZERO visitor_sessions operations — this is
 * the exact behaviour INT-001 Phase 1 will change, so it must be provable
 * "before" state. No production change.
 */

type RecordedOp = {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<[string, ...unknown[]]>;
};

const ops: RecordedOp[] = [];
const responses: Record<string, { data: unknown; error: unknown }> = {};
const throwOnInsert = new Set<string>();

function respond(table: string, op: string) {
  return responses[`${table}:${op}`] ?? { data: null, error: null };
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec: RecordedOp = { table, op: 'select', payload: undefined, filters: [] };
    ops.push(rec);
    const chain: any = {
      select: jest.fn(() => chain),
      insert: jest.fn((p: Record<string, unknown>) => {
        if (throwOnInsert.has(table)) throw new Error(`insert failed for ${table}`);
        rec.op = 'insert'; rec.payload = p; return chain;
      }),
      update: jest.fn((p: Record<string, unknown>) => { rec.op = 'update'; rec.payload = p; return chain; }),
      eq: jest.fn((k: string, v: unknown) => { rec.filters.push(['eq', k, v]); return chain; }),
      is: jest.fn((k: string, v: unknown) => { rec.filters.push(['is', k, v]); return chain; }),
      gte: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      maybeSingle: jest.fn(async () => respond(table, rec.op)),
      single: jest.fn(async () => respond(table, rec.op)),
      then: (resolve: any, reject?: any) => Promise.resolve(respond(table, rec.op)).then(resolve, reject),
    };
    return chain;
  },
}));

import {
  resolveVisitorSession,
  stitchSessionToLead,
  persistCampaignTouchpoint,
} from '../../services/attributionResolverService';
import {
  recordLeadAttribution,
  ensureVisitorSession,
  buildTouchSnapshot,
} from '../../services/leadAttributionService';

const opsFor = (table: string, op?: RecordedOp['op']) =>
  ops.filter((o) => o.table === table && (!op || o.op === op));

const ATTR = {
  anonymous_id: 'anon-1',
  session_id: 'sess-1',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'spring',
  utm_content: 'ad-1',
  utm_term: 'crm',
  referrer: 'https://google.com',
  landing_page: 'https://site.com/landing',
  current_page: 'https://site.com/contact',
  asset_id: 'A1',
  variant_id: 'V1',
  creator_strategy_id: 'S1',
  consent_state: 'granted',
  first_touch: null,
  last_touch: null,
  metadata: { k: 'v' },
} as const;

beforeEach(() => {
  ops.length = 0;
  for (const k of Object.keys(responses)) delete responses[k];
  throwOnInsert.clear();
});

describe('P0-B — resolveVisitorSession', () => {
  test('SESSION STARVATION: no anonymous_id/session_id → sessionId null, firstTouch=lastTouch, ZERO DB operations', async () => {
    const result = await resolveVisitorSession({
      companyId: 'co-1',
      websiteId: 'w-1',
      attribution: { ...ATTR, anonymous_id: null, session_id: null },
    });
    expect(result.sessionId).toBeNull();
    expect(result.firstTouch).toEqual(result.lastTouch); // snapshot fallback
    expect(ops.length).toBe(0); // nothing touched visitor_sessions at all
  });

  test('new visitor: inserts the full visitor_sessions row (session_key from session_id) and returns its id', async () => {
    responses['visitor_sessions:select'] = { data: null, error: null };
    responses['visitor_sessions:insert'] = { data: { id: 'vs-new' }, error: null };
    const result = await resolveVisitorSession({ companyId: 'co-1', websiteId: 'w-1', attribution: { ...ATTR } });
    expect(result.sessionId).toBe('vs-new');
    const [ins] = opsFor('visitor_sessions', 'insert');
    expect(ins.payload).toMatchObject({
      company_id: 'co-1',
      website_id: 'w-1',
      anonymous_id: 'anon-1',
      session_key: 'sess-1',
      first_landing_page: 'https://site.com/landing',
      last_current_page: 'https://site.com/contact',
      first_referrer: 'https://google.com',
      last_referrer: 'https://google.com',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_content: 'ad-1',
      utm_term: 'crm',
      consent_state: 'granted',
      metadata: { k: 'v' },
    });
    // first_touch defaults to the last-touch snapshot when the client sent none
    expect(ins.payload!.first_touch).toEqual(ins.payload!.last_touch);
  });

  test('session_key falls back to anonymous_id when session_id is absent', async () => {
    responses['visitor_sessions:insert'] = { data: { id: 'vs-2' }, error: null };
    await resolveVisitorSession({ companyId: 'co-1', attribution: { ...ATTR, session_id: null } });
    const [ins] = opsFor('visitor_sessions', 'insert');
    expect(ins.payload).toMatchObject({ anonymous_id: 'anon-1', session_key: 'anon-1', website_id: null });
  });

  test('returning visitor: updates last_* fields, preserves the stored first_touch, returns the existing id', async () => {
    const storedFirst = { utm_source: 'first-src', landing_page: '/first' };
    responses['visitor_sessions:select'] = {
      data: { id: 'vs-old', website_id: 'w-old', first_touch: storedFirst, last_current_page: '/old', last_referrer: 'old-ref', consent_state: 'granted' },
      error: null,
    };
    const result = await resolveVisitorSession({ companyId: 'co-1', websiteId: null, attribution: { ...ATTR } });
    expect(result.sessionId).toBe('vs-old');
    expect(result.firstTouch).toEqual(storedFirst); // stored first-touch wins
    const [upd] = opsFor('visitor_sessions', 'update');
    expect(upd.payload).toMatchObject({
      website_id: 'w-old', // input null falls back to the existing value
      last_current_page: 'https://site.com/contact',
      last_referrer: 'https://google.com',
      consent_state: 'granted',
    });
    expect(typeof upd.payload!.last_seen_at).toBe('string');
    expect(upd.filters).toEqual([['eq', 'id', 'vs-old']]);
  });

  test('returning visitor with an EMPTY stored first_touch: falls back to attribution first_touch ?? last-touch snapshot', async () => {
    responses['visitor_sessions:select'] = { data: { id: 'vs-old', first_touch: {} }, error: null };
    const result = await resolveVisitorSession({ companyId: 'co-1', attribution: { ...ATTR } });
    expect(result.firstTouch).toEqual(result.lastTouch);
  });
});

describe('P0-B — stitchSessionToLead', () => {
  test('stitches the session and adopts ONLY orphan touchpoints (lead_id is null filter)', async () => {
    await stitchSessionToLead({ leadId: 'L1', companyId: 'co-1', visitorSessionId: 'vs-1', unifiedPersonId: 'up-1' });
    const [sess] = opsFor('visitor_sessions', 'update');
    expect(sess.payload).toMatchObject({ unified_person_id: 'up-1' });
    expect(typeof sess.payload!.stitched_at).toBe('string');
    expect(sess.filters).toEqual([['eq', 'id', 'vs-1'], ['eq', 'company_id', 'co-1']]);
    const [tp] = opsFor('campaign_touchpoints', 'update');
    expect(tp.payload).toEqual({ lead_id: 'L1' });
    expect(tp.filters).toEqual([
      ['eq', 'visitor_session_id', 'vs-1'],
      ['eq', 'company_id', 'co-1'],
      ['is', 'lead_id', null],
    ]);
  });

  test('null visitorSessionId → complete no-op (zero DB operations)', async () => {
    await stitchSessionToLead({ leadId: 'L1', companyId: 'co-1', visitorSessionId: null, unifiedPersonId: 'up-1' });
    expect(ops.length).toBe(0);
  });
});

describe('P0-B — persistCampaignTouchpoint', () => {
  test('inserts the touchpoint with source fallback utm_source → referrer → direct and the touch snapshot in metadata', async () => {
    await persistCampaignTouchpoint({
      companyId: 'co-1', websiteId: 'w-1', visitorSessionId: 'vs-1', leadId: 'L1',
      attribution: { ...ATTR }, touchpointType: 'conversion',
    });
    const [ins] = opsFor('campaign_touchpoints', 'insert');
    expect(ins.payload).toMatchObject({
      company_id: 'co-1', website_id: 'w-1', visitor_session_id: 'vs-1', lead_id: 'L1',
      touchpoint_type: 'conversion', source: 'google', medium: 'cpc', campaign: 'spring',
      content: 'ad-1', term: 'crm', page_url: 'https://site.com/contact',
      asset_id: 'A1', variant_id: 'V1', creator_strategy_id: 'S1',
    });
    expect((ins.payload!.metadata as { attribution: unknown }).attribution).toEqual(buildTouchSnapshot({ ...ATTR }));

    ops.length = 0;
    await persistCampaignTouchpoint({
      companyId: 'co-1', attribution: { ...ATTR, utm_source: null }, touchpointType: 'event',
    });
    expect(opsFor('campaign_touchpoints', 'insert')[0].payload).toMatchObject({ source: 'https://google.com' });

    ops.length = 0;
    await persistCampaignTouchpoint({
      companyId: 'co-1', attribution: { ...ATTR, utm_source: null, referrer: null }, touchpointType: 'event',
    });
    expect(opsFor('campaign_touchpoints', 'insert')[0].payload).toMatchObject({ source: 'direct' });
  });

  test('best-effort: a throwing insert resolves without throwing (touchpoints never block capture)', async () => {
    throwOnInsert.add('campaign_touchpoints');
    await expect(persistCampaignTouchpoint({
      companyId: 'co-1', attribution: { ...ATTR }, touchpointType: 'conversion',
    })).resolves.toBeUndefined();
  });
});

describe('P0-B — recordLeadAttribution', () => {
  test('writes the capture_snapshot lead_attributions row AND the form_conversions row', async () => {
    await recordLeadAttribution({
      companyId: 'co-1', leadId: 'L1', formId: 'F1', websiteId: 'w-1',
      visitorSessionId: 'vs-1', source: 'website', attribution: { ...ATTR },
    });
    const snapshot = buildTouchSnapshot({ ...ATTR });
    const [attr] = opsFor('lead_attributions', 'insert');
    expect(attr.payload).toMatchObject({
      lead_id: 'L1', company_id: 'co-1', website_id: 'w-1', visitor_session_id: 'vs-1',
      attribution_model: 'capture_snapshot',
      first_touch: snapshot, last_touch: snapshot, // both fall back to the derived snapshot
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring',
      referrer: 'https://google.com', landing_page: 'https://site.com/landing',
      current_page: 'https://site.com/contact',
      asset_id: 'A1', variant_id: 'V1', creator_strategy_id: 'S1', consent_state: 'granted',
    });
    const [conv] = opsFor('form_conversions', 'insert');
    expect(conv.payload).toMatchObject({
      company_id: 'co-1', website_id: 'w-1', form_id: 'F1', lead_id: 'L1',
      visitor_session_id: 'vs-1', conversion_name: 'lead_form_submit', source: 'website',
      metadata: { attribution: snapshot },
    });
  });

  test('independent best-effort catches: a throwing lead_attributions insert never blocks the form_conversions write', async () => {
    throwOnInsert.add('lead_attributions');
    await expect(recordLeadAttribution({
      companyId: 'co-1', leadId: 'L1', attribution: { ...ATTR },
    })).resolves.toBeUndefined();
    expect(opsFor('form_conversions', 'insert').length).toBe(1); // second write still attempted
    expect(opsFor('form_conversions', 'insert')[0].payload).toMatchObject({ source: 'form' }); // default source
  });
});

describe('P0-B — snapshot + ensureVisitorSession contracts', () => {
  test('buildTouchSnapshot: 13-key shape; session_id falls back to visitor_session_id', () => {
    const snap = buildTouchSnapshot({ ...ATTR, session_id: null, visitor_session_id: 'vs-77' });
    expect(snap).toEqual({
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: 'ad-1', utm_term: 'crm',
      referrer: 'https://google.com', landing_page: 'https://site.com/landing', current_page: 'https://site.com/contact',
      asset_id: 'A1', variant_id: 'V1', creator_strategy_id: 'S1',
      anonymous_id: 'anon-1', session_id: 'vs-77',
    });
  });

  test('ensureVisitorSession: pre-supplied visitor_session_id is returned with zero DB ops; no anonymous id → null', async () => {
    const kept = await ensureVisitorSession({ attribution: { ...ATTR, visitor_session_id: 'vs-9' } });
    expect(kept).toBe('vs-9');
    expect(ops.length).toBe(0);
    const none = await ensureVisitorSession({ attribution: { ...ATTR, anonymous_id: null, session_id: null } });
    expect(none).toBeNull();
    expect(ops.length).toBe(0);
  });
});
