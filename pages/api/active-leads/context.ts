import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getPlatformsWithTokensForOrg } from '../../../backend/services/platformTokenService';
import { getPublicListeningPlatforms } from '../../../backend/services/postDiscoveryConnectors';
import { getProfile } from '../../../backend/services/companyProfileService';

type ExternalApiRow = {
  id: string;
  display_name: string;
  provider_key: string;
  category: string;
  is_paid: boolean;
  config_json: Record<string, unknown> | null;
};

type AssignmentRow = {
  connection_id: string;
  assignment_mode: string;
  scope_json: Record<string, unknown> | null;
};

type ListeningPlatform = {
  id: string;
  label: string;
  availability: 'connected' | 'public';
  recommended?: boolean;
  recommendation_reason?: string | null;
};

type PublicListeningGroup = {
  id: string;
  label: string;
  description: string;
  source_ids: string[];
  recommended: boolean;
};

type RecommendationSummary = {
  headline: string;
  body: string;
  highlights: string[];
};

type IntegrationReadinessSummary = {
  headline: string;
  body: string;
  status: 'strong' | 'partial' | 'limited';
  highlights: string[];
};

function getPlatformLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized === 'twitter' || normalized === 'x') return 'X';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'hackernews') return 'Hacker News';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function tokenizeProfileText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').toLowerCase())
    .join(' ');
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function getPlatformRecommendation(platform: string, profileText: string): string | null {
  const isB2B = includesAny(profileText, [
    'b2b',
    'saas',
    'software',
    'enterprise',
    'agency',
    'consulting',
    'it services',
    'marketing',
    'sales',
    'recruitment',
    'cybersecurity',
    'cloud',
  ]);
  const isTech = includesAny(profileText, [
    'ai',
    'developer',
    'engineering',
    'devops',
    'api',
    'data',
    'cloud',
    'software',
    'startup',
    'product-led',
  ]);
  const isConsumer = includesAny(profileText, [
    'b2c',
    'consumer',
    'ecommerce',
    'retail',
    'fashion',
    'beauty',
    'food',
    'travel',
    'hospitality',
    'lifestyle',
    'fitness',
    'wellness',
  ]);
  const isCommunityLed = includesAny(profileText, [
    'community',
    'forum',
    'audience',
    'creator',
    'gaming',
    'education',
    'learning',
    'course',
    'open source',
  ]);

  switch (platform) {
    case 'linkedin':
      return isB2B
        ? 'Recommended because this company profile reads like a B2B or professional-services business where buyer intent is more visible on LinkedIn.'
        : null;
    case 'twitter':
    case 'x':
      return isTech || isB2B
        ? 'Recommended because this business operates in a space where public product evaluation, category chatter, and competitor comparisons often happen on X.'
        : null;
    case 'hackernews':
      return isTech
        ? 'Recommended because the company profile points to a tech/startup audience where Hacker News can surface higher-quality product and tooling discussions.'
        : null;
    case 'reddit':
      return isCommunityLed || isConsumer || isTech
        ? 'Recommended because this business can benefit from broad problem-driven community discussions that usually surface well on Reddit.'
        : null;
    case 'instagram':
      return isConsumer
        ? 'Recommended because this company looks consumer or brand-led, where Instagram conversations can expose demand and influencer-led buying cues.'
        : null;
    case 'facebook':
      return isConsumer || isCommunityLed
        ? 'Recommended because this business can benefit from community-group discussions and consumer discovery patterns often found on Facebook.'
        : null;
    default:
      return null;
  }
}

function buildPublicListeningGroups(platforms: ListeningPlatform[], profileText: string): PublicListeningGroup[] {
  const byId = new Map(platforms.map((platform) => [platform.id, platform]));
  const isTech = includesAny(profileText, [
    'ai',
    'developer',
    'engineering',
    'devops',
    'software',
    'cloud',
    'data',
    'startup',
    'api',
    'product-led',
  ]);
  const isConsumer = includesAny(profileText, [
    'b2c',
    'consumer',
    'ecommerce',
    'retail',
    'fashion',
    'beauty',
    'travel',
    'hospitality',
    'lifestyle',
    'fitness',
    'wellness',
  ]);
  const isB2B = includesAny(profileText, [
    'b2b',
    'saas',
    'enterprise',
    'services',
    'consulting',
    'agency',
    'it services',
    'marketing',
    'sales',
    'recruitment',
  ]);
  const isEarlyStage = includesAny(profileText, ['startup', 'seed', 'series a', 'founder-led', 'small team']);

  const groups: PublicListeningGroup[] = [
    {
      id: 'category-chatter',
      label: isB2B ? 'B2B & Category Intent' : 'Market & Category Chatter',
      description: isB2B
        ? 'Best for businesses where product comparisons, category evaluation, and public buying discussions reveal early lead intent.'
        : 'Best for companies that need to track open market conversations and category evaluation before intent becomes direct.',
      source_ids: ['twitter'],
      recommended: false,
    },
    {
      id: 'community-demand',
      label: isConsumer ? 'Consumer & Community Demand' : 'Community Demand Discovery',
      description: isConsumer
        ? 'Best for consumer-facing or broad-audience businesses where recommendation threads and community discussions drive interest.'
        : 'Best for problem-led discovery where people openly ask communities for recommendations, alternatives, or help.',
      source_ids: ['reddit'],
      recommended: false,
    },
    {
      id: 'tech-evaluation',
      label: isEarlyStage ? 'Startup & Builder Signals' : 'Tech & Product Evaluation',
      description: isEarlyStage
        ? 'Best for founder-led or earlier-stage companies where startup, operator, and builder communities reveal sharper buying or tooling intent.'
        : 'Best for technology, product, and operator-focused businesses where public tooling and workflow evaluation drives demand.',
      source_ids: ['hackernews', 'twitter'],
      recommended: false,
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      source_ids: group.source_ids.filter((id) => byId.has(id)),
    }))
    .filter((group) => group.source_ids.length > 0)
    .map((group) => ({
      ...group,
      recommended: group.source_ids.some((id) => byId.get(id)?.recommended),
    }))
    .sort((left, right) => {
      if (left.recommended !== right.recommended) {
        return left.recommended ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
}

function buildRecommendationSummary(profileText: string, platforms: ListeningPlatform[]): RecommendationSummary | null {
  const recommendedPlatforms = platforms.filter((platform) => platform.recommended);
  if (recommendedPlatforms.length === 0) {
    return null;
  }

  const isTech = includesAny(profileText, [
    'ai',
    'developer',
    'engineering',
    'devops',
    'software',
    'cloud',
    'data',
    'startup',
    'api',
    'product-led',
  ]);
  const isConsumer = includesAny(profileText, [
    'b2c',
    'consumer',
    'ecommerce',
    'retail',
    'fashion',
    'beauty',
    'travel',
    'hospitality',
    'lifestyle',
    'fitness',
    'wellness',
  ]);
  const isB2B = includesAny(profileText, [
    'b2b',
    'saas',
    'enterprise',
    'services',
    'consulting',
    'agency',
    'it services',
    'marketing',
    'sales',
    'recruitment',
  ]);
  const isEarlyStage = includesAny(profileText, ['startup', 'seed', 'series a', 'founder-led', 'small team']);

  const highlights: string[] = [];
  if (isB2B) highlights.push('B2B and professional buyer conversations matter most here.');
  if (isTech) highlights.push('Tech and product-evaluation communities are likely to surface better intent.');
  if (isConsumer) highlights.push('Community-led recommendation threads can be stronger than direct brand mentions.');
  if (isEarlyStage) highlights.push('Founder-led and startup spaces can reveal earlier buying cues.');

  const recommendedLabels = recommendedPlatforms.map((platform) => platform.label).join(', ');

  return {
    headline: `Recommended listening focus: ${recommendedLabels}`,
    body: `These sources are being prioritized from the company profile so Active Leads starts with the public conversations most likely to reveal real buyer intent for this business.`,
    highlights: highlights.slice(0, 3),
  };
}

function buildIntegrationReadinessSummary(
  platforms: ListeningPlatform[],
  externalApiCount: number,
  communityCount: number
): IntegrationReadinessSummary {
  const connectedCount = platforms.filter((platform) => platform.availability === 'connected').length;
  const publicCount = platforms.filter((platform) => platform.availability === 'public').length;

  const highlights: string[] = [];
  if (connectedCount > 0) {
    highlights.push(`${connectedCount} connected source${connectedCount === 1 ? '' : 's'} available`);
  }
  if (publicCount > 0) {
    highlights.push(`${publicCount} public listening source${publicCount === 1 ? '' : 's'} ready`);
  }
  if (communityCount > 0) {
    highlights.push(`${communityCount} communit${communityCount === 1 ? 'y' : 'ies'} assigned`);
  }
  if (externalApiCount > 0) {
    highlights.push(`${externalApiCount} external API${externalApiCount === 1 ? '' : 's'} assigned`);
  }

  if (connectedCount > 0 && (communityCount > 0 || externalApiCount > 0)) {
    return {
      headline: 'Integration setup is in a strong place',
      body: 'You already have a mix of connected sources and added signal coverage, so Active Leads can scan beyond a basic public listening pass without creating clutter here.',
      status: 'strong',
      highlights,
    };
  }

  if (connectedCount > 0 || publicCount > 0) {
    return {
      headline: 'Integration setup is usable, but still partial',
      body: 'The current setup is enough to start scanning, but stronger lead quality will come from adding more relevant communities or assigned APIs for this business.',
      status: 'partial',
      highlights,
    };
  }

  return {
    headline: 'Integration setup is still limited',
    body: 'Active Leads can still rely on public listening paths, but lead quality will stay shallow until more business-relevant sources are connected or assigned.',
    status: 'limited',
    highlights,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const connectedPlatforms = await getPlatformsWithTokensForOrg(companyId);
    const publicPlatforms = getPublicListeningPlatforms();
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });

    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('external_api_assignments')
      .select('connection_id, assignment_mode, scope_json')
      .eq('company_id', companyId)
      .eq('feature_key', 'active_leads')
      .eq('is_enabled', true);

    if (assignmentError) {
      return res.status(500).json({ error: assignmentError.message });
    }

    const connectionIds = [...new Set((assignmentRows ?? []).map((row) => row.connection_id).filter(Boolean))];

    let apiRows: ExternalApiRow[] = [];
    if (connectionIds.length > 0) {
      const { data: connections, error: connectionError } = await supabase
        .from('external_api_connections')
        .select('id, display_name, provider_key, category, is_paid, config_json')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .in('id', connectionIds);

      if (connectionError) {
        return res.status(500).json({ error: connectionError.message });
      }
      apiRows = (connections ?? []) as ExternalApiRow[];
    }

    const communitySet = new Set<string>();
    for (const assignment of (assignmentRows ?? []) as AssignmentRow[]) {
      normalizeStringArray(assignment.scope_json?.communities).forEach((community) => communitySet.add(community));
    }
    for (const connection of apiRows) {
      normalizeStringArray(connection.config_json?.communities).forEach((community) => communitySet.add(community));
    }

    const platformMap = new Map<string, ListeningPlatform>();

    const profileText = tokenizeProfileText([
      profile?.industry,
      profile?.category,
      profile?.products_services,
      profile?.target_audience,
      profile?.ideal_customer_profile,
      profile?.target_customer_segment,
      profile?.brand_positioning,
      profile?.goals,
      profile?.marketing_channels,
      profile?.growth_priorities,
      profile?.unique_value,
      Array.isArray(profile?.industry_list) ? profile?.industry_list.join(' ') : '',
      Array.isArray(profile?.category_list) ? profile?.category_list.join(' ') : '',
      Array.isArray(profile?.products_services_list) ? profile?.products_services_list.join(' ') : '',
      Array.isArray(profile?.target_audience_list) ? profile?.target_audience_list.join(' ') : '',
    ]);

    for (const platform of connectedPlatforms) {
      const normalized = String(platform ?? '').trim().toLowerCase();
      if (!normalized) continue;
      const recommendation = getPlatformRecommendation(normalized, profileText);
      platformMap.set(normalized, {
        id: normalized,
        label: getPlatformLabel(normalized),
        availability: 'connected',
        recommended: Boolean(recommendation),
        recommendation_reason: recommendation,
      });
    }

    for (const platform of publicPlatforms) {
      const normalized = String(platform ?? '').trim().toLowerCase();
      if (!normalized || platformMap.has(normalized)) continue;
      const recommendation = getPlatformRecommendation(normalized, profileText);
      platformMap.set(normalized, {
        id: normalized,
        label: getPlatformLabel(normalized),
        availability: 'public',
        recommended: Boolean(recommendation),
        recommendation_reason: recommendation,
      });
    }

    const normalizedPlatforms = Array.from(platformMap.values()).sort((left, right) => {
      if (Boolean(left.recommended) !== Boolean(right.recommended)) {
        return left.recommended ? -1 : 1;
      }
      if (left.availability !== right.availability) {
        return left.availability === 'connected' ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

    return res.status(200).json({
      companyId,
      platforms: normalizedPlatforms,
      recommendationSummary: buildRecommendationSummary(profileText, normalizedPlatforms),
      integrationReadiness: buildIntegrationReadinessSummary(
        normalizedPlatforms,
        apiRows.length,
        communitySet.size
      ),
      publicSourceGroups: buildPublicListeningGroups(
        normalizedPlatforms.filter((platform) => platform.availability === 'public'),
        profileText
      ),
      communities: Array.from(communitySet).map((community) => ({
        id: community,
        label: community,
      })),
      externalApis: apiRows.map((connection) => ({
        id: connection.id,
        label: connection.display_name,
        provider_key: connection.provider_key,
        category: connection.category,
        is_paid: connection.is_paid,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to load Active Leads context' });
  }
}
