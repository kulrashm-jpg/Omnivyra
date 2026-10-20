/**
 * WP3 / L6 — AWS SNS message authentication: signature, topic, timestamp.
 *
 * Adapted from the ENG-003 reference (uncommitted pi-consol work), reviewed and
 * extended with a replay window.
 *
 * WHY A SIGNATURE AND NOT A SHARED SECRET. An SNS HTTPS subscription sends no
 * custom headers and shares no secret, so there is nothing to HMAC with. AWS
 * signs each message with an RSA key and publishes the certificate; verifying
 * that signature IS the authentication for the endpoint.
 *
 * FAIL CLOSED, ALWAYS. There is no development bypass.
 *
 * WHAT IS VERIFIED, IN ORDER:
 *   1. the message is an object with a recognised `Type`
 *   2. `SignatureVersion` is one we can check (1 → SHA1, 2 → SHA256)
 *   3. `SigningCertURL` is https, on an `sns.<region>.amazonaws.com` host, and
 *      ends in `.pem` — BEFORE any fetch, because an unvalidated certificate URL
 *      in a signed-looking payload is an SSRF primitive
 *   4. the canonical string is rebuilt from the fields AWS signs, in AWS's
 *      order, and the RSA signature is verified against the certificate
 * Then, separately: the TopicArn is allow-listed (a valid AWS signature proves
 * the message came from AWS, not from OUR topic) and the Timestamp is inside the
 * replay window.
 */
import crypto from 'crypto';

export const SNS_MESSAGE_TYPES = ['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'] as const;
export type SnsMessageType = (typeof SNS_MESSAGE_TYPES)[number];

export interface SnsEnvelope {
  Type?: unknown;
  MessageId?: unknown;
  TopicArn?: unknown;
  Subject?: unknown;
  Message?: unknown;
  Timestamp?: unknown;
  SignatureVersion?: unknown;
  Signature?: unknown;
  SigningCertURL?: unknown;
  SubscribeURL?: unknown;
  Token?: unknown;
}

export type SnsVerificationFailure =
  | 'malformed_envelope'
  | 'unknown_message_type'
  | 'unsupported_signature_version'
  | 'invalid_certificate_url'
  | 'certificate_unavailable'
  | 'signature_mismatch';

/** One shape with nullable fields — `strict: false` does not narrow unions. */
export interface SnsVerificationResult {
  ok: boolean;
  type: SnsMessageType | null;
  topicArn: string | null;
  messageId: string | null;
  failure: SnsVerificationFailure | null;
  error: string | null;
}

const snsOk = (type: SnsMessageType, topicArn: string, messageId: string): SnsVerificationResult => ({
  ok: true, type, topicArn, messageId, failure: null, error: null,
});

const snsFail = (failure: SnsVerificationFailure, error: string): SnsVerificationResult => ({
  ok: false, type: null, topicArn: null, messageId: null, failure, error,
});

/**
 * The exact fields AWS signs, in the exact order, per message type. `Subject`
 * contributes to a Notification ONLY when present.
 */
const SIGNED_FIELDS: Readonly<Record<SnsMessageType, readonly string[]>> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

const SIGNATURE_ALGORITHMS: Readonly<Record<string, string>> = { '1': 'RSA-SHA1', '2': 'RSA-SHA256' };

/** `sns.<region>.amazonaws.com` and nothing else. */
const SNS_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export type CertificateFetcher = (url: string) => Promise<string | null>;

/** True when `url` is an https URL on an SNS host with a `.pem` path. */
export function isSnsCertificateUrl(url: unknown): boolean {
  const candidate = str(url);
  if (!candidate) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (!SNS_CERT_HOST.test(parsed.hostname)) return false;
  return parsed.pathname.endsWith('.pem');
}

/** Rebuild the string AWS signed: `name\nvalue\n` per present signed field. */
export function canonicalSnsString(type: SnsMessageType, message: SnsEnvelope): string {
  let out = '';
  for (const field of SIGNED_FIELDS[type]) {
    const value = (message as Record<string, unknown>)[field];
    if (typeof value !== 'string') continue;
    out += `${field}\n${value}\n`;
  }
  return out;
}

/**
 * Verify an SNS envelope's signature. Never throws. The certificate fetcher is
 * injected, so the host allow-list is the only way a certificate is obtained.
 */
export async function verifySnsSignature(message: unknown, fetchCertificate: CertificateFetcher): Promise<SnsVerificationResult> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return snsFail('malformed_envelope', 'SNS envelope must be a JSON object');
  }
  const envelope = message as SnsEnvelope;

  const type = str(envelope.Type);
  if (!type || !(SNS_MESSAGE_TYPES as readonly string[]).includes(type)) {
    return snsFail('unknown_message_type', 'unsupported SNS Type');
  }
  const messageType = type as SnsMessageType;

  const messageId = str(envelope.MessageId);
  const topicArn = str(envelope.TopicArn);
  const signature = str(envelope.Signature);
  if (!messageId || !topicArn || !signature || !str(envelope.Timestamp)) {
    return snsFail('malformed_envelope', 'MessageId, TopicArn, Timestamp and Signature are all required');
  }

  const version = str(envelope.SignatureVersion);
  const algorithm = version === null ? undefined : SIGNATURE_ALGORITHMS[version];
  if (!algorithm) return snsFail('unsupported_signature_version', 'unsupported SignatureVersion');

  // Validated BEFORE the fetch, deliberately.
  if (!isSnsCertificateUrl(envelope.SigningCertURL)) {
    return snsFail('invalid_certificate_url', 'SigningCertURL must be an https .pem URL on an sns.<region>.amazonaws.com host');
  }

  let certificate: string | null;
  try {
    certificate = await fetchCertificate(String(envelope.SigningCertURL));
  } catch {
    certificate = null;
  }
  if (!str(certificate)) return snsFail('certificate_unavailable', 'signing certificate could not be retrieved');

  let verified = false;
  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(canonicalSnsString(messageType, envelope), 'utf8');
    verified = verifier.verify(certificate as string, String(signature), 'base64');
  } catch {
    verified = false;
  }
  if (!verified) return snsFail('signature_mismatch', 'SNS signature verification failed');

  return snsOk(messageType, topicArn, messageId);
}

/** Parse the configured topic allow-list. Empty ⇒ the caller refuses everything. */
export function parseAllowedTopicArns(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** Constant-time membership test over the configured topic ARNs. */
export function isAllowedTopicArn(topicArn: string, allowed: readonly string[]): boolean {
  let matched = false;
  const candidate = Buffer.from(topicArn, 'utf8');
  for (const entry of allowed) {
    const expected = Buffer.from(entry, 'utf8');
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}

/**
 * The replay window.
 *
 * AWS documents a HARD limit of 3,600 seconds on the total retry time of an
 * HTTP/S delivery policy, and a redelivery keeps the original `Timestamp`. Two
 * hours therefore covers every legitimate (re)delivery with margin, while a
 * captured message cannot be replayed indefinitely. Idempotency on the SNS
 * MessageId already makes a replay harmless; the window bounds it as well.
 */
export const SNS_MAX_MESSAGE_AGE_MS = 2 * 60 * 60 * 1000;
export const SNS_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type SnsTimestampFailure = 'invalid_timestamp' | 'stale_message' | 'future_message';

export function checkSnsTimestamp(timestamp: unknown, nowMs: number = Date.now()): SnsTimestampFailure | null {
  const raw = str(timestamp);
  if (!raw) return 'invalid_timestamp';
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return 'invalid_timestamp';
  if (at > nowMs + SNS_MAX_FUTURE_SKEW_MS) return 'future_message';
  if (nowMs - at > SNS_MAX_MESSAGE_AGE_MS) return 'stale_message';
  return null;
}
