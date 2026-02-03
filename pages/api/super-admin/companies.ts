import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { saveProfile } from '../../../backend/services/companyProfileService';

const normalizeWebsite = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  return withoutScheme.replace(/\/+$/, '');
};

const requireSuperAdminSession = (req: NextApiRequest, res: NextApiResponse): boolean => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (!hasSession) {
    res.status(403).json({ error: 'NOT_AUTHORIZED' });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireSuperAdminSession(req, res)) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES' });
    }

    return res.status(200).json({ companies: data || [] });
  }

  if (req.method === 'POST') {
    const { name, website, industry } = req.body || {};
    if (!name || !website) {
      return res.status(400).json({ error: 'name and website are required' });
    }

    const normalizedWebsite = normalizeWebsite(String(website));
    if (!normalizedWebsite) {
      return res.status(400).json({ error: 'website is invalid' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('companies')
      .select('id')
      .eq('website', normalizedWebsite)
      .limit(1);

    if (existingError) {
      return res.status(500).json({ error: 'FAILED_TO_VALIDATE_WEBSITE' });
    }
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'WEBSITE_ALREADY_EXISTS' });
    }

    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: String(name).trim(),
        website: normalizedWebsite,
        industry: industry ? String(industry).trim() : null,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'FAILED_TO_CREATE_COMPANY' });
    }

    const profileWebsite = String(website || '').trim() || normalizedWebsite;
    await saveProfile({
      company_id: data.id,
      name: data.name,
      industry: data.industry || undefined,
      website_url: profileWebsite,
    });

    return res.status(201).json({ company: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
