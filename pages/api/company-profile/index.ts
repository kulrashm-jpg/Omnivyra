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
import {
  calculateIntelligenceReadiness,
  getCompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveCompanyAccess, getContentArchitectCompanyId, isContentArchitectSession } from '../../../backend/services/contentArchitectService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { extractDomain } from '../../../backend/services/companyMatchService';
import { filterCompatibleCompanyRoleRows } from '../../../backend/services/companyMembershipIntegrityService';
import { buildUnifiedCompetitorIntelligence } from '../../../backend/services/unifiedCompetitorIntelligenceService';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';
import { sendAuthError } from '../../../backend/services/sendAuthError';

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
          const profile = await getProfile(archCompanyId, { autoRefine: false, languageRefine: false });
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
          // Translate the resolver's failure mode into a typed code so the
          // client can decide between "sign me out" and "show a visible
          // error" without re-classifying status codes. The sendAuthError
          // helper picks the HTTP status from the registry.
          if (error === 'ACCOUNT_DELETED') {
            sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
            return;
          }
          if (error === 'ACCOUNT_SUSPENDED') {
            sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DISABLED);
            return;
          }
          if (error === 'ACCOUNT_INVITED') {
            sendAuthError(res, AUTH_ERROR_CODE.USER_INVITED);
            return;
          }
          if (error === 'SESSION_REVOKED' || error === 'INVALID_AUTH' || error === 'MISSING_AUTH') {
            sendAuthError(res, AUTH_ERROR_CODE.INVALID_SESSION);
            return;
          }
          // Fallback: token validated but no user row yet (orphan auth).
          sendAuthError(res, AUTH_ERROR_CODE.USER_NOT_FOUND);
          return;
        }
        // Resolve the canonical display name from the users table so the
        // frontend doesn't have to fall back to Supabase auth metadata
        // (which produced "you"/"there" placeholders when missing).
        const { data: userRow } = await supabase
          .from('users')
          .select('name, email, active_company_id')
          .eq('id', user.id)
          .maybeSingle();
        const resolvedUserName =
          (userRow?.name as string | null | undefined) ||
          (typeof user.email === 'string' ? user.email.split('@')[0] : '') ||
          'User';
        // Only companies this user has an active role for — Company Admin never sees other companies
        const { data: roleRows, error: roleError } = await supabase
          .from('user_company_roles')
          .select('company_id, role, status, join_source, created_at')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false });
        if (roleError) {
          return res.status(500).json({ error: 'FAILED_TO_LOAD_COMPANIES' });
        }
        const rawRows = roleRows || [];
        const rawCompanyIds = Array.from(new Set(rawRows.map((r: { company_id?: string }) => r.company_id).filter(Boolean) as string[]));
        const { data: companyRows } = rawCompanyIds.length
          ? await supabase
              .from('companies')
              .select('id, name, website_domain, admin_email_domain')
              .in('id', rawCompanyIds)
          : { data: [] as any[] };
        const companyById = new Map(
          (companyRows || []).map((row: any) => [String(row.id), row])
        );
        const emailDomain = extractDomain(String(userRow?.email || user.email || ''));
        const rows = filterCompatibleCompanyRoleRows({
          rows: rawRows,
          companyById,
          userEmail: String(userRow?.email || user.email || ''),
        });
        if (rawRows.length !== rows.length) {
          console.warn('[company-profile:list] filtered mismatched self-registered company role', {
            userId: user.id,
            emailDomain,
            removed: rawRows.length - rows.length,
          });
        }
        const companyIdSet = new Set<string>(rows.map((r: { company_id?: string }) => r.company_id).filter(Boolean) as string[]);
        const activeCompanyId = String((userRow as any)?.active_company_id || '');
        const unorderedCompanyIds = Array.from(companyIdSet);
        const companyIds = activeCompanyId && companyIdSet.has(activeCompanyId)
          ? [activeCompanyId, ...unorderedCompanyIds.filter((id) => id !== activeCompanyId)]
          : unorderedCompanyIds;
        const resolvedActiveCompanyId = companyIds[0] || null;
        if (activeCompanyId && resolvedActiveCompanyId && activeCompanyId !== resolvedActiveCompanyId) {
          await supabase
            .from('users')
            .update({ active_company_id: resolvedActiveCompanyId, updated_at: new Date().toISOString() })
            .eq('id', user.id);
        }
        const normalizeListRole = (r: string) => (r?.toUpperCase() === 'ADMIN' ? 'COMPANY_ADMIN' : r);
        const rolesByCompany = rows.map((row: { company_id: string; role: string }) => ({
          company_id: row.company_id,
          role: normalizeListRole(row.role || ''),
        }));
        // mode=list only consumes profile.name, which is not in the language-refine
        // field set (target_audience, brand_voice, unique_value, etc.). Calling
        // languageRefine here forces N LLM calls per company per page-load and was
        // the source of the multi-second buffering spinner on /command-center.
        const profiles = await Promise.all(
          companyIds.map(async (id) => {
            const profile = await getProfile(id, { autoRefine: false, languageRefine: false });
            return profile || { company_id: id, name: id };
          })
        );
        return res.status(200).json({
          userId: user.id,
          userName: resolvedUserName,
          activeCompanyId: resolvedActiveCompanyId,
          companies: profiles.map((profile) => ({
            company_id: profile.company_id,
            name: companyById.get(profile.company_id)?.name || profile.name || profile.company_id,
          })),
          rolesByCompany,
        });
      }

      const access = await resolveCompanyAccess(req, res, companyId);
      if (!access) return;

      const profile = await getProfile(companyId, {
        autoRefine: false,
        languageRefine: true,
        includeStoredCompetitors: true,
      });
      const resolvedProfile = profile || await saveProfile({ company_id: companyId });
      const isCompanyAdminOnly = access.role === 'COMPANY_ADMIN';
      const responseProfile = isCompanyAdminOnly
        ? (toLimitedCompanyProfile(resolvedProfile) ?? resolvedProfile)
        : resolvedProfile;
      const unifiedCompetitorIntelligence = await buildUnifiedCompetitorIntelligence({
        companyId,
        profile: resolvedProfile,
      }).catch(() => null);
      if (unifiedCompetitorIntelligence) {
        responseProfile.report_settings = {
          ...(responseProfile.report_settings ?? {}),
          market_pulse: {
            ...(responseProfile.report_settings?.market_pulse ?? {}),
            unified_competitor_intelligence: unifiedCompetitorIntelligence,
          },
        };
      }
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
            const intelligence = await getCompanyContextIntelligence(companyId);
            const intelligenceReadiness = calculateIntelligenceReadiness({ intelligence, profile: resolvedProfile });
            response.profile_completeness = completeness;
            response.intelligence_readiness = intelligenceReadiness;
            const companyContext = buildCompanyContext(resolvedProfile, { intelligence });
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
      const canEditCanonicalWebsite = normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'CONTENT_ARCHITECT';
      const incomingReportSettings =
        (body.report_settings as CompanyProfile['report_settings'] | undefined) ?? undefined;
      const incomingWebsite = typeof body.website_url === 'string' ? body.website_url.trim() : body.website_url;
      const existingWebsite = existingProfile?.website_url ?? null;
      if (!canEditCanonicalWebsite && incomingWebsite !== undefined && String(incomingWebsite || '').trim() !== String(existingWebsite || '').trim()) {
        body.website_url = existingWebsite;
      }
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
