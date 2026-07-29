/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-008 · Phase D.1 — runtime-hosted canonical shadow execution surface.
 *
 * Operator-ONLY, authenticated surface that runs the ISOLATED canonical shadow pipeline INSIDE the deployed
 * application runtime — where the AI gateway is fully initialized (a bare local operator returns a degraded
 * empty extraction). It orchestrates nothing new: it invokes exactly the deployed, certified functions:
 *
 *     acquireGroundedEvidence()  →  runCanonicalShadowJob()  →  persist ONLY report_settings.canonical_understanding
 *
 * NO reader change, NO customer-facing route, NO legacy mutation, NO feature flag. Additive and dormant
 * until a super-admin operator invokes it (auditable via structured logs). This is the exact code path
 * production shadow population will use.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { supabase } from '../../../backend/db/supabaseClient';
import { getProfile } from '../../../backend/services/companyProfileService';
import { acquireGroundedEvidence, makeProductionAcquisitionDeps } from '../../../backend/services/companyIntelligence/production/canonicalEvidenceAcquisition';
import { runCanonicalShadowJob, makeSupabaseShadowDeps } from '../../../backend/services/companyIntelligence/production/canonicalShadowJob';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Operator-only: signature-validated legacy super-admin session. No other role may reach the shadow path.
  if (!getLegacySuperAdminSession(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = (body.companyId as string | undefined) ?? (req.query.companyId as string | undefined);
  if (!companyId || typeof companyId !== 'string') return res.status(400).json({ error: 'companyId required' });

  try {
    const acqDeps = makeProductionAcquisitionDeps((id) => getProfile(id, { autoRefine: false, languageRefine: false }));
    const acquired = await acquireGroundedEvidence(companyId, acqDeps);
    if (!acquired.evidence) {
      console.warn('[operator:canonical-shadow] no evidence', { companyId, observability: acquired.observability });
      return res.status(200).json({ ok: false, reason: 'NO_EVIDENCE', observability: acquired.observability });
    }
    const result = await runCanonicalShadowJob(
      companyId,
      new Date().toISOString(),
      acquired.evidence,
      makeSupabaseShadowDeps(supabase),
    );
    console.info('[operator:canonical-shadow] executed', {
      companyId, wrote: result.wrote, abstained: result.abstained, version: result.version, acquisition: acquired.observability,
    });
    return res.status(200).json({ ok: true, result, observability: acquired.observability });
  } catch (error) {
    console.error('[operator:canonical-shadow] failed', { companyId, error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: 'canonical shadow job failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/operator/canonical-shadow' });
