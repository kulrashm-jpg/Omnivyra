import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BLOG_PUBLISH_MANAGE } from '../../../../shared/contracts/security';

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // All methods on this route are mutations — gate on BLOG_PUBLISH_MANAGE.
  const guard = await requireCapability(req, res, {
    capability: BLOG_PUBLISH_MANAGE,
    reason: 'blog relationship mutation',
  });
  if (guard.ok !== true) return;

  // ── POST — create relationship ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { source_blog_id, target_blog_id, relationship_type = 'related' } = req.body ?? {};

    if (!source_blog_id || !target_blog_id)
      return res.status(400).json({ error: 'source_blog_id and target_blog_id required' });
    if (source_blog_id === target_blog_id)
      return res.status(400).json({ error: 'source and target must differ' });
    if (!VALID_TYPES.has(relationship_type))
      return res.status(400).json({ error: 'Invalid relationship_type' });

    const { data, error } = await supabase
      .from('blog_relationships')
      .insert({ source_blog_id, target_blog_id, relationship_type })
      .select('id, source_blog_id, target_blog_id, relationship_type')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Relationship already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  // ── DELETE — remove relationship ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase.from('blog_relationships').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/blog/relationships' });
