import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/outreach/unsubscribe?t=<token> — WP3 / L4.
 *
 * AUTHENTICATION IS THE TOKEN. The link arrives from an email, so there is no
 * session. `verifyOutreachUnsubscribeToken` (AES-256-GCM) is the authentication:
 * a token that does not authenticate is refused before anything is read.
 *
 *   GET  — a confirmation page. It WRITES NOTHING: link scanners and prefetchers
 *          follow GET links, and an unsubscribe they trigger is not the
 *          recipient's act.
 *   POST — records the unsubscribe. Two senders reach it:
 *            • the confirmation page's form;
 *            • a mailbox provider's RFC 8058 one-click request
 *              (`List-Unsubscribe=One-Click` in a form-encoded body).
 *
 * RESPONSES. The success page is identical whether the restriction was new or
 * already in force. A failed write is NEVER shown as success: transient failures
 * answer 503 (try again), terminal ones 500. An invalid or unknown link answers
 * one generic page, whatever the reason.
 *
 * PRIVACY. The address is never logged or echoed. `Referrer-Policy: no-referrer`
 * keeps the token out of outbound Referer headers, and the page is not cached.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyOutreachUnsubscribeToken } from '../../../backend/security/outreachUnsubscribeToken';
import { recordOutreachUnsubscribe } from '../../../backend/services/leadOutreachExecution/unsubscribeService';
import { checkRateLimit, type RateLimitConfig } from '../../../lib/auth/rateLimit';
import { authRequestIp } from '../../../backend/auth/requestClientIp';

/**
 * Generous on purpose. One-click requests come from a few mailbox-provider
 * egress addresses, and refusing a genuine unsubscribe is the failure that
 * matters here — so a Redis outage FALLS BACK rather than closing.
 */
export const OUTREACH_UNSUBSCRIBE_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:outreach_unsubscribe',
  limit: 120,
  windowSecs: 60,
  onRedisFailure: 'fallback',
};

const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function page(res: NextApiResponse, status: number, title: string, message: string, form?: { token: string }): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  const action = form ? `<form method="post" action="?t=${escapeHtml(encodeURIComponent(form.token))}"><button type="submit">Unsubscribe</button></form>` : '';
  res.status(status).send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>`
    + '<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937}button{font:inherit;padding:.6rem 1.2rem;cursor:pointer}</style></head>'
    + `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${action}</body></html>`,
  );
}

const INVALID = ['Link not valid', 'This unsubscribe link is not valid. If you keep receiving emails you do not want, reply to one and ask to be removed.'] as const;

function readToken(req: NextApiRequest): string | null {
  const q = req.query?.t;
  if (typeof q === 'string' && q) return q;
  const body = req.body as Record<string, unknown> | null | undefined;
  if (body && typeof body === 'object' && typeof body.t === 'string' && body.t) return body.t;
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const limited = await checkRateLimit(`ip:${authRequestIp(req)}`, OUTREACH_UNSUBSCRIBE_LIMIT);
  if (!limited.allowed) {
    res.setHeader('Retry-After', '60');
    page(res, 429, 'Please try again', 'Too many requests. Please try again in a minute.');
    return;
  }

  const verification = verifyOutreachUnsubscribeToken(readToken(req));
  if (!verification.ok) {
    console.warn('[outreach-unsubscribe] token refused', { failure: verification.failure });
    page(res, 400, INVALID[0], INVALID[1]);
    return;
  }

  if (req.method === 'GET') {
    page(res, 200, 'Unsubscribe', 'Confirm that you no longer want to receive these emails.', { token: readToken(req) as string });
    return;
  }

  const body = req.body as Record<string, unknown> | null | undefined;
  const method = body && typeof body === 'object' && body['List-Unsubscribe'] === 'One-Click' ? 'one_click' : 'confirmation';
  const result = await recordOutreachUnsubscribe(verification.payload, method);

  switch (result.status) {
    case 'recorded':
      page(res, 200, 'You are unsubscribed', 'You will not receive these emails again.');
      return;
    case 'invalid_link':
      page(res, 400, INVALID[0], INVALID[1]);
      return;
    case 'retryable_failure':
      console.error('[outreach-unsubscribe] not recorded (retryable)', { reason: result.reason });
      res.setHeader('Retry-After', '30');
      page(res, 503, 'Please try again', 'We could not complete your request just now. Please try again shortly.');
      return;
    default:
      console.error('[outreach-unsubscribe] not recorded (terminal)', { reason: result.reason });
      page(res, 500, 'Something went wrong', 'We could not complete your request. Please reply to the email and ask to be removed.');
  }
}

export default __createApiRoute(handler, { route: '/api/outreach/unsubscribe' });
