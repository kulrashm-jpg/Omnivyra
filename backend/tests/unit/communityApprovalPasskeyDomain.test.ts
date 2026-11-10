/**
 * Prompt 3 (community passkey) — domain separation of the D-02 approval challenge.
 *
 * (a) GOLDEN: the outreach digest (no `subject`) is pinned to the bytes the pre-extension
 *     code produced, so the community extension cannot move it.
 * (b) The same binding under subject 'community_action' digests differently, and an
 *     assertion made for one domain never verifies in the other.
 * (c) `subject` is an allow-list: any other value throws, never defaults.
 * (d) 48 bytes, unchanged.
 */

const mockPk = {
  challenges: new Map<string, { userId: string | null; expiresAt: number; consumed: boolean }>(),
  verifyCalls: 0,
};
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({
  beginAuthentication: async (input: { userId: string | null; challenge?: Uint8Array }) => {
    const bytes = input.challenge ? Buffer.from(input.challenge) : require('crypto').randomBytes(32);
    const challenge = Buffer.from(bytes).toString('base64url');
    mockPk.challenges.set(challenge, { userId: input.userId, expiresAt: Date.now() + 300_000, consumed: false });
    return { options: { challenge, rpId: 'test' } };
  },
  verifyAuthentication: async (input: { userId: string; response: { response: { clientDataJSON: string; signature: string } } }) => {
    mockPk.verifyCalls += 1;
    const challenge = JSON.parse(Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    const stored = mockPk.challenges.get(challenge);
    if (!stored) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'NOT_FOUND' };
    if (stored.consumed) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'ALREADY_CONSUMED' };
    stored.consumed = true;
    if (input.response.response.signature !== 'valid') return { ok: false, reason: 'VERIFICATION_FAILED' };
    return { ok: true, result: { userId: input.userId } };
  },
}));

import {
  approvalChallengeBytes,
  beginApprovalPasskey,
  verifyApprovalPasskey,
} from '../../services/leadOutreachExecution/approvalPasskey';

const USER = '00000000-0000-4000-8000-0000000000a1';
const ORG = '00000000-0000-4000-8000-0000000000b1';
const TASK = '00000000-0000-4000-8000-0000000000c1';
const binding = (over: Record<string, unknown> = {}) => ({
  userId: USER, organizationId: ORG, taskId: TASK, action: 'approve' as const, bindingHash: 'a'.repeat(64), ...over,
});
const assertion = (challenge: string, signature = 'valid') => ({
  id: 'cred-1', rawId: 'cred-1', type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'), signature, authenticatorData: 'x' },
  clientExtensionResults: {},
});

/** Computed from approvalPasskey.ts BEFORE the subject extension (D1 0679a5908). */
const GOLDEN_OUTREACH_HEX =
  '01010101010101010101010101010101' + '3d462f202fe43c8a2c1ff81f87614b67246ce5194ccfbcbad05afd2941d59ba1';

beforeEach(() => { mockPk.challenges.clear(); mockPk.verifyCalls = 0; });

describe('approval challenge — outreach golden vector', () => {
  it('the outreach digest (no subject) is byte-identical to the pre-extension code', () => {
    const bytes = approvalChallengeBytes(Buffer.alloc(16, 1), binding() as any);
    expect(bytes).toHaveLength(48);
    expect(bytes.toString('hex')).toBe(GOLDEN_OUTREACH_HEX);
  });

  it('subject undefined is the outreach domain (explicitly absent key is the same as no key)', () => {
    const bytes = approvalChallengeBytes(Buffer.alloc(16, 1), binding({ subject: undefined }) as any);
    expect(bytes.toString('hex')).toBe(GOLDEN_OUTREACH_HEX);
  });
});

describe('approval challenge — community domain separation', () => {
  it('the same binding under subject community_action digests differently, still 48 bytes', () => {
    const nonce = Buffer.alloc(16, 1);
    const outreach = approvalChallengeBytes(nonce, binding() as any);
    const community = approvalChallengeBytes(nonce, binding({ subject: 'community_action' }) as any);
    expect(community).toHaveLength(48);
    expect(community.subarray(0, 16)).toEqual(nonce);
    expect(community.equals(outreach)).toBe(false);
  });

  it.each([['outreach_task'], ['Community_Action'], [''], [null], [1], [{}]])(
    'any subject other than community_action is refused (throws), never defaulted: %p',
    (subject) => {
      expect(() => approvalChallengeBytes(Buffer.alloc(16, 1), binding({ subject }) as any)).toThrow();
    },
  );

  it('an outreach assertion fails to verify as community, without burning the challenge', async () => {
    const options = await beginApprovalPasskey(binding() as any);
    const c = String(options.challenge);
    const asCommunity = await verifyApprovalPasskey(binding({ subject: 'community_action' }) as any, assertion(c));
    expect(asCommunity).toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
    expect(mockPk.verifyCalls).toBe(0);
    expect(await verifyApprovalPasskey(binding() as any, assertion(c))).toMatchObject({ ok: true });
  });

  it('a community assertion fails to verify as outreach, and verifies as community', async () => {
    const options = await beginApprovalPasskey(binding({ subject: 'community_action' }) as any);
    const c = String(options.challenge);
    expect(await verifyApprovalPasskey(binding() as any, assertion(c))).toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
    expect(mockPk.verifyCalls).toBe(0);
    const ok = await verifyApprovalPasskey(binding({ subject: 'community_action' }) as any, assertion(c));
    expect(ok).toMatchObject({ ok: true, proof: { taskId: TASK, subject: 'community_action' } });
  });

  it('a community proof is never redeemable as an outreach approval (and is burnt by the attempt)', async () => {
    const { redeemApprovalPasskeyProof } = require('../../services/leadOutreachExecution/approvalPasskey');
    const c = String((await beginApprovalPasskey(binding({ subject: 'community_action' }) as any)).challenge);
    const r = await verifyApprovalPasskey(binding({ subject: 'community_action' }) as any, assertion(c));
    expect(r.ok).toBe(true);
    const proof = (r as any).proof;
    const asOutreach = redeemApprovalPasskeyProof(proof, { userId: USER, organizationId: ORG, taskId: TASK, bindingHash: 'a'.repeat(64) });
    expect(asOutreach.ok).toBe(false);
    expect(redeemApprovalPasskeyProof(proof, { userId: USER, organizationId: ORG, taskId: TASK, bindingHash: 'a'.repeat(64), subject: 'community_action' }).ok).toBe(false);
  });

  it('a community proof redeems once for the community binding', async () => {
    const { redeemApprovalPasskeyProof } = require('../../services/leadOutreachExecution/approvalPasskey');
    const c = String((await beginApprovalPasskey(binding({ subject: 'community_action' }) as any)).challenge);
    const r = await verifyApprovalPasskey(binding({ subject: 'community_action' }) as any, assertion(c));
    const exp = { userId: USER, organizationId: ORG, taskId: TASK, bindingHash: 'a'.repeat(64), subject: 'community_action' as const };
    expect(redeemApprovalPasskeyProof((r as any).proof, exp)).toMatchObject({ ok: true, credentialId: 'cred-1' });
    expect(redeemApprovalPasskeyProof((r as any).proof, exp).ok).toBe(false);
  });

  it('verifyApprovalPasskey never throws on an unknown subject', async () => {
    const c = String((await beginApprovalPasskey(binding() as any)).challenge);
    await expect(verifyApprovalPasskey(binding({ subject: 'x' }) as any, assertion(c))).resolves.toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
  });

  it('beginApprovalPasskey refuses an unknown subject before any challenge is issued', async () => {
    await expect(beginApprovalPasskey(binding({ subject: 'other' }) as any)).rejects.toThrow();
    expect(mockPk.challenges.size).toBe(0);
  });
});
