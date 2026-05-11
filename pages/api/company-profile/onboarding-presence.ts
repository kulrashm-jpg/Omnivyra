import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  saveProfile,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { normalizeCanonicalWebsite } from '../../../utils/companyProfileValidation';

const SOCIAL_FIELDS = [
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'tiktok_url',
  'reddit_url',
  'pinterest_url',
  'whatsapp_url',
  'blog_url',
] as const;

const PLATFORM_BY_FIELD: Record<(typeof SOCIAL_FIELDS)[number], string> = {
  linkedin_url: 'linkedin',
  facebook_url: 'facebook',
  instagram_url: 'instagram',
  x_url: 'x',
  youtube_url: 'youtube',
  tiktok_url: 'tiktok',
  reddit_url: 'reddit',
  pinterest_url: 'pinterest',
  whatsapp_url: 'whatsapp',
  blog_url: 'blog',
};

function mergeLockedFields(existingFields: unknown, field: string): string[] {
  return Array.from(new Set([...(Array.isArray(existingFields) ? existingFields : []), field]));
}

function normalizeUrlInput(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return normalizeCanonicalWebsite(value) ?? undefined;
}

function buildSocialProfiles(profile: Record<string, any>) {
  const existing = Array.isArray(profile.social_profiles) ? profile.social_profiles : [];
  const scalarProfiles = SOCIAL_FIELDS
    .map((field) => {
      const url = normalizeUrlInput(profile[field]);
      if (!url) return null;
      return { platform: PLATFORM_BY_FIELD[field], url, source: 'user', confidence: 'High' };
    })
    .filter(Boolean);
  const merged = [...existing, ...scalarProfiles];
  return Array.from(
    new Map(
      merged
        .filter((entry) => entry && typeof entry.url === 'string' && entry.url.trim())
        .map((entry) => [`${entry.platform}:${entry.url}`, entry])
    ).values()
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const existingProfile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    const { data: companyRow } = await supabase
      .from('companies')
      .select('website')
      .eq('id', companyId)
      .maybeSingle();

    const profileWebsite = normalizeCanonicalWebsite(existingProfile?.website_url);
    const companyWebsite = normalizeCanonicalWebsite((companyRow as { website?: string } | null)?.website);
    const canonicalWebsite = profileWebsite ?? companyWebsite;

    if (!canonicalWebsite) {
      return res.status(400).json({ error: 'ONBOARDING_CANONICAL_WEBSITE_REQUIRED' });
    }

    const incoming: Record<string, unknown> = typeof req.body === 'object' && req.body ? req.body : {};
    const scopedSocials: Record<string, string> = {};
    for (const field of SOCIAL_FIELDS) {
      const normalized = normalizeUrlInput(incoming[field]);
      if (normalized) {
        scopedSocials[field] = normalized;
      }
    }

    const existingForSocials = existingProfile ? { ...existingProfile } : {};
    const mergedForSocials = { ...existingForSocials, ...scopedSocials, website_url: canonicalWebsite };
    const profile = await saveProfile(
      {
        company_id: companyId,
        website_url: canonicalWebsite,
        user_locked_fields: mergeLockedFields(existingProfile?.user_locked_fields, 'website_url'),
        ...scopedSocials,
        social_profiles: buildSocialProfiles(mergedForSocials) as any,
      },
      { source: 'user', suppressUserLocks: true }
    );

    const responseProfile =
      access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(profile) ?? profile : profile;
    return res.status(200).json({
      profile: responseProfile,
      canonicalWebsite,
      websiteDrift: Boolean(profileWebsite && companyWebsite && profileWebsite !== companyWebsite),
    });
  } catch (error: any) {
    console.error('Error saving onboarding social presence:', error?.message, error?.stack);
    return res.status(500).json({ error: error?.message || 'Failed to save onboarding social presence' });
  }
}
