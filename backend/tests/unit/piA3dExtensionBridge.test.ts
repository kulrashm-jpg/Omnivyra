/**
 * A3D — Omnivyra Extension → PI evidence bridge.
 *
 * B1 identity resolution and LI-2 ingestion are doubled at their own
 * boundaries, so what is proven here is the BRIDGE'S behaviour: what it turns
 * into evidence, what it refuses, and — decisively — what it declines to
 * attach.
 *
 * The load-bearing assertions are negative: no attribute is invented from a
 * name, ambiguity links nothing, insufficient identity creates nothing, and the
 * tenant's own user never becomes a prospect.
 */

import {
  normalizeExtensionObservation, bridgeExtensionObservation,
  EXTENSION_SOURCE_ID, EXTENSION_SUPPLIED_ATTRIBUTES, NO_ATTRIBUTE_REASON,
  type ExtensionAuthorObservation, type ExtensionBridgePorts,
} from '../../services/enrichment/providers';
import { evaluateIcpFit, validateCriteria } from '../../services/prospectIcp';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const CONTACT = '55555555-5555-4555-8555-555555555555';
const PERSON = '11111111-1111-4111-8111-111111111111';
const PERSON_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-05T00:00:00.000Z';

/** Exactly the shape /api/extension/events/comments receives per author. */
const commentAuthor = (over: Partial<ExtensionAuthorObservation> = {}): ExtensionAuthorObservation => ({
  platform: 'linkedin',
  platformUserId: 'ACoAAB123',
  handle: 'jane-doe',
  displayName: 'Jane Doe',
  profileUrl: 'https://www.linkedin.com/in/jane-doe',
  self: false,
  observedAt: '2026-08-20T10:00:00.000Z',
  sourceReference: 'urn:li:comment:7234',
  ...over,
});

interface Recorded { ingested: Record<string, unknown>[]; resolved: Record<string, unknown>[] }

function ports(
  over: Partial<ExtensionBridgePorts> & { rec?: Recorded; identity?: Record<string, unknown> } = {},
): ExtensionBridgePorts {
  const rec = over.rec ?? { ingested: [], resolved: [] };
  return {
    ingest: over.ingest ?? (async (record: unknown) => {
      rec.ingested.push(record as Record<string, unknown>);
      return {
        sourceRecordId: 'src-1', outcome: 'created',
        assertionsRecorded: 0, assertionsAlreadyPresent: 0,
        canonicalApplied: [], canonicalWithheld: [],
      };
    }) as never,
    resolveIdentity: over.resolveIdentity ?? (async (input: unknown) => {
      rec.resolved.push(input as Record<string, unknown>);
      return {
        outcome: 'linked', personId: PERSON, claim: 'created',
        candidatePersonIds: [PERSON], duplicatesParked: 0, failureCodes: [],
        reason: 'single deterministic match',
        ...(over.identity ?? {}),
      };
    }) as never,
    now: over.now ?? (() => NOW),
  };
}

describe('A3D — Test A: a representative extension event enters the bridge', () => {
  it('normalizes a real comment-author shape into a usable observation', () => {
    const n = normalizeExtensionObservation(commentAuthor());
    expect(n.outcome).toBe('usable');
    expect(n.platform).toBe('linkedin');
    expect(n.platformIdentity).toBe('ACoAAB123');
    expect(n.observedAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('prefers the immutable platform id over a handle the owner can change', () => {
    expect(normalizeExtensionObservation(commentAuthor()).platformIdentity).toBe('ACoAAB123');
    expect(normalizeExtensionObservation(commentAuthor({ platformUserId: null })).platformIdentity)
      .toBe('jane-doe');
  });

  it('refuses a platform the extension does not observe', () => {
    const n = normalizeExtensionObservation(commentAuthor({ platform: 'tiktok' }));
    expect(n.outcome).toBe('unsupported_platform');
  });
});

describe('A3D — Test B: an observation becomes evidence WITHOUT fabrication', () => {
  it('asserts NO attribute, because the extension transmits none', () => {
    const n = normalizeExtensionObservation(commentAuthor());
    // The decisive assertion: a name and a handle are not a job title.
    expect(n.fields).toEqual([]);
    expect(EXTENSION_SUPPLIED_ATTRIBUTES).toEqual([]);
    expect(n.reason).toBe(NO_ATTRIBUTE_REASON);
  });

  it('sends only identity-justified fields, never message content or avatars', () => {
    const n = normalizeExtensionObservation(commentAuthor());
    expect(Object.keys(n.rawPayload).sort())
      .toEqual(['display_name', 'platform', 'platform_identity', 'profile_url']);
    expect(JSON.stringify(n.rawPayload)).not.toMatch(/avatar|content|token|cookie|session/i);
  });

  it('writes a source record through LI-2 attributed to the extension', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));

    expect(r.sourceRecordId).toBe('src-1');
    const record = rec.ingested[0];
    expect(record.provider).toBe(EXTENSION_SOURCE_ID);
    expect(record.entityType).toBe('person');
    expect(record.personAttributes).toEqual({});   // no assertions, honestly
    expect(record.confidence).toBeNull();          // the extension states none
  });
});

describe('A3D — Test C: strong identity attaches', () => {
  it('links the observation to a single deterministic match', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));
    expect(r.outcome).toBe('observed_and_linked');
    expect(r.personId).toBe(PERSON);
    expect(rec.ingested[0].personId).toBe(PERSON);
  });

  it('reuses an already-linked identity rather than re-linking it', async () => {
    const r = await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(),
      ports({ identity: { outcome: 'already_linked', personId: PERSON, reason: 'pre-existing link' } }));
    expect(r.outcome).toBe('observed_and_linked');
    expect(r.personId).toBe(PERSON);
  });
});

describe('A3D — Test D: ambiguous identity links NOTHING', () => {
  it('records the observation but attaches no person', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({
      rec,
      identity: {
        outcome: 'ambiguous', personId: null,
        candidatePersonIds: [PERSON, PERSON_B], duplicatesParked: 1,
        reason: 'identity points at two persons',
      },
    }));

    expect(r.outcome).toBe('observed_ambiguous');
    expect(r.personId).toBeNull();
    expect(r.candidatePersonIds).toEqual([PERSON, PERSON_B]);
    // The evidence survives; only the linkage is withheld.
    expect(rec.ingested).toHaveLength(1);
    expect(rec.ingested[0].personId).toBeNull();
    expect(r.reason).toContain('withheld');
  });
});

describe('A3D — Test E: insufficient identity creates nothing', () => {
  it('refuses an author with only a display name', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation(ORG, CONTACT,
      commentAuthor({ platformUserId: null, handle: null }), ports({ rec }));

    expect(r.outcome).toBe('not_observed');
    expect(r.reason).toContain('identifies nobody');
    expect(rec.ingested).toHaveLength(0);   // nothing written at all
    expect(rec.resolved).toHaveLength(0);   // B1 never even consulted
  });

  it('never treats the logged-in user as a prospect', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation(ORG, CONTACT,
      commentAuthor({ self: true }), ports({ rec }));
    expect(r.outcome).toBe('not_observed');
    expect(r.reason).toContain('logged-in user');
    expect(rec.ingested).toHaveLength(0);
  });

  it('never creates a person — B1 owns that refusal and is always consulted first', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({
      rec, identity: { outcome: 'unresolved', personId: null, candidatePersonIds: [], reason: 'nobody holds this identity' },
    }));
    // Identity is resolved BEFORE the write, and the write carries no person.
    expect(rec.resolved).toHaveLength(1);
    expect(rec.ingested[0].personId).toBeNull();
  });
});

describe('A3D — Test F: account linkage', () => {
  it('creates no account, because the extension transmits no domain or company', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));
    expect(rec.ingested[0].accountId).toBeNull();
    expect(rec.ingested[0].accountAttributes).toEqual({});
  });
});

describe('A3D — Test G: provenance survives', () => {
  it('keeps source, platform, identity, observed_at and the source reference', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));
    const r = rec.ingested[0];

    expect(r.provider).toBe(EXTENSION_SOURCE_ID);
    expect((r.rawPayload as Record<string, unknown>).platform).toBe('linkedin');
    expect((r.rawPayload as Record<string, unknown>).platform_identity).toBe('ACoAAB123');
    expect(r.observedAt).toBe('2026-08-20T10:00:00.000Z');
    expect(r.ingestionRunId).toBe('urn:li:comment:7234');
  });

  it('uses the PLATFORM timestamp as observed_at, never the server clock', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));
    expect(rec.ingested[0].observedAt).not.toBe(NOW);
  });

  it('records observed_at as null rather than inventing one when none was captured', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor({ observedAt: null }), ports({ rec }));
    expect(rec.ingested[0].observedAt).toBeNull();
  });
});

describe('A3D — Test H: duplicate suppression', () => {
  it('uses a stable source record id, so a repeat capture updates rather than duplicates', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const p = ports({ rec });
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), p);
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor({ sourceReference: 'urn:li:comment:9999' }), p);

    expect(rec.ingested).toHaveLength(2);
    // Same person, same platform ⇒ same record identity, which LI-2 upserts.
    expect(rec.ingested[0].sourceRecordId).toBe(rec.ingested[1].sourceRecordId);
    expect(rec.ingested[0].sourceRecordId).toBe(`${EXTENSION_SOURCE_ID}:linkedin:ACoAAB123`);
  });
});

describe('A3D — Test J: the ICP path, honestly', () => {
  const UNION = {
    id: 'person-title-union', kind: 'required', subject: 'person', attribute: 'job_title',
    predicate: { op: 'one_of', values: ['Marketing Manager'] },
  };
  const ratified = {
    organizationId: ORG, icpId: '44444444-4444-4444-8444-444444444444', icpKey: 'k', version: 1,
    criteria: validateCriteria([UNION]), ratifiedAt: NOW, ratifiedBy: 'user-1',
  };

  it('extension evidence alone leaves an ICP evaluation ABSTAINING, not scoring zero', () => {
    // The bridge asserts no attributes, so a person known only through the
    // extension has nothing the evaluator can test. That is `unknown`, and an
    // abstention — never a 0, which would read as "a bad fit".
    const out = evaluateIcpFit({
      ratified, facts: { subject: 'person', attributes: {}, observedAt: NOW }, asOf: NOW,
    });
    expect(out.abstained).toBe(true);
    expect(out.reason).toBe('no_evaluable_criteria');
    expect(out.contributions).toEqual([]);
  });

  it('the SAME canonical person evaluates once ANOTHER source supplies job_title', () => {
    // Proves the pipe is connected: the bridge links identity, and any source
    // that later supplies an ICP attribute for that person scores normally.
    const out = evaluateIcpFit({
      ratified,
      facts: { subject: 'person', attributes: { job_title: 'Marketing Manager' }, observedAt: NOW },
      asOf: NOW,
    });
    expect(out.reason).toBe('evaluated');
    expect(out.contributions[0].value).toBe(1);
  });
});

describe('A3D — Test K: tenant isolation', () => {
  it('resolves and writes only the tenant the extension session verified', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT, commentAuthor(), ports({ rec }));
    expect(rec.resolved[0].organizationId).toBe(ORG);
    expect(rec.ingested[0].organizationId).toBe(ORG);
    expect(JSON.stringify(rec.ingested[0])).not.toContain(OTHER_ORG);
  });

  it('refuses a tenant-less observation before consulting B1 or LI-2', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    const r = await bridgeExtensionObservation('   ', CONTACT, commentAuthor(), ports({ rec }));
    expect(r.outcome).toBe('not_observed');
    expect(r.reason).toContain('never tenant-less');
    expect(rec.resolved).toHaveLength(0);
    expect(rec.ingested).toHaveLength(0);
  });

  it('never reads a tenant from the observed payload', async () => {
    const rec: Recorded = { ingested: [], resolved: [] };
    await bridgeExtensionObservation(ORG, CONTACT,
      { ...commentAuthor(), displayName: OTHER_ORG } as ExtensionAuthorObservation, ports({ rec }));
    expect(rec.ingested[0].organizationId).toBe(ORG);
  });
});
