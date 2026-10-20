import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/webhooks/ses — SES delivery, bounce and complaint events via SNS.
 * WP3 / L6–L9. Adapted from the ENG-003 reference (pi-consol), reviewed.
 *
 * ORDER OF OPERATIONS:
 *   1. refuse everything unless `SES_SNS_TOPIC_ARNS` is configured
 *   2. read the RAW body — the signature covers the bytes
 *   3. `verifySnsSignature` — nothing in the payload is trusted before this
 *   4. the TopicArn must be allow-listed: any AWS account can have AWS sign its
 *      own notifications, so a valid signature alone proves nothing about OURS
 *   5. the Timestamp must be inside the replay window
 *   6. only then is `Message` interpreted as an SES event
 *
 * SUBSCRIPTION CONFIRMATION IS MANUAL. A verified `SubscriptionConfirmation` is
 * logged for an operator; this endpoint never fetches the SubscribeURL — an
 * outbound request to a URL taken from an inbound payload is an SSRF shape.
 *
 * STATUS CODES ARE THE RETRY PROTOCOL (SNS retries 5xx/429 only):
 *   200 processed, duplicate or deliberately dropped · 401 signature, topic or
 *   timestamp refused · 422 authentic but terminal · 503 transient — retry.
 *
 * FAIL CLOSED in every environment; there is no development bypass.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import https from 'https';
import {
  checkSnsTimestamp,
  isAllowedTopicArn,
  isSnsCertificateUrl,
  parseAllowedTopicArns,
  verifySnsSignature,
  type CertificateFetcher,
} from '../../../backend/services/providerEvents/snsSignature';
import { ingestSesEvent } from '../../../backend/services/providerEvents/sesProviderEventIngestion';

export const config = { api: { bodyParser: false } };

export const SES_SNS_TOPIC_ARNS_ENV = 'SES_SNS_TOPIC_ARNS';

/**
 * Hard cap on the request body, enforced WHILE reading (bodyParser is off, so
 * nothing else bounds it, and the read happens before authentication).
 *
 * AWS: an SNS message is at most 262,144 bytes (256 KiB) by default — a topic
 * owner may raise `MaximumMessageSize` to 1 MiB — and message attributes add at
 * most 16 KiB. The message arrives JSON-escaped inside the SNS envelope, which
 * can grow it (quotes, backslashes, `\uXXXX`); 1 MiB covers a default-size
 * message even at three times its size, plus attributes and envelope fields.
 * OPERATING CONSTRAINT: the SES events topic keeps the default
 * `MaximumMessageSize`. Raising it requires revisiting this cap.
 */
export const SES_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

/** Certificates are immutable per URL; cached per process. */
const certificateCache = new Map<string, string>();

/** Signing-certificate fetch limits. */
export const CERTIFICATE_FETCH_TIMEOUT_MS = 5000;
export const CERTIFICATE_MAX_BYTES = 65536;

/** Tests only: the real fetcher, and a way to empty its cache. */
export function __clearSnsCertificateCacheForTests(): void {
  certificateCache.clear();
}

export const fetchSigningCertificate: CertificateFetcher = async (url) => {
  // Re-checked here: this is the function that opens a socket.
  if (!isSnsCertificateUrl(url)) return null;
  const cached = certificateCache.get(url);
  if (cached) return cached;

  return new Promise<string | null>((resolve) => {
    const request = https.get(url, { timeout: CERTIFICATE_FETCH_TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve(null);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        // A signing certificate is a few kilobytes. Anything larger is not one.
        if (body.length > CERTIFICATE_MAX_BYTES) {
          request.destroy();
          resolve(null);
        }
      });
      response.on('end', () => {
        if (body.includes('BEGIN CERTIFICATE')) {
          certificateCache.set(url, body);
          resolve(body);
        } else {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
  });
};

let certificateFetcher: CertificateFetcher = fetchSigningCertificate;
/** Tests only: substitute the network fetch. `null` restores the real one. */
export function __setSnsCertificateFetcherForTests(fetcher: CertificateFetcher | null): void {
  certificateFetcher = fetcher ?? fetchSigningCertificate;
}

interface BoundedBody {
  body: Buffer | null;
  failure: 'too_large' | 'unreadable' | null;
}

/**
 * Read the raw body, refusing it the moment it exceeds `limit` bytes. Bytes past
 * the limit are never buffered: the listener is detached and the rest of the
 * stream is drained into nothing. A stream error is reported as `unreadable`;
 * the error itself (which may echo payload) is not surfaced.
 */
function readBoundedBody(req: NextApiRequest, limit: number): Promise<BoundedBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (result: BoundedBody) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      resolve(result);
    };
    function onData(chunk: unknown) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > limit) {
        settle({ body: null, failure: 'too_large' });
        req.resume(); // discard the remainder without buffering it
        return;
      }
      chunks.push(buf);
    }
    req.on('data', onData);
    req.on('end', () => settle({ body: Buffer.concat(chunks), failure: null }));
    req.on('error', () => settle({ body: null, failure: 'unreadable' }));
  });
}

function tooLarge(res: NextApiResponse): void {
  res.setHeader('Connection', 'close');
  res.status(413).json({ error: 'Payload too large' });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const allowedTopics = parseAllowedTopicArns(process.env[SES_SNS_TOPIC_ARNS_ENV]);
  if (allowedTopics.length === 0) {
    console.error('[ses-webhook] refused: SES_SNS_TOPIC_ARNS is unset');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // An honest Content-Length above the cap is refused before any byte is read;
  // a dishonest or absent one is caught by the bounded read below.
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > SES_WEBHOOK_MAX_BODY_BYTES) {
    tooLarge(res);
    return;
  }

  const read = await readBoundedBody(req, SES_WEBHOOK_MAX_BODY_BYTES);
  if (read.failure === 'too_large') {
    tooLarge(res);
    return;
  }
  if (read.failure || !read.body) {
    res.status(400).json({ error: 'Unreadable body' });
    return;
  }

  const envelope = safeParse(read.body.toString('utf8'));
  if (envelope === null) {
    res.status(400).json({ error: 'Malformed JSON' });
    return;
  }

  // Cheap pre-filter BEFORE the certificate fetch: a message that does not even
  // CLAIM one of our topics is refused without any outbound request. This is not
  // the authorization — the claim is unauthenticated — so the topic is checked
  // again, authoritatively, after the signature below.
  const claimedTopic = (envelope as { TopicArn?: unknown } | null)?.TopicArn;
  if (typeof claimedTopic !== 'string' || !isAllowedTopicArn(claimedTopic, allowedTopics)) {
    console.error('[ses-webhook] claimed topic not allow-listed; no certificate fetched');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const verification = await verifySnsSignature(envelope, certificateFetcher);
  if (!verification.ok) {
    console.error('[ses-webhook] signature rejected', { failure: verification.failure });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!isAllowedTopicArn(verification.topicArn as string, allowedTopics)) {
    console.error('[ses-webhook] topic not allow-listed');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const stale = checkSnsTimestamp((envelope as { Timestamp?: unknown }).Timestamp);
  if (stale) {
    console.error('[ses-webhook] timestamp refused', { failure: stale, messageId: verification.messageId });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (verification.type === 'SubscriptionConfirmation' || verification.type === 'UnsubscribeConfirmation') {
    console.warn('[ses-webhook] subscription message received; operator action required', {
      type: verification.type, messageId: verification.messageId,
    });
    res.status(200).json({ ok: true, action: 'operator_confirmation_required' });
    return;
  }

  const body = (envelope as { Message?: unknown }).Message;
  const sesPayload = typeof body === 'string' ? safeParse(body) : body;
  const result = await ingestSesEvent(sesPayload, verification.messageId as string);

  switch (result.status) {
    case 'processed':
      res.status(200).json({ ok: true, duplicate: result.duplicate, eventType: result.eventType, governance: result.governance });
      return;
    case 'dropped':
      res.status(200).json({ ok: true, dropped: result.reason, eventType: result.eventType });
      return;
    case 'retryable':
      console.error('[ses-webhook] transient failure; SNS will retry', { reason: result.reason, messageId: verification.messageId });
      res.status(503).json({ error: result.reason });
      return;
    default:
      console.error('[ses-webhook] event refused', { reason: result.reason, messageId: verification.messageId });
      res.status(422).json({ error: result.reason });
  }
}

export default __createApiRoute(handler, { route: '/api/webhooks/ses' });
