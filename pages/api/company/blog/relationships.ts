import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { tenantContextFor, tenantTable } from '@/backend/db/tenantTable';

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;
  // S2: every read and write below is pinned to the company the access check resolved.
  const tenant = tenantContextFor(auth, company_id);

  // POST — create relationship
  if (req.method === 'POST') {
    const { source_blog_id, target_blog_id, relationship_type = 'related' } = req.body ?? {};

    if (!source_blog_id || !target_blog_id)
      return res.status(400).json({ error: 'source_blog_id and target_blog_id required' });
    if (source_blog_id === target_blog_id)
      return res.status(400).json({ error: 'source and target must differ' });
    if (!VALID_TYPES.has(relationship_type))
      return res.status(400).json({ error: 'Invalid relationship_type' });

    // Both ends must be THIS company's blogs (S2, 2026-11-12). Unchecked, a member
    // could link another tenant's blog ids - and the FK made the insert an
    // existence oracle for them (success vs 23503).
    const { data: own, error: ownErr } = await tenantTable('blogs', tenant)
      .select('id')
      .in('id', [String(source_blog_id), String(target_blog_id)]);
    if (ownErr || !Array.isArray(own)) return res.status(500).json({ error: ownErr?.message ?? 'blog lookup failed' });
    if (own.length !== 2) return res.status(404).json({ error: 'Blog not found' });

    const { data, error } = await tenantTable('company_blog_relationships', tenant)
      .insert({ source_blog_id, target_blog_id, relationship_type })
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

    const { error } = await tenantTable('company_blog_relationships', tenant)
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/blog/relationships' });
