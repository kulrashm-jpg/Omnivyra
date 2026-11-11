/**
 * L-3 — recipient resolution and the consent decision (owner L3-2).
 *
 * Part A drives recheckCommunityRecipient through an in-memory port: exact
 * keys only; ambiguity, missing identity and unreadable state refuse.
 * Part B runs the REAL canonical policy engine (evaluateCanonicalGovernance →
 * mayContact) over a LinkedIn "do not engage" record, so the channel-scoped
 * restriction a social opt-out writes actually blocks.
 */

const mockLoadGovernanceRecords = jest.fn();
// Shaped like the real loader since A2 (contactGovernanceRepository): an answer without
// `reads` has no decision instant and is INDETERMINATE, so the recheck would refuse as
// UNREADABLE for the wrong reason. The stub's rows come back as one read at the moment of
// the call (standing in for the database instant).
const withReads = (r: any) => (r && r.ok && r.reads === undefined
  ? { ...r, reads: [{ anchor: 'target', ok: true, records: r.records, readAt: new Date().toISOString() }] }
  : r);
jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceRepository');
  return { ...actual, loadGovernanceRecords: async (...a: unknown[]) => withReads(await mockLoadGovernanceRecords(...a)) };
});
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('port must be used'); } } }));

import {
  recheckCommunityRecipient,
  type RecipientRecheckPort,
} from '../../services/communityRecipientRecheck';
import { evaluateCanonicalGovernance } from '../../services/prospectIdentity/contactGovernanceEvaluation';

const ORG = 'org-l3';
type Row = Record<string, unknown>;

function port(data: {
  discovered?: Row[]; messages?: Row[]; threads?: Row[]; authors?: Row[]; posts?: Row[]; accounts?: Row[];
  decision?: 'allowed' | 'blocked' | 'deferred'; evaluateFails?: boolean; throwOn?: string;
}): RecipientRecheckPort & { evaluated: unknown[] } {
  const evaluated: unknown[] = [];
  const guard = (name: string, rows: Row[] = []) => async () => {
    if (data.throwOn === name) throw new Error(`${name} unavailable`);
    return rows;
  };
  return {
    evaluated,
    loadDiscoveredUser: guard('discovered', data.discovered),
    loadMessagesByPlatformId: guard('messages', data.messages),
    loadThreads: async (org, ids) => {
      if (data.throwOn === 'threads') throw new Error('threads unavailable');
      return (data.threads ?? []).filter((t) => t.organization_id === org && ids.includes(String(t.id)));
    },
    loadAuthors: guard('authors', data.authors),
    loadOwnPosts: guard('posts', data.posts),
    loadCompanySocialAccounts: async (org) => (data.accounts ?? []).filter((a) => a.company_id === org),
    evaluate: async (req) => {
      evaluated.push(req);
      if (data.evaluateFails) return { ok: false, error: 'read failed' } as any;
      return { ok: true, targetNormalized: req.target, verdict: { decision: data.decision ?? 'allowed', gate: null, governanceType: data.decision === 'blocked' ? 'dnc_channel' : null, recordId: data.decision === 'blocked' ? 'gov-1' : null, matchedBy: 'target', reason: data.decision === 'blocked' ? 'do not engage (linkedin)' : 'allowed' } } as any;
    },
    now: () => '2026-11-03T00:00:00.000Z',
  };
}

const action = (over: Row = {}) => ({
  id: 'a1', organization_id: ORG, platform: 'linkedin', action_type: 'reply',
  target_id: 'urn:li:comment:(urn:li:activity:1,2)', discovered_user_id: null, ...over,
}) as any;

const commentOn = (author = 'au1') => ({
  messages: [{ id: 'm1', thread_id: 'th1', author_id: author, platform: 'linkedin' }],
  threads: [{ id: 'th1', organization_id: ORG, unified_person_id: 'person-1' }],
  authors: [{ id: author, platform: 'linkedin', platform_user_id: 'li-user-AbC' }],
});

describe('Part A — deterministic resolution', () => {
  it('resolves the comment author by exact key and asks the consent store about that recipient', async () => {
    const p = port({ ...commentOn() });
    const r = await recheckCommunityRecipient(action(), p);
    expect(r).toEqual({ ok: true, basis: 'recipient_allowed', recipient: { platform: 'linkedin', platformUserId: 'li-user-AbC', personId: 'person-1' } });
    expect(p.evaluated).toEqual([{ organizationId: ORG, channel: 'linkedin', personId: 'person-1', target: 'li-user-AbC', now: '2026-11-03T00:00:00.000Z' }]);
  });

  it('an opt-out recorded for that recipient refuses (RECIPIENT_RESTRICTED)', async () => {
    const r = await recheckCommunityRecipient(action(), port({ ...commentOn(), decision: 'blocked' }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_RESTRICTED', governance: { decision: 'blocked', governanceType: 'dnc_channel', recordId: 'gov-1' } });
  });

  it('a deferral also refuses — only an explicit "allowed" proceeds', async () => {
    const r = await recheckCommunityRecipient(action(), port({ ...commentOn(), decision: 'deferred' }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_RESTRICTED' });
  });

  it('messages in ANOTHER tenant\'s thread are ignored (no cross-tenant recipient)', async () => {
    const r = await recheckCommunityRecipient(action(), port({
      messages: [{ id: 'm1', thread_id: 'th-other', author_id: 'au1', platform: 'linkedin' }],
      threads: [{ id: 'th-other', organization_id: 'org-other' }],
      authors: [{ id: 'au1', platform: 'linkedin', platform_user_id: 'li-user-AbC' }],
    }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });

  it('two different authors behind the same target id → RECIPIENT_AMBIGUOUS, no first-result fallback', async () => {
    const r = await recheckCommunityRecipient(action(), port({
      messages: [
        { id: 'm1', thread_id: 'th1', author_id: 'au1', platform: 'linkedin' },
        { id: 'm2', thread_id: 'th2', author_id: 'au2', platform: 'linkedin' },
      ],
      threads: [{ id: 'th1', organization_id: ORG }, { id: 'th2', organization_id: ORG }],
      authors: [{ id: 'au1', platform: 'linkedin', platform_user_id: 'x' }, { id: 'au2', platform: 'linkedin', platform_user_id: 'y' }],
    }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_AMBIGUOUS' });
  });

  it('a message whose author has no platform identifier → RECIPIENT_UNRESOLVED', async () => {
    const r = await recheckCommunityRecipient(action(), port({ ...commentOn(), authors: [{ id: 'au1', platform: 'linkedin', platform_user_id: '' }] }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });

  it('an unknown target that is not the tenant\'s own post → RECIPIENT_UNRESOLVED (nothing is guessed)', async () => {
    const p = port({});
    const r = await recheckCommunityRecipient(action({ target_id: 'urn:li:activity:999' }), p);
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
    expect(p.evaluated).toEqual([]);
  });

  it('the tenant\'s own published post has no third-party recipient → allowed as own_content', async () => {
    const r = await recheckCommunityRecipient(action({ action_type: 'like', target_id: 'urn:li:share:7' }), port({
      posts: [{ id: 'p1', social_account_id: 'sa1', platform: 'linkedin' }],
      accounts: [{ id: 'sa1', company_id: ORG }],
    }));
    expect(r).toEqual({ ok: true, basis: 'own_content', recipient: null });
  });

  it('a post published through ANOTHER company\'s account is not "own content"', async () => {
    const r = await recheckCommunityRecipient(action({ action_type: 'like', target_id: 'urn:li:share:7' }), port({
      posts: [{ id: 'p1', social_account_id: 'sa9', platform: 'linkedin' }],
      accounts: [{ id: 'sa9', company_id: 'org-other' }],
    }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });

  it('explicit discovered user: exact tenant + platform row is the recipient', async () => {
    const r = await recheckCommunityRecipient(action({ discovered_user_id: 'du1', target_id: null }), port({
      discovered: [{ id: 'du1', organization_id: ORG, platform: 'linkedin', external_user_id: 'li-du', eligible_for_engagement: true }],
    }));
    expect(r).toMatchObject({ ok: true, recipient: { platformUserId: 'li-du' } });
  });

  it('a discovered user marked not eligible for engagement is refused', async () => {
    const r = await recheckCommunityRecipient(action({ discovered_user_id: 'du1' }), port({
      discovered: [{ id: 'du1', organization_id: ORG, platform: 'linkedin', external_user_id: 'li-du', eligible_for_engagement: false, blocked_reason: 'operator block' }],
    }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_ELIGIBLE' });
  });

  it('a discovered user on another platform does not resolve', async () => {
    const r = await recheckCommunityRecipient(action({ discovered_user_id: 'du1', target_id: null }), port({
      discovered: [{ id: 'du1', organization_id: ORG, platform: 'x', external_user_id: 'x-du' }],
    }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });

  it.each(['messages', 'threads', 'authors', 'posts', 'discovered'])('a failed %s read refuses (RECIPIENT_STATE_UNREADABLE)', async (which) => {
    const r = await recheckCommunityRecipient(
      action(which === 'discovered' ? { discovered_user_id: 'du1' } : which === 'posts' ? { target_id: 'urn:li:share:7' } : {}),
      // For the posts read, the target must match no message, so resolution
      // actually reaches the own-content lookup.
      port(which === 'posts' ? { throwOn: which } : { ...commentOn(), throwOn: which }),
    );
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_STATE_UNREADABLE' });
  });

  it('an unreadable consent store refuses (fail closed)', async () => {
    const r = await recheckCommunityRecipient(action(), port({ ...commentOn(), evaluateFails: true }));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_STATE_UNREADABLE' });
  });

  it('no tenant or platform → refused', async () => {
    expect(await recheckCommunityRecipient(action({ organization_id: '' }), port({}))).toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });
});

describe('Part B — the real policy engine blocks a LinkedIn "do not engage" record', () => {
  // The shape loadGovernanceRecords returns (GovernanceRecord). The target is
  // casefolded by the repository for a non-email/phone channel.
  const record = (over: Row = {}) => ({
    id: 'gov-li-1', organizationId: ORG, personId: null, targetNormalized: 'li-user-abc',
    channel: 'linkedin', governanceType: 'dnc_channel', purposeScope: null,
    effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveUntil: null, revokedAt: null, ...over,
  });
  const realPort = (records: Row[]) => {
    mockLoadGovernanceRecords.mockResolvedValue({ ok: true, records });
    return { ...port({ ...commentOn() }), evaluate: evaluateCanonicalGovernance };
  };

  it('dnc_channel on channel=linkedin for this recipient → blocked by the canonical engine', async () => {
    const r = await recheckCommunityRecipient(action(), realPort([record()]));
    expect(r).toMatchObject({ ok: false, code: 'RECIPIENT_RESTRICTED', governance: { decision: 'blocked', recordId: 'gov-li-1' } });
  });

  it('a revoked restriction no longer blocks', async () => {
    const r = await recheckCommunityRecipient(action(), realPort([record({ revokedAt: '2026-11-02T00:00:00.000Z' })]));
    expect(r).toMatchObject({ ok: true });
  });

  it('no record → allowed for an IDENTIFIED recipient (absence is not consent for an unidentified one)', async () => {
    expect(await recheckCommunityRecipient(action(), realPort([]))).toMatchObject({ ok: true, basis: 'recipient_allowed' });
    expect(await recheckCommunityRecipient(action({ target_id: 'urn:li:activity:unknown' }), { ...realPort([]), loadMessagesByPlatformId: async () => [] }))
      .toMatchObject({ ok: false, code: 'RECIPIENT_UNRESOLVED' });
  });
});
