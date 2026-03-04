import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const companyName = (body.companyName as string)?.trim();
    const websiteUrl = (body.websiteUrl as string)?.trim();
    const email = (body.email as string)?.trim() || null;
    const score = typeof body.score === 'number' ? body.score : Number(body.score);

    if (!companyName || !websiteUrl) {
      return res.status(400).json({ error: 'companyName and websiteUrl are required' });
    }
    if (Number.isNaN(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'score must be a number between 0 and 100' });
    }

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id ?? null;

    const { error } = await supabase.from('campaign_readiness_leads').insert({
      company_name: companyName,
      website_url: websiteUrl,
      email: email || null,
      score,
      user_id: userId,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('readiness-lead insert error', error);
      return res.status(500).json({ error: 'Failed to save lead' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('readiness-lead error', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
