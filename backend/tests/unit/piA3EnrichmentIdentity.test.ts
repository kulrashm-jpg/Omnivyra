/**
 * A3 — identity resolution, provenance wiring, and the path into ICP evaluation.
 *
 * The canonical seams are doubled at their own boundaries, so what is proven
 * here is that enrichment USES them rather than reimplementing them: W4 decides
 * account identity, LI-2 decides canonical values, and the real `evaluateIcpFit`
 * scores the result.
 *
 * The load-bearing assertions: an ambiguous account is never attached, an
 * enrichment never writes a canonical field itself, and an enriched person
 * actually moves an ICP evaluation off abstention.
 */

import {
  resolveEnrichmentAccount, makePersistObservation, toAttributeBags,
  UNSAFE_ACCOUNT_OUTCOMES, executeEnrichment,
  type EnrichmentProviderAdapter, type ExecuteEnrichmentPorts, type ProviderField,
} from '../../services/enrichment/providers';
import { evaluateIcpFit, validateCriteria } from '../../services/prospectIcp';
import type { RatifiedIcp } from '../../services/prospectIcp/types';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const PERSON = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_B = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-05T00:00:00.000Z';

/** A W4 resolver double. Returns whatever outcome the test needs. */
const resolver = (out: Record<string, unknown>) => (async () => ({
  organizationId: ORG, accountId: null, outcome: 'created',
  candidateAccountIds: [], normalizedDomain: null, sourceKey: null, reason: 'ok',
  ...out,
})) as never;

describe('A3 identity — account resolution defers to W4', () => {
  it('links an account matched on a provider reference', async () => {
    const r = await resolveEnrichmentAccount(ORG, { sourceReference: 'apollo-1', source: 'apollo' }, NOW,
      resolver({ accountId: ACCOUNT_A, outcome: 'matched_source', reason: 'provider ref' }));
    expect(r.linkable).toBe(true);
    expect(r.accountId).toBe(ACCOUNT_A);
  });

  it('reuses an existing account matched on domain rather than creating one', async () => {
    const r = await resolveEnrichmentAccount(ORG, { domain: 'example.com' }, NOW,
      resolver({ accountId: ACCOUNT_A, outcome: 'matched_domain', normalizedDomain: 'example.com' }));
    expect(r.outcome).toBe('matched_domain');
    expect(r.accountId).toBe(ACCOUNT_A);
  });

  it('REFUSES to attach when the evidence points at two accounts', async () => {
    const r = await resolveEnrichmentAccount(ORG, { name: 'Acme' }, NOW,
      resolver({ accountId: null, outcome: 'ambiguous', candidateAccountIds: [ACCOUNT_A, ACCOUNT_B], reason: 'keys disagree' }));

    // Picking a candidate would merge two real companies on a similar name.
    expect(r.linkable).toBe(false);
    expect(r.accountId).toBeNull();
    expect(r.candidateAccountIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });

  it('refuses when the evidence is too weak to identify a company at all', async () => {
    const r = await resolveEnrichmentAccount(ORG, { name: 'Acme' }, NOW,
      resolver({ accountId: null, outcome: 'insufficient_evidence', reason: 'name only' }));
    expect(r.linkable).toBe(false);
    expect(r.accountId).toBeNull();
  });

  it.each(UNSAFE_ACCOUNT_OUTCOMES)('never returns a linkable account for outcome %s', async (outcome) => {
    const r = await resolveEnrichmentAccount(ORG, { domain: 'x.com' }, NOW,
      resolver({ accountId: ACCOUNT_A, outcome }));
    expect(r.linkable).toBe(false);
    expect(r.accountId).toBeNull();     // even when the resolver offered one
  });
});

describe('A3 provenance — observations go through LI-2, never around it', () => {
  const fields: ProviderField[] = [
    { attribute: 'job_title', subject: 'person', value: 'Marketing Manager', observedAt: '2026-08-01T00:00:00.000Z', confidence: 0.9, providerInferred: false },
    { attribute: 'industry', subject: 'account', value: 'Marketing Technology', observedAt: null, confidence: null, providerInferred: false },
  ];

  it('splits fields into the person and account bags the boundary expects', () => {
    const bags = toAttributeBags(fields);
    // A3V: the bag speaks LI-2's vocabulary. The adapter said `job_title`; the
    // ingestion contract reads `jobTitle`, and the translation is what stopped
    // the value being silently discarded at the boundary.
    expect(bags.personAttributes).toEqual({ jobTitle: 'Marketing Manager' });
    expect(bags.accountAttributes).toEqual({ industry: 'Marketing Technology' });
  });

  it('drops empty values rather than asserting them', () => {
    const bags = toAttributeBags([
      { attribute: 'department', subject: 'person', value: '', observedAt: null, confidence: null, providerInferred: false },
      { attribute: 'city', subject: 'person', value: null, observedAt: null, confidence: null, providerInferred: false },
    ]);
    expect(bags.personAttributes).toEqual({});
  });

  it('hands a ProviderSourceRecord to ingestSourceRecord with provider attribution intact', async () => {
    let received: Record<string, unknown> | null = null;
    const persist = makePersistObservation((async (record: unknown) => {
      received = record as Record<string, unknown>;
      return { sourceRecordId: 'src-1', outcome: 'created', assertionsRecorded: 2, assertionsAlreadyPresent: 0, canonicalApplied: ['job_title'], canonicalWithheld: [] };
    }) as never);

    const out = await persist({
      organizationId: ORG, providerId: 'fake', subject: 'person', entityId: PERSON,
      fields, rawPayload: { title: 'Marketing Manager' }, payloadHash: 'h1',
      observedAt: '2026-08-01T00:00:00.000Z', correlationId: 'corr-1',
    });

    const r = received as unknown as Record<string, unknown>;
    expect(r.organizationId).toBe(ORG);
    expect(r.provider).toBe('fake');
    expect(r.personId).toBe(PERSON);
    expect(r.observedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(r.confidence).toBe(0.9);
    expect(r.ingestionRunId).toBe('corr-1');
    expect(out.sourceRecordId).toBe('src-1');
  });

  it('surfaces canonical values LI-2 WITHHELD instead of reporting them applied', async () => {
    const persist = makePersistObservation((async () => ({
      sourceRecordId: 'src-1', outcome: 'changed', assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [{ attribute: 'job_title', reason: 'sources_disagree' }],
    })) as never);

    const out = await persist({
      organizationId: ORG, providerId: 'fake', subject: 'person', entityId: PERSON,
      fields, rawPayload: {}, payloadHash: null, observedAt: null, correlationId: 'c',
    });
    expect(out.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });

  it('uses a stable source record id so a repeat observation updates, not duplicates', async () => {
    const ids: string[] = [];
    const persist = makePersistObservation((async (record: unknown) => {
      ids.push(String((record as Record<string, unknown>).sourceRecordId));
      return { sourceRecordId: 'src-1', outcome: 'unchanged', assertionsRecorded: 0, assertionsAlreadyPresent: 2, canonicalApplied: [], canonicalWithheld: [] };
    }) as never);

    const input = {
      organizationId: ORG, providerId: 'fake', subject: 'person' as const, entityId: PERSON,
      fields, rawPayload: {}, payloadHash: null, observedAt: null, correlationId: 'c',
    };
    await persist(input); await persist(input);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(`fake:person:${PERSON}`);
  });

  it('never routes a tenant other than the one the executor verified', async () => {
    let seen = '';
    const persist = makePersistObservation((async (record: unknown) => {
      seen = String((record as Record<string, unknown>).organizationId);
      return { sourceRecordId: 's', outcome: 'created', assertionsRecorded: 1, assertionsAlreadyPresent: 0, canonicalApplied: [], canonicalWithheld: [] };
    }) as never);

    await persist({
      organizationId: ORG, providerId: 'fake', subject: 'person', entityId: PERSON,
      fields, rawPayload: { organizationId: OTHER_ORG }, payloadHash: null, observedAt: null, correlationId: 'c',
    });
    expect(seen).toBe(ORG);
    expect(seen).not.toBe(OTHER_ORG);
  });
});

describe('A3 → ICP — enriched attributes reach the existing evaluator', () => {
  const ratified = (criteria: unknown[]): RatifiedIcp => ({
    organizationId: ORG,
    icpId: '44444444-4444-4444-8444-444444444444',
    icpKey: 'first-cut',
    version: 1,
    criteria: validateCriteria(criteria),
    ratifiedAt: NOW,
    ratifiedBy: 'user-1',
  });

  const UNION = {
    id: 'person-title-union', kind: 'required', subject: 'person', attribute: 'job_title',
    predicate: { op: 'one_of', values: ['Head of Marketing', 'Marketing Manager'] },
  };

  it('an UNENRICHED person abstains rather than scoring zero', () => {
    const out = evaluateIcpFit({
      ratified: ratified([UNION]),
      facts: { subject: 'person', attributes: {}, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.abstained).toBe(true);
    expect(out.reason).toBe('no_evaluable_criteria');
    // An absence is never a zero — the contributions array is empty, not 0.
    expect(out.contributions).toEqual([]);
  });

  it('the SAME person, once enriched with job_title, evaluates and scores', () => {
    // A3V correction. This used to build the evaluator's facts from
    // `toAttributeBags`, which only worked because the bag happened to share
    // PI's spelling. It does not: the bag is LI-2's INGESTION vocabulary, while
    // the evaluator reads the CANONICAL attributes LI-2 later writes to the
    // person's columns — the same `job_title` an ICP criterion names. Feeding
    // one to the other conflated two layers; the canonical form is used here,
    // exactly as the sibling test below already does.
    const enriched = { job_title: 'Marketing Manager' };

    const out = evaluateIcpFit({
      ratified: ratified([UNION]),
      facts: { subject: 'person', attributes: enriched, observedAt: '2026-08-01T00:00:00.000Z' },
      asOf: NOW,
    });

    expect(out.abstained).toBe(false);
    expect(out.reason).toBe('evaluated');
    expect(out.satisfied).toEqual(['person-title-union']);
    expect(out.contributions[0].value).toBe(1);
  });

  it('a job title outside the union is unsatisfied — not unknown, and not an error', () => {
    const out = evaluateIcpFit({
      ratified: ratified([UNION]),
      facts: { subject: 'person', attributes: { job_title: 'Warehouse Supervisor' }, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.unsatisfied).toEqual(['person-title-union']);
    expect(out.contributions[0].value).toBe(0);
  });

  it('enriched account attributes evaluate on the account subject', () => {
    const enriched = toAttributeBags([{
      attribute: 'industry', subject: 'account', value: 'Marketing Technology',
      observedAt: null, confidence: null, providerInferred: false,
    }]).accountAttributes;

    const out = evaluateIcpFit({
      ratified: ratified([{
        id: 'account-industry', kind: 'optional', subject: 'account', attribute: 'industry',
        predicate: { op: 'one_of', values: ['Marketing Technology'] },
      }]),
      facts: { subject: 'account', attributes: enriched, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.reason).toBe('evaluated');
    expect(out.satisfied).toEqual(['account-industry']);
  });

  it('a GAP-3 attribute stays unknown even when a criterion names it', () => {
    // Nothing can populate seniority, so it must not read as a failure.
    const out = evaluateIcpFit({
      ratified: ratified([{
        id: 'person-seniority', kind: 'optional', subject: 'person', attribute: 'seniority',
        predicate: { op: 'one_of', values: ['manager'] },
      }]),
      facts: { subject: 'person', attributes: { job_title: 'Marketing Manager' }, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.unknown).toEqual(['person-seniority']);
    expect(out.unsatisfied).toEqual([]);
    expect(out.abstained).toBe(true);
  });
});

describe('A3 — the full path, end to end through real contracts', () => {
  it('provider response → observation → LI-2 → attributes an ICP can evaluate', async () => {
    let ingested: Record<string, unknown> | null = null;

    const adapter: EnrichmentProviderAdapter = {
      id: 'fake', label: 'Fake', supports: ['job_title'], credentialEnvVar: null,
      isAvailable: () => true,
      async enrich() {
        return {
          outcome: 'enriched',
          fields: [{ attribute: 'job_title', subject: 'person', value: 'Marketing Manager', observedAt: '2026-08-01T00:00:00.000Z', confidence: 0.9, providerInferred: false }],
          notReturned: [],
          rawPayload: { title: 'Marketing Manager' },
          payloadHash: 'h1',
        };
      },
    };

    const ports: ExecuteEnrichmentPorts = {
      authorizeCost: async () => ({ authorized: true, holdId: 'h', cost: { kind: 'free' } }),
      releaseCost: async () => { /* not reached */ },
      // A3M: tenant-owned credential, present so identity remains under test.
      resolveCredential: async () => 'tenant-scoped-test-secret',
      findRecentObservation: async () => null,
      persistObservation: makePersistObservation((async (record: unknown) => {
        ingested = record as Record<string, unknown>;
        return { sourceRecordId: 'src-1', outcome: 'created', assertionsRecorded: 1, assertionsAlreadyPresent: 0, canonicalApplied: ['job_title'], canonicalWithheld: [] };
      }) as never),
      now: () => NOW,
    };

    const result = await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: PERSON,
      attributes: ['job_title'], selectors: { email_domain: 'example.com' },
      purpose: 'icp', correlationId: 'corr-1',
    }, 'fake', ports, { adapter });

    expect(result.outcome).toBe('enriched');
    expect(result.sourceRecordId).toBe('src-1');

    // The observation reached LI-2 with its provenance intact.
    const rec = ingested as unknown as Record<string, unknown>;
    expect(rec.provider).toBe('fake');
    expect(rec.observedAt).toBe('2026-08-01T00:00:00.000Z');
    // A3V: LI-2's vocabulary at the ingestion boundary. See the bag test above.
    expect(rec.personAttributes).toEqual({ jobTitle: 'Marketing Manager' });

    // And the canonical value it produced is one the real evaluator can score.
    //
    // A3V: the evaluator is fed the CANONICAL attribute LI-2 writes to the
    // person's columns — the `job_title` the criterion names — not the
    // ingestion bag above, which is LI-2's own input vocabulary. The mock
    // ingest reports exactly this as `canonicalApplied: ['job_title']`.
    const canonical = { job_title: 'Marketing Manager' };
    const out = evaluateIcpFit({
      ratified: {
        organizationId: ORG, icpId: '44444444-4444-4444-8444-444444444444', icpKey: 'k', version: 1,
        criteria: validateCriteria([{
          id: 'person-title-union', kind: 'required', subject: 'person', attribute: 'job_title',
          predicate: { op: 'one_of', values: ['Marketing Manager'] },
        }]),
        ratifiedAt: NOW, ratifiedBy: 'user-1',
      },
      facts: { subject: 'person', attributes: canonical, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.reason).toBe('evaluated');
    expect(out.contributions[0].value).toBe(1);
  });
});
