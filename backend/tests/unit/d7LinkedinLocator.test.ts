/**
 * D7(i): the LinkedIn profile URL as a NON-MERGING LOCATOR for Apollo person match.
 *
 * Binding constraints (owner D7=(a), PI review): the locator is never an
 * identity claim, never `external_keys`, never W1/attachPerson/reconciliation
 * input; stored evidence is read AS CAPTURED and normalised at read time; a
 * locator match is accepted only when Apollo's returned URL normalises to the
 * same key AND the name agrees (F2), and an absent returned URL refuses.
 *
 * Mocked Apollo shapes cover: match, no match, a match with a disagreeing
 * name, a match with no linkedin_url, and a transport failure.
 * SECRETS: synthetic only. The transport is mocked at `safeFetch`.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

const dbCalls: string[] = [];
let dbResult: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    dbCalls.push(`table:${table}`);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) {
      chain[m] = (...a: unknown[]) => { dbCalls.push(`${m}:${JSON.stringify(a)}`); return chain; };
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      chain[m] = () => { dbCalls.push(`WRITE:${m}`); return chain; };
    }
    chain.limit = async () => dbResult;
    return chain;
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { safeFetch } from '../../../lib/security/safeFetch';
import {
  apolloEnrichmentAdapter,
  checkLocatorMatch,
  personMatchBody,
  personNamesAgree,
} from '../../services/enrichment/providers/adapters/apollo';
import { canonicalSelectors } from '../../services/enrichment/execution';
import { readPersonLocators } from '../../services/salesNavCapture/locator';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

const fetchMock = safeFetch as unknown as jest.Mock;
const SECRET = 'synthetic-tenant-apollo-key';
const ORG = '11111111-1111-4111-8111-111111111111';
const KEY = 'https://www.linkedin.com/in/jane-doe';
const OPAQUE = 'ACoAAA1b2C3d4E5f6G7h8I9j0KlMnOpQrStU';

const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

const locatorRequest = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG,
  subject: 'person',
  entityId: 'p-1',
  attributes: ['job_title'],
  selectors: { name: 'Jane Doe', linkedin_url: KEY, linkedin_url_form: 'vanity' },
  purpose: 'd7',
  correlationId: 'corr-d7',
  credential: SECRET,
  ...over,
} as EnrichmentRequest);

beforeEach(() => { fetchMock.mockReset(); dbCalls.length = 0; dbResult = { data: [], error: null }; });

describe('selectors: read-time normalisation and classification', () => {
  it('a captured vanity URL becomes linkedin_url + form, normalised at READ time', () => {
    expect(canonicalSelectors('person', { full_name: 'Jane Doe' },
      { linkedinProfileUrl: 'https://de.linkedin.com/in/Jane-Doe/?trk=x' }))
      .toEqual({ name: 'Jane Doe', linkedin_url: KEY, linkedin_url_form: 'vanity' });
  });

  it('an opaque id is passed WITH its label, so a miss is attributable to key shape', () => {
    expect(canonicalSelectors('person', {}, { linkedinProfileUrl: `https://www.linkedin.com/in/${OPAQUE}` }))
      .toEqual({ linkedin_url: `https://www.linkedin.com/in/${OPAQUE}`, linkedin_url_form: 'opaque' });
  });

  it('a refused URL yields no locator at all; accounts never get one', () => {
    expect(canonicalSelectors('person', {}, { linkedinProfileUrl: 'https://evil.com/in/jane' })).toEqual({});
    expect(canonicalSelectors('account', { domain_normalized: 'x.com' }, { linkedinProfileUrl: KEY } as never))
      .toEqual({ domain: 'x.com' });
  });
});

describe('match precedence', () => {
  it('Apollo id beats email beats the locator; the locator is used only when nothing stronger is held', () => {
    expect(personMatchBody(locatorRequest({ selectors: { apollo_id: 'a1', email: 'e@x.com', linkedin_url: KEY } }))?.matchedOn).toBe('apollo_id');
    expect(personMatchBody(locatorRequest({ selectors: { email: 'e@x.com', linkedin_url: KEY } }))?.matchedOn).toBe('email');
    expect(personMatchBody(locatorRequest())).toEqual({
      body: { linkedin_url: KEY, reveal_personal_emails: false, reveal_phone_number: false }, matchedOn: 'linkedin_url',
    });
  });
});

describe('F2 name rule, both directions', () => {
  it.each([
    ['Jane Doe', 'jane doe', 'case'],
    ['José Álvarez', 'Jose Alvarez', 'diacritics'],
    ['Jane Q. Doe', 'Jane Doe', 'middle initial'],
    ['Jane Mary Doe', 'Jane Doe', 'middle name'],
    ['Doe Jane', 'Jane Doe', 'surname-first ordering'],
  ])('MUST accept (%s vs %s): %s', (a, b) => {
    expect(personNamesAgree(a, b)).toBe(true);
  });

  it.each([
    ['John Smith', 'Jane Doe', 'different person'],
    ['Jane Smith', 'Jane Doe', 'same first, different last (recycled slug, new owner)'],
    ['Bob Doe', 'Robert Doe', 'nickname: refused by design'],
    ['Jane', 'Jane Doe', 'single token is unverifiable'],
    ['', 'Jane Doe', 'empty'],
    ['张伟', 'Jane Doe', 'different script, different person'],
    ['Jane Doe Jr', 'Jane Doe', 'suffix becomes the last token: refused (stated cost)'],
  ])('MUST refuse (%s vs %s): %s', (a, b) => {
    expect(personNamesAgree(a, b)).toBe(false);
  });
});

describe('the locator guard after a paid call', () => {
  const person = (over: Record<string, unknown> = {}) => ({
    name: 'Jane Doe', linkedin_url: 'http://www.linkedin.com/in/jane-doe', title: 'VP', ...over,
  });

  it('accepts the same profile and an agreeing name', () => {
    expect(checkLocatorMatch(person(), KEY, 'Jane Doe')).toEqual({ ok: true });
    expect(checkLocatorMatch(person({ name: undefined, first_name: 'Jane', last_name: 'Doe' }), KEY, 'Jane Doe')).toEqual({ ok: true });
  });

  it('an ABSENT returned linkedin_url refuses: absence of a contradiction is not agreement', () => {
    expect(checkLocatorMatch(person({ linkedin_url: undefined }), KEY, 'Jane Doe')).toEqual({ ok: false, reason: 'url_absent' });
    expect(checkLocatorMatch(person({ linkedin_url: 'https://evil.com/in/jane-doe' }), KEY, 'Jane Doe')).toEqual({ ok: false, reason: 'url_absent' });
  });

  it('a different profile refuses', () => {
    expect(checkLocatorMatch(person({ linkedin_url: 'https://www.linkedin.com/in/jane-doe-2' }), KEY, 'Jane Doe'))
      .toEqual({ ok: false, reason: 'url_mismatch' });
  });

  it('same slug, different name (the recycled-slug case) refuses', () => {
    expect(checkLocatorMatch(person({ name: 'John Smith' }), KEY, 'Jane Doe')).toEqual({ ok: false, reason: 'name_mismatch' });
  });
});

describe('end to end through the adapter (mocked Apollo shapes)', () => {
  it('a guard refusal after the call is no_match with an explicit reason, and returns NO fields', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: { name: 'John Smith', linkedin_url: KEY, title: 'CEO' } }));
    const out = await apolloEnrichmentAdapter.enrich(locatorRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe('no_match');
    expect(out.fields).toEqual([]);
    expect(out.detail).toContain('locator guard refused the match: name_mismatch');
    expect(out.detail).toContain('form=vanity');
  });

  it('a match with no linkedin_url is refused, not accepted', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: { name: 'Jane Doe', title: 'VP' } }));
    const out = await apolloEnrichmentAdapter.enrich(locatorRequest());
    expect(out.outcome).toBe('no_match');
    expect(out.detail).toContain('url_absent');
  });

  it('no match carries the locator form, so an opaque-key miss is attributable', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: null }));
    const out = await apolloEnrichmentAdapter.enrich(locatorRequest({
      selectors: { name: 'Jane Doe', linkedin_url: `https://www.linkedin.com/in/${OPAQUE}`, linkedin_url_form: 'opaque' },
    }));
    expect(out.outcome).toBe('no_match');
    expect(out.detail).toContain('form=opaque');
  });

  it('a transport failure is a provider error, never a match or a miss', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const out = await apolloEnrichmentAdapter.enrich(locatorRequest());
    expect(['provider_unavailable', 'timeout']).toContain(out.outcome);
    expect(out.fields).toEqual([]);
  });

  it('a guard pass proceeds to mapping (fields still gated by the claim list)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: { name: 'Jane Doe', linkedin_url: KEY, title: 'VP' } }));
    const out = await apolloEnrichmentAdapter.enrich(locatorRequest());
    // job_title is not claimed until live verification, so a passed guard yields field_not_found.
    expect(out.outcome).toBe('field_not_found');
    expect(out.detail).not.toContain('locator guard');
  });

  it('no verifiable canonical name: refused BEFORE egress, zero spend', async () => {
    for (const name of [undefined, '', 'Jane']) {
      const out = await apolloEnrichmentAdapter.enrich(locatorRequest({
        selectors: { ...(name !== undefined ? { name } : {}), linkedin_url: KEY, linkedin_url_form: 'vanity' },
      }));
      expect(out.outcome).toBe('provider_declined');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the locator is NOT identity: no writes, no identity paths', () => {
  it('readPersonLocators only reads, tenant-scoped, and returns the URL AS CAPTURED', async () => {
    dbResult = { data: [{ raw_payload: { public_profile_url: 'https://www.LinkedIn.com/in/Jane-Doe/?trk=1' } }], error: null };
    const out = await readPersonLocators(ORG, 'p-1');
    expect(out).toEqual({ linkedinProfileUrl: 'https://www.LinkedIn.com/in/Jane-Doe/?trk=1' });
    expect(dbCalls.some((c) => c.startsWith('WRITE:'))).toBe(false);
    expect(dbCalls).toContain('table:source_records');
    expect(dbCalls).toContain(`eq:${JSON.stringify(['organization_id', ORG])}`);
    expect(dbCalls).toContain(`eq:${JSON.stringify(['provider', 'linkedin_sales_navigator'])}`);
  });

  it('a read error throws (a locator we could not read is not "no locator")', async () => {
    dbResult = { data: null, error: { message: 'boom' } };
    await expect(readPersonLocators(ORG, 'p-1')).rejects.toThrow('locator read failed');
  });

  it('no tenant or no person: no read at all', async () => {
    expect(await readPersonLocators('', 'p-1')).toEqual({ linkedinProfileUrl: null });
    expect(await readPersonLocators(ORG, null)).toEqual({ linkedinProfileUrl: null });
    expect(dbCalls).toEqual([]);
  });

  it('the locator code reaches no identity writer (source scan)', () => {
    const files = [
      'backend/services/salesNavCapture/locator.ts',
      'lib/linkedin/profileUrl.ts',
    ].map((f) => fs.readFileSync(path.join(__dirname, '../../..', f), 'utf8')
      // Code only: the headers NAME these paths in order to forbid them.
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
    for (const src of files) {
      for (const forbidden of ['identity_claims', 'external_keys', 'resolveUnifiedPerson', 'attachPerson',
        'persistClaims', 'linkedin_urns', '.insert(', '.update(', '.upsert(', '.delete(']) {
        expect(src).not.toContain(forbidden);
      }
    }
  });
});
