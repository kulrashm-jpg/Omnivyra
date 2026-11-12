import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/onboarding/validate-company-name
 *
 * Checks if a company name is already taken in the system.
 * Also validates that the name is not empty and meets basic requirements.
 *
 * Body:
 *  {
 *    companyName: string -- Company name to validate (min 2 chars, max 100 chars)
 *  }
 *
 * Response:
 *  {
 *    available: boolean     -- true if name is available
 *    reason?: string        -- Error message if not available
 *  }
 *
 * No auth required (public endpoint for signup flow)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { checkRateLimit } from '../../../lib/auth/rateLimit';

/**
 * SECURITY (e1, 2026-11-12): this public endpoint answers "is this EXACT name taken". It passed the
 * raw input to `.ilike()`, where `%` `_` `\` (SQL LIKE) and `*` (PostgREST rewrites it to `%`) are
 * pattern characters - so 'A%' or 'A*' answered "is ANY company named A...", letting anyone enumerate
 * existing company names by prefix.
 * The CONTROL is `isExactNameMatch`: availability is decided by case-insensitive EQUALITY in code, so
 * whatever rows a pattern returns, the answer is about the exact name only. The pattern is also narrowed
 * (`likeCandidatePattern`: % _ \ escaped, `*` -> single-char `_`) so it fetches only same-length
 * candidates. The per-IP limit is a speed bump, not a control (the IP rests on a forwarding header).
 */
export function likeCandidatePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_');
}
export function isExactNameMatch(rowName: unknown, wanted: string): boolean {
  return typeof rowName === 'string' && rowName.trim().toLowerCase() === wanted.toLowerCase();
}
// No UI calls this endpoint today, so refusing during a limiter outage costs nothing: fail CLOSED.
const NAME_CHECK_LIMIT = { keyPrefix: 'rl:validate-company-name', limit: 30, windowSecs: 60, onRedisFailure: 'closed' as const };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { companyName } = req.body || {};

  // Validate input
  if (!companyName || typeof companyName !== 'string') {
    return res.status(400).json({ 
      available: false,
      reason: 'Company name is required' 
    });
  }

  const trimmed = companyName.trim();
  const candidates = likeCandidatePattern(trimmed);

  // Check length constraints
  if (trimmed.length < 2) {
    return res.status(400).json({ 
      available: false,
      reason: 'Company name must be at least 2 characters' 
    });
  }

  if (trimmed.length > 100) {
    return res.status(400).json({ 
      available: false,
      reason: 'Company name must not exceed 100 characters' 
    });
  }

  const rl = await checkRateLimit(authRequestIp(req), NAME_CHECK_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({ available: false, reason: 'Too many requests. Try again later.' });
  }

  try {
    // Check in companies table
    const { data: companiesResult, error: companiesError } = await supabase
      .from('companies')
      .select('id, name')
      .ilike('name', candidates) // candidates only - the decision is isExactNameMatch below
      .limit(50);

    if (companiesError) {
      console.error('[validate-company-name] companies query error:', companiesError);
      return res.status(500).json({ 
        available: false,
        reason: 'Could not validate company name (server error)' 
      });
    }

    if ((companiesResult ?? []).some((r: { name?: unknown }) => isExactNameMatch(r.name, trimmed))) {
      return res.status(200).json({ 
        available: false,
        reason: `Company name "${trimmed}" is already taken. Please choose a different name.` 
      });
    }

    // Check in company_profiles table as well (fallback storage)
    // cross-tenant: company-name-availability
    const { data: profilesResult, error: profilesError } = await supabase.from('company_profiles')
      .select('company_id, name')
      .ilike('name', candidates) // candidates only - the decision is isExactNameMatch below
      .limit(50);

    if (profilesError) {
      console.error('[validate-company-name] company_profiles query error:', profilesError);
      return res.status(500).json({ 
        available: false,
        reason: 'Could not validate company name (server error)' 
      });
    }

    if ((profilesResult ?? []).some((r: { name?: unknown }) => isExactNameMatch(r.name, trimmed))) {
      return res.status(200).json({ 
        available: false,
        reason: `Company name "${trimmed}" is already taken. Please choose a different name.` 
      });
    }

    // Name is available
    return res.status(200).json({ 
      available: true
    });
  } catch (err: any) {
    console.error('[validate-company-name] exception:', err);
    return res.status(500).json({ 
      available: false,
      reason: 'Could not validate company name' 
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/onboarding/validate-company-name' });
