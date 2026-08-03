/**
 * INT-001 Phase 0 (P0-C) — characterization of createLead (THE one `leads` write).
 *
 * Pins CURRENT behaviour exactly: insert payload defaults and pass-through,
 * the IDENTITY_REQUIRED_FOR_LEAD gate, telemetry emission, the fire-and-forget
 * adoptLead bridge, and error propagation. No production change.
 */

const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
let insertResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: any = {
      insert: jest.fn((p: Record<string, unknown>) => { inserts.push({ table, payload: p }); return chain; }),
      select: jest.fn(() => chain),
      update: jest.fn(() => chain),
      delete: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      single: jest.fn(async () => insertResponse),
      maybeSingle: jest.fn(async () => insertResponse),
      then: (res: any, rej?: any) => Promise.resolve(insertResponse).then(res, rej),
    };
    return chain;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const ensureUnifiedPerson = jest.fn();
jest.mock('../../../lib/identity/identityGateway', () => ({
  ensureUnifiedPerson: (...a: unknown[]) => ensureUnifiedPerson(...a),
}));
jest.mock('../../services/integrationCredentialService', () => ({
  mergeConnectionConfig: jest.fn(async (_c: unknown, _n: unknown, cfg: unknown) => cfg),
}));
const adoptLead = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({
  adoptLead: (...a: unknown[]) => adoptLead(...a),
}));
const trackEvent = jest.fn();
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({
  trackEvent: (...a: unknown[]) => trackEvent(...a),
}));
jest.mock('../../services/leadIntelligence/legacyLeadCompat', () => ({
  getLegacyLeads: jest.fn(async () => []),
}));

import { createLead } from '../../services/leadService';

const LEAD_ROW = {
  id: 'L1', company_id: 'co-1', name: 'Jane Doe', email: 'jane@acme.com',
  source: 'website', unified_person_id: 'up-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  inserts.length = 0;
  insertResponse = { data: LEAD_ROW, error: null };
  ensureUnifiedPerson.mockResolvedValue('up-1');
});

describe('P0-C — createLead characterization', () => {
  test('minimal input: insert payload carries the exact defaults (source direct, empty metadata/attribution, is_test false, nulls)', async () => {
    const lead = await createLead('co-1', { name: 'Jane Doe', email: 'jane@acme.com' });
    expect(lead).toEqual(LEAD_ROW);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('leads');
    expect(inserts[0].payload).toEqual({
      company_id: 'co-1',
      website_id: null,
      created_by: null,
      name: 'Jane Doe',
      email: 'jane@acme.com',
      phone: null,
      source: 'direct',
      form_id: null,
      integration_id: null,
      metadata: {},
      attribution: {},
      visitor_session_id: null,
      consent_state: null,
      is_test: false,
      unified_person_id: 'up-1',
    });
  });

  test('full input passes through verbatim (attribution, consent, session, website, metadata, is_test)', async () => {
    await createLead('co-1', {
      name: 'Jane', email: 'jane@acme.com', phone: '+1 555', source: 'website',
      form_id: 'F1', integration_id: 'I1', created_by: 'u-9',
      metadata: { intent: 'contact_sales' }, attribution: { utm_source: 'google' },
      website_id: 'w-1', visitor_session_id: 'vs-1', consent_state: 'granted', is_test: true,
    });
    expect(inserts[0].payload).toMatchObject({
      phone: '+1 555', source: 'website', form_id: 'F1', integration_id: 'I1',
      created_by: 'u-9', metadata: { intent: 'contact_sales' },
      attribution: { utm_source: 'google' }, website_id: 'w-1',
      visitor_session_id: 'vs-1', consent_state: 'granted', is_test: true,
    });
    expect(ensureUnifiedPerson).toHaveBeenCalledWith({ email: 'jane@acme.com', phone: '+1 555', companyId: 'co-1' });
  });

  test('identity gate: a null unified person → throws IDENTITY_REQUIRED_FOR_LEAD with NO insert, no telemetry, no adoption', async () => {
    ensureUnifiedPerson.mockResolvedValue(null);
    await expect(createLead('co-1', { name: 'J', email: 'j@a.com' }))
      .rejects.toThrow('IDENTITY_REQUIRED_FOR_LEAD');
    expect(inserts).toHaveLength(0);
    expect(trackEvent).not.toHaveBeenCalled();
    expect(adoptLead).not.toHaveBeenCalled();
  });

  test("telemetry: emits 'lead.captured' with entity id + source after the insert", async () => {
    await createLead('co-1', { name: 'J', email: 'j@a.com', source: 'webhook', created_by: 'u-1' });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith({
      type: 'lead.captured',
      organizationId: 'co-1',
      actorId: 'u-1',
      entityId: 'L1',
      metadata: { source: 'webhook' },
    });
  });

  test("fire-and-forget adoption: adoptLead('website', row) is invoked once with the inserted row and its result is not awaited", async () => {
    // A rejected promise from adoptLead must not affect the caller — createLead
    // resolves with the lead regardless (the facade is fail-open internally).
    adoptLead.mockReturnValue(Promise.reject(new Error('sink down')).catch(() => undefined));
    const lead = await createLead('co-1', { name: 'J', email: 'j@a.com' });
    expect(lead).toEqual(LEAD_ROW);
    expect(adoptLead).toHaveBeenCalledTimes(1);
    expect(adoptLead).toHaveBeenCalledWith('website', LEAD_ROW);
  });

  test('insert error → throws the DB message; telemetry and adoption never fire', async () => {
    insertResponse = { data: null, error: { message: 'duplicate key value' } };
    await expect(createLead('co-1', { name: 'J', email: 'j@a.com' }))
      .rejects.toThrow('duplicate key value');
    expect(trackEvent).not.toHaveBeenCalled();
    expect(adoptLead).not.toHaveBeenCalled();
  });
});
