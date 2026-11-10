/**
 * Sales Navigator saved-lead capture (PI side of the Outreach capture contract).
 *
 * The orchestrator, the shared ingestion gate and the feature-flag service are
 * doubled: this suite proves the capture service's gates, validation, mapping
 * and response shape. The orchestrator's own chain is proven elsewhere and is
 * not touched by this change.
 */

const state = { captureEnabled: true };

jest.mock('../../services/salesNavCapture/captureSwitch', () => ({
  get SALESNAV_EXTENSION_CAPTURE_ENABLED() { return state.captureEnabled; },
  SALESNAV_LEAD_KEY_PROVISIONAL: true,
}));

const flag = jest.fn(async () => ({ enabled: true, reason: 'flag_enabled_full_rollout' }));
jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: (...a: unknown[]) => flag(...(a as [])),
}));

const gate = jest.fn(async () => ({ allowed: true, reason: 'tenant_flag:flag_enabled_full_rollout' }));
const ingest = jest.fn();
// The usage-ledger write is pinned in salesNavCaptureRunLedger.test.ts; here it is stubbed explicitly.
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({ upsert: async () => ({ error: null }) }) }));
jest.mock('../../services/leadIngestion/orchestrator', () => ({
  resolveLeadIngestionGate: (...a: unknown[]) => gate(...(a as [])),
  ingestLeadBatch: (...a: unknown[]) => ingest(...(a as [])),
}));

import {
  ingestCapturedSavedLeads,
  snapSavedLeadsProvider,
  getSavedLeadsProvider,
  SnapNotConnectedError,
  SALESNAV_CAPTURE_FLAG_KEY,
  MAX_CAPTURE_BATCH,
  type CaptureBatchPayload,
  type CaptureCallerContext,
} from '../../services/salesNavCapture';
import { translateSalesNavLead, toBatchRecord } from '../../services/salesNavCapture/adapter';
import { checkLeadKey, fromWire } from '../../services/salesNavCapture/providers';
import { __resetLeadSourceRegistry, getLeadSourceAdapter } from '../../services/leadIngestion/registry';
import { piAdapterProfile } from '../../services/prospectProvenance/ingestion/sourceProfiles';
import { redactSecrets } from '../../services/prospectIdentity/ingestionBoundary';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-10T12:00:00.000Z');
const KEY_A = 'ACwAAAbcDEF123';
const KEY_B = 'ACwAAAxyzUVW456';

const ctx: CaptureCallerContext = {
  orgId: ORG,
  userId: 'user-1',
  socialAccountId: 'sa-1',
  actingMemberUrn: 'urn:li:member:1',
  commandId: 'cmd-1',
  extensionVersion: '1.5.0',
};

const payload = (over: Partial<CaptureBatchPayload> = {}): CaptureBatchPayload => ({
  provider: 'linkedin_salesnav_extension',
  contract_version: 1,
  org_id: ORG,
  captured_at: '2026-11-10T11:59:00.000Z',
  source: { surface: 'sales_navigator', list_kind: 'saved_leads', list_name: 'Q4', page_index: 0 },
  leads: [{
    lead_key: KEY_A,
    raw_urn: `urn:li:fs_salesProfile:(${KEY_A},NAME_SEARCH,abc)`,
    public_profile_url: 'https://www.linkedin.com/in/jane-doe/',
    full_name: 'Jane Doe',
    headline: 'Growth leader',
    title: 'VP Marketing',
    company_name: 'Acme',
    company_salesnav_urn: 'urn:li:fs_salesCompany:12345',
    company_linkedin_url: 'https://www.linkedin.com/company/acme',
    location: 'London, United Kingdom',
    connection_degree: 2,
    saved_at: '2026-11-01T00:00:00.000Z',
  }],
  ...over,
});

const okOutcome = (provenanceOutcome: 'created' | 'changed' | 'unchanged') => ({
  externalId: 'x', ok: true, sourceRecordId: 'sr', personId: 'p', prospectId: 'pr', provenanceOutcome,
});

beforeEach(() => {
  state.captureEnabled = true;
  flag.mockClear(); gate.mockClear(); ingest.mockReset();
  __resetLeadSourceRegistry();
  ingest.mockImplementation(async (input: { records: unknown[] }) => ({
    organizationId: ORG, source: 'linkedin_sales_navigator', total: input.records.length,
    succeeded: input.records.length, failed: 0,
    outcomes: input.records.map(() => okOutcome('created')),
  }));
});

describe('the code constant', () => {
  it('ships OFF (owner P-1): the real module value is false', () => {
    const real = jest.requireActual('../../services/salesNavCapture/captureSwitch');
    expect(real.SALESNAV_EXTENSION_CAPTURE_ENABLED).toBe(false);
    expect(real.SALESNAV_LEAD_KEY_PROVISIONAL).toBe(true);
  });

  it('when off, refuses before ANY gate, flag or ingestion call', async () => {
    state.captureEnabled = false;
    const r = await ingestCapturedSavedLeads(ctx, payload(), { now: NOW });
    expect(r).toEqual({ ok: false, refusal: 'capture_disabled', detail: 'code_constant_off', leadKeyProvisional: true, outcomes: [] });
    expect(gate).not.toHaveBeenCalled();
    expect(flag).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('batch gates fail closed', () => {
  it('refuses a payload naming a different tenant', async () => {
    const r = await ingestCapturedSavedLeads(ctx, payload({ org_id: '00000000-0000-4000-8000-0000000000bb' }), { now: NOW });
    expect(r.refusal).toBe('organization_mismatch');
    expect(gate).not.toHaveBeenCalled();
  });

  it('refuses when the shared ingestion gate refuses', async () => {
    gate.mockResolvedValueOnce({ allowed: false, reason: 'global_kill_switch_off' });
    const r = await ingestCapturedSavedLeads(ctx, payload(), { now: NOW });
    expect(r).toMatchObject({ ok: false, refusal: 'ingestion_not_enabled', detail: 'global_kill_switch_off' });
    expect(flag).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('requires the tenant salesnav_capture flag, separately from lead_ingestion', async () => {
    flag.mockResolvedValueOnce({ enabled: false, reason: 'no_flag_row' });
    const r = await ingestCapturedSavedLeads(ctx, payload(), { now: NOW });
    expect(r).toMatchObject({ refusal: 'capture_not_enabled_for_tenant', detail: 'tenant_flag:no_flag_row' });
    expect(flag).toHaveBeenCalledWith({ organizationId: ORG, flagKey: SALESNAV_CAPTURE_FLAG_KEY, cohortKey: null });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('a thrown flag evaluation is a refusal, never an open door', async () => {
    flag.mockRejectedValueOnce(new Error('db down'));
    const r = await ingestCapturedSavedLeads(ctx, payload(), { now: NOW });
    expect(r.refusal).toBe('capture_not_enabled_for_tenant');
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported_provider', { provider: 'linkedin_snap' }],
    ['unsupported_contract_version', { contract_version: 2 }],
    ['unsupported_surface', { source: { surface: 'linkedin_feed', list_kind: 'saved_leads' } }],
    ['invalid_payload', { captured_at: '2026-11-10T13:00:00.000Z' }], // an hour in the future
    ['invalid_payload', { captured_at: 'yesterday' }],
    ['invalid_payload', { leads: [] }],
  ] as Array<[string, Partial<CaptureBatchPayload>]>)('refuses envelope: %s', async (refusal, over) => {
    const r = await ingestCapturedSavedLeads(ctx, payload(over), { now: NOW });
    expect(r.refusal).toBe(refusal);
    expect(ingest).not.toHaveBeenCalled();
  });

  it(`refuses more than ${MAX_CAPTURE_BATCH} leads in one batch`, async () => {
    const leads = Array.from({ length: MAX_CAPTURE_BATCH + 1 }, (_, i) => ({ lead_key: `ACwAAA${String(i).padStart(6, '0')}` }));
    const r = await ingestCapturedSavedLeads(ctx, payload({ leads }), { now: NOW });
    expect(r.refusal).toBe('batch_too_large');
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('per-lead validation', () => {
  it('rejects a full fs_salesProfile URN as lead_key (identity-splitting defence)', () => {
    expect(checkLeadKey(`urn:li:fs_salesProfile:(${KEY_A},NAME_SEARCH,abc)`)).toEqual({ reason: 'lead_key_is_full_urn' });
    expect(checkLeadKey(`(${KEY_A},NAME_SEARCH,abc)`)).toEqual({ reason: 'lead_key_is_full_urn' });
    expect(checkLeadKey('')).toEqual({ reason: 'missing_lead_key' });
    expect(checkLeadKey('ab')).toEqual({ reason: 'invalid_lead_key' });
    expect(checkLeadKey(` ${KEY_A} `)).toEqual({ key: KEY_A });
  });

  it('rejects a lead whose raw URN does not contain its key', () => {
    expect(fromWire({ lead_key: KEY_A, raw_urn: `urn:li:fs_salesProfile:(${KEY_B},NAME_SEARCH,x)` }, NOW.toISOString()))
      .toEqual({ reason: 'lead_key_urn_mismatch' });
  });

  it('mixes rejected and ingested leads in input order; duplicates in a batch are rejected', async () => {
    const r = await ingestCapturedSavedLeads(ctx, payload({
      leads: [
        { lead_key: `urn:li:fs_salesProfile:(${KEY_A},X,y)` },
        { lead_key: KEY_A },
        { lead_key: KEY_A },
        { lead_key: KEY_B },
      ],
    }), { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.outcomes).toEqual([
      { key: `urn:li:fs_salesProfile:(${KEY_A},X,y)`, status: 'rejected', reason: 'lead_key_is_full_urn' },
      { key: KEY_A, status: 'created' },
      { key: KEY_A, status: 'rejected', reason: 'duplicate_in_batch' },
      { key: KEY_B, status: 'created' },
    ]);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect((ingest.mock.calls[0][0] as { records: unknown[] }).records).toHaveLength(2);
  });

  it('a batch with no valid lead never calls ingestion', async () => {
    const r = await ingestCapturedSavedLeads(ctx, payload({ leads: [{ lead_key: 'bad key!' }] }), { now: NOW });
    expect(r.outcomes).toEqual([{ key: 'bad key!', status: 'rejected', reason: 'invalid_lead_key' }]);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('ingestion call and response shape', () => {
  it('calls ingestLeadBatch with the PI source, the context tenant and the command as run id', async () => {
    await ingestCapturedSavedLeads(ctx, payload(), { now: NOW });
    const input = ingest.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      organizationId: ORG, source: 'linkedin_sales_navigator', ingestionRunId: 'cmd-1', now: NOW.toISOString(),
    });
    // The adapter is registered for the orchestrator to find.
    expect(getLeadSourceAdapter('linkedin_sales_navigator').source).toBe('linkedin_sales_navigator');
  });

  it('maps LI-2 verdicts to created / updated / unchanged / rejected and echoes NO ids or PII', async () => {
    ingest.mockImplementationOnce(async () => ({
      organizationId: ORG, source: 'linkedin_sales_navigator', total: 4, succeeded: 3, failed: 1,
      outcomes: [okOutcome('created'), okOutcome('changed'), okOutcome('unchanged'),
        { externalId: 'x', ok: false, rejection: 'identity_failed', error: 'Jane Doe jane@x.com broke' }],
    }));
    const keys = ['ACwAAA000001', 'ACwAAA000002', 'ACwAAA000003', 'ACwAAA000004'];
    const r = await ingestCapturedSavedLeads(ctx, payload({ leads: keys.map((k) => ({ lead_key: k, full_name: 'Jane Doe' })) }), { now: NOW });
    expect(r.outcomes.map((o) => o.status)).toEqual(['created', 'updated', 'unchanged', 'rejected']);
    expect(r.outcomes[3].reason).toBe('identity_failed');
    const json = JSON.stringify(r);
    for (const leaked of ['Jane', 'jane@', 'personId', 'prospectId', 'sourceRecordId', '"pr"', '"sr"']) {
      expect(json).not.toContain(leaked);
    }
    expect(r.leadKeyProvisional).toBe(true);
  });
});

describe('translation (pure adapter)', () => {
  const lead = () => {
    const r = fromWire(payload().leads[0], '2026-11-10T11:59:00.000Z');
    if ('reason' in r) throw new Error(r.reason);
    return r.lead;
  };

  it('member identity, namespaced apart from core LinkedIn ids; title mapped; nothing invented', () => {
    const { normalized } = translateSalesNavLead(toBatchRecord(lead()), ORG);
    expect(normalized).toEqual({
      organizationId: ORG,
      source: 'linkedin_sales_navigator',
      entityType: 'person',
      externalId: `salesnav:${KEY_A}`,
      person: {
        fullName: 'Jane Doe',
        jobTitle: 'VP Marketing',
        externalKeys: { linkedin_sales_navigator: { external_id: KEY_A } },
      },
      account: { externalId: '12345', name: 'Acme' },
      observedAt: '2026-11-10T11:59:00.000Z',
      confidence: null,
    });
  });

  it('the company LinkedIn URL is NEVER a domain or website (would merge every employer on linkedin.com)', () => {
    const { normalized } = translateSalesNavLead(toBatchRecord(lead()), ORG);
    expect(normalized.account?.domain).toBeUndefined();
    expect(normalized.account?.websiteUrl).toBeUndefined();
  });

  it('a company name with no Sales Navigator company id does not anchor an employer', () => {
    const r = fromWire({ lead_key: KEY_A, company_name: 'Acme' }, NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    expect(translateSalesNavLead(toBatchRecord(r.lead), ORG).normalized.account).toBeNull();
  });

  it('raw evidence excludes per-capture and per-viewer fields, so a re-capture hashes the same', () => {
    const first = lead();
    const again = { ...first, capturedAt: '2026-11-11T09:00:00.000Z' };
    const a = translateSalesNavLead(toBatchRecord(first), ORG).raw;
    const b = translateSalesNavLead(toBatchRecord(again), ORG).raw;
    expect(a).toEqual(b);
    for (const k of ['__observed_at', 'captured_at', 'saved_at', 'connection_degree', 'list_name', 'page_index', 'raw_urn']) {
      expect(a).not.toHaveProperty(k);
    }
    expect(a).toMatchObject({ lead_key: KEY_A, capture_transport: 'extension', headline: 'Growth leader', location: 'London, United Kingdom' });
  });

  it('evidence is stored EXACTLY as captured; nothing is normalised before LI-2 hashes it (review F1)', () => {
    const asSent = {
      lead_key: KEY_A,
      public_profile_url: 'https://www.LinkedIn.com/in/Jane-Doe/?trk=abc',
      company_linkedin_url: 'http://linkedin.com/company/acme/',
      company_salesnav_urn: 'urn:li:fs_salesCompany:12345',
      full_name: '  Jane Doe ',
    };
    const r = fromWire(asSent, NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    const raw = translateSalesNavLead(toBatchRecord(r.lead), ORG).raw;
    expect(raw).toMatchObject({
      public_profile_url: asSent.public_profile_url,
      company_linkedin_url: asSent.company_linkedin_url,
      company_salesnav_urn: asSent.company_salesnav_urn,
      full_name: asSent.full_name,
    });
    expect(raw).not.toHaveProperty('company_salesnav_id');
    // Derived at READ time: the normalised record still gets the company id and a trimmed name.
    const { normalized } = translateSalesNavLead(toBatchRecord(r.lead), ORG);
    expect(normalized.account).toEqual({ externalId: '12345', name: null });
    expect(normalized.person?.fullName).toBe('Jane Doe');
  });


  it('no email or phone is ever produced (owner P-3)', () => {
    const { normalized } = translateSalesNavLead({ ...toBatchRecord(lead()), email: 'a@b.c', phone: '+44 1' }, ORG);
    expect(normalized.person?.email).toBeUndefined();
    expect(normalized.person?.phone).toBeUndefined();
  });

  it('the adapter throws on a bad key, which the orchestrator reports per record', () => {
    expect(() => translateSalesNavLead({ lead_key: 'urn:li:x' }, ORG)).toThrow('lead_key_is_full_urn');
  });
});

describe('providers and provenance classification', () => {
  it('SNAP is a stub: not connected, and fetching throws', async () => {
    await expect(snapSavedLeadsProvider.availability(ORG)).resolves.toEqual({ available: false, reason: 'not_connected' });
    await expect(snapSavedLeadsProvider.fetchSavedLeads!(ORG, null)).rejects.toBeInstanceOf(SnapNotConnectedError);
    expect(getSavedLeadsProvider('linkedin_snap')?.transport).toBe('snap');
    expect(getSavedLeadsProvider('hasOwnProperty')).toBeNull();
  });

  it('Sales Navigator is classified as discovery with its own namespace, no new category', () => {
    expect(piAdapterProfile('linkedin_sales_navigator')).toEqual({
      sourceCategory: 'pi_discovery', platform: 'linkedin_sales_navigator', refProvider: 'linkedin_sales_navigator',
    });
  });
});

// The normaliser and classifier cases live in the SHARED fixture table
// (lib/linkedin/profileUrlFixtures.ts), run by linkedinProfileUrl.test.ts.

describe('what may be STORED as evidence (review NEW 1)', () => {
  it('a Sales Navigator app URL (it can carry an auth token) is never stored', () => {
    const r = fromWire({
      lead_key: KEY_A,
      public_profile_url: 'https://www.linkedin.com/sales/lead/ACwAAAbcDEF123,NAME_SEARCH,secretAuthToken',
      company_linkedin_url: 'https://www.linkedin.com/sales/company/12345',
    }, NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    const raw = translateSalesNavLead(toBatchRecord(r.lead), ORG).raw;
    expect(raw.public_profile_url).toBeNull();
    expect(raw.company_linkedin_url).toBeNull();
    expect(JSON.stringify(raw)).not.toContain('secretAuthToken');
  });

  it('a URL with credentials in the authority is never stored', () => {
    const r = fromWire({ lead_key: KEY_A, public_profile_url: 'https://u:p@www.linkedin.com/in/jane' }, NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    expect(r.lead.profileUrl).toBeNull();
  });

  it('every stored evidence key is snake_case, so the boundary redactor can reach it', () => {
    const r = fromWire(payload().leads[0], NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    for (const k of Object.keys(translateSalesNavLead(toBatchRecord(r.lead), ORG).raw)) {
      expect(k).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('lead_key survives the boundary redactor (bare "key" is not a secret name)', () => {
    const r = fromWire({ lead_key: KEY_A }, NOW.toISOString());
    if ('reason' in r) throw new Error(r.reason);
    const redacted = redactSecrets(translateSalesNavLead(toBatchRecord(r.lead), ORG).raw) as Record<string, unknown>;
    expect(redacted.lead_key).toBe(KEY_A);
  });
});
