
import { supabase } from '../../backend/db/supabaseClient';
import { requireSuperAdminUser } from '../../backend/services/requestAccessService';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // ROUTE-AUTH-001 (STEP 3AH-85): this returns the latest post_events rows of
    // EVERY tenant (no company filter). It has no known caller; until it is
    // retired it is platform diagnostics, so super admin only.
    const admin = await requireSuperAdminUser(req, res);
    if (!admin) return;

    const { data, error } = await supabase
      .from('post_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(200).json(data);
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
