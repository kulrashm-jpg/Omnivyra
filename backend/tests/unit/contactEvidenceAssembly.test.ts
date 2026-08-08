/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 2 — evidence assembly.
 *
 * Phase 1 proved the canonical contracts hold. These prove the layer that FILLS them obeys the four
 * rules it claims: abstain rather than infer, preserve provenance, derive confidence from evidence,
 * and stay references-only.
 *
 * The abstention assertions carry the most weight. A score dimension that defaults to 0 instead of
 * abstaining would make an unenriched contact look identical to an unreachable one, and every
 * downstream consumer would read that as a measurement.
 */

import {
  contactFromEvidence,
  assembleContactUnderstanding,
  resolveContactId,
  projectContact,
  CONTACT_SCORE_DIMENSIONS,
  type ContactEvidenceInput,
} from '../../services/contactIntelligence';

const ASOF = '2026-08-08T00:00:00.000Z';
const RECENT = '2026-08-01T00:00:00.000Z';
const OLD = '2025-02-01T00:00:00.000Z';

const base = (over: Partial<ContactEvidenceInput> = {}): ContactEvidenceInput => ({
  companyId: 'co-1', contactId: 'ct-1', asOf: ASOF, source: 'contact_capture', ...over,
});

const dim = (a: ReturnType<typeof contactFromEvidence>, d: string) =>
  a.contributions.find((c) => c.dimension === d)!;

describe('Contact evidence assembly — abstention', () => {
  it('with no observations at all: only identity is stated, everything else abstains', () => {
    const a = contactFromEvidence(base());
    // canonical_id is derived from the key, not inferred about the world, so it is always safe.
    expect(a.facets.identity?.value?.canonical_id).toBe('ct-1');
    expect(a.facets.identity?.value?.platform).toBeUndefined();
    expect(a.facets.profile).toBeUndefined();
    expect(a.facets.affiliation).toBeUndefined();
    expect(a.facets.channels).toBeUndefined();
    expect(a.facets.engagement).toBeUndefined();
    expect(a.facets.reachability).toBeUndefined();
    expect(a.facets.attribution).toBeUndefined();
    expect(a.edges).toEqual([]);
  });

  it('every score dimension abstains with null — never defaults to 0', () => {
    const a = contactFromEvidence(base());
    for (const d of CONTACT_SCORE_DIMENSIONS) {
      const c = dim(a, d);
      // null = "not measured". 0 would mean "measured and found absent" — a different claim.
      expect(c.value).toBeNull();
      expect(c.confidence).toBe(0);
      expect(c.evidence).toEqual([]);
    }
  });

  it('a profile input with no populated field does not create an empty facet', () => {
    const a = contactFromEvidence(base({ profile: { observedAt: RECENT } }));
    expect(a.facets.profile).toBeUndefined();
  });

  it('records what it could not determine as explicit unknowns', () => {
    const a = contactFromEvidence(base());
    expect(a.reasoning[0].unknowns).toEqual([
      'no_platform_identity_evidence', 'no_channel_evidence', 'no_interaction_evidence', 'unresolved_canonical_person',
    ]);
    expect(a.reasoning[0].conclusion).toBeNull();
  });

  it('never fabricates the canonical person reference', () => {
    expect(contactFromEvidence(base()).facets.identity?.value?.unifiedPersonId).toBeNull();
  });
});

describe('Contact evidence assembly — provenance and confidence', () => {
  it('attributes each observation to ITS OWN source, not the call default', () => {
    const a = contactFromEvidence(base({
      identity: { platform: 'x', platformUserId: '12345', observedAt: RECENT, source: 'x_api' },
      channels: [{ channel: 'email', observedAt: RECENT, source: 'linkedin_api' }],
    }));
    const systems = new Set(a.evidence.map((e) => e.source.system));
    expect(systems.has('x_api')).toBe(true);
    expect(systems.has('linkedin_api')).toBe(true);
    // A channel learned from LinkedIn must never be attributed to the caller's default.
    expect(a.evidence.find((e) => e.label === 'channel:email')!.source.system).toBe('linkedin_api');
  });

  it('falls back to the call source only when an observation names none', () => {
    const a = contactFromEvidence(base({ identity: { platform: 'x', platformUserId: '1', observedAt: RECENT } }));
    expect(a.evidence.find((e) => e.label === 'platform')!.source.system).toBe('contact_capture');
  });

  it('derives contribution confidence from the evidence subset that produced it', () => {
    const a = contactFromEvidence(base({
      identity: { platform: 'x', platformUserId: '1', observedAt: RECENT },
      channels: [{ channel: 'dm', observedAt: RECENT }],
    }));
    expect(dim(a, 'identity_strength').confidence).toBeGreaterThan(0);
    expect(dim(a, 'identity_strength').evidence.length).toBeGreaterThan(0);
    expect(dim(a, 'engagement_depth').confidence).toBe(0);
  });
});

describe('Contact evidence assembly — derived dimensions', () => {
  it('identity_strength counts corroborating SOURCES, not fields', () => {
    const oneSource = contactFromEvidence(base({
      identity: { platform: 'x', platformUserId: '1', handle: '@a', contactKey: 'x:1', observedAt: RECENT, source: 'x_api' },
    }));
    const twoSources = contactFromEvidence(base({
      identity: { platform: 'x', platformUserId: '1', observedAt: RECENT, source: 'x_api' },
      profile: { displayName: 'Alice', observedAt: RECENT, source: 'linkedin_api' },
    }));
    // Four fields from one observer is still one observer.
    expect(dim(twoSources, 'identity_strength').value!).toBeGreaterThan(dim(oneSource, 'identity_strength').value!);
  });

  it('reachability rises with DISTINCT channels and never reaches certainty', () => {
    const one = contactFromEvidence(base({ channels: [{ channel: 'dm', observedAt: RECENT }] }));
    const two = contactFromEvidence(base({ channels: [{ channel: 'dm', observedAt: RECENT }, { channel: 'email', observedAt: RECENT }] }));
    const dup = contactFromEvidence(base({ channels: [{ channel: 'dm', observedAt: RECENT }, { channel: 'dm', observedAt: ASOF }] }));

    expect(dim(one, 'reachability').value).toBe(0.5);
    expect(dim(two, 'reachability').value!).toBeGreaterThan(0.5);
    expect(dim(two, 'reachability').value!).toBeLessThan(1);
    // The same channel seen twice is one route, not two.
    expect(dim(dup, 'reachability').value).toBe(0.5);
    expect(dup.facets.reachability?.value?.distinctChannels).toBe(1);
  });

  it('channel verification is monotonic — a later unverified sighting cannot un-verify', () => {
    const a = contactFromEvidence(base({
      channels: [
        { channel: 'email', verified: true, observedAt: RECENT },
        { channel: 'email', verified: false, observedAt: ASOF },
      ],
    }));
    expect(a.facets.channels?.value?.channels?.[0].verified).toBe(true);
    expect(a.facets.channels?.value?.preferred).toBe('email');
  });

  it('engagement_depth counts interactions and reports distinct threads', () => {
    const a = contactFromEvidence(base({
      interactions: [
        { threadRef: 't1', messageRef: 'm1', observedAt: RECENT },
        { threadRef: 't1', messageRef: 'm2', observedAt: ASOF },
        { threadRef: 't2', messageRef: 'm3', observedAt: ASOF },
      ],
    }));
    expect(a.facets.engagement?.value?.totalMessages).toBe(3);
    expect(a.facets.engagement?.value?.totalThreads).toBe(2);
    expect(a.facets.engagement?.value?.firstInteractionAt).toBe(RECENT);
    expect(a.facets.engagement?.value?.lastInteractionAt).toBe(ASOF);
    expect(dim(a, 'engagement_depth').value!).toBeGreaterThan(0);
  });

  it('recency decays with age', () => {
    const fresh = contactFromEvidence(base({ interactions: [{ threadRef: 't', observedAt: RECENT }] }));
    const stale = contactFromEvidence(base({ interactions: [{ threadRef: 't', observedAt: OLD }] }));
    expect(dim(fresh, 'recency').value!).toBeGreaterThan(dim(stale, 'recency').value!);
  });
});

describe('Contact evidence assembly — references only', () => {
  it('emits contact_of → person and works_at → company, both as references', () => {
    const a = contactFromEvidence(base({
      unifiedPersonId: 'up-1',
      affiliation: { companyRef: 'co-9', role: 'Head of Growth', observedAt: RECENT },
    }));
    const kinds = a.edges.map((e) => `${e.type}:${e.to.type}`).sort();
    expect(kinds).toEqual(['contact_of:person', 'works_at:company']);
    for (const e of a.edges) expect(e.from).toEqual({ type: 'contact', id: 'ct-1' });
  });

  it('emits no company edge when affiliation carries no companyRef', () => {
    const a = contactFromEvidence(base({ affiliation: { role: 'Engineer', observedAt: RECENT } }));
    expect(a.edges.filter((e) => e.type === 'works_at')).toEqual([]);
    expect(a.facets.affiliation?.value?.role).toBe('Engineer');
  });
});

describe('Contact evidence assembly — determinism and id resolution', () => {
  it('slugs the contact id deterministically', () => {
    expect(resolveContactId('  CT_1 ')).toBe('ct-1');
    expect(resolveContactId('')).toBe('contact');
    expect(resolveContactId('!!!')).toBe('contact');
  });

  it('identical inputs serialise identically', () => {
    const build = () => contactFromEvidence(base({
      identity: { platform: 'x', platformUserId: '1', observedAt: RECENT },
      channels: [{ channel: 'email', observedAt: RECENT }, { channel: 'dm', observedAt: RECENT }],
      interactions: [{ threadRef: 't1', observedAt: RECENT }],
      sourceRefs: ['b', 'a', 'b'],
    }));
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('input order does not change the output', () => {
    const mk = (channels: Array<{ channel: string; observedAt: string }>) =>
      JSON.stringify(contactFromEvidence(base({ channels: channels as any })).facets.channels);
    expect(mk([{ channel: 'email', observedAt: RECENT }, { channel: 'dm', observedAt: RECENT }]))
      .toBe(mk([{ channel: 'dm', observedAt: RECENT }, { channel: 'email', observedAt: RECENT }]));
  });

  it('deduplicates and sorts attribution source refs', () => {
    const a = contactFromEvidence(base({ sourceRefs: ['zeta', 'alpha', 'zeta'] }));
    expect(a.facets.attribution?.value?.sourceRefs).toEqual(['alpha', 'zeta']);
    expect(a.facets.attribution?.value?.firstSeenSource).toBe('alpha');
  });
});

describe('Contact assembly seam', () => {
  const full = base({
    unifiedPersonId: 'up-1',
    identity: { platform: 'x', platformUserId: '12345', handle: '@alice', contactKey: 'x:12345', observedAt: RECENT },
    profile: { displayName: 'Alice', profileUrl: 'https://x.com/alice', observedAt: RECENT, source: 'x_api' },
    affiliation: { companyRef: 'co-9', role: 'Head of Growth', observedAt: RECENT },
    channels: [{ channel: 'dm', verified: true, observedAt: RECENT }, { channel: 'email', observedAt: RECENT }],
    interactions: [{ threadRef: 't1', observedAt: RECENT }, { threadRef: 't2', observedAt: ASOF }],
    sourceRefs: ['thread:t1'],
  });

  it('produces understanding + projection from one pass', () => {
    const { understanding, projection } = assembleContactUnderstanding(full);
    expect(understanding.key).toEqual({ companyId: 'co-1', contactId: 'ct-1' });
    expect(understanding.builtAt).toBe(ASOF);
    expect(understanding.graph.root).toEqual({ type: 'contact', id: 'ct-1' });
    expect(projection.unifiedPersonId).toBe('up-1');
    expect(projection.reachable).toBe(true);
    expect(projection.channels).toEqual(['dm', 'email']);
    expect(projection.identity?.handle).toBe('@alice');
  });

  it('scores are populated once contributors exist', () => {
    const { projection } = assembleContactUnderstanding(full);
    for (const d of CONTACT_SCORE_DIMENSIONS) expect(projection.scores[d]).not.toBeNull();
    expect(projection.overallScore).not.toBeNull();
  });

  it('an empty pass still yields a valid, wholly-abstaining understanding', () => {
    const { understanding, projection } = assembleContactUnderstanding(base());
    for (const d of CONTACT_SCORE_DIMENSIONS) expect(projection.scores[d]).toBeNull();
    expect(projection.reachable).toBe(false);
    expect(projection.unifiedPersonId).toBeNull();
    expect(understanding.graph.edges).toEqual([]);
  });

  it('assembly agrees with calling the builder and projection directly', () => {
    const { understanding, projection } = assembleContactUnderstanding(full);
    expect(JSON.stringify(projectContact(understanding, ASOF))).toBe(JSON.stringify(projection));
  });
});
