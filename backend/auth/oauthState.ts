/**
 * OAuth State Encoding/Decoding
 *
 * Encodes companyId + userId + returnTo into a compact base64url state string.
 * Backward compatible: old colon-delimited states are still parsed as a fallback.
 */

export interface OAuthStateParams {
  companyId?: string;
  userId?: string;
  returnTo?: string;
}

export function encodeOAuthState(params: OAuthStateParams): string {
  const payload = {
    cid: params.companyId || '',
    uid: params.userId || '',
    ts: Date.now(),
  };
  const base = Buffer.from(JSON.stringify(payload)).toString('base64');
  return params.returnTo ? `${base}|${params.returnTo}` : base;
}

export function decodeOAuthState(state: string | undefined): OAuthStateParams {
  if (!state || typeof state !== 'string') return {};
  const pipeIdx = state.indexOf('|');
  const base = pipeIdx >= 0 ? state.slice(0, pipeIdx) : state;
  const returnToRaw = pipeIdx >= 0 ? state.slice(pipeIdx + 1) : '';
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : undefined;

  // Try new base64 JSON format first
  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64').toString('utf8'));
    return {
      companyId: parsed.cid || undefined,
      userId: parsed.uid || undefined,
      returnTo,
    };
  } catch {
    // ignore — fall through to legacy format
  }

  // Legacy format: c:${companyId}:platform:${ts}  or  platform_${ts}
  const result: OAuthStateParams = { returnTo };
  if (base.startsWith('c:')) {
    const parts = base.split(':');
    if (parts.length >= 2 && parts[1]) result.companyId = parts[1];
  }
  return result;
}
