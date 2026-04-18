/**
 * GET  /api/whatsapp/webhook   — Meta webhook verification (hub.challenge)
 * POST /api/whatsapp/webhook   — Incoming Meta webhook events (async)
 *
 * POST flow:
 *   1. Verify X-Hub-Signature-256 (HMAC-SHA256)
 *   2. Enqueue raw payload to whatsapp-webhook queue (jobId = sha256(body) for dedup)
 *   3. Return 200 immediately — processing happens in whatsappWebhookProcessor
 *
 * Replay protection: identical payloads produce same jobId — BullMQ ignores duplicates.
 * Security: APP_SECRET required in production; dev-only bypass if unset.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getContentQueue } from '../../../../backend/queue/contentGenerationQueues';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';
const APP_SECRET   = process.env.WHATSAPP_APP_SECRET ?? '';

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody: Buffer, signature: string): boolean {
  if (!APP_SECRET) {
    // Reject in production-like environments; allow in local dev only
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

  // ── GET: hub.challenge verification ──────────────────────────────────────
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge as string);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // ── POST: enqueue and ack immediately ────────────────────────────────────
  if (req.method === 'POST') {
    const rawBody = await readRawBody(req);
    const sig = (req.headers['x-hub-signature-256'] as string) ?? '';

    if (!verifySignature(rawBody, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Dedup key: sha256(rawBody hex) — identical replays from Meta produce same jobId
    const jobId = 'wa-webhook-' + crypto.createHash('sha256').update(rawBody).digest('hex');

    try {
      const queue = getContentQueue('whatsapp-webhook');
      await queue.add('wa-webhook-event', { payload }, {
        jobId,
        priority: 8,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      });
    } catch (err) {
      // Log but still ack — prevents Meta from retrying a payload we may have partially queued
      console.error('[whatsapp-webhook] enqueue failed', err);
    }

    // Ack immediately — Meta requires 200 within ~5s
    return res.status(200).json({ received: true });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
