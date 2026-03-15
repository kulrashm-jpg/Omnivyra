/**
 * Response Rules API
 * GET: List rules for organization
 * POST: Create rule
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
    const organizationId =
      (req.query.organization_id ?? req.query.organizationId ?? req.body?.organization_id ?? user?.defaultCompanyId) as
        | string
        | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    if (req.method === 'GET') {
      const platform = (req.query.platform as string)?.trim() || undefined;
      const intent = (req.query.intent_type as string)?.trim() || undefined;

      let query = supabase
        .from('response_rules')
        .select(`
          id, platform, intent_type, template_id, auto_reply, priority, created_at,
          response_templates(template_name)
        `)
        .eq('organization_id', organizationId)
        .order('priority', { ascending: false });

      if (platform) query = query.or(`platform.eq.${platform},platform.is.null`);
      if (intent) query = query.eq('intent_type', intent);

      const { data, error } = await query;

      if (error) {
        console.error('[response/rules]', error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ rules: data ?? [] });
    }

    const body = req.body || {};
    const platform = (body.platform ?? '').toString().trim() || null;
    const intent_type = (body.intent_type ?? '').toString().trim();
    const template_id = body.template_id;

    if (!intent_type || !template_id) {
      return res.status(400).json({ error: 'intent_type and template_id required' });
    }

    const { data, error } = await supabase
      .from('response_rules')
      .insert({
        organization_id: organizationId,
        platform,
        intent_type,
        template_id,
        auto_reply: Boolean(body.auto_reply),
        priority: Number(body.priority) || 0,
      })
      .select('id, platform, intent_type, template_id, auto_reply, priority, created_at')
      .single();

    if (error) {
      console.error('[response/rules]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/rules]', msg);
    return res.status(500).json({ error: msg });
  }
}
