/**
 * OAuth State Encoding/Decoding
 *
 * Encodes companyId + userId + returnTo into a compact state string.
 * Backward compatible: old colon-delimited and unsigned states are still parsed.
 */

import crypto from 'crypto';
import { config } from '@/config';

export interface OAuthStateParams {
  companyId?: string;
  userId?: string;
  returnTo?: string;
  flow?: string;
  tenantId?: string;
  codeVerifier?: string;
  valid?: boolean;
}

function getStateSigningKey(): string {
  return (
    config.ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'omnivyra-oauth-state'
  );
}

function signStatePayload(base: string, returnTo?: string): string {
  return crypto
    .createHmac('sha256', getStateSigningKey())
    .update(`${base}|${returnTo || ''}`)
    .digest('base64url');
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
  const signature = signStatePayload(base, params.returnTo);
  return params.returnTo ? `${base}.${signature}|${params.returnTo}` : `${base}.${signature}`;
}

export function decodeOAuthState(state: string | undefined): OAuthStateParams {
  if (!state || typeof state !== 'string') return { valid: false };

  const pipeIdx = state.indexOf('|');
  const signedBase = pipeIdx >= 0 ? state.slice(0, pipeIdx) : state;
  const returnToRaw = pipeIdx >= 0 ? state.slice(pipeIdx + 1) : '';
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : undefined;

  const dotIdx = signedBase.lastIndexOf('.');
  const base = dotIdx >= 0 ? signedBase.slice(0, dotIdx) : signedBase;
  const signature = dotIdx >= 0 ? signedBase.slice(dotIdx + 1) : '';
  const valid = Boolean(signature) && signature === signStatePayload(base, returnTo);

  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64').toString('utf8'));
    return {
      companyId: parsed.cid || undefined,
      userId: parsed.uid || undefined,
      flow: parsed.flo || undefined,
      tenantId: parsed.tid || undefined,
      codeVerifier: parsed.cv || undefined,
      returnTo,
      valid,
    };
  } catch {
    const result: OAuthStateParams = { returnTo, valid };
    if (base.startsWith('c:')) {
      const parts = base.split(':');
      if (parts.length >= 2 && parts[1]) result.companyId = parts[1];
    }
    return result;
  }
}
