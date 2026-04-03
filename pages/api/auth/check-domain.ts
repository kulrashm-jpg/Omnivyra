
/**
 * GET /api/auth/check-domain?domain=example.com
 *
 * Public endpoint. Checks whether a domain is already claimed by a company.
 * Accepts a domain name or full email address (domain is extracted).
 *
 * Query: domain (e.g. "acme.com" or "user@acme.com")
 * No auth required. Rate-limited by IP.
 * Returns: { taken: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';

type SuccessResponse = { taken: boolean };
type ErrorResponse   = { error: string };

const CHECK_DOMAIN_LIMIT = { ...LOGIN_LIMIT, keyPrefix: 'rl:check-domain', limit: 30, windowSecs: 60 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Rate limit by IP ───────────────────────────────────────────────────
  const ip = String(req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, CHECK_DOMAIN_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  // ── 2. Parse domain from query ────────────────────────────────────────────
  const raw = (req.query.domain as string)?.trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: 'domain query parameter is required' });

  // Accept either "acme.com" or "user@acme.com"
  const domain = raw.includes('@') ? raw.split('@')[1] : raw;
  if (!domain || !domain.includes('.')) return res.status(400).json({ error: 'Invalid domain' });

  // ── 3. Look up domain in company_domains table ────────────────────────────
  const { data: domainRow } = await supabase
    .from('company_domains')
    .select('id')
    .eq('domain', domain)
    .maybeSingle();

  return res.status(200).json({ taken: !!domainRow });
}
