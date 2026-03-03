import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { saveProfile } from '../../../backend/services/companyProfileService';
import { isContentArchitectSession } from '../../../backend/services/contentArchitectService';

const normalizeWebsite = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  return withoutScheme.replace(/\/+$/, '');
};

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (isContentArchitectSession(req)) {
    return true;
  }
  // Legacy super-admin login: cookie takes precedence when user also has a Supabase session
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
    return true;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdminAccess(req, res))) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES' });
    }

    const companies = data || [];
    const companyIds = new Set(companies.map((company) => company.id));
    const { data: profileRows, error: profileError } = await supabase
      .from('company_profiles')
      .select('company_id,name,industry,website_url,created_at')
      .order('created_at', { ascending: false });
    if (!profileError && profileRows && profileRows.length > 0) {
      profileRows.forEach((profile) => {
        if (!profile.company_id || companyIds.has(profile.company_id)) return;
        companies.push({
          id: profile.company_id,
          name: profile.name || profile.website_url || 'Unnamed company',
          website: profile.website_url || '',
          industry: profile.industry || null,
          status: 'active',
          created_at: profile.created_at,
          source: 'company_profile',
        } as any);
      });
    }

    return res.status(200).json({ companies });
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

  if (req.method === 'PATCH') {
    const { companyId, status } = req.body || {};
    if (!companyId || !status) {
      return res.status(400).json({ error: 'companyId and status are required' });
    }
    if (!['active', 'inactive'].includes(String(status))) {
      return res.status(400).json({ error: 'INVALID_STATUS' });
    }

    const { data, error } = await supabase
      .from('companies')
      .update({ status: String(status) })
      .eq('id', companyId)
      .select('*')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_COMPANY' });
    }

    return res.status(200).json({ company: data });
  }

  if (req.method === 'DELETE') {
    const { companyId } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const { error: rolesError } = await supabase
      .from('user_company_roles')
      .delete()
      .eq('company_id', companyId);
    if (rolesError) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY_USERS' });
    }

    const { error: profileError } = await supabase
      .from('company_profiles')
      .delete()
      .eq('company_id', companyId);
    if (profileError) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY_PROFILE' });
    }

    const { error: companyError } = await supabase
      .from('companies')
      .delete()
      .eq('id', companyId);
    if (companyError) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
