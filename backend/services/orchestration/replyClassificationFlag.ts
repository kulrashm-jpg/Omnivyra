/**
 * Prompt 5 — the switch for reply classification in Orchestration. DEFAULT OFF.
 *
 * DO NOT TURN THIS ON BEFORE SC7-R. Turning it on in ANY environment requires the owner's
 * SC7-R ratification of the SC-7 vocabulary first (Outreach agreement, 2026-11-06). Until
 * then every inbound reply pauses the run for a person, and no classifier output changes a
 * journey or PI.
 *
 * Even ON, it only lets replyClassificationAdapter.ts return a classified consequence; it
 * wires nothing. A label can never end a journey or override STOP, complaint, unsubscribe
 * or a bounce (replyConsequence.ts), and nothing in the sweeper or a journey module reads
 * the adapter (a guard test pins that).
 *
 * Exactly the string `true` turns it on; anything else, unset included, is OFF.
 */

export const REPLY_CLASSIFICATION_FLAG = 'ORCHESTRATION_REPLY_CLASSIFICATION_ENABLED';

export function isReplyClassificationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[REPLY_CLASSIFICATION_FLAG] === 'true';
}
