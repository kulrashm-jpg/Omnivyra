/**
 * INT-002 Wave 1 — intelligence generation activation.
 *
 * Two layers, one seam:
 *  CORE — the activation service driving the REAL INT-001 orchestrator over
 *  injected in-memory ports: generate-once, fingerprint skip, regeneration on
 *  capture/tracking/attribution/enrichment input changes, engine-version bump
 *  regeneration, fail-open persistence, kill switch, cooldown dedupe, and
 *  session-driven regeneration.
 *  WIRING — the production call sites (captureWebsiteLead, /api/leads modes,
 *  /api/website-events/track) fire the trigger at the right moment with a spy
 *  orchestrator injected via the activation test hook. No response contract
 *  changes anywhere (the Phase 0 suites re-pin those separately).
 */

type RecordedOp = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
const ops: RecordedOp[] = [];
const tableQueues: Record<string, Array<{ data: unknown; error: unknown }>> = {};
const queueResponse = (key: string, v: { data: unknown; error: unknown }) => {
  (tableQueues[key] = tableQueues[key] ?? []).push(v);
};
const nextResponse = (table: string, op: string) =>
  (tableQueues[`${table}:${op}`]?.shift()) ?? { data: [], error: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec: RecordedOp = { table, op: 'select', filters: [] };
    ops.push(rec);
    let resolved: { data: unknown; error: unknown } | null = null;
    const resolve = () => (resolved = resolved ?? nextResponse(table, rec.op));
    const chain: any = {
      select: jest.fn(() => chain),
      insert: jest.fn((p: unknown) => { rec.op = 'insert'; rec.payload = p; return chain; }),
      update: jest.fn((p: unknown) => { rec.op = 'update'; rec.payload = p; return chain; }),
      upsert: jest.fn((p: unknown) => { rec.op = 'upsert'; rec.payload = p; return chain; }),
      eq: jest.fn((k: string, v: unknown) => { rec.filters.push([k, v]); return chain; }),
      is: jest.fn(() => chain),
      gte: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      single: jest.fn(async () => { const r = resolve(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; }),
      maybeSingle: jest.fn(async () => { const r = resolve(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; }),
      then: (res: any, rej?: any) => {
        const r = resolve();
        const arrayData = Array.isArray(r.data) ? r.data : r.data != null ? [r.data] : [];
        return Promise.resolve({ ...r, data: arrayData }).then(res, rej);
      },
    };
    return chain;
  },
}));

// Route-layer collaborators for the wiring tests.
const enforceCompanyAccess = jest.fn();
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a) }));
const createLead = jest.fn();
const validateWebhookAuth = jest.fn();
const getForm = jest.fn();
jest.mock('../../services/leadService', () => ({
  createLead: (...a: unknown[]) => createLead(...a),
  getLeads: jest.fn(async () => []),
  validateWebhookAuth: (...a: unknown[]) => validateWebhookAuth(...a),
  getForm: (...a: unknown[]) => getForm(...a),
}));
const recordLeadAttribution = jest.fn();
jest.mock('../../services/leadAttributionService', () => ({
  ...jest.requireActual('../../services/leadAttributionService'),
  recordLeadAttribution: (...a: unknown[]) => recordLeadAttribution(...a),
}));
const resolveVisitorSession = jest.fn();
const persistCampaignTouchpoint = jest.fn();
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: (...a: unknown[]) => resolveVisitorSession(...a),
  stitchSessionToLead: jest.fn(async () => undefined),
  persistCampaignTouchpoint: (...a: unknown[]) => persistCampaignTouchpoint(...a),
}));
jest.mock('../../services/websiteDomainEnforcementService', () => ({
  checkFormOrigin: jest.fn(async () => ({ allowed: true })),
  checkWebsiteOrigin: jest.fn(async () => ({ allowed: true })),
  hashIp: (v: string | undefined) => (v ? `HASH(${v})` : null),
}));
jest.mock('../../services/tenantResolutionService', () => ({ resolveTenantForWebsite: jest.fn() }));
jest.mock('../../services/leadCaptureProtection', () => ({ evaluateCaptureProtection: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/trackingRateLimitService', () => ({
  checkInMemoryRateLimit: jest.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  isLikelyBot: jest.fn(() => false),
}));

import {
  runLeadIntelligenceGeneration,
  runVisitorSessionRegeneration,
  triggerLeadIntelligence,
  __setActivationOverridesForTests,
  ACTIVATION_COOLDOWN_MS,
} from '../../services/leadIntelligenceActivation';
import { createLeadIntelligenceOrchestrator, ENGINE_VERSION } from '../../services/leadIntelligenceOrchestration';
import type {
  LeadIntelligenceRecord,
  RawLeadRows,
  IntelligenceSnapshotSourcePort,
  IntelligencePersistencePort,
} from '../../services/leadIntelligenceOrchestration';
import { captureWebsiteLead } from '../../services/leadCaptureService';
import leadsHandler from '../../../pages/api/leads/index';
import trackHandler from '../../../pages/api/website-events/track';
import { createMockRes } from '../utils/setupApiTest';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const flush = () => new Promise((r) => setImmediate(r));

function makeRows(over: Partial<RawLeadRows> = {}): RawLeadRows {
  return {
    leadRow: { id: 'L1', company_id: 'co-1', email: 'a@b.co', name: 'A', source: 'website', created_at: '2026-08-03T11:00:00.000Z', metadata: {} },
    trackingEventRows: [],
    visitorSessionRows: [],
    touchpointRows: [],
    ...over,
  } as RawLeadRows;
}

/** Real orchestrator over injected in-memory ports + controllable clock. */
function realHarness(initialRows: RawLeadRows | null = makeRows()) {
  const store = new Map<string, LeadIntelligenceRecord>();
  let rows = initialRows;
  let upsertFails = false;
  let clockNow = T0;
  const persistence: IntelligencePersistencePort = {
    get: async (c: string, l: string) => store.get(`${c}:${l}`) ?? null,
    upsert: async (record: LeadIntelligenceRecord) => {
      if (upsertFails) return { ok: false, error: 'relation "lead_intelligence_profiles" does not exist' };
      store.set(`${record.companyId}:${record.leadId}`, record);
      return { ok: true };
    },
    markRebuildRequested: async () => ({ ok: true }),
  } as IntelligencePersistencePort;
  const snapshotSource: IntelligenceSnapshotSourcePort = { load: async () => rows };
  const orchestrator = createLeadIntelligenceOrchestrator({ persistence, snapshotSource, clock: () => clockNow });
  return {
    orchestrator,
    store,
    setRows: (r: RawLeadRows | null) => { rows = r; },
    setUpsertFails: (v: boolean) => { upsertFails = v; },
    advance: (ms: number) => { clockNow += ms; },
    now: () => clockNow,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ops.length = 0;
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  delete process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED;
  __setActivationOverridesForTests(null);
});
afterAll(() => __setActivationOverridesForTests(null));

// ── CORE — real orchestrator semantics through the activation seam ──────────

describe('INT-002 W1 — activation core (real orchestrator)', () => {
  test('intelligence generated exactly once after capture; record persisted with version metadata', async () => {
    const h = realHarness();
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    const outcome = await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');
    expect(outcome).toBe('ran');
    expect(h.store.size).toBe(1);
    const record = h.store.get('co-1:L1')!;
    expect(record.generationVersion).toBe(1);
    expect(record.engineVersion).toBe(ENGINE_VERSION);
  });

  test('fingerprint skip: identical inputs never generate twice (no duplicate generations)', async () => {
    const h = realHarness();
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');
    h.advance(ACTIVATION_COOLDOWN_MS + 1); // rule out cooldown as the reason
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');
    expect(h.store.get('co-1:L1')!.generationVersion).toBe(1); // skipped_unchanged
  });

  test('regeneration on input change: attribution update, then tracking update, each bumps the generation', async () => {
    const h = realHarness();
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');

    h.setRows(makeRows({ touchpointRows: [{ id: 'tp-1', touchpoint_type: 'conversion', source: 'google', touched_at: '2026-08-03T11:30:00.000Z' } as any] }));
    await runLeadIntelligenceGeneration('co-1', 'L1', 'attribution_updated');
    expect(h.store.get('co-1:L1')!.generationVersion).toBe(2);

    h.setRows(makeRows({
      touchpointRows: [{ id: 'tp-1', touchpoint_type: 'conversion', source: 'google', touched_at: '2026-08-03T11:30:00.000Z' } as any],
      trackingEventRows: [{ id: 'ev-1', event_name: 'page_view', page_url: '/pricing', created_at: '2026-08-03T11:45:00.000Z', metadata: {} } as any],
    }));
    h.advance(ACTIVATION_COOLDOWN_MS + 1);
    await runLeadIntelligenceGeneration('co-1', 'L1', 'tracking_events');
    expect(h.store.get('co-1:L1')!.generationVersion).toBe(3);
  });

  test('enrichment updates: snapshot-visible changes regenerate; snapshot-invisible metadata is fingerprint-skipped', async () => {
    const h = realHarness();
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');

    // Metadata keys OUTSIDE the normalized snapshot profile do not alter the
    // fingerprint — the skip is correct current behaviour, pinned here.
    h.setRows(makeRows({ leadRow: { id: 'L1', company_id: 'co-1', email: 'a@b.co', name: 'A', source: 'website', created_at: '2026-08-03T11:00:00.000Z', metadata: { lead_status: 'qualified', revenue: 5000 } } as any }));
    await runLeadIntelligenceGeneration('co-1', 'L1', 'enrichment_updated');
    expect(h.store.get('co-1:L1')!.generationVersion).toBe(1); // skipped_unchanged

    // Enrichment that lands in a snapshot-visible field regenerates.
    h.setRows(makeRows({ leadRow: { id: 'L1', company_id: 'co-1', email: 'a@b.co', name: 'A (Enriched Corp)', source: 'website', created_at: '2026-08-03T11:00:00.000Z', metadata: {} } as any }));
    await runLeadIntelligenceGeneration('co-1', 'L1', 'enrichment_updated');
    expect(h.store.get('co-1:L1')!.generationVersion).toBe(2);
  });

  test('engine-version bump: an old-version record regenerates even with an identical fingerprint', async () => {
    const h = realHarness();
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');
    const current = h.store.get('co-1:L1')!;
    h.store.set('co-1:L1', { ...current, engineVersion: 'lie-0.9.9' } as LeadIntelligenceRecord);
    await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured');
    const regenerated = h.store.get('co-1:L1')!;
    expect(regenerated.engineVersion).toBe(ENGINE_VERSION);
    expect(regenerated.generationVersion).toBe(current.generationVersion + 1);
  });

  test('fail-open: missing profiles table (failing upsert) and a throwing orchestrator both never throw', async () => {
    const h = realHarness();
    h.setUpsertFails(true);
    __setActivationOverridesForTests({ orchestrator: h.orchestrator, now: h.now });
    await expect(runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured')).resolves.toBe('ran');
    expect(h.store.size).toBe(0); // nothing persisted, nothing thrown

    __setActivationOverridesForTests({
      orchestrator: { generate: async () => { throw new Error('boom'); } } as any,
      now: () => T0,
    });
    await expect(runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured')).resolves.toBe('failed_open');
  });

  test('kill switch: LEAD_INTELLIGENCE_GENERATION_DISABLED=true short-circuits before the orchestrator', async () => {
    const generate = jest.fn();
    __setActivationOverridesForTests({ orchestrator: { generate } as any, now: () => T0 });
    process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED = 'true';
    expect(await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured')).toBe('disabled');
    expect(generate).not.toHaveBeenCalled();
  });

  test('cooldown: rapid tracking re-triggers are absorbed; capture triggers are never cooled down', async () => {
    const generate = jest.fn(async () => ({ status: 'generated' }));
    let now = T0;
    __setActivationOverridesForTests({ orchestrator: { generate } as any, now: () => now });
    expect(await runLeadIntelligenceGeneration('co-1', 'L1', 'tracking_events')).toBe('ran');
    expect(await runLeadIntelligenceGeneration('co-1', 'L1', 'tracking_events')).toBe('cooldown');
    expect(generate).toHaveBeenCalledTimes(1);
    now += ACTIVATION_COOLDOWN_MS + 1;
    expect(await runLeadIntelligenceGeneration('co-1', 'L1', 'tracking_events')).toBe('ran');
    // capture reason ignores the cooldown entirely
    expect(await runLeadIntelligenceGeneration('co-1', 'L1', 'lead_captured')).toBe('ran');
    expect(generate).toHaveBeenCalledTimes(3);
  });

  test('session regeneration: every stitched lead regenerates once; the session cooldown absorbs repeats', async () => {
    const generate = jest.fn(async () => ({ status: 'generated' }));
    let now = T0;
    __setActivationOverridesForTests({ orchestrator: { generate } as any, now: () => now });
    queueResponse('leads:select', { data: [{ id: 'L1' }, { id: 'L2' }], error: null });
    const ran = await runVisitorSessionRegeneration('co-1', 'vs-1', 'tracking_events');
    expect(ran).toBe(2);
    // `generate` is a bare jest.fn(), so `mock.calls` infers as an empty tuple;
    // widen to read the first argument of each call.
    expect((generate.mock.calls as unknown[][]).map((c) => c[0])).toEqual([
      { companyId: 'co-1', leadId: 'L1' },
      { companyId: 'co-1', leadId: 'L2' },
    ]);
    // tenant-scoped lookup
    const lookup = ops.find((o) => o.table === 'leads');
    expect(lookup!.filters).toEqual(expect.arrayContaining([['company_id', 'co-1'], ['visitor_session_id', 'vs-1']]));
    // immediate repeat: session cooldown absorbs the whole lookup
    expect(await runVisitorSessionRegeneration('co-1', 'vs-1', 'tracking_events')).toBe(0);
    now += ACTIVATION_COOLDOWN_MS + 1;
    queueResponse('leads:select', { data: [{ id: 'L1' }], error: null });
    expect(await runVisitorSessionRegeneration('co-1', 'vs-1', 'tracking_events')).toBe(1);
  });
});

// ── WIRING — production call sites fire the trigger correctly ───────────────

describe('INT-002 W1 — lifecycle wiring', () => {
  function spyOrchestrator() {
    const generate = jest.fn(async () => ({ status: 'generated' }));
    __setActivationOverridesForTests({ orchestrator: { generate } as any, now: () => T0 });
    return generate;
  }

  const SESSION = { sessionId: 'vs-1', firstTouch: {}, lastTouch: {} };

  test('captureWebsiteLead: triggers exactly once, AFTER the touchpoint write, with the created lead', async () => {
    const generate = spyOrchestrator();
    resolveVisitorSession.mockResolvedValue(SESSION);
    persistCampaignTouchpoint.mockResolvedValue(undefined);
    recordLeadAttribution.mockResolvedValue(undefined);
    createLead.mockResolvedValue({ id: 'L-new', source: 'website', unified_person_id: 'up-1' });
    queueResponse('leads:select', { data: [], error: null }); // no recent duplicate

    const result = await captureWebsiteLead({
      intent: 'contact_sales', firstName: 'J', lastName: 'D', email: 'j@a.co', consent: true, rawBody: {},
    } as any, { companyId: 'co-1' });
    await flush();
    expect(result.status).toBe('created');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ companyId: 'co-1', leadId: 'L-new' });
    // trigger fires after the attribution chain completed
    expect(persistCampaignTouchpoint.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]);
  });

  test('duplicate capture: short-circuits with NO generation', async () => {
    const generate = spyOrchestrator();
    queueResponse('leads:select', { data: [{ id: 'L-old', created_at: new Date(T0).toISOString() }], error: null });
    const result = await captureWebsiteLead({
      intent: 'contact_sales', firstName: 'J', lastName: 'D', email: 'j@a.co', consent: true, rawBody: {},
    } as any, { companyId: 'co-1' });
    await flush();
    expect(result.status).toBe('duplicate');
    expect(generate).not.toHaveBeenCalled();
  });

  test('/api/leads: webhook, embed and manual modes each trigger generation for the created lead', async () => {
    const generate = spyOrchestrator();
    resolveVisitorSession.mockResolvedValue(SESSION);
    persistCampaignTouchpoint.mockResolvedValue(undefined);
    recordLeadAttribution.mockResolvedValue(undefined);
    createLead.mockResolvedValue({ id: 'L-9', source: 'webhook', unified_person_id: 'up-1' });

    // webhook
    validateWebhookAuth.mockResolvedValue({ company_id: 'co-w', website_id: null, integration_id: 'i1' });
    let res = createMockRes();
    await leadsHandler({ method: 'POST', headers: {}, query: {}, body: { integration_id: 'i1', webhook_secret: 's', name: 'J', email: 'j@a.co' }, cookies: {} } as any, res);
    await flush();
    expect(res.statusCode).toBe(201);
    expect(generate).toHaveBeenLastCalledWith({ companyId: 'co-w', leadId: 'L-9' });

    // embed
    getForm.mockResolvedValue({ id: 'F1', company_id: 'co-f', website_id: null, name: 'Form', integration_id: null, fields: [{ name: 'em', label: 'Email', type: 'email', required: true }] });
    res = createMockRes();
    await leadsHandler({ method: 'POST', headers: {}, query: {}, body: { form_id: 'F1', em: 'x@y.z' }, cookies: {} } as any, res);
    await flush();
    expect(res.statusCode).toBe(201);
    expect(generate).toHaveBeenLastCalledWith({ companyId: 'co-f', leadId: 'L-9' });

    // manual
    enforceCompanyAccess.mockResolvedValue({ userId: 'u1' });
    res = createMockRes();
    await leadsHandler({ method: 'POST', headers: {}, query: {}, body: { company_id: 'co-m', name: 'J', email: 'j@a.co' }, cookies: {} } as any, res);
    await flush();
    expect(res.statusCode).toBe(201);
    expect(generate).toHaveBeenLastCalledWith({ companyId: 'co-m', leadId: 'L-9' });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  test('/api/website-events/track: one session-regeneration per touched session; 202 contract unchanged', async () => {
    const generate = spyOrchestrator();
    resolveVisitorSession.mockResolvedValue(SESSION);
    persistCampaignTouchpoint.mockResolvedValue(undefined);
    queueResponse('websites:select', { data: [{ id: 'w-1', company_id: 'co-t' }], error: null });
    queueResponse('tracking_events:insert', { data: null, error: null });
    queueResponse('tracking_events:insert', { data: null, error: null });
    queueResponse('leads:select', { data: [{ id: 'L-t' }], error: null }); // session → lead lookup

    const res = createMockRes();
    await trackHandler({
      method: 'POST',
      headers: { origin: 'https://t.example', 'user-agent': 'UA', 'x-forwarded-for': '1.1.1.1' },
      socket: { remoteAddress: '1.1.1.1' },
      query: {}, cookies: {},
      body: { website_id: 'w-1', anonymous_id: 'a-1', events: [{ event_name: 'page_view' }, { event_name: 'cta_click' }] },
    } as any, res);
    await flush();

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ ok: true, accepted: 2, events: ['page_view', 'cta_click'] });
    expect(generate).toHaveBeenCalledTimes(1); // one session → one lookup → one stitched lead
    expect(generate).toHaveBeenCalledWith({ companyId: 'co-t', leadId: 'L-t' });
  });

  test('/api/website-events/track: distinct sessions per request are BOUNDED (fan-out hardening); 202 unchanged', async () => {
    const generate = spyOrchestrator();
    // Each event resolves to its own session — the amplification path.
    let n = 0;
    resolveVisitorSession.mockImplementation(async () => {
      n += 1;
      return { sessionId: `vs-${n}`, firstTouch: {}, lastTouch: {} };
    });
    persistCampaignTouchpoint.mockResolvedValue(undefined);
    queueResponse('websites:select', { data: [{ id: 'w-1', company_id: 'co-t' }], error: null });
    for (let i = 0; i < 6; i += 1) queueResponse('tracking_events:insert', { data: null, error: null });
    for (let i = 0; i < 6; i += 1) queueResponse('leads:select', { data: [{ id: `L-${i}` }], error: null });

    const res = createMockRes();
    await trackHandler({
      method: 'POST',
      headers: { origin: 'https://t.example', 'user-agent': 'UA', 'x-forwarded-for': '1.1.1.1' },
      socket: { remoteAddress: '1.1.1.1' },
      query: {}, cookies: {},
      body: {
        website_id: 'w-1',
        anonymous_id: 'a-0',
        events: Array.from({ length: 6 }, (_, i) => ({ event_name: 'page_view', anonymous_id: `a-${i}` })),
      },
    } as any, res);
    await flush();

    expect(res.statusCode).toBe(202); // contract unchanged
    expect((res.body as { accepted: number }).accepted).toBe(6); // every event still ingested
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3); // bounded fan-out, not 6
  });
});
