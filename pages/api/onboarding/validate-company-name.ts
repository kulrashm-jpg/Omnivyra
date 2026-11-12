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
 * SECURITY (e1 S2, 2026-11-12): this public endpoint answers "is this EXACT name taken". It passed the
 * raw input to `.ilike()`, where `%` `_` and `\` are pattern characters - so 'A%' answered "is ANY
 * company named A...", letting anyone enumerate existing company names by prefix. The input is now
 * escaped (exact, case-insensitive match) and the endpoint is rate-limited per IP.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
const NAME_CHECK_LIMIT = { keyPrefix: 'rl:validate-company-name', limit: 30, windowSecs: 60 };

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
  const exact = escapeLikePattern(trimmed);

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
      .ilike('name', exact) // exact, case-insensitive (wildcards escaped)
      .limit(1);

    if (companiesError) {
      console.error('[validate-company-name] companies query error:', companiesError);
      return res.status(500).json({ 
        available: false,
        reason: 'Could not validate company name (server error)' 
      });
    }

    if (companiesResult && companiesResult.length > 0) {
      return res.status(200).json({ 
        available: false,
        reason: `Company name "${trimmed}" is already taken. Please choose a different name.` 
      });
    }

    // Check in company_profiles table as well (fallback storage)
    // cross-tenant: company-name-availability
    const { data: profilesResult, error: profilesError } = await supabase.from('company_profiles')
      .select('company_id, name')
      .ilike('name', exact) // exact, case-insensitive (wildcards escaped)
      .limit(1);

    if (profilesError) {
      console.error('[validate-company-name] company_profiles query error:', profilesError);
      return res.status(500).json({ 
        available: false,
        reason: 'Could not validate company name (server error)' 
      });
    }

    if (profilesResult && profilesResult.length > 0) {
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
