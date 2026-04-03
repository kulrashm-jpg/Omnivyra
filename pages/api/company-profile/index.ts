import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  saveProfile,
  calculateCompanyProfileCompleteness,
  toLimitedCompanyProfile,
  upsertCompanyProfileGovernanceSettings,
  getCompanyProfileReviewStatus,
  type CompanyProfile,
} from '../../../backend/services/companyProfileService';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  computeCompanyContextCompletion,
  FORCED_CONTEXT_FIELD_LABELS,
} from '../../../backend/services/companyContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveCompanyAccess, getContentArchitectCompanyId, isContentArchitectSession } from '../../../backend/services/contentArchitectService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';

const DEFAULT_STRATEGIC_ASPECTS = ['Growth', 'Awareness', 'Conversion'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId =
    (req.query.companyId as string | undefined) ||
    (body.companyId as string | undefined) ||
    (body.company_id as string | undefined);
  const mode = (req.query.mode as string | undefined) || (body.mode as string | undefined);
  const includeCompleteness = req.query.includeCompleteness !== '0' && req.query.includeCompleteness !== 'false';

  if (req.method === 'GET') {
    try {
      if (mode === 'list') {
        // Legacy super admin takes precedence: when both super_admin_session and content_architect_session
        // exist (e.g. stale content architect cookie), treat as super admin so external-apis etc. work.
        const legacySuperAdmin = getLegacySuperAdminSession(req);
        if (legacySuperAdmin) {
          const { data: companyRows } = await supabase
            .from('companies')
            .select('id, name')
            .order('created_at', { ascending: false });
          const companyIds = new Set((companyRows || []).map((r: { id: string }) => r.id));
          const { data: profileRows } = await supabase
            .from('company_profiles')
            .select('company_id, name')
            .order('created_at', { ascending: false });
          const profiles = profileRows || [];
          const companies: Array<{ company_id: string; name: string }> = [];
          (companyRows || []).forEach((r: { id: string; name?: string }) => {
            companies.push({ company_id: r.id, name: r.name || r.id });
          });
          profiles.forEach((p: { company_id: string; name?: string }) => {
            if (p.company_id && !companyIds.has(p.company_id)) {
              companies.push({
                company_id: p.company_id,
                name: (p as { name?: string }).name || p.company_id,
              });
              companyIds.add(p.company_id);
            }
          });
          const rolesByCompany = companies.map((c) => ({
            company_id: c.company_id,
            role: 'SUPER_ADMIN',
          }));
          return res.status(200).json({ companies, rolesByCompany });
        }
        const archCompanyId = getContentArchitectCompanyId(req);
        if (archCompanyId) {
          const profile = await getProfile(archCompanyId, { autoRefine: false, languageRefine: true });
          return res.status(200).json({
            companies: [{ company_id: archCompanyId, name: profile?.name || archCompanyId }],
            rolesByCompany: [{ company_id: archCompanyId, role: 'CONTENT_ARCHITECT' }],
          });
        }
        if (isContentArchitectSession(req)) {
          const { data: rows } = await supabase.from('company_profiles').select('company_id, name');
          const companies = (rows || []).map((r: { company_id: string; name?: string }) => ({
            company_id: r.company_id,
            name: r.name || r.company_id,
          }));
          const rolesByCompany = companies.map((c: { company_id: string }) => ({
            company_id: c.company_id,
            role: 'CONTENT_ARCHITECT',
          }));
          return res.status(200).json({ companies, rolesByCompany });
        }
        const { user, error } = await getSupabaseUserFromRequest(req);
        if (error || !user) {
          return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        // Only companies this user has an active role for — Company Admin never sees other companies
        const { data: roleRows, error: roleError } = await supabase
          .from('user_company_roles')
          .select('company_id, role, status')
          .eq('user_id', user.id)
          .eq('status', 'active');
        if (roleError) {
          return res.status(500).json({ error: 'FAILED_TO_LOAD_COMPANIES' });
        }
        const rows = roleRows || [];
        const companyIdSet = new Set<string>(rows.map((r: { company_id?: string }) => r.company_id).filter(Boolean) as string[]);
        const companyIds = Array.from(companyIdSet);
        const normalizeListRole = (r: string) => (r?.toUpperCase() === 'ADMIN' ? 'COMPANY_ADMIN' : r);
        const rolesByCompany = rows.map((row: { company_id: string; role: string }) => ({
          company_id: row.company_id,
          role: normalizeListRole(row.role || ''),
        }));
        const profiles = await Promise.all(
          companyIds.map(async (id) => {
            const profile = await getProfile(id, { autoRefine: false, languageRefine: true });
            return profile || { company_id: id, name: id };
          })
        );
        return res.status(200).json({
          companies: profiles.map((profile) => ({
            company_id: profile.company_id,
            name: profile.name || profile.company_id,
          })),
          rolesByCompany,
        });
      }

      const access = await resolveCompanyAccess(req, res, companyId);
      if (!access) return;

      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
      const resolvedProfile = profile || await saveProfile({ company_id: companyId });
      const isCompanyAdminOnly = access.role === 'COMPANY_ADMIN';
      const responseProfile = isCompanyAdminOnly
        ? (toLimitedCompanyProfile(resolvedProfile) ?? resolvedProfile)
        : resolvedProfile;
      const response: Record<string, unknown> = { profile: responseProfile };
      response.company_profile_review = getCompanyProfileReviewStatus(resolvedProfile);

      // Recommendation tab: profile-driven strategic config. Content Architect overrides from profile.strategic_inputs.
      const overrides = (resolvedProfile as { strategic_inputs?: { strategic_aspects?: string[]; offerings_by_aspect?: Record<string, string[]>; strategic_objectives?: string[] } | null })?.strategic_inputs;
      const profileAspects = [
        ...(Array.isArray((resolvedProfile as unknown as { content_themes?: string[] | null })?.content_themes)
          ? ((resolvedProfile as unknown as { content_themes?: string[] | null }).content_themes ?? [])
          : []),
        ...(Array.isArray((resolvedProfile as unknown as { campaign_focus?: string[] | null })?.campaign_focus)
          ? ((resolvedProfile as unknown as { campaign_focus?: string[] | null }).campaign_focus ?? [])
          : []),
      ]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
      const strategic_aspects =
        Array.isArray(overrides?.strategic_aspects) && overrides.strategic_aspects.length > 0
          ? overrides.strategic_aspects
          : (profileAspects.length > 0 ? Array.from(new Set(profileAspects)).slice(0, 12) : DEFAULT_STRATEGIC_ASPECTS);
      const offerings_by_aspect =
        overrides?.offerings_by_aspect && typeof overrides.offerings_by_aspect === 'object'
          ? overrides.offerings_by_aspect
          : {};
      response.recommendation_strategic_config = {
        strategic_aspects,
        aspect_offerings_map: offerings_by_aspect,
        offerings_by_aspect,
        ranked_aspects: strategic_aspects,
        aspect_anchors: strategic_aspects.map((aspect) => ({ aspect, intent_tags: [] })),
        offering_tags: [],
        strategic_objectives: Array.isArray(overrides?.strategic_objectives) ? overrides.strategic_objectives : undefined,
      };

      let completeness = null;
      if (includeCompleteness) {
        try {
          completeness = calculateCompanyProfileCompleteness(resolvedProfile);
          response.overall_profile_completion = completeness?.score ?? 0;
          if (isCompanyAdminOnly) {
            response.problem_transformation_completion = 0;
            response.section_scores = {};
            response.company_context_completion = undefined;
            response.forced_context_enabled_fields = undefined;
            response.forced_context_active_labels = undefined;
            response.completeness = undefined;
          } else {
            response.problem_transformation_completion = completeness?.section_scores?.problem_transformation ?? 0;
            response.section_scores = completeness?.section_scores ?? {};
            response.completeness = completeness;
            const companyContext = buildCompanyContext(resolvedProfile);
            const { forced_context_enabled_fields } = buildForcedCompanyContext(
              companyContext,
              resolvedProfile?.forced_context_fields
            );
            response.company_context_completion = computeCompanyContextCompletion(companyContext);
            response.forced_context_enabled_fields = forced_context_enabled_fields;
            response.forced_context_active_labels = forced_context_enabled_fields.map(
              (key: string) => FORCED_CONTEXT_FIELD_LABELS[key] || key.replace(/_/g, ' ')
            );
          }
        } catch (e) {
          response.problem_transformation_completion = 0;
          response.overall_profile_completion = 0;
          response.section_scores = {};
        }
      } else {
        response.problem_transformation_completion = 0;
        response.overall_profile_completion = 0;
        response.section_scores = {};
      }
      return res.status(200).json(response);
    } catch (error: any) {
      console.error('Error fetching company profile:', error);
      return res.status(500).json({ error: 'Failed to fetch company profile' });
    }
  }

  if (req.method === 'POST') {
    try {
      const resolvedCompanyId = companyId?.trim?.() || companyId;
      if (!resolvedCompanyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      const access = await resolveCompanyAccess(req, res, resolvedCompanyId);
      if (!access) return;
      const existingProfile = await getProfile(resolvedCompanyId, { autoRefine: false, languageRefine: false });
      const normalizedRole = String(access.role ?? '').toUpperCase();
      const incomingReportSettings =
        (body.report_settings as CompanyProfile['report_settings'] | undefined) ?? undefined;
      const payload = {
        ...body,
        company_id: resolvedCompanyId,
        report_settings: upsertCompanyProfileGovernanceSettings({
          existingReportSettings: existingProfile?.report_settings,
          incomingReportSettings,
          confirmedByRole:
            normalizedRole === 'COMPANY_ADMIN' || normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'ADMIN'
              ? normalizedRole
              : null,
        }),
      };
      const profile = await saveProfile(payload);
      const responseProfile =
        access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(profile) ?? profile : profile;
      return res.status(200).json({
        profile: responseProfile,
        company_profile_review: getCompanyProfileReviewStatus(profile),
      });
    } catch (error: any) {
      console.error('Error saving company profile:', error);
      const message = error?.message && typeof error.message === 'string' ? error.message : 'Failed to save company profile';
      return res.status(500).json({ error: message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
