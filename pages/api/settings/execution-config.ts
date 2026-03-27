/**
 * GET  /api/settings/execution-config   — read company execution flags
 * PUT  /api/settings/execution-config   — update company execution flags
 *
 * Body (PUT):
 *   {
 *     insights?: {
 *       market_trends?:       boolean,
 *       competitor_tracking?: boolean,
 *       ai_recommendations?:  boolean,
 *     },
 *     frequency?: {
 *       insights?: "1h" | "2h" | "8h"
 *     }
 *   }
 *
 * Auth: requires authenticated user with company membership.
 * The company_id is resolved from the authenticated user's session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  getCompanyExecutionFlags,
  setCompanyExecutionFlags,
  type CompanyExecutionFlags,
} from '../../../backend/services/intentExecutionService';

const VALID_FREQUENCIES = new Set(['1h', '2h', '8h']);

function validateBody(body: unknown): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Body must be an object' };
  const b = body as Record<string, unknown>;

  if (b.insights !== undefined) {
    if (typeof b.insights !== 'object' || b.insights === null) {
      return { valid: false, error: 'insights must be an object' };
    }
    const ins = b.insights as Record<string, unknown>;
    for (const field of ['market_trends', 'competitor_tracking', 'ai_recommendations'] as const) {
      if (field in ins && typeof ins[field] !== 'boolean') {
        return { valid: false, error: `insights.${field} must be a boolean` };
      }
    }
  }

  if (b.frequency !== undefined) {
    if (typeof b.frequency !== 'object' || b.frequency === null) {
      return { valid: false, error: 'frequency must be an object' };
    }
    const freq = b.frequency as Record<string, unknown>;
    if (freq.insights !== undefined && !VALID_FREQUENCIES.has(freq.insights as string)) {
      return { valid: false, error: 'frequency.insights must be "1h", "2h", or "8h"' };
    }
  }

  return { valid: true };
}

/** Resolve the company_id for the authenticated user from their profile. */
async function resolveCompanyId(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    return data?.company_id ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const companyId = await resolveCompanyId(user.id);
  if (!companyId) {
    return res.status(404).json({ error: 'No company found for this user' });
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const flags = await getCompanyExecutionFlags(companyId);
    return res.status(200).json({ companyId, flags });
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  const { valid, error: valError } = validateBody(req.body);
  if (!valid) return res.status(400).json({ error: valError });

  await setCompanyExecutionFlags(
    companyId,
    req.body as Partial<CompanyExecutionFlags>,
    user.id,
  );

  const updated = await getCompanyExecutionFlags(companyId);
  return res.status(200).json({ companyId, flags: updated });
}
