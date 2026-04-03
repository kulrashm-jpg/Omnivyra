
/**
 * Response Templates API
 * GET: List templates for organization
 * POST: Create template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const orgParam = req.query.organization_id ?? req.query.organizationId ?? (req.body && (req.body as Record<string, unknown>).organization_id);
    const organizationId = (orgParam ?? user?.defaultCompanyId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    if (req.method === 'GET') {
      const platform = (req.query.platform as string)?.trim() || undefined;
      let query = supabase
        .from('response_templates')
        .select('id, template_name, platform, template_structure, tone, emoji_policy, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (platform) {
        query = query.or(`platform.eq.${platform},platform.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[response/templates]', error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ templates: data ?? [] });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const template_name = (body.template_name ?? '').toString().trim();
    const template_structure = (body.template_structure ?? '').toString().trim();

    if (!template_name || !template_structure) {
      return res.status(400).json({ error: 'template_name and template_structure required' });
    }

    const { data, error } = await supabase
      .from('response_templates')
      .insert({
        organization_id: organizationId,
        template_name,
        platform: (body.platform as string)?.trim() || null,
        template_structure,
        tone: (body.tone as string) ?? 'professional',
        emoji_policy: (body.emoji_policy as string) ?? 'minimal',
      })
      .select('id, template_name, platform, template_structure, tone, emoji_policy, created_at')
      .single();

    if (error) {
      console.error('[response/templates]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/templates]', msg);
    return res.status(500).json({ error: msg });
  }
}
