/**
 * WebAuthnRegistrationService — passkey enrollment.
 *
 * Two-phase ceremony:
 *   1. begin: server generates a challenge + options, persists the
 *      challenge as one-shot, returns the options to the browser.
 *   2. verify: browser returns the attestation; server verifies via
 *      @simplewebauthn/server, atomically consumes the challenge,
 *      persists the credential, audits.
 *
 * Rules enforced:
 *   - All verification crypto is delegated to @simplewebauthn/server.
 *   - RP ID + origin are sourced from env (hard-validated at boot).
 *   - Challenges are atomic single-shot (replay-safe).
 *   - Duplicate credential ids are rejected.
 *   - Multiple credentials per user are supported.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import { getWebAuthnRpId, getWebAuthnRpOrigin } from '../env';
import { claim, issue } from './WebAuthnChallengeService';
import {
  findByCredentialId,
  insertCredential,
  listForUser,
} from './WebAuthnCredentialRepository';
import type { StoredWebAuthnCredential } from './webauthnTypes';

// ── Begin ────────────────────────────────────────────────────────────────────

export interface BeginRegistrationInput {
  userId: string;
  userName: string;                  // human-readable login (typically email)
  userDisplayName: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface BeginRegistrationResult {
  options: PublicKeyCredentialCreationOptionsJSON;
}

export async function beginRegistration(
  input: BeginRegistrationInput,
): Promise<BeginRegistrationResult> {
  const rpId = getWebAuthnRpId();

  // exclude credentials already on file so the authenticator doesn't
  // re-enroll the same key
  const existing = await listForUser(input.userId);
  const excludeCredentials = existing.map((c) => ({
    id: c.credentialId,
    transports: c.transports as AuthenticatorTransportFuture[] | undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName:        'Omnivyra',
    rpID:          rpId,
    // user.id must be a stable identifier; use the supabase users.id (UUID).
    // The library converts string IDs to bytes appropriately.
    userID:        Buffer.from(input.userId),
    userName:      input.userName,
    userDisplayName: input.userDisplayName,
    timeout:       60_000,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey:        'preferred',
      userVerification:   'preferred',
      authenticatorAttachment: undefined, // platform OR cross-platform
    },
  });

  // Persist the challenge for atomic single-shot consumption.
  await issue({
    userId:    input.userId,
    ceremony:  'registration',
    challenge: options.challenge,
  });

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'passkey_registration_started',
    actorUserId: input.userId,
    principalUserId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { options };
}

// ── Verify ───────────────────────────────────────────────────────────────────

export interface VerifyRegistrationInput {
  userId: string;
  response: RegistrationResponseJSON;
  label?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface VerifyRegistrationResult {
  credential: StoredWebAuthnCredential;
}

export type VerifyRegistrationFailure =
  | 'CHALLENGE_REJECTED'
  | 'VERIFICATION_FAILED'
  | 'DUPLICATE_CREDENTIAL'
  | 'NO_CREDENTIAL_INFO';

export async function verifyRegistration(
  input: VerifyRegistrationInput,
): Promise<{ ok: true; result: VerifyRegistrationResult } | { ok: false; reason: VerifyRegistrationFailure; detail?: string }> {
  const rpId = getWebAuthnRpId();
  const origin = getWebAuthnRpOrigin();

  const challengeFromResponse = decodeClientDataChallenge(input.response.response.clientDataJSON);
  if (!challengeFromResponse) {
    await emitFailure(input, 'invalid clientDataJSON');
    return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'invalid clientDataJSON' };
  }

  const claimResult = await claim({
    challenge: challengeFromResponse,
    ceremony: 'registration',
    expectedUserId: input.userId,
  });
  if (claimResult.ok !== true) {
    await emitFailure(input, `challenge claim: ${claimResult.reason}`);
    return { ok: false, reason: 'CHALLENGE_REJECTED', detail: claimResult.reason };
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: claimResult.challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    await emitFailure(input, err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      reason: 'VERIFICATION_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!verification.verified || !verification.registrationInfo) {
    await emitFailure(input, 'verifyRegistrationResponse returned verified=false');
    return { ok: false, reason: 'VERIFICATION_FAILED' };
  }

  const info = verification.registrationInfo;
  const cred = info.credential;
  if (!cred) {
    await emitFailure(input, 'no credential info');
    return { ok: false, reason: 'NO_CREDENTIAL_INFO' };
  }

  // Reject re-registration of an existing credential id (replay defense).
  const existing = await findByCredentialId(cred.id);
  if (existing) {
    await emitFailure(input, 'duplicate credential id');
    return { ok: false, reason: 'DUPLICATE_CREDENTIAL' };
  }

  const stored = await insertCredential({
    userId:               input.userId,
    credentialId:         cred.id,
    publicKey:            cred.publicKey,
    counter:              cred.counter,
    transports:           cred.transports ?? null,
    attestationFormat:    info.fmt ?? null,
    authenticatorAaguid:  info.aaguid ?? null,
    deviceType:           info.credentialDeviceType ?? null,
    isBackedUp:           !!info.credentialBackedUp,
    label:                input.label ?? null,
  });

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'passkey_registered',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: stored.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, result: { credential: stored } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function emitFailure(input: VerifyRegistrationInput, reason: string): Promise<void> {
  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'passkey_registration_failed',
    actorUserId: input.userId,
    principalUserId: input.userId,
    reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  logger.warn('webauthn_registration_failed', { userId: input.userId, reason });
}

/**
 * Decode the b64url-encoded clientDataJSON and pull out the challenge field.
 * The challenge in clientDataJSON is itself base64url; we return it verbatim
 * for matching against the stored challenge.
 */
function decodeClientDataChallenge(clientDataJSONb64url: string): string | null {
  try {
    const json = Buffer.from(clientDataJSONb64url, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as { challenge?: string };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

