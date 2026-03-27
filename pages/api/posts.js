
import { supabase } from '../../backend/db/supabaseClient';

export default async function handler(req, res) {
  if (req.method === 'GET') {
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
