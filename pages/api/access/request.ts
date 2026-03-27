/**
 * POST /api/access/request
 *
 * Submit a free-credit access request for borderline domains.
 * Rate-limited: max 3 requests per IP per 24h.
 *
 * Body: { companyName, jobTitle, useCase, websiteUrl? }
 * Auth: Supabase Bearer token required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import crypto from 'crypto';
import { checkDomainEligibility } from '@/backend/services/domainEligibilityService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_HOURS = 24;

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.RATE_LIMIT_SALT ?? 'salt')).digest('hex');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });


  // ── Rate limit by IP ────────────────────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 3600 * 1000).toISOString();

  const { data: rateRow } = await supabase
    .from('access_request_rate_limit')
    .select('request_count, window_start')
    .eq('ip_hash', ipHash)
    .maybeSingle();

  if (rateRow && rateRow.window_start > windowStart && rateRow.request_count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many access requests. Please try again tomorrow.' });
  }

  // Upsert rate limit counter
  if (!rateRow || rateRow.window_start <= windowStart) {
    await supabase.from('access_request_rate_limit').upsert({
      ip_hash: ipHash,
      request_count: 1,
      window_start: new Date().toISOString(),
    }, { onConflict: 'ip_hash' });
  } else {
    await supabase
      .from('access_request_rate_limit')
      .update({ request_count: rateRow.request_count + 1 })
      .eq('ip_hash', ipHash);
  }

  // ── Domain eligibility check ────────────────────────────────────────────────
  if (!user.email) return res.status(400).json({ error: 'No email on account' });

  const eligibility = await checkDomainEligibility(user.email, user.id);
  if (eligibility.status === 'eligible') {
    return res.status(400).json({ error: 'Your domain is already eligible. No access request needed.' });
  }
  if (eligibility.status === 'blocked' && eligibility.reason !== 'public_provider') {
    return res.status(403).json({ error: 'This domain is not eligible for free credits.' });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { companyName, jobTitle, useCase, websiteUrl } = body as {
    companyName?: string;
    jobTitle?: string;
    useCase?: string;
    websiteUrl?: string;
  };

  if (!companyName || !useCase) {
    return res.status(400).json({ error: 'companyName and useCase are required' });
  }

  // ── Check for existing pending request ─────────────────────────────────────
  const { data: existing } = await supabase
    .from('access_requests')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: existing.status === 'approved'
        ? 'Your access request has already been approved.'
        : 'You already have a pending access request.',
      status: existing.status,
    });
  }

  // ── Get org membership ─────────────────────────────────────────────────────
  const { data: membership } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  // ── Insert access request ──────────────────────────────────────────────────
  const domain = user.email.split('@').pop() ?? '';
  const { data: newRequest, error: insertErr } = await supabase
    .from('access_requests')
    .insert({
      user_id: user.id,
      organization_id: membership?.company_id ?? null,
      email: user.email,
      domain,
      company_name: companyName,
      job_title: jobTitle ?? null,
      use_case: useCase,
      website_url: websiteUrl ?? null,
      domain_status: eligibility.reason,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[access/request]', insertErr.message);
    return res.status(500).json({ error: 'Failed to submit access request' });
  }

  return res.status(201).json({ success: true, requestId: newRequest.id });
}
