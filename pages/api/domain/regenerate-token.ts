/**
 * POST /api/domain/regenerate-token
 *
 * Issues a fresh per-domain verification token. The DB stores the new HMAC;
 * the raw token is returned in this response and never persisted server-side.
 *
 * Side effects:
 *   - verification_token  := HMAC(new_raw_token, VERIFICATION_SECRET)
 *   - verification_status := 'pending' (any prior 'verified' state is reset)
 *   - verification_method := null
 *   - verified_at         := null
 *   - audit_logs row: action=DOMAIN_TOKEN_REGENERATED
 *
 * Auth: COMPANY_ADMIN or SUPER_ADMIN active in the target company.
 *       force=true is NOT supported (no admin-override path here — the
 *       legitimate use case is "I lost my token" not "I want to bypass").
 *
 * Rate limit: 5/min/IP (matches /api/domain/verify).
 *
 * Response:
 *   200 { ok: true, token: <raw>, final_domain }
 *   400 { error: 'INVALID_DOMAIN' | 'NO_COMPANY_CONTEXT' }
 *   401 { error: 'UNAUTHENTICATED' }
 *   403 { error: 'INSUFFICIENT_PERMISSIONS' }
 *   404 { error: 'DOMAIN_NOT_FOUND' }
 *   429 { error: 'RATE_LIMITED' }
 *   500 { error: 'INTERNAL_ERROR' }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { logger } from '../../../backend/services/logger';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { normalizeDomain } from '../../../backend/services/domainCanonicalService';
import { hashVerificationToken } from '../../../backend/services/verificationSecret';
import { insertAuditLogStrict } from '../../../backend/services/auditActorService';

const REGEN_RATE_LIMIT = {
  keyPrefix: 'rl:domain_regenerate_token',
  limit: 5,
  windowSecs: 60,
};

type SuccessResponse = { ok: true; token: string; final_domain: string };
type ErrorResponse = { error: string; details?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const ip = String(
    req.headers['x-forwarded-for']
    ?? (req.socket as any)?.remoteAddress
    ?? 'unknown',
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, REGEN_RATE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'RATE_LIMITED' });

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const rawDomain = (body?.domain ?? '') as string;
  const domain = normalizeDomain(String(rawDomain));

  // Resolve user → active company → domain row
  const { data: userRow } = await supabase
    .from('users')
    .select('id, active_company_id')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();
  if (!userRow) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const internalUserId  = (userRow as any).id as string;
  const activeCompanyId = (userRow as any).active_company_id as string | null;

  // Look up the domain row. Two paths:
  //   - body.domain provided -> look up by final_domain (then verify the
  //     caller belongs to its owning company).
  //   - body.domain absent    -> use the caller's active_company_id and pick
  //     the primary domain.
  let domainRow:
    | { id: string; company_id: string; final_domain: string }
    | null = null;
  if (domain) {
    const { data, error } = await supabase
      .from('company_domains')
      .select('id, company_id, final_domain')
      .eq('final_domain', domain)
      .maybeSingle();
    if (error) {
      logger.error('regenerate_token_lookup_failed', { domain, message: error.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
    domainRow = (data as any) ?? null;
  } else {
    if (!activeCompanyId) {
      return res.status(400).json({ error: 'NO_COMPANY_CONTEXT' });
    }
    const { data } = await supabase
      .from('company_domains')
      .select('id, company_id, final_domain')
      .eq('company_id', activeCompanyId)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle();
    domainRow = (data as any) ?? null;
  }
  if (!domainRow) return res.status(404).json({ error: 'DOMAIN_NOT_FOUND' });

  // Authorization — COMPANY_ADMIN or SUPER_ADMIN in the owning company.
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', internalUserId)
    .eq('company_id', domainRow.company_id)
    .eq('status', 'active')
    .in('role', ['COMPANY_ADMIN', 'SUPER_ADMIN'])
    .limit(1)
    .maybeSingle();
  if (!roleRow) {
    return res.status(403).json({
      error: 'INSUFFICIENT_PERMISSIONS',
      details: 'Only COMPANY_ADMIN or SUPER_ADMIN may regenerate a domain token.',
    });
  }

  // Generate + hash + persist
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashed   = hashVerificationToken(rawToken);

  const { error: updErr } = await supabase
    .from('company_domains')
    .update({
      verification_token:  hashed,
      verification_status: 'pending',
      verification_method: null,
      verified_at:         null,
      verified:            false,
    })
    .eq('id', domainRow.id);
  if (updErr) {
    logger.error('regenerate_token_update_failed', {
      domain: domainRow.final_domain,
      message: updErr.message,
    });
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  // Audit — non-null actor enforced via insertAuditLogStrict.
  await insertAuditLogStrict({
    actorUserId: internalUserId,
    action:      'DOMAIN_TOKEN_REGENERATED',
    targetUserId: null,
    companyId:   domainRow.company_id,
    metadata: {
      final_domain: domainRow.final_domain,
      domain_record_id: domainRow.id,
    },
  });

  logger.info('domain_token_regenerated', {
    company_id: domainRow.company_id,
    final_domain: domainRow.final_domain,
    actor_user_id: internalUserId,
  });

  return res.status(200).json({
    ok: true,
    token: rawToken,
    final_domain: domainRow.final_domain,
  });
}
