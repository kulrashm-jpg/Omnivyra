/**
 * WebAuthnAuthenticationService — passkey verification.
 *
 * Two-phase ceremony:
 *   1. begin: generate options (allowCredentials when user is known, or
 *      none for userless ceremonies); persist challenge.
 *   2. verify: claim the challenge atomically, look up the credential by
 *      its base64url id, verify via @simplewebauthn/server, monotonic
 *      counter bump, audit.
 *
 * Wave 2B-A scope is verification + counter persistence + audit. Session
 * projection (issuing an auth_session or stepup_session) is handled by
 * the caller (Wave 2B-B step-up flow / Wave 2B-C login flow).
 */

import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialDescriptorJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import { getWebAuthnRpId, getWebAuthnRpOrigin } from '../env';
import { claim, issue } from './WebAuthnChallengeService';
import {
  bumpCounter,
  findByCredentialId,
  listForUser,
  touchLastUsed,
} from './WebAuthnCredentialRepository';
import type { WebAuthnVerifiedAuthentication } from './webauthnTypes';

// ── Begin ────────────────────────────────────────────────────────────────────

export interface BeginAuthenticationInput {
  /**
   * When set, scopes the ceremony to this user (allowCredentials populated).
   * When null, runs userless (any registered credential matches; the user
   * is identified by the response's credential id at verify time).
   */
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface BeginAuthenticationResult {
  options: PublicKeyCredentialRequestOptionsJSON;
}

export async function beginAuthentication(
  input: BeginAuthenticationInput,
): Promise<BeginAuthenticationResult> {
  const rpId = getWebAuthnRpId();

  let allowCredentials: PublicKeyCredentialDescriptorJSON[] | undefined;
  if (input.userId) {
    const existing = await listForUser(input.userId);
    allowCredentials = existing.map((c): PublicKeyCredentialDescriptorJSON => ({
      id: c.credentialId,
      type: 'public-key',
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID:             rpId,
    timeout:          60_000,
    userVerification: 'preferred',
    allowCredentials,
  });

  await issue({
    userId:    input.userId,
    ceremony:  'authentication',
    challenge: options.challenge,
  });

  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'passkey_auth_started',
    actorUserId: input.userId,
    principalUserId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { options };
}

// ── Verify ───────────────────────────────────────────────────────────────────

export interface VerifyAuthenticationInput {
  /**
   * When set, the ceremony is bound to this user. The credential resolved
   * from the response must belong to them. When null, the user identity
   * is derived from the credential.
   */
  userId: string | null;
  response: AuthenticationResponseJSON;
  ip?: string | null;
  userAgent?: string | null;
}

export type VerifyAuthenticationFailure =
  | 'CHALLENGE_REJECTED'
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_REVOKED'
  | 'OWNERSHIP_MISMATCH'
  | 'COUNTER_REPLAY'
  | 'VERIFICATION_FAILED';

export async function verifyAuthentication(
  input: VerifyAuthenticationInput,
): Promise<
  | { ok: true; result: WebAuthnVerifiedAuthentication }
  | { ok: false; reason: VerifyAuthenticationFailure; detail?: string }
> {
  const rpId = getWebAuthnRpId();
  const origin = getWebAuthnRpOrigin();

  const challengeFromResponse = decodeClientDataChallenge(input.response.response.clientDataJSON);
  if (!challengeFromResponse) {
    await emitFailure(input, null, 'invalid clientDataJSON');
    return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'invalid clientDataJSON' };
  }

  // Look up the credential FIRST so we can resolve the binding user for
  // both userless ceremonies and scoped ceremonies.
  const credential = await findByCredentialId(input.response.id);
  if (!credential) {
    await emitFailure(input, null, 'credential not found');
    return { ok: false, reason: 'CREDENTIAL_NOT_FOUND' };
  }
  if (credential.revokedAt) {
    await emitFailure(input, credential.userId, 'credential revoked');
    return { ok: false, reason: 'CREDENTIAL_REVOKED' };
  }

  // Ownership check: if the route bound the ceremony to a userId, the
  // credential MUST belong to that user.
  if (input.userId && credential.userId !== input.userId) {
    await emitFailure(input, input.userId, 'credential ownership mismatch');
    return { ok: false, reason: 'OWNERSHIP_MISMATCH' };
  }

  // Atomically claim the challenge. Stored challenge may have been
  // userless (user_id null) — in that case the claim accepts any caller
  // and we use the credential's user as the proven identity.
  const claimResult = await claim({
    challenge: challengeFromResponse,
    ceremony: 'authentication',
    expectedUserId: credential.userId,
  });
  if (claimResult.ok !== true) {
    await emitFailure(input, credential.userId, `challenge claim: ${claimResult.reason}`);
    return { ok: false, reason: 'CHALLENGE_REJECTED', detail: claimResult.reason };
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: claimResult.challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: typeof credential.counter === 'bigint' ? Number(credential.counter) : credential.counter,
        transports: (credential.transports ?? undefined) as Parameters<typeof verifyAuthenticationResponse>[0]['credential']['transports'],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    await emitFailure(input, credential.userId, err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      reason: 'VERIFICATION_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!verification.verified) {
    await emitFailure(input, credential.userId, 'verifyAuthenticationResponse verified=false');
    return { ok: false, reason: 'VERIFICATION_FAILED' };
  }

  // Counter handling: when the authenticator reports a counter > 0, we
  // must monotonically advance. If the new counter is <= stored, this is
  // a replay. Some platform authenticators (e.g. Apple passkeys) always
  // report 0; in that case we skip the strict monotonic check but still
  // record the use.
  const newCounter = verification.authenticationInfo.newCounter;
  const storedCounter = typeof credential.counter === 'bigint'
    ? Number(credential.counter)
    : credential.counter;

  if (newCounter > 0 || storedCounter > 0) {
    const updated = await bumpCounter(credential.credentialId, newCounter);
    if (!updated) {
      await emitFailure(input, credential.userId, `counter replay: stored=${storedCounter} new=${newCounter}`);
      return { ok: false, reason: 'COUNTER_REPLAY' };
    }
  } else {
    await touchLastUsed(credential.credentialId);
  }

  const verifiedAt = new Date();
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'passkey_authenticated',
    actorUserId: credential.userId,
    principalUserId: credential.userId,
    resourceId: credential.id,
    mfaPhishingResistant: true,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    result: {
      userId:       credential.userId,
      credentialId: credential.credentialId,
      newCounter,
      verifiedAt,
      deviceType:   credential.deviceType,
      isBackedUp:   credential.isBackedUp,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function emitFailure(
  input: VerifyAuthenticationInput,
  resolvedUserId: string | null,
  reason: string,
): Promise<void> {
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'passkey_auth_failed',
    actorUserId: resolvedUserId ?? input.userId ?? null,
    principalUserId: resolvedUserId ?? input.userId ?? null,
    reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  logger.warn('webauthn_authentication_failed', {
    userId: resolvedUserId ?? input.userId ?? null,
    reason,
  });
}

function decodeClientDataChallenge(clientDataJSONb64url: string): string | null {
  try {
    const json = Buffer.from(clientDataJSONb64url, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as { challenge?: string };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}
