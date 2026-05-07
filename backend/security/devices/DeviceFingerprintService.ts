/**
 * DeviceFingerprintService — server-side device fingerprint computation.
 *
 * Wave 2A inlined a cheap djb2-style hash inside IdentityResolver. This
 * service supersedes that with a SHA-256-backed fingerprint over a
 * normalized input set. Inputs:
 *   - User-Agent header
 *   - Accept-Language header
 *   - The set of cookie NAMES present (sorted; values excluded)
 *
 * NEVER trust client-supplied identifiers. NEVER include cookie values
 * (those are auth secrets) or IP (mobile churn).
 */

import { createHash } from 'crypto';
import type { NextApiRequest } from 'next';
import type { DeviceFingerprintInputs } from './trustedDeviceTypes';

const FINGERPRINT_VERSION = 'v2sha256';

export function fingerprintFromInputs(inputs: DeviceFingerprintInputs): string {
  const ua = (inputs.userAgent ?? '').slice(0, 512);
  const al = (inputs.acceptLanguage ?? '').slice(0, 256);
  const cookieList = [...inputs.cookieNames]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');

  const normalized = `${FINGERPRINT_VERSION}|${ua}|${al}|${cookieList}`;
  const hash = createHash('sha256').update(normalized, 'utf8').digest('base64url');
  return `dv-${hash}`;
}

export function fingerprintFromRequest(req: NextApiRequest): string {
  const ua = headerString(req.headers['user-agent']);
  const al = headerString(req.headers['accept-language']);
  const cookieNames = parseCookieNames(req.headers.cookie);
  return fingerprintFromInputs({ userAgent: ua, acceptLanguage: al, cookieNames });
}

function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return String(value[0] ?? '');
  return null;
}

function parseCookieNames(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  if (!text) return [];
  return text
    .split(';')
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}
