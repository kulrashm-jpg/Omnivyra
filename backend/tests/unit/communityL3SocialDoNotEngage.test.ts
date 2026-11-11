/**
 * L3-1 — the social "do not engage" writer, end to end against the L-3 recheck.
 *
 * The PI canonical writer runs for real over a captured insert; the stored
 * row is then fed to the REAL policy engine through the L-3 recheck, proving a
 * restriction written after approval blocks the action.
 */
const inserted: Record<string, any>[] = [];
let insertError: { code: string; message: string } | null = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    insert: (row: Record<string, any>) => ({
      select: () => ({
        single: async () => {
          if (insertError) return { data: null, error: insertError };
          inserted.push(row);
          return { data: { id: `gov-${inserted.length}` }, error: null };
        },
      }),
    }),
  }),
}));
const mockLoad = jest.fn();
// Shaped like the real loader since A2 (contactGovernanceRepository): an answer without
// `reads` has no decision instant and is INDETERMINATE, so the recheck would refuse as
// UNREADABLE for the wrong reason. The stub's rows come back as one read at the moment of
// the call (standing in for the database instant).
const withReads = (r: any) => (r && r.ok && r.reads === undefined
  ? { ...r, reads: [{ anchor: 'target', ok: true, records: r.records, readAt: new Date().toISOString() }] }
  : r);
jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceRepository');
  return { ...actual, loadGovernanceRecords: async (...a: unknown[]) => withReads(await mockLoad(...a)) };
});
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('unused'); } } }));

import { recordSocialDoNotEngage, SOCIAL_DO_NOT_ENGAGE_SOURCE } from '../../services/communitySocialDoNotEngage';
import { recheckCommunityRecipient, type RecipientRecheckPort } from '../../services/communityRecipientRecheck';
import { evaluateCanonicalGovernance } from '../../services/prospectIdentity/contactGovernanceEvaluation';

const ORG = 'org-dne';
const base = { organizationId: ORG, platform: 'linkedin', platformUserId: 'ACoAABxYz-Case', actorUserId: 'user-op-1', reasonCode: 'requested_no_contact' };

beforeEach(() => { inserted.length = 0; insertError = null; mockLoad.mockReset(); });

describe('what the record preserves', () => {
  it('writes one canonical dnc_channel record with every required field', async () => {
    const r = await recordSocialDoNotEngage({ ...base, personId: 'person-9', sourceRecordId: 'src-1', effectiveFrom: '2026-11-03T10:00:00.000Z' });
    expect(r).toEqual({ id: 'gov-1', outcome: 'created' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organization_id: ORG,                     // tenant
      person_id: 'person-9',                    // person
      channel: 'linkedin',                      // platform
      target_raw: 'ACoAABxYz-Case',             // exact platform recipient identifier
      target_normalized: 'acoaabxyz-case',      // matching form (casefold — contract gap G2)
      governance_type: 'dnc_channel',           // restriction type
      source: SOCIAL_DO_NOT_ENGAGE_SOURCE,      // source
      source_record_id: 'src-1',
      effective_from: '2026-11-03T10:00:00.000Z', // timestamp
      evidence: { actor_user_id: 'user-op-1', reason_code: 'requested_no_contact', recipient_identifier_kind: 'platform_user_id' }, // actor + evidence
    });
    expect(inserted[0]).not.toHaveProperty('purpose_scope'); // unscoped = every purpose (gap G3)
  });

  it.each([
    ['unsupported platform', { platform: 'tiktok' }, 'platform_unsupported'],
    ['a display name instead of an id', { platformUserId: 'Jane Doe' }, 'recipient_identifier_invalid'],
    ['a profile URL instead of an id', { platformUserId: 'https://www.linkedin.com/in/jane' }, 'recipient_identifier_invalid'],
    ['blank id', { platformUserId: '  ' }, 'recipient_identifier_invalid'],
    ['no actor', { actorUserId: '' }, 'actor_required'],
    ['free-text reason', { reasonCode: 'She asked us to stop!' }, 'reason_code_invalid'],
  ])('refuses %s, writing nothing', async (_l, over, code) => {
    await expect(recordSocialDoNotEngage({ ...base, ...(over as any) })).rejects.toMatchObject({ code });
    expect(inserted).toEqual([]);
  });

  it('a cross-tenant person is refused by the database guard (composite FK)', async () => {
    insertError = { code: '23503', message: 'fk' };
    await expect(recordSocialDoNotEngage({ ...base, personId: 'person-of-other-tenant' })).rejects.toMatchObject({ code: 'cross_tenant_reference' });
  });
});

describe('written after approval → the L-3 recheck blocks the action', () => {
  const port = (): RecipientRecheckPort => ({
    loadDiscoveredUser: async () => [],
    loadMessagesByPlatformId: async () => [{ id: 'm1', thread_id: 'th1', author_id: 'au1', platform: 'linkedin' }],
    loadThreads: async () => [{ id: 'th1', organization_id: ORG, unified_person_id: null }],
    loadAuthors: async () => [{ id: 'au1', platform: 'linkedin', platform_user_id: 'ACoAABxYz-Case' }],
    loadOwnPosts: async () => [],
    loadCompanySocialAccounts: async () => [],
    evaluate: evaluateCanonicalGovernance,
    now: () => '2026-11-03T12:00:00.000Z',
  });
  const action = { id: 'a1', organization_id: ORG, platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:comment:1' } as any;
  const asStored = (row: Record<string, any>, id: string) => ({
    id, organizationId: row.organization_id, personId: row.person_id ?? null, targetNormalized: row.target_normalized,
    channel: row.channel, governanceType: row.governance_type, purposeScope: row.purpose_scope ?? null,
    effectiveFrom: row.effective_from ?? '2026-11-03T10:00:00.000Z', effectiveUntil: null, revokedAt: null,
  });

  it('before the restriction: allowed; after: RECIPIENT_RESTRICTED by that record', async () => {
    mockLoad.mockResolvedValue({ ok: true, records: [] });
    expect(await recheckCommunityRecipient(action, port())).toMatchObject({ ok: true });

    await recordSocialDoNotEngage({ ...base, effectiveFrom: '2026-11-03T10:00:00.000Z' });
    mockLoad.mockResolvedValue({ ok: true, records: [asStored(inserted[0], 'gov-1')] });
    const r = await recheckCommunityRecipient(action, port());
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_RESTRICTED', governance: { decision: 'blocked', recordId: 'gov-1' } });
  });
});
