/**
 * Persistence for `webauthn_challenges`.
 *
 * Service-layer thin wrapper. Service contracts:
 *   - issue:   INSERT a new (challenge, ceremony, expires_at, rp_id, origin)
 *   - load:    fetch by challenge string for verify-time consumption
 *   - consume: atomic UPDATE setting consumed_at = now WHERE consumed_at IS NULL
 *              (returns true iff the row was unconsumed at update time —
 *              race-loser sees false; replay attempts must fail)
 *
 * Direct callers of this repository: WebAuthnChallengeService only.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import type { StoredWebAuthnChallenge, WebAuthnCeremony } from './webauthnTypes';

export interface IssueChallengeInput {
  userId: string | null;
  challenge: string;
  ceremony: WebAuthnCeremony;
  rpId: string;
  origin: string;
  expiresAt: Date;
}

interface ChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  ceremony: string;
  rp_id: string;
  origin: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

function rowToStored(row: ChallengeRow): StoredWebAuthnChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    challenge: row.challenge,
    ceremony: row.ceremony as WebAuthnCeremony,
    rpId: row.rp_id,
    origin: row.origin,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
  };
}

export async function issueChallenge(input: IssueChallengeInput): Promise<StoredWebAuthnChallenge> {
  const { data, error } = await db
    .from('webauthn_challenges')
    .insert({
      user_id:    input.userId,
      challenge:  input.challenge,
      ceremony:   input.ceremony,
      rp_id:      input.rpId,
      origin:     input.origin,
      expires_at: input.expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error || !data) {
    logger.error('webauthn_challenge_insert_failed', {
      message: error?.message,
      ceremony: input.ceremony,
    });
    throw new Error(`webauthn_challenge_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return rowToStored(data as ChallengeRow);
}

export async function loadChallenge(
  challenge: string,
  ceremony: WebAuthnCeremony,
): Promise<StoredWebAuthnChallenge | null> {
  const { data } = await db
    .from('webauthn_challenges')
    .select('*')
    .eq('challenge', challenge)
    .eq('ceremony', ceremony)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as ChallengeRow);
}

/**
 * Atomic single-flight consume. Returns true iff this call was the one
 * that flipped consumed_at from NULL to now(). All subsequent calls (and
 * concurrent racers) return false.
 */
export async function consumeChallenge(challengeId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await db
    .from('webauthn_challenges')
    .update({ consumed_at: now })
    .eq('id', challengeId)
    .is('consumed_at', null)
    .select('id');
  return !!data && data.length > 0;
}

/**
 * Best-effort cleanup hook. Wave 2B-A leaves invocation to a future cron;
 * unconsumed expired challenges are simply ignored on verify (we check
 * expires_at).
 */
export async function purgeExpiredChallenges(beforeIso: string): Promise<number> {
  const { data } = await db
    .from('webauthn_challenges')
    .delete()
    .lt('expires_at', beforeIso)
    .select('id');
  return data?.length ?? 0;
}
