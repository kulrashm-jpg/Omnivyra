import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'blog:relationships');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/blog/relationships', 'blog:relationships');
  }

  // â”€â”€ POST â€” create relationship â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ DELETE â€” remove relationship â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase.from('blog_relationships').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
