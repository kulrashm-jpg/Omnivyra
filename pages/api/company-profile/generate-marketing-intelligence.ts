import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  MARKETING_INTELLIGENCE_FIELD_NAMES,
  generateMarketingIntelligenceDraft,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { supabase } from '../../../backend/db/supabaseClient';
import { mergeAiScalarFields } from '../../../backend/services/companyProfile/aiProfileMerge';

const OUTPUT_FIELDS = [
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const draft = await generateMarketingIntelligenceDraft(profile);

    // e1 2026-11-13: an empty model field used to come back as '' and overwrite the stored value (the client spreads
    // this into the profile). Now, like define-marketing-intelligence: a non-empty draft value wins, else the current
    // stored value, else the key is omitted - never ''. Gates 55's scalar clear-lock ('' = a deliberate user clear).
    const structuredFields = mergeAiScalarFields(OUTPUT_FIELDS, draft as Record<string, unknown>, profile as unknown as Record<string, unknown>);

    try {
      await supabase.from('audit_logs').insert({
        action: 'MARKETING_INTELLIGENCE_GENERATED',
        actor_user_id: access.userId,
        company_id: null,
        metadata: {
          company_id: companyId,
          fields_generated: MARKETING_INTELLIGENCE_FIELD_NAMES.slice(),
        },
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('MARKETING_INTELLIGENCE_GENERATED audit failed', e);
    }

    return res.status(200).json({ structuredFields });
  } catch (err: any) {
    console.error('Generate marketing intelligence failed:', err);
    return res.status(500).json({
      error: 'Failed to generate marketing intelligence',
      details: err?.message || null,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/generate-marketing-intelligence' });
