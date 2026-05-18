import crypto from 'crypto';
import type { CaptureForm } from './leadService';

export function verifyWebhookSignature(payload: string, secret: string, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const normalized = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(normalized, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function isAllowedOriginForForm(form: CaptureForm, originHeader: string | undefined): boolean {
  const allowed = Array.isArray(form.allowed_domains) ? form.allowed_domains.filter(Boolean) : [];
  if (allowed.length === 0) return true;
  if (!originHeader) return false;

  let host = '';
  try {
    host = new URL(originHeader).hostname.toLowerCase();
  } catch {
    return false;
  }

  return allowed.some((entry) => {
    const normalized = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    return normalized === host || host.endsWith(`.${normalized}`);
  });
}

export function buildWebhookIdempotencyKey(source: string, payload: unknown): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(`${source}:${body}`).digest('hex');
}
