import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  refineProfileWithAIWithDetails,
  saveProfile,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { supabase } from '../../../backend/db/supabaseClient';
import { normalizeCanonicalWebsite } from '../../../utils/companyProfileValidation';

function stripCompetitorInputs(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, any>;
  delete record.competitors;
  delete record.competitors_list;

  if (record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile)) {
    stripCompetitorInputs(record.profile);
  }
  if (record.report_settings && typeof record.report_settings === 'object' && !Array.isArray(record.report_settings)) {
    const reportSettings = record.report_settings as Record<string, any>;
    if (reportSettings.default_inputs && typeof reportSettings.default_inputs === 'object') {
      delete reportSettings.default_inputs.competitors;
      delete reportSettings.default_inputs.competitors_list;
    }
    if (reportSettings.market_pulse && typeof reportSettings.market_pulse === 'object') {
      delete reportSettings.market_pulse.named_competitors;
      delete reportSettings.market_pulse.competitor_details;
      delete reportSettings.market_pulse.competitor_quality;
      delete reportSettings.market_pulse.market_alternatives;
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  stripCompetitorInputs(req.body);

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  const resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, resolvedCompanyId);
  if (!access) return;

  const effectiveCompanyId = resolvedCompanyId;
  try {
    let profile: any = null;
    const onboardingMode =
      req.query.onboarding === 'company-profile' ||
      req.body?.onboarding === 'company-profile' ||
      req.body?.onboardingMode === true;
    const mergeLockedFields = (existingFields: unknown, field: string) =>
      Array.from(new Set([...(Array.isArray(existingFields) ? existingFields : []), field]));
    profile = await getProfile(effectiveCompanyId, {
      autoRefine: false,
      includeStoredCompetitors: true,
    });
    const { data: companyRow } = onboardingMode
      ? await supabase.from('companies').select('website').eq('id', effectiveCompanyId).maybeSingle()
      : { data: null };
    const canonicalWebsite = onboardingMode
      ? normalizeCanonicalWebsite(profile?.website_url) ??
        normalizeCanonicalWebsite((companyRow as { website?: string } | null)?.website) ??
        ''
      : '';
    if (onboardingMode && !canonicalWebsite) {
      return res.status(400).json({ error: 'ONBOARDING_CANONICAL_WEBSITE_REQUIRED' });
    }
    if (!profile) {
      const seedProfile = await saveProfile({
        ...(req.body?.profile || req.body || {}),
        company_id: effectiveCompanyId,
        ...(canonicalWebsite ? { website_url: canonicalWebsite, user_locked_fields: ['website_url'] } : {}),
        source: 'user',
      }, onboardingMode ? { source: 'user', suppressUserLocks: true } : undefined);
      profile = seedProfile;
    } else if (!onboardingMode && req.body && Object.keys(req.body).length > 0) {
      const hasSeedData = Object.values(req.body).some(
        (value) => value !== undefined && value !== null && value !== ''
      );
      if (hasSeedData) {
        profile = await saveProfile({
          ...profile,
          ...req.body,
          company_id: profile.company_id,
          ...(canonicalWebsite
            ? {
                website_url: canonicalWebsite,
                user_locked_fields: mergeLockedFields(profile.user_locked_fields, 'website_url'),
              }
            : {}),
          source: profile.source || 'user',
        });
      }
    }
    if (canonicalWebsite) {
      profile = {
        ...profile,
        website_url: canonicalWebsite,
        user_locked_fields: mergeLockedFields(profile.user_locked_fields, 'website_url'),
      };
    }
    // CKRE-002 §3 — this is the explicit user-triggered refresh; manualRefresh
    // bypasses the change gate so a manual refine always runs the full AI chain.
    const refined = await refineProfileWithAIWithDetails(profile, { force: true, manualRefresh: true });
    const responseProfile =
      access.role === 'COMPANY_ADMIN'
        ? toLimitedCompanyProfile(refined.profile) ?? refined.profile
        : refined.profile;
    return res.status(200).json({ profile: responseProfile, refinement: refined.details });
  } catch (error: any) {
    console.error('Error refining company profile:', error?.message, error?.stack);
    return res.status(500).json({
      error: error?.message || 'Failed to refine company profile',
      details: error?.cause?.message || error?.stack?.split('\n')[1] || null,
    });
  }
}
