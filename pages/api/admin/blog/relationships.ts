import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ok = await requireSuperAdmin(req, res);
  if (!ok) return;

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
