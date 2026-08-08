/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 1 — canonical Contact Understanding.
 *
 * Proves the canonical layer behaves like its seven siblings: one builder, one projection owner,
 * deterministic output, abstention on absent evidence, references-only graph, and a tenant-scoped key.
 *
 * The tenancy assertions are the ones that matter most. WS-5E froze platform-person identity as
 * tenant-scoped; a `ContactIdentityKey` that lost `companyId` would make every facet below
 * cross-tenant, and nothing else in this suite would notice.
 */

import {
  buildContactUnderstanding,
  projectContact,
  contactEdge,
  buildContactGraph,
  toShadowRecord,
  toLegacyFields,
  isContactUnderstandingEnabled,
  isContactProjectionAuthoritative,
  CONTACT_MODEL_VERSION,
  CONTACT_FACET_NAMES,
  CONTACT_SCORE_DIMENSIONS,
  type ContactIdentityKey,
  type ContactFacets,
} from '../../services/contactIntelligence';
import { facet, mkEvidence } from '../../services/intelligence/canonical';
import type { EvidenceRef } from '../../services/intelligence/canonical';

const ASOF = '2026-08-08T00:00:00.000Z';
const KEY: ContactIdentityKey = { companyId: 'co-1', contactId: 'ct-1' };

const ev = (label: string, value: string, source: string, observedAt = ASOF): EvidenceRef =>
  mkEvidence('contact', { label, value, source, observedAt, kind: 'observed', weight: 0.8 });

describe('Contact Understanding — canonical contracts', () => {
  it('is tenant-scoped: the key carries companyId AND contactId', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    expect(u.key.companyId).toBe('co-1');
    expect(u.key.contactId).toBe('ct-1');
    // The frozen WS-5E decision. Without companyId the understanding could not say whose it is.
    expect(Object.keys(u.key).sort()).toEqual(['companyId', 'contactId']);
  });

  it('declares 8 facets and 4 descriptive score dimensions', () => {
    expect(CONTACT_FACET_NAMES).toEqual([
      'identity', 'profile', 'affiliation', 'channels', 'engagement', 'reachability', 'attribution', 'evidenceSummary',
    ]);
    expect(CONTACT_SCORE_DIMENSIONS).toEqual(['identity_strength', 'reachability', 'engagement_depth', 'recency']);
  });

  it('abstains on every facet when given no evidence', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    for (const name of CONTACT_FACET_NAMES) {
      expect(u.facets[name].value).toBeNull();
      expect(u.facets[name].confidence).toBe(0);
    }
    expect(u.version).toBe(CONTACT_MODEL_VERSION);
    expect(u.builtAt).toBe(ASOF);
  });

  it('summarises evidence and counts DISTINCT sources, not raw volume', () => {
    // Two facts from one platform corroborate one observer; two from two observers is a stronger claim.
    const u = buildContactUnderstanding({
      key: KEY,
      builtAt: ASOF,
      evidence: [ev('handle', '@alice', 'x'), ev('display_name', 'Alice', 'x'), ev('handle', 'alice', 'linkedin')],
    });
    expect(u.facets.evidenceSummary.value?.totalEvidence).toBe(3);
    expect(u.facets.evidenceSummary.value?.distinctSources).toBe(2);
  });

  it('owns exactly ONE graph node — its own — and references everything else', () => {
    const edges = [
      contactEdge('ct-1', 'contact_of', 'person', 'up-1'),
      contactEdge('ct-1', 'works_at', 'company', 'co-9'),
    ];
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF, edges });
    expect(u.graph.root).toEqual({ type: 'contact', id: 'ct-1' });
    for (const e of u.graph.edges) expect(e.from).toEqual({ type: 'contact', id: 'ct-1' });
    expect(u.graph.edges.map((e) => e.to.type).sort()).toEqual(['company', 'person']);
  });

  it('buildContactGraph agrees with the builder’s graph root', () => {
    const g = buildContactGraph(KEY, []);
    expect(g.root).toEqual({ type: 'contact', id: 'ct-1' });
  });

  it('is deterministic — identical inputs serialise identically', () => {
    const build = () => buildContactUnderstanding({
      key: KEY, builtAt: ASOF,
      evidence: [ev('handle', '@alice', 'x'), ev('display_name', 'Alice', 'linkedin')],
      edges: [contactEdge('ct-1', 'contact_of', 'person', 'up-1')],
    });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('Contact Projection — the single projection owner', () => {
  const populated = (): Partial<ContactFacets> => {
    const e = [ev('handle', '@alice', 'x')];
    return {
      identity: facet({ platform: 'x', platformUserId: '12345', handle: '@alice', unifiedPersonId: 'up-1', contactKey: 'x:12345' }, e),
      profile: facet({ displayName: 'Alice', profileUrl: 'https://x.com/alice' }, e),
      channels: facet({ channels: [{ channel: 'dm' as const, verified: true }, { channel: 'mention' as const }] }, e),
    };
  };

  it('reshapes without recomputing — reads decided facet values only', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF, facets: populated() });
    const p = projectContact(u, ASOF);
    expect(p.key).toEqual(KEY);
    expect(p.identity?.handle).toBe('@alice');
    expect(p.profile?.displayName).toBe('Alice');
    expect(p.channels).toEqual(['dm', 'mention']);
    expect(p.projectedAt).toBe(ASOF);
    expect(p.version).toBe(CONTACT_MODEL_VERSION);
  });

  it('surfaces the upward reference to the Canonical Person', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF, facets: populated() });
    expect(projectContact(u, ASOF).unifiedPersonId).toBe('up-1');
  });

  it('normalises an unresolved person to null rather than undefined', () => {
    // An abstained facet and an explicit null both mean "not resolved"; consumers get one check.
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    expect(projectContact(u, ASOF).unifiedPersonId).toBeNull();
  });

  it('derives reachability from channels when the facet abstains', () => {
    const withChannels = buildContactUnderstanding({ key: KEY, builtAt: ASOF, facets: populated() });
    expect(projectContact(withChannels, ASOF).reachable).toBe(true);

    const bare = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    expect(projectContact(bare, ASOF).reachable).toBe(false);
    expect(projectContact(bare, ASOF).channels).toEqual([]);
  });

  it('a decided reachability facet overrides the channel-derived default', () => {
    const e = [ev('blocked', 'true', 'x')];
    const u = buildContactUnderstanding({
      key: KEY, builtAt: ASOF,
      facets: { ...populated(), reachability: facet({ reachable: false, distinctChannels: 0 }, e) },
    });
    expect(projectContact(u, ASOF).reachable).toBe(false);
  });

  it('exposes every dimension and every facet confidence', () => {
    const p = projectContact(buildContactUnderstanding({ key: KEY, builtAt: ASOF }), ASOF);
    expect(Object.keys(p.scores).sort()).toEqual([...CONTACT_SCORE_DIMENSIONS].sort());
    expect(Object.keys(p.facetConfidence).sort()).toEqual([...CONTACT_FACET_NAMES].sort());
  });
});

describe('Contact persistence — shape builders only, no writer', () => {
  it('shadow record carries the tenant and the contact separately', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    const rec = toShadowRecord(u, projectContact(u, ASOF), 0.97);
    expect(rec.company_id).toBe('co-1');
    expect(rec.contact_id).toBe('ct-1');
    expect(rec.parity).toBe(0.97);
    expect(rec.built_at).toBe(ASOF);
    expect(rec.version).toBe(CONTACT_MODEL_VERSION);
  });

  it('legacy fields mirror the columns an adopter already has', () => {
    const e = [ev('handle', '@alice', 'x')];
    const u = buildContactUnderstanding({
      key: KEY, builtAt: ASOF,
      facets: {
        identity: facet({ platform: 'x', platformUserId: '12345', contactKey: 'x:12345', unifiedPersonId: 'up-1' }, e),
        profile: facet({ displayName: 'Alice', profileUrl: 'https://x.com/alice' }, e),
      },
    });
    expect(toLegacyFields(u)).toMatchObject({
      company_id: 'co-1', contact_id: 'ct-1',
      platform: 'x', platform_user_id: '12345', contact_key: 'x:12345',
      display_name: 'Alice', profile_url: 'https://x.com/alice',
      unified_person_id: 'up-1',
    });
  });

  it('legacy fields abstain to null rather than inventing a value', () => {
    const u = buildContactUnderstanding({ key: KEY, builtAt: ASOF });
    const f = toLegacyFields(u);
    expect(f.platform).toBeNull();
    expect(f.platform_user_id).toBeNull();
    expect(f.display_name).toBeNull();
    expect(f.unified_person_id).toBeNull();
    expect(f.reachable).toBe(false);
  });
});

describe('Contact rollout flags — shadow-only', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('both default OFF', () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    delete process.env.CONTACT_UNDERSTANDING_AUTHORITATIVE;
    expect(isContactUnderstandingEnabled()).toBe(false);
    expect(isContactProjectionAuthoritative()).toBe(false);
  });

  it('only the exact string "true" enables', () => {
    process.env.CONTACT_UNDERSTANDING_ENABLED = 'TRUE';
    expect(isContactUnderstandingEnabled()).toBe(false);
    process.env.CONTACT_UNDERSTANDING_ENABLED = 'true';
    expect(isContactUnderstandingEnabled()).toBe(true);
  });
});
