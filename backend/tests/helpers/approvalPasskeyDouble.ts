/**
 * D-02 — how a test approves an external-channel outreach task.
 *
 * The approval writer accepts only a proof that `verifyApprovalPasskey` issued (S-02), and
 * production code has no test seam around that. So tests go through the REAL
 * `beginApprovalPasskey` → `verifyApprovalPasskey` → `approveOutreachTask` path, with the
 * WebAuthn ceremony replaced by `webauthnDouble`: a faithful in-memory double of its
 * contract (one stored challenge per ceremony, user-bound, five-minute TTL, consumed on
 * first use, the purpose-bound 48-byte shape accepted only for the approval purpose).
 *
 * Wire it in a suite with:
 *   jest.mock('<rel>/security/webauthn/WebAuthnAuthenticationService',
 *     () => require('<rel>/tests/helpers/approvalPasskeyDouble').webauthnDouble);
 * Suites that exercise the real challenge store (realschema/d02_approval_binding) do not.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import { randomBytes } from 'crypto';

type Stored = { userId: string | null; expiresAt: number; consumed: boolean };
const challenges = new Map<string, Stored>();

export const webauthnDouble = {
  __esModule: true,
  challenges,
  async beginAuthentication(input: { userId: string | null; challenge?: Uint8Array }) {
    const challenge = Buffer.from(input.challenge ?? randomBytes(32)).toString('base64url');
    challenges.set(challenge, { userId: input.userId, expiresAt: Date.now() + 300_000, consumed: false });
    return { options: { challenge, rpId: 'test' } };
  },
  async verifyAuthentication(input: {
    userId: string | null; purpose?: string;
    response: { id?: string; response: { clientDataJSON: string; signature?: string } };
  }) {
    let challenge = '';
    try {
      challenge = String(JSON.parse(Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8')).challenge ?? '');
    } catch { return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'invalid clientDataJSON' }; }
    if ((Buffer.from(challenge, 'base64url').length === 48) !== (input.purpose === 'outreach_approval')) {
      return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'PURPOSE_MISMATCH' };
    }
    const stored = challenges.get(challenge);
    if (!stored) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'NOT_FOUND' };
    if (stored.consumed) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'ALREADY_CONSUMED' };
    if (stored.expiresAt <= Date.now()) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'EXPIRED' };
    if (stored.userId !== null && stored.userId !== input.userId) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'WRONG_USER_BINDING' };
    stored.consumed = true;
    if ((input.response.response.signature ?? 'valid') !== 'valid') return { ok: false, reason: 'VERIFICATION_FAILED' };
    return { ok: true, result: { userId: input.userId, credentialId: input.response.id ?? 'cred-test', newCounter: 0, verifiedAt: new Date() } };
  },
};

/** An assertion over `challenge`, as a browser would return it. */
export const passkeyAssertion = (challenge: string, credentialId = 'cred-test', signature = 'valid') => ({
  id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {},
  response: {
    clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:3000' })).toString('base64url'),
    signature, authenticatorData: 'AA', userHandle: null,
  },
});

/**
 * Approve `taskId` as `approverUserId` through the one approval writer. For an external
 * channel the passkey ceremony runs first, bound to the binding computed now (and, for a
 * non-journey task, to `recipient`). For the internal channel it is a plain approval.
 */
export async function approveWithPasskey(
  companyId: string, taskId: string, approverUserId: string,
  extra: { reason?: string | null; notes?: string | null; decidedAt?: string; recipient?: string | null; tier?: 'tenant' | 'platform' | null } = {},
) {
  const { getOutreachTaskById } = require('../../services/leadOutreachExecution/storage');
  const { computeApprovalBinding, isExternalChannel } = require('../../services/leadOutreachExecution/approvalBinding');
  const { beginApprovalPasskey, verifyApprovalPasskey } = require('../../services/leadOutreachExecution/approvalPasskey');
  const { approveOutreachTask } = require('../../services/leadOutreachExecution/approval');

  const input = { approverUserId, ...extra };
  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id || !isExternalChannel(task)) return approveOutreachTask(companyId, taskId, input);
  const binding = await computeApprovalBinding(companyId, task, { recipient: extra.recipient ?? null });
  if (!binding.ok) return approveOutreachTask(companyId, taskId, input);
  const ceremony = { userId: approverUserId, organizationId: companyId, taskId, action: 'approve' as const, bindingHash: binding.hash };
  const options = await beginApprovalPasskey(ceremony);
  const verified = await verifyApprovalPasskey(ceremony, passkeyAssertion(String(options.challenge)));
  if (verified.ok !== true) throw new Error(`test passkey ceremony refused: ${verified.code}`);
  return approveOutreachTask(companyId, taskId, { ...input, passkeyProof: verified.proof });
}
