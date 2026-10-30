/**
 * Prospect provenance (Agent 2) — the explicit source → category table, the
 * namespacing rules, and the PI ingestion contribution helper.
 */
import { SOURCE_CATEGORIES, parseExternalRef } from '../../../lib/prospectProvenance/contract';
import {
  INBOUND_LEAD_PROFILES,
  LEGACY_CRM_PROFILE,
  MARKETPULSE_PROFILE,
  PI_ADAPTER_PROFILES,
  PI_ENRICHMENT_PROFILE,
  piAdapterProfile,
  prospectKeyCandidates,
  toNamespacedRef,
} from '../../services/prospectProvenance/ingestion/sourceProfiles';
import { classifyInboundLead } from '../../services/prospectProvenance/ingestion/inboundLeadProvenance';
import {
  piProspectCandidateKeys,
  recordPiIngestionContribution,
} from '../../services/prospectProvenance/ingestion/piIngestionContribution';
import {
  getProvenanceIngestionCounters,
  resetProvenanceIngestionCounters,
} from '../../services/prospectProvenance/ingestion/provenanceTelemetry';
import type { SourceContributionInput } from '../../../lib/prospectProvenance/contract';

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no db in this suite'); } }));

const ORG = '00000000-0000-4000-8000-0000000000aa';
const AT = '2026-10-30T12:00:00.000Z';

beforeEach(() => resetProvenanceIngestionCounters());

describe('source → category matrix is explicit and inside the contract vocabulary', () => {
  it('PI adapters map exactly as approved; Apollo is discovery, never CRM', () => {
    expect(PI_ADAPTER_PROFILES).toEqual({
      apollo: { sourceCategory: 'pi_discovery', platform: 'apollo', refProvider: 'apollo' },
      crm: { sourceCategory: 'crm', platform: null, refProvider: 'crm' },
      csv: { sourceCategory: 'csv', platform: null, refProvider: 'csv' },
      manual: { sourceCategory: 'manual', platform: null, refProvider: 'manual' },
    });
    expect(PI_ENRICHMENT_PROFILE.sourceCategory).toBe('pi_enrichment');
  });

  it('inbound modes, legacy CRM and MarketPulse map explicitly', () => {
    expect(INBOUND_LEAD_PROFILES.inbound_form.sourceCategory).toBe('inbound_form');
    expect(INBOUND_LEAD_PROFILES.inbound_webhook.sourceCategory).toBe('inbound_webhook');
    expect(INBOUND_LEAD_PROFILES.website.sourceCategory).toBe('website');
    expect(INBOUND_LEAD_PROFILES.manual.sourceCategory).toBe('manual');
    expect(LEGACY_CRM_PROFILE.sourceCategory).toBe('crm');
    expect(MARKETPULSE_PROFILE).toEqual({ sourceCategory: 'marketpulse', platform: 'marketpulse', refProvider: 'marketpulse' });
  });

  it('every profile uses an approved category and a valid provider prefix', () => {
    const all = [
      ...Object.values(PI_ADAPTER_PROFILES), ...Object.values(INBOUND_LEAD_PROFILES),
      LEGACY_CRM_PROFILE, MARKETPULSE_PROFILE, PI_ENRICHMENT_PROFILE,
    ];
    for (const p of all) {
      expect(SOURCE_CATEGORIES).toContain(p.sourceCategory);
      expect(parseExternalRef(toNamespacedRef(p.refProvider, 'x1'))).toEqual({ provider: p.refProvider, id: 'x1' });
    }
  });

  it('an unknown adapter key is NOT classified by guess', () => {
    expect(piAdapterProfile('hubspot')).toBeNull();
    expect(piAdapterProfile('website')).toBeNull();
    expect(piAdapterProfile(undefined)).toBeNull();
  });
});

describe('namespacing', () => {
  it('prefixes raw ids and never double-prefixes an id already in its namespace', () => {
    expect(toNamespacedRef('apollo', '5f1a')).toBe('apollo:5f1a');
    expect(toNamespacedRef('csv', 'csv:abc')).toBe('csv:abc');
    expect(toNamespacedRef('crm', 'hubspot:9')).toBe('crm:hubspot:9');
  });

  it('key candidates: namespaced first, legacy raw kept for lookup', () => {
    expect(prospectKeyCandidates('crm', 'CRM-1')).toEqual({ namespaced: 'crm:CRM-1', legacy: 'CRM-1' });
    expect(prospectKeyCandidates('csv', 'csv:abc')).toEqual({ namespaced: 'csv:abc', legacy: null });
    expect(prospectKeyCandidates('crm', '  ')).toBeNull();
  });

  it('PI candidate keys carry provenance for the create', () => {
    expect(piProspectCandidateKeys('apollo', 'p-1')).toEqual({
      externalLeadKey: 'p-1',
      namespacedExternalLeadKey: 'apollo:p-1',
      provenance: { sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:p-1' },
    });
    expect(piProspectCandidateKeys('unknown', 'p-1')).toEqual({ externalLeadKey: 'p-1', namespacedExternalLeadKey: null, provenance: null });
  });
});

describe('inbound mode is structural, never the free-text source', () => {
  it.each([
    [{ form_id: 'f1', integration_id: 'i1', visitor_session_id: 'v1' }, 'inbound_form'],
    [{ integration_id: 'i1', visitor_session_id: 'v1' }, 'inbound_webhook'],
    [{ visitor_session_id: 'v1' }, 'website'],
    [{}, 'manual'],
    [{ mode: 'website', form_id: 'f1' }, 'website'],
    [{ mode: 'bogus', form_id: 'f1' }, 'inbound_form'],
  ])('%j → %s', (input, expected) => {
    expect(classifyInboundLead(input as never)).toBe(expected);
  });
});

describe('PI ingestion contribution', () => {
  const recorded: SourceContributionInput[] = [];
  const recorder = jest.fn(async (i: SourceContributionInput) => { recorded.push(i); return { status: 'inserted' as const, id: 'c1', role: (i.leadCreated ? 'originating' : 'contributing') as 'originating' | 'contributing', roleDowngraded: false }; });
  beforeEach(() => { recorded.length = 0; recorder.mockClear(); });

  it('Apollo discovery: pi_discovery, platform apollo, apollo:<id>, run id, ingestion-time fallback flagged', async () => {
    const r = await recordPiIngestionContribution({
      organizationId: ORG, adapterSource: 'apollo', externalId: 'ap-77',
      prospect: { prospectId: 'lead-1', outcome: 'created' }, sourceRecordId: 'sr-1',
      observedAt: null, ingestedAt: AT, ingestionRunId: 'exec-9',
    }, recorder);
    expect(r).toMatchObject({ status: 'inserted', role: 'originating' });
    expect(recorded[0]).toMatchObject({
      organizationId: ORG, canonicalLeadId: 'lead-1', leadCreated: true,
      sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:ap-77',
      sourceRecordId: 'sr-1', observedAt: AT, ingestionRunId: 'exec-9',
      sourceMetadata: expect.objectContaining({ observedAtBasis: 'ingestion', discoveryExecutionId: 'exec-9' }),
    });
  });

  it('csv keeps its own namespace and the source time verbatim; a match is contributing', async () => {
    await recordPiIngestionContribution({
      organizationId: ORG, adapterSource: 'csv', externalId: 'csv:abc',
      prospect: { prospectId: 'lead-2', outcome: 'matched', matchedKey: 'legacy' }, sourceRecordId: 'sr-2',
      observedAt: '2026-01-02T03:04:05Z', ingestedAt: AT,
    }, recorder);
    expect(recorded[0]).toMatchObject({
      leadCreated: false, sourceCategory: 'csv', externalRef: 'csv:abc', observedAt: '2026-01-02T03:04:05Z',
      sourceMetadata: expect.objectContaining({ observedAtBasis: 'source', prospectMatchedBy: 'legacy' }),
    });
  });

  it('skips (and counts) instead of guessing: unmapped source, no prospect, no id', async () => {
    const base = { organizationId: ORG, sourceRecordId: null, observedAt: null, ingestedAt: AT };
    expect(await recordPiIngestionContribution({ ...base, adapterSource: 'mystery', externalId: 'x', prospect: { prospectId: 'l', outcome: 'created' } }, recorder))
      .toEqual({ status: 'skipped', reason: 'unmapped_source' });
    expect(await recordPiIngestionContribution({ ...base, adapterSource: 'csv', externalId: 'x', prospect: { prospectId: null, outcome: 'insufficient_evidence' } }, recorder))
      .toEqual({ status: 'skipped', reason: 'no_prospect' });
    expect(await recordPiIngestionContribution({ ...base, adapterSource: 'csv', externalId: ' ', prospect: { prospectId: 'l', outcome: 'created' } }, recorder))
      .toEqual({ status: 'skipped', reason: 'no_external_id' });
    expect(recorder).not.toHaveBeenCalled();
    expect(getProvenanceIngestionCounters()['pi_ingestion:skipped']).toBe(3);
  });

  it('a writer error or throw is returned and counted, never thrown', async () => {
    const failing = jest.fn(async () => { throw new Error('relation does not exist'); });
    const r = await recordPiIngestionContribution({
      organizationId: ORG, adapterSource: 'manual', externalId: 'manual:h', prospect: { prospectId: 'l', outcome: 'created' },
      sourceRecordId: null, observedAt: null, ingestedAt: AT,
    }, failing);
    expect(r).toMatchObject({ status: 'error', code: 'threw' });
    expect(getProvenanceIngestionCounters()['pi_ingestion:error']).toBe(1);
  });

  it('idempotent retry: a duplicate from the writer is reported as duplicate', async () => {
    const dup = jest.fn(async () => ({ status: 'duplicate' as const, role: null }));
    const r = await recordPiIngestionContribution({
      organizationId: ORG, adapterSource: 'apollo', externalId: 'ap-1', prospect: { prospectId: 'l', outcome: 'matched' },
      sourceRecordId: null, observedAt: null, ingestedAt: AT,
    }, dup);
    expect(r).toEqual({ status: 'duplicate', role: null });
    expect(getProvenanceIngestionCounters()['pi_ingestion:duplicate']).toBe(1);
  });
});
