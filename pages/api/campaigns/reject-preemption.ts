import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/reject-preemption
 * Rejects a pending preemption request.
 * Sets status = REJECTED, rejected_at = NOW(). No campaign change.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { rejectPreemptionRequest, PreemptionValidationError } from '../../../backend/services/CampaignPreemptionService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

/**
 * Postgres / PostgREST error codes that will NOT succeed on a client retry. Pattern borrowed from
 * billing/holdSettlementState (enumerate the definitive codes) - not its function, whose semantics are about commit.
 *
 * DEFAULT POLARITY (05): an UNKNOWN code here defaults to RETRYABLE (503), the opposite of isDefinitiveDbRefusal, which
 * defaults an unknown code to NOT definitive. Both follow one rule - the default points AWAY from the irreversible
 * outcome: there, wrongly calling an error definitive releases a hold that may have settled (money); here, wrongly
 * calling one permanent only denies a retry of a transient read (availability, nothing to undo).
 *
 * PGRST116 (singular row-count mismatch) is deliberately NOT listed: this route reads with maybeSingle(), where zero
 * rows is data=null (the 404 branch) and >1 rows cannot happen on a primary-key filter - so it falls to the default.
 */
const PERMANENT_READ_ERROR_CODES = new Set([
  '42501', '42P01', '42703', '42883', '42601', '42804', '42846', '42P02',   // privilege / schema / statement errors
  'PGRST100', 'PGRST202', 'PGRST204', 'PGRST205',                             // query parse + schema-cache misses
]);
/** Caller input the server can never process (a malformed id): the request is invalid, not the server broken (05). */
const INVALID_INPUT_CODES = new Set(['22P02']);
/** Schema-cache misses: permanent for the CLIENT, but an operator reload fixes them - log them as such (05). */
const SCHEMA_CACHE_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205'])

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { requestId, companyId } = req.body || {};

    if (!requestId || !companyId) {
      return res.status(400).json({
        error: 'requestId and companyId are required',
      });
    }

    const { data: request, error: fetchError } = await supabase
      .from('campaign_preemption_requests')
      .select('id, initiator_campaign_id')
      .eq('id', requestId)
      .maybeSingle();

    // Reads contract: a FAILED read is not "not found" - refuse retryably instead of a permanent 404.
    if (fetchError) {
      console.error('[reject-preemption] request read failed', { requestId, code: fetchError.code, message: fetchError.message });
      // 05: only promise a retry when one can help. A definitively-fatal error (privilege / schema) is a 500 without
      // retryable - the client must not loop on it. Allow-list of PERMANENT codes; everything else defaults to 503.
      const code = String(fetchError.code ?? '');
      if (INVALID_INPUT_CODES.has(code)) {
        return res.status(400).json({ error: 'Invalid preemption request id' });
      }
      if (PERMANENT_READ_ERROR_CODES.has(code)) {
        if (SCHEMA_CACHE_CODES.has(code)) console.error('[reject-preemption] schema cache miss - an operator schema reload fixes this', { code });
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: 'Preemption request could not be loaded. Please retry.', retryable: true });
    }
    if (!request) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: request.initiator_campaign_id,
      requireCampaignId: true,
    });
    if (!access) return;

    await rejectPreemptionRequest(requestId);

    return res.status(200).json({
      status: 'REJECTED',
      requestId,
    });
  } catch (err: unknown) {
    if (err instanceof PreemptionValidationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        rejected: true,
      });
    }
    // e9: never echo internal error text (it can carry table names / seam detail) - log it, answer generically.
    console.error('[reject-preemption]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/reject-preemption' });
