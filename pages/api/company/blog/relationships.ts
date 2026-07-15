import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;

  // POST — create relationship
  if (req.method === 'POST') {
    const { source_blog_id, target_blog_id, relationship_type = 'related' } = req.body ?? {};

    if (!source_blog_id || !target_blog_id)
      return res.status(400).json({ error: 'source_blog_id and target_blog_id required' });
    if (source_blog_id === target_blog_id)
      return res.status(400).json({ error: 'source and target must differ' });
    if (!VALID_TYPES.has(relationship_type))
      return res.status(400).json({ error: 'Invalid relationship_type' });

    const { data, error } = await supabase
      .from('company_blog_relationships')
      .insert({ company_id, source_blog_id, target_blog_id, relationship_type })
      .select('id, source_blog_id, target_blog_id, relationship_type')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Relationship already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  // DELETE — remove relationship
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase
      .from('company_blog_relationships')
      .delete()
      .eq('id', id)
      .eq('company_id', company_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/blog/relationships' });
