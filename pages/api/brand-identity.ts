import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
/**
 * Unified Brand Runtime — Phase 3B. Voice-first brand-identity write path.
 *
 * POST /api/brand-identity  { action, companyId, ... }
 *   action=createDraft        → create/return the draft (prefilled from profile voice)
 *   action=updateDraft        → { patch: { voice:{tone,descriptors}, tagline } } (visual fields ignored)
 *   action=preview            → resolved DRAFT BrandRuntime (no publish)
 *   action=publishDraft       → publish the draft + invalidate cache
 *   action=rollbackPublished  → { version } pointer flip to a prior published version
 *
 * Thin handler: auth + dispatch to brandIdentityWriteService. No visual fields.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../backend/services/contentArchitectService';
import { supabase } from '../../backend/db/supabaseClient';
import { getProfile } from '../../backend/services/companyProfileService';
import {
  createDraft, updateDraft, previewBrand, publishDraft, rollbackPublished,
  createSupabaseBrandIdentityStore, BrandWriteError,
  type BrandWriteDeps, type BrandProfileVoiceSource,
} from '../../backend/services/brand/brandIdentityWriteService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'error', code: 'METHOD_NOT_ALLOWED' });
  }
  const body = (typeof req.body === 'object' && req.body ? req.body : {}) as Record<string, unknown>;
  const companyId = String((req.query.companyId as string) || body.companyId || body.company_id || '').trim();
  if (!companyId) return res.status(400).json({ status: 'error', code: 'COMPANY_ID_REQUIRED' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return; // resolveCompanyAccess already sent the auth error

  const action = String((req.query.action as string) || body.action || '').trim();

  const deps: BrandWriteDeps = {
    store: createSupabaseBrandIdentityStore(supabase as unknown as { from: (t: string) => any }),
    loadProfile: async (id): Promise<BrandProfileVoiceSource | null> => {
      const p = await getProfile(id).catch(() => null);
      if (!p) return null;
      const r = p as Record<string, unknown>;
      return {
        brandVoice: (r.brand_voice as string) ?? null,
        brandVoiceList: (r.brand_voice_list as string[]) ?? null,
        brandPositioning: (r.brand_positioning as string) ?? null,
        keyMessages: (r.key_messages as string) ?? null,
        targetAudience: (r.target_audience as string) ?? null,
      };
    },
  };

  try {
    switch (action) {
      case 'createDraft':
        return res.status(200).json({ status: 'ok', ...(await createDraft(companyId, deps)) });
      case 'updateDraft':
        return res.status(200).json({ status: 'ok', ...(await updateDraft(companyId, (body.patch ?? {}) as Record<string, unknown>, deps)) });
      case 'preview':
      case 'previewDraft':
        return res.status(200).json({ status: 'ok', runtime: await previewBrand(companyId, deps) });
      case 'publishDraft':
        return res.status(200).json({ status: 'ok', ...(await publishDraft(companyId, deps)) });
      case 'rollbackPublished': {
        const version = Number(body.version);
        if (!Number.isInteger(version)) return res.status(400).json({ status: 'error', code: 'VERSION_REQUIRED' });
        return res.status(200).json({ status: 'ok', ...(await rollbackPublished(companyId, version, deps)) });
      }
      default:
        return res.status(400).json({ status: 'error', code: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e instanceof BrandWriteError) return res.status(409).json({ status: 'error', code: e.code });
    return res.status(500).json({ status: 'error', code: 'BRAND_WRITE_FAILED', message: e instanceof Error ? e.message : String(e) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/brand-identity' });
