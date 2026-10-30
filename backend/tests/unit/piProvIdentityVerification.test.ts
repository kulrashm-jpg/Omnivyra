/**
 * Workstream B — no person from a bare social handle (owner decision 2, 2026-10-30).
 *
 *   - the shared verification rule (bridge/verifiedIdentity.ts)
 *   - the Lead Intelligence adoption identity port (leadIntelligencePorts.ts)
 *   - the bridge with its REAL production deps over a PostgREST double:
 *     no unified_persons / identity_claims write, prospect without a person,
 *     evidence preserved
 *   - later verification links the person to the EXISTING prospect (acceptance #4)
 *   - cross-tenant isolation of the same handle
 */
import { makeWorld, makeFakeDb, feedItem, listeningSignal, ORG_A, ORG_B, type DbOp } from './piProvBridge.helpers';

const mockDbRef: { current: ReturnType<typeof makeFakeDb> | null } = { current: null };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDbRef.current!.table(t),
  ownedDbRpc: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDbRef.current!.table(t), rpc: jest.fn() },
}));
jest.mock('../../services/identityResolutionService', () => {
  const actual = jest.requireActual('../../services/identityResolutionService');
  return { ...actual, resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'up-email', matchedBy: 'email', created: false })) };
});

import { resolveUnifiedPerson } from '../../services/identityResolutionService';
import {
  resolveVerifiedSocialPerson,
  socialHandlePairs,
  hasSocialIdentifier,
  hasContactEvidence,
  normalizedSocialIdentity,
} from '../../services/prospectProvenance/bridge/verifiedIdentity';
import { createUnifiedPersonIdentityPort, createInMemorySink, VERIFIED_SOCIAL_MATCH } from '../../services/leadIntelligence/leadIntelligencePorts';
import { createLeadIntelligenceIngestor } from '../../services/leadIntelligence/leadIntelligenceFacade';
import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { bridgeCommunityFeedItem, withCommunityAuthorIdentity, resetBridgeCounters } from '../../services/prospectProvenance/communityBridge';
import { defaultBridgeDeps } from '../../services/prospectProvenance/bridge/defaultDeps';

const resolvePersonMock = resolveUnifiedPerson as jest.Mock;
const PERSON_TABLES = ['unified_persons', 'identity_claims'];
const writesTo = (ops: DbOp[], table: string) => ops.filter((o) => o.table === table && o.op !== 'select');

/** identity_claims rows the double answers with: [{org, platform, value, personId}] (active, linked). */
function claimsDb(claims: Array<{ org: string; platform: string; value: string; personId: string }>, extra?: (op: DbOp) => { data: unknown; error: unknown } | null) {
  let seq = 0;
  return makeFakeDb((op, terminal) => {
    const custom = extra?.(op);
    if (custom) return custom;
    const f = (k: string) => op.filters.find(([fk]) => fk === k)?.[1];
    if (op.table === 'identity_claims' && op.op === 'select') {
      const rows = claims.filter((c) => c.org === f('organization_id') && c.platform === f('platform') && c.value === f('normalized_value'));
      return { data: rows.map((r) => ({ person_id: r.personId })), error: null };
    }
    if (op.op === 'insert' || op.op === 'upsert') {
      const row = { ...(op.payload as object), id: `${op.table}-${++seq}` };
      return { data: terminal === 'many' ? [row] : row, error: null };
    }
    return { data: terminal === 'many' ? [] : null, error: null };
  });
}

beforeEach(() => { resolvePersonMock.mockClear(); resetBridgeCounters(); });

describe('verification rule (verifiedIdentity.ts)', () => {
  it('extracts only <platform>:user string keys; contact_id counts as a social identifier', () => {
    expect(socialHandlePairs({ 'reddit:user': ' u_alice ', anonymous_id: 'a', 'x:user': 7, apollo: { external_id: '1' } }))
      .toEqual([{ platform: 'reddit', platformUserId: 'u_alice' }]);
    expect(hasSocialIdentifier({ contact_id: 'c1' })).toBe(true);
    expect(hasSocialIdentifier({ anonymous_id: 'a' })).toBe(false);
    expect(hasContactEvidence(' ', null)).toBe(false);
    expect(hasContactEvidence('A@B.com', null)).toBe(true);
    expect(normalizedSocialIdentity('LinkedIn', '@Bob')).toEqual({ platform: 'linkedin', platformUserId: 'bob' });
  });

  it('exactly one linked claim ⇒ verified; none ⇒ unverified; two ⇒ ambiguous (never picks)', async () => {
    const lookup = (ids: string[], outcome: string) => async () => ({ personId: ids.length === 1 ? ids[0] : null, outcome, candidatePersonIds: ids });
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: 'reddit', platformUserId: 'u' }], lookup(['p1'], 'matched_claim')))
      .resolves.toMatchObject({ status: 'verified', personId: 'p1', reason: 'linked_identity_claim' });
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: 'reddit', platformUserId: 'u' }], lookup([], 'unresolved')))
      .resolves.toMatchObject({ status: 'unverified', personId: null, reason: 'unresolved' });
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: 'reddit', platformUserId: 'u' }], lookup(['p1', 'p2'], 'ambiguous')))
      .resolves.toMatchObject({ status: 'unverified', personId: null, reason: 'ambiguous', candidateCount: 2 });
    // a spine match is not a handle verification
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: 'reddit', platformUserId: 'u' }], lookup(['p1'], 'matched_spine')))
      .resolves.toMatchObject({ status: 'unverified' });
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: '', platformUserId: 'u' }], lookup(['p1'], 'matched_claim')))
      .resolves.toMatchObject({ status: 'unverified', reason: 'unusable' });
  });

  it('the default lookup reads ONLY linked, active claims, tenant-scoped, and writes nothing', async () => {
    mockDbRef.current = claimsDb([{ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-a' }]);
    await expect(resolveVerifiedSocialPerson(ORG_A, [{ platform: 'Reddit', platformUserId: 'U_Alice' }])).resolves.toMatchObject({ status: 'verified', personId: 'p-a' });
    await expect(resolveVerifiedSocialPerson(ORG_B, [{ platform: 'reddit', platformUserId: 'u_alice' }])).resolves.toMatchObject({ status: 'unverified' });
    const claimReads = mockDbRef.current.ops.filter((o) => o.table === 'identity_claims');
    expect(claimReads.length).toBeGreaterThan(0);
    for (const o of claimReads) {
      expect(o.op).toBe('select');
      expect(o.filters).toEqual(expect.arrayContaining([['revoked_at', null], ['claim_type', 'external_id']]));
    }
    for (const t of PERSON_TABLES) expect(writesTo(mockDbRef.current.ops, t)).toEqual([]);
  });
});

describe('adoption identity port: never creates a person from a bare handle', () => {
  function ingestorWithDefaultPort() {
    const { sink, emitted } = createInMemorySink();
    return { ingestor: createLeadIntelligenceIngestor({ sink, identity: createUnifiedPersonIdentityPort(), now: () => 't' }), emitted };
  }

  it('unverified community author ⇒ lead WITHOUT a person, handle kept as evidence, no person write', async () => {
    mockDbRef.current = claimsDb([]);
    const { ingestor, emitted } = ingestorWithDefaultPort();
    await adoptLeadAsync('community', withCommunityAuthorIdentity(feedItem(ORG_A)), ingestor);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].unifiedPersonId).toBeNull();
    expect(emitted[0].identity).toMatchObject({ platform: 'reddit', platformUserId: 'u_alice' });
    expect(emitted[0].identity.externalKeys).toMatchObject({ 'reddit:user': 'u_alice' });
    expect(emitted[0].sourceRef).toEqual({ table: 'opportunity_feed_items', id: 'feed-1' });
    expect(resolvePersonMock).not.toHaveBeenCalled();
    for (const t of PERSON_TABLES) expect(writesTo(mockDbRef.current.ops, t)).toEqual([]);
  });

  it('unverified engagement author (handle + contact_id) ⇒ no person, no resolveUnifiedPerson', async () => {
    mockDbRef.current = claimsDb([]);
    const { ingestor, emitted } = ingestorWithDefaultPort();
    await adoptLeadAsync('engagement', { id: 's1', organization_id: ORG_A, source_type: 'engagement', platform: 'linkedin', platform_user_id: 'li_bob', contact_id: 'c9', intent_score: 0.9 }, ingestor);
    expect(emitted[0].unifiedPersonId).toBeNull();
    expect(emitted[0].identity).toMatchObject({ platform: 'linkedin', platformUserId: 'li_bob', contactId: 'c9' });
    expect(resolvePersonMock).not.toHaveBeenCalled();
  });

  it('a verified handle links to the EXISTING person (read-only), matchedBy verified_identity_claim', async () => {
    mockDbRef.current = claimsDb([{ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-known' }]);
    const { ingestor, emitted } = ingestorWithDefaultPort();
    await adoptLeadAsync('community', withCommunityAuthorIdentity(feedItem(ORG_A)), ingestor);
    expect(emitted[0]).toMatchObject({ unifiedPersonId: 'p-known', identityMatchedBy: VERIFIED_SOCIAL_MATCH });
    expect(resolvePersonMock).not.toHaveBeenCalled();
    for (const t of PERSON_TABLES) expect(writesTo(mockDbRef.current.ops, t)).toEqual([]);
  });

  it('contact evidence (email) still goes through W1 exactly as before', async () => {
    mockDbRef.current = claimsDb([]);
    const { ingestor, emitted } = ingestorWithDefaultPort();
    await adoptLeadAsync('website', { id: 'l1', company_id: ORG_A, email: 'a@b.com', source: 'form_embed' }, ingestor);
    expect(resolvePersonMock).toHaveBeenCalledTimes(1);
    expect(emitted[0].unifiedPersonId).toBe('up-email');
  });

  it('a non-social key (anonymous_id) keeps the existing W1 path (outside the decision)', async () => {
    const resolvePerson = jest.fn(async () => ({ unifiedPersonId: 'up-anon', matchedBy: 'created' as const, created: true }));
    const verifySocial = jest.fn();
    const port = createUnifiedPersonIdentityPort({ resolvePerson, verifySocial });
    await expect(port.resolve({ organizationId: ORG_A, externalKeys: { anonymous_id: 'anon-1' } })).resolves.toMatchObject({ unifiedPersonId: 'up-anon' });
    expect(verifySocial).not.toHaveBeenCalled();
  });

  it('same handle in two tenants: verified only where the tenant holds the claim', async () => {
    mockDbRef.current = claimsDb([{ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-a' }]);
    const { ingestor, emitted } = ingestorWithDefaultPort();
    await adoptLeadAsync('community', withCommunityAuthorIdentity(feedItem(ORG_A)), ingestor);
    await adoptLeadAsync('community', withCommunityAuthorIdentity(feedItem(ORG_B, { id: 'feed-b' })), ingestor);
    expect(emitted.map((l) => [l.organizationId, l.unifiedPersonId])).toEqual([[ORG_A, 'p-a'], [ORG_B, null]]);
  });
});

describe('bridge with its REAL production deps (PostgREST double): acceptance #3', () => {
  it('unverified handle ⇒ prospect without a person; no unified_persons / identity_claims write; evidence preserved', async () => {
    const contributions: Array<Record<string, unknown>> = [];
    const sourceRecords: Array<Record<string, unknown>> = [];
    mockDbRef.current = claimsDb([], (op) => (op.table === 'lead_signals' && op.op === 'select'
      ? { data: listeningSignal(ORG_A), error: null } : null));
    const real = defaultBridgeDeps();
    const deps = {
      ...real,
      gate: async () => ({ allowed: true, reason: 'tenant_flag:test' }),
      // LI-2 and the provenance writer are exercised by their own suites; captured here.
      ingestSourceRecord: async (input: Record<string, unknown>) => { sourceRecords.push(input); return { sourceRecordId: 'src-1' }; },
      recordContribution: async (input: Record<string, unknown>) => { contributions.push(input); return { status: 'inserted' as const, id: 'psc-1', role: 'originating' as const, roleDowngraded: false }; },
    } as unknown as typeof real;

    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), deps);
    expect(out).toMatchObject({ status: 'bridged', identityStatus: 'unverified', personId: null, prospectPath: 'created' });

    const ops = mockDbRef.current.ops;
    for (const t of PERSON_TABLES) expect(writesTo(ops, t)).toEqual([]);
    expect(resolvePersonMock).not.toHaveBeenCalled();
    const leadInsert = ops.find((o) => o.table === 'canonical_leads' && o.op === 'insert');
    expect(leadInsert?.payload).toMatchObject({
      company_id: ORG_A, unified_person_id: null, external_lead_key: 'community:feed-1', source: 'community',
      lead_metadata: expect.objectContaining({ sourceIdentity: { platform: 'reddit', platformUserId: 'u_alice' }, identityStatus: 'unverified' }),
    });
    // handle lookup is tenant-scoped and keyed by the normalised identity
    const handleRead = ops.find((o) => o.table === 'canonical_leads' && o.filters.some(([k]) => k === 'contains:lead_metadata'));
    expect(handleRead?.filters).toEqual(expect.arrayContaining([['company_id', ORG_A], ['contains:lead_metadata', { sourceIdentity: { platform: 'reddit', platformUserId: 'u_alice' } }]]));

    expect(sourceRecords[0]).toMatchObject({ organizationId: ORG_A, personId: null, provider: 'community', sourceRecordId: 'feed-1' });
    expect((sourceRecords[0].rawPayload as Record<string, Record<string, unknown>>).opportunity_feed_item.author_metadata).toMatchObject({ platform_user_id: 'u_alice', author_handle: 'alice' });
    expect(contributions[0]).toMatchObject({
      organizationId: ORG_A, platform: 'reddit', sourceUrl: 'https://reddit.com/r/saas/comments/abc',
      observedAt: '2026-10-29T09:00:00.000Z', opportunityFeedItemId: 'feed-1', leadSignalId: 'sig-1', contactId: 'contact-1',
    });
    expect(contributions[0].evidence).toMatchObject({
      sourceIdentity: { platform: 'reddit', platformUserId: 'u_alice', authorHandle: 'alice' },
      identityVerification: { status: 'unverified' },
    });
  });
});

describe('acceptance #4: later verification links the person to the existing prospect', () => {
  it('replay of the same item after verification attaches the person; no second prospect', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const first = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(first).toMatchObject({ personId: null, identityStatus: 'unverified' });

    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-verified' });
    const again = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(again).toMatchObject({ prospectId: first.prospectId, prospectPath: 'own_key', identityStatus: 'verified', personId: 'p-verified', personAttached: true });
    expect(w.prospects).toHaveLength(1);
    expect(w.prospects[0].personId).toBe('p-verified');
  });

  it('a NEW item by the now-verified author joins the handle-anchored prospect and attaches the person', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const first = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-verified' });
    const second = await bridgeCommunityFeedItem(feedItem(ORG_A, { id: 'feed-2', signal_id: 'sig-2' }), w.deps);
    expect(second).toMatchObject({ prospectId: first.prospectId, prospectPath: 'existing_handle', contributionRole: 'contributing', personAttached: true });
    // and from then on the person path finds it
    const third = await bridgeCommunityFeedItem(feedItem(ORG_A, { id: 'feed-3', signal_id: 'sig-3' }), w.deps);
    expect(third).toMatchObject({ prospectId: first.prospectId, prospectPath: 'existing_person' });
    expect(w.prospects).toHaveLength(1);
  });

  it('a prospect already anchored to a different person is never re-anchored', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.prospects.push({ id: 'lead-x', org: ORG_A, key: 'community:feed-1', personId: 'p-other', source: 'community', metadata: {} });
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-verified' });
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(out).toMatchObject({ prospectId: 'lead-x', personAttached: false });
    expect(w.prospects[0].personId).toBe('p-other');
  });

  it('a revoked or unlinked claim does not verify', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p1', revokedAt: '2026-10-01T00:00:00Z' });
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: null });
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(out).toMatchObject({ identityStatus: 'unverified', personId: null });
  });
});

describe('cross-tenant isolation of the same handle', () => {
  it('two tenants get separate handle-only prospects; a claim in one tenant verifies nothing in the other', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.gateOpen.add(ORG_B);
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'u_alice', personId: 'p-a' });
    const a = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    const b = await bridgeCommunityFeedItem(feedItem(ORG_B, { id: 'feed-b', signal_id: null }), w.deps);
    expect(a).toMatchObject({ identityStatus: 'verified', personId: 'p-a' });
    expect(b).toMatchObject({ identityStatus: 'unverified', personId: null, prospectPath: 'created' });
    expect(a.prospectId).not.toBe(b.prospectId);
    // a second ORG_B item joins ORG_B's prospect, never ORG_A's
    const b2 = await bridgeCommunityFeedItem(feedItem(ORG_B, { id: 'feed-b2', signal_id: null }), w.deps);
    expect(b2).toMatchObject({ prospectId: b.prospectId, prospectPath: 'existing_handle' });
    expect(w.prospects.filter((p) => p.org === ORG_B)).toHaveLength(1);
  });
});
