/**
 * A3E — extension acquisition activation.
 *
 * Covers what A3D could not: profile context DOES cross the transport
 * (`/api/extension/events` carries `data.raw_context`), a production-shaped
 * event maps onto an observation, the W1 identity port replaces B1 where there
 * is no `contacts` row, and a PI failure cannot harm an engagement capture.
 *
 * The load-bearing assertions remain negative: a headline never becomes a
 * job_title, a company name never becomes an account, and a location never
 * becomes a country.
 */

import {
  normalizeExtensionObservation, observationFromExtensionEvent,
  bridgeExtensionObservation, bridgeExtensionObservationSafely,
  makeShadowIdentityPort, REFUSED_CONTEXT_MAPPINGS, EXTENSION_SOURCE_ID,
  type ExtensionAuthorObservation, type ExtensionBridgePorts,
} from '../../services/enrichment/providers';
import { evaluateIcpFit, validateCriteria } from '../../services/prospectIcp';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const AUTHOR = '55555555-5555-4555-8555-555555555555';
const PERSON = '11111111-1111-4111-8111-111111111111';
const PERSON_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-05T00:00:00.000Z';

/** Exactly what `buildEvent` produces for a Sales Navigator lead. */
const salesNavEvent = (over: Record<string, unknown> = {}) => ({
  platform: 'linkedin',
  platformMessageId: 'sales-lead-42',
  data: {
    author_name: 'Jane Doe',
    author_username: 'jane-doe',
    author_profile_url: 'https://www.linkedin.com/in/jane-doe',
    author_self: false,
    created_at: '2026-08-20T10:00:00.000Z',
    raw_context: {
      collector: 'sales_navigator',
      company: 'Acme Marketing Ltd',
      headline: 'Helping SaaS teams scale | ex-Google | Marketing',
    },
    ...over,
  },
});

interface Recorded { ingested: Record<string, unknown>[]; resolved: Record<string, unknown>[] }

function ports(
  over: { rec?: Recorded; identity?: Record<string, unknown>; ingestThrows?: boolean } = {},
): ExtensionBridgePorts {
  const rec = over.rec ?? { ingested: [], resolved: [] };
  return {
    ingest: (async (record: unknown) => {
      if (over.ingestThrows) throw new Error('LI-2 unavailable');
      rec.ingested.push(record as Record<string, unknown>);
      return {
        sourceRecordId: 'src-1', outcome: 'created',
        assertionsRecorded: 0, assertionsAlreadyPresent: 0,
        canonicalApplied: [], canonicalWithheld: [],
      };
    }) as never,
    resolveIdentity: (async (input: unknown) => {
      rec.resolved.push(input as Record<string, unknown>);
      return {
        outcome: 'linked', personId: PERSON, claim: 'not_attempted',
        candidatePersonIds: [PERSON], duplicatesParked: 0, failureCodes: [],
        reason: 'w1 shadow: matched_claim',
        ...(over.identity ?? {}),
      };
    }) as never,
    now: () => NOW,
  };
}

describe('A3E — transport: profile context DOES cross the boundary', () => {
  it('maps a production Sales Navigator event onto an observation', () => {
    const obs = observationFromExtensionEvent(salesNavEvent());
    expect(obs).not.toBeNull();
    expect(obs!.platform).toBe('linkedin');
    expect(obs!.handle).toBe('jane-doe');
    expect(obs!.observedAt).toBe('2026-08-20T10:00:00.000Z');
    expect(obs!.profileContext?.headline).toContain('Helping SaaS teams scale');
    expect(obs!.profileContext?.company).toBe('Acme Marketing Ltd');
  });

  it('remains valid for an event carrying NO raw_context', () => {
    const obs = observationFromExtensionEvent(salesNavEvent({ raw_context: null }));
    expect(obs).not.toBeNull();
    expect(obs!.profileContext).toBeNull();
  });

  it('returns null when the event carries no durable platform identity', () => {
    expect(observationFromExtensionEvent(
      salesNavEvent({ author_username: null, author_profile_url: null }))).toBeNull();
  });

  it('never uses the synthesised engagement author id as a person identity', () => {
    // buildAuthorId derives from a message id — it identifies an EVENT.
    const obs = observationFromExtensionEvent(salesNavEvent());
    expect(obs!.handle).not.toContain('sales-lead-42');
    expect(obs!.platformUserId).not.toBe('sales-lead-42');
  });

  it('falls back to the profile URL when no username was captured', () => {
    const obs = observationFromExtensionEvent(salesNavEvent({ author_username: null }));
    expect(obs!.handle).toBe('https://www.linkedin.com/in/jane-doe');
  });
});

describe('A3E — profile context is EVIDENCE, never a canonical attribute', () => {
  it('names each refused mapping and its reason', () => {
    expect(REFUSED_CONTEXT_MAPPINGS.headline).toBe('job_title');
    expect(REFUSED_CONTEXT_MAPPINGS.company).toBe('account');
    expect(REFUSED_CONTEXT_MAPPINGS.location).toBe('city / region / country_code');
  });

  it('retains headline/company/location verbatim, labelled as unmapped', () => {
    const obs = observationFromExtensionEvent(salesNavEvent())!;
    const n = normalizeExtensionObservation(obs);
    const ctx = n.rawPayload.observed_profile_context as Record<string, string>;

    expect(ctx.headline).toContain('Helping SaaS teams scale');
    expect(ctx.company).toBe('Acme Marketing Ltd');
    expect(String(n.rawPayload.observed_profile_context_note)).toContain('not mapped to a canonical attribute');
  });

  it('asserts NO attribute — a headline is not a job title', () => {
    const n = normalizeExtensionObservation(observationFromExtensionEvent(salesNavEvent())!);
    expect(n.fields).toEqual([]);
  });

  it('writes no job_title, no city, no region and no country_code', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent({
        raw_context: { headline: 'VP Marketing', company: 'Acme', location: 'San Francisco Bay Area' },
      }))!, ports({ rec }));

    // Even when the headline LOOKS like a title, it is not asserted.
    expect(rec.ingested[0].personAttributes).toEqual({});
    expect(rec.ingested[0].accountAttributes).toEqual({});
    expect(rec.ingested[0].accountId).toBeNull();
  });

  it('creates no account from a company NAME', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, ports({ rec }));
    expect(rec.ingested[0].accountId).toBeNull();
  });
});

describe('A3E — the W1 identity port replaces B1 where there is no contacts row', () => {
  const shadow = (outcome: string, personId: string | null, candidates: string[] = []) =>
    (async () => ({
      organizationId: ORG, personId, outcome, candidatePersonIds: candidates,
      verdicts: [{ claimType: 'external_id', platform: 'linkedin', normalizedValue: 'jane-doe', outcome, personIds: candidates, reason: `w1: ${outcome}` }],
    })) as never;

  it('maps matched_claim to linked', async () => {
    const port = makeShadowIdentityPort(shadow('matched_claim', PERSON, [PERSON]));
    const r = await port({ organizationId: ORG, contactId: AUTHOR, platform: 'linkedin', platformUserId: 'jane-doe' });
    expect(r.outcome).toBe('linked');
    expect(r.personId).toBe(PERSON);
  });

  it('maps matched_spine to linked', async () => {
    const port = makeShadowIdentityPort(shadow('matched_spine', PERSON, [PERSON]));
    expect((await port({ organizationId: ORG, contactId: AUTHOR, platform: 'linkedin', platformUserId: 'x' })).outcome)
      .toBe('linked');
  });

  it('maps ambiguous to ambiguous and attaches NOBODY', async () => {
    const port = makeShadowIdentityPort(shadow('ambiguous', PERSON, [PERSON, PERSON_B]));
    const r = await port({ organizationId: ORG, contactId: AUTHOR, platform: 'linkedin', platformUserId: 'x' });
    expect(r.outcome).toBe('ambiguous');
    expect(r.personId).toBeNull();          // even though W1 offered one
    expect(r.candidatePersonIds).toEqual([PERSON, PERSON_B]);
  });

  it('maps unresolved to unresolved and creates nothing', async () => {
    const port = makeShadowIdentityPort(shadow('unresolved', null));
    const r = await port({ organizationId: ORG, contactId: AUTHOR, platform: 'linkedin', platformUserId: 'x' });
    expect(r.outcome).toBe('unresolved');
    expect(r.personId).toBeNull();
    expect(r.claim).toBe('not_attempted');  // it writes no claim; it only reads
  });

  it('queries the tenant it was given, on an external_id claim', async () => {
    let seen: unknown[] = [];
    const port = makeShadowIdentityPort((async (org: string, candidates: unknown[]) => {
      seen = [org, candidates];
      return { organizationId: org, personId: null, outcome: 'unresolved', candidatePersonIds: [], verdicts: [] };
    }) as never);
    await port({ organizationId: ORG, contactId: AUTHOR, platform: 'linkedin', platformUserId: 'jane-doe' });
    expect(seen[0]).toBe(ORG);
    expect(seen[1]).toEqual([{ claimType: 'external_id', value: 'jane-doe', platform: 'linkedin' }]);
  });
});

describe('A3E — failure isolation', () => {
  it('never throws when LI-2 fails; the engagement capture is unaffected', async () => {
    const r = await bridgeExtensionObservationSafely(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, ports({ ingestThrows: true }));

    expect(r.outcome).toBe('not_observed');
    expect(r.reason).toContain('engagement capture unaffected');
    expect(r.reason).toContain('LI-2 unavailable');
  });

  it('never throws when identity resolution fails', async () => {
    const failing: ExtensionBridgePorts = {
      ...ports(),
      resolveIdentity: (async () => { throw new Error('W1 down'); }) as never,
    };
    const r = await bridgeExtensionObservationSafely(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, failing);
    expect(r.outcome).toBe('not_observed');
    expect(r.reason).toContain('W1 down');
  });

  it('reports success normally when nothing fails', async () => {
    const r = await bridgeExtensionObservationSafely(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, ports());
    expect(r.outcome).toBe('observed_and_linked');
    expect(r.personId).toBe(PERSON);
  });

  it('writes exactly one PI source record per observation — never a duplicate', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservationSafely(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, ports({ rec }));
    expect(rec.ingested).toHaveLength(1);
  });
});

describe('A3E — deduplication across events', () => {
  it('gives the same person a stable PI identity across different event ids', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const p = ports({ rec });
    await bridgeExtensionObservation(ORG, AUTHOR, observationFromExtensionEvent(salesNavEvent())!, p);
    await bridgeExtensionObservation(ORG, AUTHOR,
      observationFromExtensionEvent({ ...salesNavEvent(), platformMessageId: 'sales-lead-99' })!, p);

    expect(rec.ingested[0].sourceRecordId).toBe(rec.ingested[1].sourceRecordId);
    expect(rec.ingested[0].sourceRecordId).toBe(`${EXTENSION_SOURCE_ID}:linkedin:jane-doe`);
    // Correlation still distinguishes the two events.
    expect(rec.ingested[0].ingestionRunId).not.toBe(rec.ingested[1].ingestionRunId);
  });

  it('keeps genuinely distinct platform identities distinct', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const p = ports({ rec });
    await bridgeExtensionObservation(ORG, AUTHOR, observationFromExtensionEvent(salesNavEvent())!, p);
    await bridgeExtensionObservation(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent({ author_username: 'john-smith' }))!, p);
    expect(rec.ingested[0].sourceRecordId).not.toBe(rec.ingested[1].sourceRecordId);
  });
});

describe('A3E — ICP evaluation, unchanged and honest', () => {
  const ratified = {
    organizationId: ORG, icpId: '44444444-4444-4444-8444-444444444444', icpKey: 'k', version: 1,
    criteria: validateCriteria([{
      id: 'person-title-union', kind: 'required', subject: 'person', attribute: 'job_title',
      predicate: { op: 'one_of', values: ['Marketing Manager'] },
    }]),
    ratifiedAt: NOW, ratifiedBy: 'user-1',
  };

  it('an extension-only person abstains — the headline did NOT become a title', () => {
    const out = evaluateIcpFit({
      ratified, facts: { subject: 'person', attributes: {}, observedAt: NOW }, asOf: NOW,
    });
    expect(out.abstained).toBe(true);
    expect(out.reason).toBe('no_evaluable_criteria');
  });

  it('a matching job_title from ANY source contributes', () => {
    const out = evaluateIcpFit({
      ratified, facts: { subject: 'person', attributes: { job_title: 'Marketing Manager' }, observedAt: NOW }, asOf: NOW,
    });
    expect(out.contributions[0].value).toBe(1);
  });

  it('a non-matching job_title does NOT falsely contribute', () => {
    const out = evaluateIcpFit({
      ratified, facts: { subject: 'person', attributes: { job_title: 'Warehouse Supervisor' }, observedAt: NOW }, asOf: NOW,
    });
    expect(out.unsatisfied).toEqual(['person-title-union']);
    expect(out.contributions[0].value).toBe(0);
  });
});

describe('A3E — tenant isolation', () => {
  it('uses the authenticated tenant, never one from the payload', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent({
        raw_context: { company: OTHER_ORG, headline: OTHER_ORG },
      }))!, ports({ rec }));

    expect(rec.ingested[0].organizationId).toBe(ORG);
    expect(rec.resolved[0].organizationId).toBe(ORG);
  });

  it('refuses a tenant-less event before touching W1 or LI-2', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservationSafely('', AUTHOR,
      observationFromExtensionEvent(salesNavEvent())!, ports({ rec }));
    expect(r.outcome).toBe('not_observed');
    expect(rec.resolved).toHaveLength(0);
    expect(rec.ingested).toHaveLength(0);
  });

  it('cannot be handed a canonical person id by the browser', () => {
    // The observation type has no canonical id field at all, so a browser
    // payload has nothing to populate. Identity is resolved server-side only.
    const obs = observationFromExtensionEvent(salesNavEvent({
      person_id: PERSON_B, unified_person_id: PERSON_B,
    } as Record<string, unknown>))!;
    expect(Object.keys(obs)).not.toContain('personId');
    expect(JSON.stringify(obs)).not.toContain(PERSON_B);
  });

  it('never attaches a person the resolver did not agree on', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, AUTHOR, observationFromExtensionEvent(salesNavEvent())!,
      ports({ rec, identity: { outcome: 'ambiguous', personId: null, candidatePersonIds: [PERSON, PERSON_B] } }));
    expect(rec.ingested[0].personId).toBeNull();
  });
});

describe('A3E — self-authored and unsupported input', () => {
  it('never turns the tenant user into a prospect', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservationSafely(ORG, AUTHOR,
      observationFromExtensionEvent(salesNavEvent({ author_self: true }))!, ports({ rec }));
    expect(r.outcome).toBe('not_observed');
    expect(rec.ingested).toHaveLength(0);
  });

  it('ignores an unsupported platform', () => {
    const obs: ExtensionAuthorObservation = {
      ...observationFromExtensionEvent(salesNavEvent())!, platform: 'tiktok',
    };
    expect(normalizeExtensionObservation(obs).outcome).toBe('unsupported_platform');
  });
});
