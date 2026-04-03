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
  /** 'community-ai' when the OAuth flow originates from a Community AI connector */
  flow?: string;
  /** Tenant / organization ID for community-ai flows */
  tenantId?: string;
  /** PKCE code_verifier for community-ai Twitter flows */
  codeVerifier?: string;
}

export function encodeOAuthState(params: OAuthStateParams): string {
  const payload: Record<string, string> = {
    cid: params.companyId || '',
    uid: params.userId || '',
    ts: String(Date.now()),
  };
  if (params.flow) payload.flo = params.flow;
  if (params.tenantId) payload.tid = params.tenantId;
  if (params.codeVerifier) payload.cv = params.codeVerifier;
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
      flow: parsed.flo || undefined,
      tenantId: parsed.tid || undefined,
      codeVerifier: parsed.cv || undefined,
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
