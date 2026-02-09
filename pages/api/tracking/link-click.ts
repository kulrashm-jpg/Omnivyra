import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';

const hashIp = (ip?: string | null) => {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex');
};

const extractUtm = (url?: string | null) => {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      utm_source: parsed.searchParams.get('utm_source'),
      utm_campaign: parsed.searchParams.get('utm_campaign'),
      utm_content: parsed.searchParams.get('utm_content'),
    };
  } catch {
    return {};
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      tracking_url,
      campaign_id,
      platform,
      utm_source,
      utm_campaign,
      utm_content,
      user_agent,
    } = req.body || {};

    const forwardedFor = req.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '')
        .split(',')[0]
        .trim() ||
      req.socket?.remoteAddress ||
      null;

    const derivedUtm = extractUtm(tracking_url);
    const metadata = {
      tracking_url: tracking_url || null,
      campaign_id: campaign_id || null,
      platform: platform || null,
      utm_source: utm_source || derivedUtm.utm_source || null,
      utm_campaign: utm_campaign || derivedUtm.utm_campaign || null,
      utm_content: utm_content || derivedUtm.utm_content || null,
      user_agent: user_agent || req.headers['user-agent'] || null,
      ip_hash: hashIp(ip),
    };

    await supabase.from('audit_logs').insert({
      action: 'TRACKING_LINK_CLICK',
      actor_user_id: null,
      company_id: null,
      metadata,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Tracking link click error', error);
    return res.status(500).json({ error: 'Failed to log tracking click' });
  }
}
