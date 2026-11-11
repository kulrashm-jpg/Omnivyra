/**
 * Signed command envelope (EXTENSION-1.5.0-CONTRACT.md §4).
 *
 * The server signs every 1.5 command with the session's derived HMAC secret; the
 * extension verifies it in the service worker before acting. Both sides implement
 * `canonical` identically and pin the shared vectors in envelopeVectors.json.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const COMMAND_SCHEMA_VERSION_V15 = '2026-11-10.1';
export const ENVELOPE_DOMAIN = 'omnivyra.ext.cmd.v1';

export type ExtensionAction15 =
  | 'li.collect.own_post_comments'
  | 'li.collect.own_inbox'
  | 'li.salesnav.capture_saved_leads'
  | 'li.comment.reply'
  | 'li.reaction.like';

export const WRITE_ACTIONS15: ReadonlySet<ExtensionAction15> = new Set(['li.comment.reply', 'li.reaction.like']);

export interface CommandEnvelope {
  command_id: string;
  schema_version: typeof COMMAND_SCHEMA_VERSION_V15;
  org_id: string;
  user_id: string;
  platform: 'linkedin';
  acting_member_urn: string;
  action: ExtensionAction15;
  params: Record<string, unknown>;
  /** Epoch milliseconds. */
  expires_at: number;
  approval_id?: string;
  text_sha256?: string;
  target?: Record<string, string>;
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, undefined-valued keys
 * omitted, no whitespace; arrays in order; scalars via JSON.stringify.
 */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('canonical: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((e) => canonical(e)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function signEnvelope(envelope: CommandEnvelope, hmacSecret: string): string {
  if (!hmacSecret) throw new Error('signEnvelope: missing secret');
  return createHmac('sha256', hmacSecret).update(`${ENVELOPE_DOMAIN}\n${canonical(envelope)}`).digest('hex');
}

/** Constant-time verification (used by server tests; the extension has its own copy). */
export function verifyEnvelopeSignature(envelope: CommandEnvelope, signature: string, hmacSecret: string): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signEnvelope(envelope, hmacSecret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
