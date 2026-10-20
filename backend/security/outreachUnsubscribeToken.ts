/**
 * WP3 / L3 — the outreach unsubscribe token.
 *
 * One token travels in every outreach email (body link and `List-Unsubscribe`
 * header). It must let the unsubscribe endpoint record a restriction against
 * the EXACT address the email went to, without that address ever appearing in
 * the URL, and without anyone being able to mint or alter one.
 *
 * ─── ONE PRIMITIVE: AES-256-GCM ───────────────────────────────────────────
 * Authenticated encryption gives both properties at once: the payload
 * (tenant, attempt, scope, recipient) is unreadable, and any change to the key
 * id, IV, ciphertext or tag fails authentication. A separate HMAC would be
 * redundant. The key id and format version are bound in as AAD, so a token
 * cannot be re-labelled to a different key.
 *
 * ─── WHY NOT `ContinuationToken` ──────────────────────────────────────────
 * It always expires, its payload is readable (signed, not encrypted), and it is
 * keyed by `SESSION_COOKIE_SECRET`. An unsubscribe link must outlive any session
 * key rotation, must not expose the recipient, and must keep working.
 *
 * ─── KEYS AND ROTATION ────────────────────────────────────────────────────
 * `OUTREACH_UNSUBSCRIBE_TOKEN_KEYS` = `kid:secret[,kid:secret...]`. The FIRST
 * entry signs new tokens; every listed entry verifies. Rotation is: prepend the
 * new key, keep the old one listed for as long as emails carrying it may still
 * be acted on, then remove it. A token whose key is no longer listed fails as
 * `unknown_key` — a link stops working only by an explicit operator act.
 * Each secret is at least 32 characters; the per-key AES key is derived with
 * HKDF-SHA256 using the key id as `info`, so two key ids never share a key.
 *
 * ─── NO EXPIRY ────────────────────────────────────────────────────────────
 * PI-CONTRACT-001: an unsubscribe is not time-limited. A token carries its
 * issue time only to refuse one claiming to come from the future.
 *
 * Nothing here logs, throws or returns the recipient. Failures carry a code.
 */
import crypto from 'crypto';

export const UNSUBSCRIBE_TOKEN_KEYS_ENV = 'OUTREACH_UNSUBSCRIBE_TOKEN_KEYS';

/** Approved scope (WP3 decision A): an unsubscribe applies to every channel. */
export const UNSUBSCRIBE_SCOPES = ['*'] as const;
export type UnsubscribeScope = (typeof UNSUBSCRIBE_SCOPES)[number];

const FORMAT = 'u1';
const MIN_SECRET_LENGTH = 32;
const KID_RE = /^[a-z0-9]{1,16}$/;
const MAX_ID_LENGTH = 64;
const MAX_RECIPIENT_LENGTH = 254;
/** Keeps `<https://host/path?t=TOKEN>` well inside SES's 995-character header value. */
export const MAX_TOKEN_LENGTH = 800;
const FUTURE_SKEW_SECONDS = 300;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface UnsubscribeTokenPayload {
  organizationId: string;
  attemptId: string;
  scope: UnsubscribeScope;
  recipient: string;
  issuedAt: number;
  keyId: string;
}

export type UnsubscribeTokenFailure =
  | 'key_config_missing'
  | 'key_config_invalid'
  | 'malformed'
  | 'unknown_key'
  | 'authentication_failed'
  | 'invalid_payload'
  | 'issued_in_future';

/** One shape with nullable fields — `strict: false` does not narrow unions. */
export interface UnsubscribeTokenVerification {
  ok: boolean;
  payload: UnsubscribeTokenPayload | null;
  failure: UnsubscribeTokenFailure | null;
}

export class UnsubscribeTokenError extends Error {
  constructor(readonly code: UnsubscribeTokenFailure | 'invalid_input') {
    super(`outreach unsubscribe token: ${code}`);
    this.name = 'UnsubscribeTokenError';
  }
}

interface KeyEntry { kid: string; key: Buffer }

/** Parse the key list. Throws a coded error; never echoes a secret. */
function loadKeys(): KeyEntry[] {
  const raw = process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') throw new UnsubscribeTokenError('key_config_missing');

  const entries: KeyEntry[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const item = part.trim();
    const sep = item.indexOf(':');
    if (sep <= 0) throw new UnsubscribeTokenError('key_config_invalid');
    const kid = item.slice(0, sep);
    const secret = item.slice(sep + 1);
    if (!KID_RE.test(kid) || seen.has(kid) || secret.length < MIN_SECRET_LENGTH) {
      throw new UnsubscribeTokenError('key_config_invalid');
    }
    seen.add(kid);
    const key = Buffer.from(crypto.hkdfSync('sha256', secret, 'omnivyra-outreach-unsubscribe-v1', kid, 32));
    entries.push({ kid, key });
  }
  if (entries.length === 0) throw new UnsubscribeTokenError('key_config_missing');
  return entries;
}

const aad = (kid: string): Buffer => Buffer.from(`omnivyra.outreach_unsubscribe.${FORMAT}.${kid}`, 'utf8');

const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID_LENGTH && !/[\s\u0000-\u001F\u007F]/.test(v);

const isRecipient = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_RECIPIENT_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const isScope = (v: unknown): v is UnsubscribeScope =>
  typeof v === 'string' && (UNSUBSCRIBE_SCOPES as readonly string[]).includes(v);

/**
 * Mint a token with the active (first) key. Throws `UnsubscribeTokenError` when
 * the key list is missing or invalid, or the input is unusable — the caller must
 * then NOT send, because an email without a working unsubscribe link must not go.
 */
export function issueOutreachUnsubscribeToken(input: {
  organizationId: string;
  attemptId: string;
  recipient: string;
  scope?: UnsubscribeScope;
  now?: number;
}): string {
  const scope = input.scope ?? '*';
  if (!isId(input.organizationId) || !isId(input.attemptId) || !isRecipient(input.recipient) || !isScope(scope)) {
    throw new UnsubscribeTokenError('invalid_input');
  }
  const [active] = loadKeys();
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const plaintext = Buffer.from(JSON.stringify({
    o: input.organizationId, a: input.attemptId, s: scope, r: input.recipient, i: issuedAt,
  }), 'utf8');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', active.key, iv);
  cipher.setAAD(aad(active.kid));
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const token = [FORMAT, active.kid, iv.toString('base64url'), sealed.toString('base64url')].join('.');
  if (token.length > MAX_TOKEN_LENGTH) throw new UnsubscribeTokenError('invalid_input');
  return token;
}

const fail = (failure: UnsubscribeTokenFailure): UnsubscribeTokenVerification => ({ ok: false, payload: null, failure });

/** Verify and open a token. Never throws. */
export function verifyOutreachUnsubscribeToken(token: unknown, opts: { now?: number } = {}): UnsubscribeTokenVerification {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return fail('malformed');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT || !KID_RE.test(parts[1])) return fail('malformed');
  const [, kid, ivPart, sealedPart] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(ivPart) || !/^[A-Za-z0-9_-]+$/.test(sealedPart)) return fail('malformed');

  let keys: KeyEntry[];
  try {
    keys = loadKeys();
  } catch (e) {
    return fail(e instanceof UnsubscribeTokenError && e.code === 'key_config_invalid' ? 'key_config_invalid' : 'key_config_missing');
  }
  const entry = keys.find((k) => k.kid === kid);
  if (!entry) return fail('unknown_key');

  const iv = Buffer.from(ivPart, 'base64url');
  const sealed = Buffer.from(sealedPart, 'base64url');
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) return fail('malformed');

  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', entry.key, iv);
    decipher.setAAD(aad(kid));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    plaintext = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return fail('authentication_failed');
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(plaintext.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fail('invalid_payload');
    body = parsed as Record<string, unknown>;
  } catch {
    return fail('invalid_payload');
  }
  if (!isId(body.o) || !isId(body.a) || !isScope(body.s) || !isRecipient(body.r)
      || typeof body.i !== 'number' || !Number.isInteger(body.i)) {
    return fail('invalid_payload');
  }
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  if (body.i > nowSeconds + FUTURE_SKEW_SECONDS) return fail('issued_in_future');

  return {
    ok: true,
    failure: null,
    payload: {
      organizationId: body.o, attemptId: body.a, scope: body.s, recipient: body.r, issuedAt: body.i, keyId: kid,
    },
  };
}

/** The public unsubscribe path. The Edge Function accepts links to this path only. */
export const UNSUBSCRIBE_PATH = '/api/outreach/unsubscribe';

/**
 * Build the https unsubscribe URL for a token. Throws when the base URL is not
 * an absolute https origin — a link that cannot work must not be sent.
 */
export function buildOutreachUnsubscribeUrl(token: string, baseUrl: string | undefined | null): string {
  let base: URL;
  try {
    base = new URL(String(baseUrl ?? ''));
  } catch {
    throw new UnsubscribeTokenError('invalid_input');
  }
  if (base.protocol !== 'https:') throw new UnsubscribeTokenError('invalid_input');
  return `${base.origin}${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
}
