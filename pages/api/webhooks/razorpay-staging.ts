import type { NextApiRequest, NextApiResponse } from 'next';
import { handleRazorpayStagingWebhook } from '@/backend/services/payments/razorpayStagingService';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await readRawBody(req);
  const signature = typeof req.headers['x-razorpay-signature'] === 'string'
    ? req.headers['x-razorpay-signature']
    : null;

  let outcome;
  try {
    outcome = await handleRazorpayStagingWebhook({ rawBody, signature });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  if (outcome.status === 'processed') return res.status(200).json({ ok: true, ...outcome });
  if (outcome.status === 'duplicate') return res.status(200).json({ ok: true, ...outcome });
  if (outcome.status === 'ignored') return res.status(202).json({ ok: true, ...outcome });
  if (outcome.reason === 'invalid_signature') return res.status(401).json({ ok: false, ...outcome });
  return res.status(400).json({ ok: false, ...outcome });
}
