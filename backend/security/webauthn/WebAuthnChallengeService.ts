/**
 * WebAuthnChallengeService — challenge lifecycle.
 *
 * Responsibilities:
 *   - Issue: persist a challenge string with TTL + ceremony + actor binding.
 *   - Verify-claim: at verify time, look up the challenge, enforce TTL +
 *     non-consumption + matching ceremony + matching actor (when bound),
 *     and atomically consume it.
 *
 * Replay prevention is enforced by:
 *   1. Atomic consume (consumeChallenge) at verify — race-loser sees false.
 *   2. expires_at check at verify time.
 *   3. ceremony match (a registration challenge cannot satisfy an auth
 *      verify and vice-versa).
 *   4. user_id match when the challenge was bound to a user.
 */

import { logger } from '../../services/logger';
import { getWebAuthnRpId, getWebAuthnRpOrigin } from '../env';
import {
  consumeChallenge,
  issueChallenge,
  loadChallenge,
} from './WebAuthnChallengeRepository';
import type {
  StoredWebAuthnChallenge,
  WebAuthnCeremony,
} from './webauthnTypes';

// ── TTLs (seconds) ───────────────────────────────────────────────────────────

const REGISTRATION_TTL_SECONDS    = 5 * 60;   // 5 minutes
const AUTHENTICATION_TTL_SECONDS  = 5 * 60;

// ── Issue ────────────────────────────────────────────────────────────────────

export interface IssueArgs {
  userId: string | null;            // null for userless authentication
  ceremony: WebAuthnCeremony;
  challenge: string;                // base64url string from generateXxxOptions
}

export async function issue(args: IssueArgs): Promise<StoredWebAuthnChallenge> {
  const ttl = args.ceremony === 'registration'
    ? REGISTRATION_TTL_SECONDS
    : AUTHENTICATION_TTL_SECONDS;

  const expiresAt = new Date(Date.now() + ttl * 1000);

  return await issueChallenge({
    userId:    args.userId,
    challenge: args.challenge,
    ceremony:  args.ceremony,
    rpId:      getWebAuthnRpId(),
    origin:    getWebAuthnRpOrigin(),
    expiresAt,
  });
}

// ── Verify-claim ─────────────────────────────────────────────────────────────

export type ChallengeClaimResult =
  | { ok: true; challenge: StoredWebAuthnChallenge }
  | { ok: false; reason: ChallengeRejectionReason };

export type ChallengeRejectionReason =
  | 'NOT_FOUND'
  | 'WRONG_CEREMONY'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'WRONG_USER_BINDING'
  | 'CONSUME_RACE_LOST';

export interface ClaimArgs {
  challenge: string;
  ceremony: WebAuthnCeremony;
  /**
   * The user who is proving themselves at verify time. For userless
   * authentication ceremonies the stored challenge has user_id=null and
   * we accept any user; once a user is identified by the credential we
   * enforce the credential ownership check upstream.
   */
  expectedUserId: string | null;
}

/**
 * Atomically claim a challenge for verification. Returns the stored row on
 * success. On any rejection, the challenge is NOT consumed (so legitimate
 * retries with a fresh challenge are unaffected).
 */
export async function claim(args: ClaimArgs): Promise<ChallengeClaimResult> {
  const stored = await loadChallenge(args.challenge, args.ceremony);
  if (!stored) return { ok: false, reason: 'NOT_FOUND' };

  if (stored.ceremony !== args.ceremony) {
    return { ok: false, reason: 'WRONG_CEREMONY' };
  }

  if (stored.consumedAt !== null) {
    return { ok: false, reason: 'ALREADY_CONSUMED' };
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'EXPIRED' };
  }

  // User binding: if the stored challenge was bound to a user, it must
  // match the user proving themselves. For userless auth ceremonies the
  // stored user_id is null and any caller is accepted at this layer.
  if (stored.userId !== null && args.expectedUserId !== null && stored.userId !== args.expectedUserId) {
    return { ok: false, reason: 'WRONG_USER_BINDING' };
  }

  const consumed = await consumeChallenge(stored.id);
  if (!consumed) {
    // Race lost: another verifier consumed the same challenge.
    logger.warn('webauthn_challenge_consume_race_lost', {
      challengeId: stored.id,
      ceremony: stored.ceremony,
    });
    return { ok: false, reason: 'CONSUME_RACE_LOST' };
  }

  return { ok: true, challenge: stored };
}
