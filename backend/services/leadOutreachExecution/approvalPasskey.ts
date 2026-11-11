/**
 * D-02 — a fresh, single-use passkey verification bound to ONE outreach approval.
 *
 * NOT A NEW AUTHENTICATION SYSTEM. It is the existing WebAuthn authentication ceremony
 * (`WebAuthnAuthenticationService`: the `webauthn_challenges` store, its five-minute TTL,
 * its atomic single-use claim, credential ownership, user verification and the signature
 * counter), with one difference: the challenge the authenticator signs is not random but
 * DERIVED from the approval it authorises.
 *
 *   challenge = nonce (16 random bytes) || SHA-256(domain, nonce, user, organization, task,
 *                                                  action, binding hash)
 *
 * So the signed assertion itself names the approval. At decision time the server
 * recomputes the digest from the approval it is about to record — the binding hash it has
 * just recomputed, not one the client sent — and refuses before the ceremony is touched
 * when it differs. Then the ordinary verification claims the stored challenge, which is
 * what makes it single-use (a replay finds it consumed) and short-lived (an old one finds
 * it expired), and checks the signature.
 *
 * A generic login or step-up challenge is 32 random bytes and can never have this shape;
 * an approval challenge can only be issued by `beginApprovalPasskey`, server-side. The
 * generic verifiers refuse this shape (`purpose` in `WebAuthnAuthenticationService`), so
 * an approval assertion is never also a login or a step-up.
 *
 * A successful verification returns a PROOF (`ApprovalPasskeyProof`). It is the only
 * passkey evidence the approval writer accepts (`approval.ts` → `redeemApprovalPasskeyProof`):
 * module-private, bound to approver, organisation, task, action and binding hash, single
 * use. So no caller — service code, route or harness — can record an external-channel
 * approval without a fresh ceremony, and the credential id is persisted on the row.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';
import {
  beginAuthentication,
  verifyAuthentication,
} from '../../security/webauthn/WebAuthnAuthenticationService';

const DOMAIN = 'omnivyra.outreach.approval.passkey.v1';
/**
 * Prompt 3 — the community-action approval domain. Same ceremony, same 48-byte shape;
 * a different digest domain, so an outreach approval assertion never verifies as a
 * community one and the reverse. `subject` absent is the outreach domain, unchanged.
 */
const COMMUNITY_DOMAIN = 'omnivyra.community.approval.passkey.v1';
const NONCE_BYTES = 16;
const DIGEST_BYTES = 32;

/** The only accepted `subject`. Anything else is refused (throws), never defaulted. */
export type ApprovalPasskeySubject = 'community_action';

export interface ApprovalPasskeyBinding {
  readonly userId: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly action: 'approve';
  readonly bindingHash: string;
  /** Absent (or undefined) = outreach task approval. 'community_action' = community action id in `taskId`. */
  readonly subject?: ApprovalPasskeySubject;
}

/** The digest domain for `binding`. Throws on any subject outside the allow-list. */
function domainFor(binding: { subject?: unknown }): string {
  const subject = binding.subject;
  if (subject === undefined) return DOMAIN;
  if (subject === 'community_action') return COMMUNITY_DOMAIN;
  throw new Error('approvalPasskey: unsupported approval subject');
}

export type ApprovalPasskeyRefusal =
  | 'passkey_required'
  | 'passkey_wrong_binding'
  | 'passkey_stale'
  | 'passkey_replayed'
  | 'passkey_rejected';

/**
 * What a successful verification proves, and the only thing the approval writer accepts
 * as passkey evidence (`approval.ts`). Frozen, and recognised by identity in a
 * module-private set: an object built anywhere else — even field for field — is not a
 * proof, and each proof is redeemed at most once.
 */
export interface ApprovalPasskeyProof extends ApprovalPasskeyBinding {
  readonly credentialId: string;
  readonly verifiedAt: string;
}

export type ApprovalPasskeyResult =
  | { ok: true; proof: ApprovalPasskeyProof }
  | { ok: false; code: ApprovalPasskeyRefusal; detail?: string };

interface RequestMeta { readonly ip?: string | null; readonly userAgent?: string | null }

/**
 * L-1 — how long a proof stays redeemable after its verification: the WebAuthn challenge
 * TTL. The claim trigger (migration 20270120000011) holds the recorded row to the same window.
 */
export const APPROVAL_PROOF_MAX_AGE_MS = 5 * 60_000;

/** Proofs issued by `verifyApprovalPasskey` and not yet redeemed. */
const ISSUED = new WeakSet<object>();

/**
 * Redeem a proof for the approval about to be recorded: it must have been issued here,
 * not yet redeemed, and bound to exactly this approver, organisation, task and binding
 * hash. Redeemed on success and on a binding mismatch alike, so a proof is never tried
 * twice. Never throws.
 */
export function redeemApprovalPasskeyProof(
  proof: unknown, expected: Omit<ApprovalPasskeyBinding, 'action'>,
): { ok: true; credentialId: string; verifiedAt: string } | { ok: false; reason: string } {
  if (proof === null || typeof proof !== 'object' || !ISSUED.has(proof)) {
    return { ok: false, reason: 'no passkey verification issued for this approval was presented' };
  }
  ISSUED.delete(proof);
  const p = proof as ApprovalPasskeyProof;
  if (p.action !== 'approve' || p.userId !== expected.userId || p.organizationId !== expected.organizationId
    || p.taskId !== expected.taskId || p.bindingHash !== expected.bindingHash
    || p.subject !== expected.subject) {
    return { ok: false, reason: 'the passkey verification was made for a different approval or content' };
  }
  // L-1 — fresh means fresh: a proof is redeemable only within the challenge TTL of its ceremony.
  const ageMs = Date.now() - Date.parse(p.verifiedAt);
  if (!Number.isFinite(ageMs) || ageMs > APPROVAL_PROOF_MAX_AGE_MS) {
    return { ok: false, reason: 'the passkey verification is too old for this approval; verify again' };
  }
  return { ok: true, credentialId: p.credentialId, verifiedAt: p.verifiedAt };
}

/** The challenge bytes for `binding`, under `nonce`. Exported for the tests. */
export function approvalChallengeBytes(nonce: Buffer, binding: ApprovalPasskeyBinding): Buffer {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      domainFor(binding), nonce.toString('hex'), binding.userId, binding.organizationId, binding.taskId, binding.action, binding.bindingHash,
    ]))
    .digest();
  return Buffer.concat([nonce, digest]);
}

/** Start the ceremony for one approval. Returns the options the browser signs. */
export async function beginApprovalPasskey(
  binding: ApprovalPasskeyBinding, meta: RequestMeta = {},
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const challenge = approvalChallengeBytes(randomBytes(NONCE_BYTES), binding);
  const { options } = await beginAuthentication({
    userId: binding.userId,
    challenge: new Uint8Array(challenge),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return options;
}

function signedChallenge(response: unknown): Buffer | null {
  const clientDataJSON = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  if (typeof clientDataJSON !== 'string' || clientDataJSON === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? Buffer.from(parsed.challenge, 'base64url') : null;
  } catch {
    return null;
  }
}

/**
 * Verify the passkey assertion presented with an approval of `binding`. Never throws.
 * The binding is checked first, without touching the stored challenge, so an assertion
 * made for another approval neither succeeds nor burns that approval's challenge.
 */
export async function verifyApprovalPasskey(
  binding: ApprovalPasskeyBinding, response: unknown, meta: RequestMeta = {},
): Promise<ApprovalPasskeyResult> {
  if (response === null || response === undefined || typeof response !== 'object') {
    return { ok: false, code: 'passkey_required', detail: 'a passkey verification for this approval is required' };
  }
  const signed = signedChallenge(response);
  if (signed === null) return { ok: false, code: 'passkey_required', detail: 'the passkey response carries no challenge' };
  if (signed.length !== NONCE_BYTES + DIGEST_BYTES) {
    return { ok: false, code: 'passkey_wrong_binding', detail: 'the passkey was not verified for an approval' };
  }
  let expected: Buffer;
  try {
    expected = approvalChallengeBytes(signed.subarray(0, NONCE_BYTES), binding);
  } catch {
    return { ok: false, code: 'passkey_wrong_binding', detail: 'the approval subject is not supported' };
  }
  if (!timingSafeEqual(expected, signed)) {
    return { ok: false, code: 'passkey_wrong_binding', detail: 'the passkey was verified for a different approval or content' };
  }

  try {
    const verified = await verifyAuthentication({
      userId: binding.userId,
      response: response as AuthenticationResponseJSON,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      purpose: 'outreach_approval',
    });
    if (verified.ok === true) {
      // The ceremony is user-bound, so the verified user is the approver; refuse otherwise.
      if (verified.result.userId !== binding.userId) {
        return { ok: false, code: 'passkey_rejected', detail: 'the passkey belongs to a different user' };
      }
      const credentialId = typeof verified.result.credentialId === 'string' && verified.result.credentialId !== ''
        ? verified.result.credentialId
        : typeof (response as { id?: unknown }).id === 'string' ? String((response as { id: string }).id) : '';
      if (credentialId === '') return { ok: false, code: 'passkey_rejected', detail: 'the verified credential is not identifiable' };
      const verifiedAt = verified.result.verifiedAt instanceof Date ? verified.result.verifiedAt.toISOString() : new Date().toISOString();
      const proof: ApprovalPasskeyProof = Object.freeze({
        userId: binding.userId, organizationId: binding.organizationId, taskId: binding.taskId,
        action: binding.action, bindingHash: binding.bindingHash, credentialId, verifiedAt,
        ...(binding.subject !== undefined ? { subject: binding.subject } : {}),
      });
      ISSUED.add(proof);
      return { ok: true, proof };
    }
    if (verified.reason === 'CHALLENGE_REJECTED' && verified.detail === 'EXPIRED') {
      return { ok: false, code: 'passkey_stale', detail: 'the passkey verification is too old; verify again' };
    }
    if ((verified.reason === 'CHALLENGE_REJECTED' && (verified.detail === 'ALREADY_CONSUMED' || verified.detail === 'CONSUME_RACE_LOST'))
      || verified.reason === 'COUNTER_REPLAY') {
      return { ok: false, code: 'passkey_replayed', detail: 'that passkey verification was already used' };
    }
    return { ok: false, code: 'passkey_rejected', detail: verified.detail ? `${verified.reason}: ${verified.detail}` : verified.reason };
  } catch (e) {
    return { ok: false, code: 'passkey_rejected', detail: e instanceof Error ? e.message : String(e) };
  }
}
