/**
 * Command Center Readiness Service
 *
 * Maps backend feature completion & readiness score to Command Center card states.
 * Replaces heuristic logic with real backend-driven truth.
 *
 * Feature → Card Mapping:
 * - reports: report_generated
 * - blogs: blog_created
 * - campaigns: campaign_created + social_accounts_connected
 * - engagement: social_accounts_connected
 */

import { CardState, RequirementStatus, CommandCenterCard, Requirement } from '../../config/commandCenterCards';

export interface FeatureStatus {
  key: string;
  status: 'completed' | 'not_started' | 'in_progress';
  score: number;        // 0.0–1.0
  completedAt?: string;
}

export interface ReadinessData {
  score: number; // 0-100
  level: string;
  completedFeatures: number;
  totalFeatures: number;
  features: FeatureStatus[];
}

interface CompanyProfileSignal {
  hasWebsite: boolean;
  profileScore: number;
  socialScore: number;
}

/**
 * Feature to Card mapping
 */
const FEATURE_CARD_MAP: Record<string, string[]> = {
  report_generated: ['reports'],
  blog_created: ['blogs'],
  campaign_created: ['campaigns'],
  campaign_published: ['campaigns'],
  social_accounts_connected: ['campaigns', 'engagement'],
  api_configured: ['campaigns'],
  company_profile_completed: ['reports', 'blogs', 'campaigns'],
  website_connected: ['reports'],
  chrome_extension_installed: ['engagement'],
};

/**
 * Get all features required for a specific card
 */
function getFeaturesForCard(cardId: string): string[] {
  const features: string[] = [];

  Object.entries(FEATURE_CARD_MAP).forEach(([feature, cardIds]) => {
    if (cardIds.includes(cardId)) {
      features.push(feature);
    }
  });

  return features;
}

/**
 * Determine card state based on feature completion
 *
 * ready: all required features completed
 * in_progress: some required features completed
 * not_started: no required features completed
 */
export function getCardStateFromFeatures(
  cardId: string,
  features: FeatureStatus[],
): CardState {
  const requiredFeatures = getFeaturesForCard(cardId);

  if (requiredFeatures.length === 0) {
    return 'not_started';
  }

  const relevantFeatures = features.filter((feature) => requiredFeatures.includes(feature.key));
  const completedCount = relevantFeatures.filter((feature) => feature.status === 'completed').length;
  const inProgressCount = relevantFeatures.filter(
    (feature) => feature.status === 'in_progress' || feature.score > 0,
  ).length;

  if (completedCount === requiredFeatures.length) {
    return 'ready';
  } else if (completedCount > 0 || inProgressCount > 0) {
    return 'in_progress';
  } else {
    return 'not_started';
  }
}

/**
 * Generate dynamic requirements from features
 */
export function generateDynamicRequirements(
  cardId: string,
  features: FeatureStatus[],
): Requirement[] {
  const requiredFeatures = getFeaturesForCard(cardId);
  const featureDescriptions: Record<string, { label: string; helpText: string; helpLink: string }> = {
    company_profile_completed: {
      label: 'Company profile setup',
      helpText: 'Complete your company profile with name, industry, and company size to personalize features.',
      // Canonical company access page; previously pointed to /settings/company (404).
      helpLink: '/settings/company-admin-access',
    },
    website_connected: {
      label: 'Website URL added',
      helpText: 'Add your website URL to enable content analysis and readiness insights.',
      // Same canonical destination — was a 404 path.
      helpLink: '/settings/company-admin-access',
    },
    blog_created: {
      label: 'First blog published',
      helpText: 'Create and publish your first blog post to unlock content creation features.',
      helpLink: '/pages/blogs',
    },
    report_generated: {
      label: 'Content readiness report',
      helpText: 'Generate your first readiness report to see content performance insights.',
      helpLink: '/reports',
    },
    social_accounts_connected: {
      label: 'Social accounts linked',
      helpText: 'Connect your LinkedIn, Twitter, and other social accounts for distribution.',
      helpLink: '/integrations?focus=data',
    },
    campaign_created: {
      label: 'Launch first campaign',
      helpText: 'Create and launch your first campaign to distribute content across channels.',
      helpLink: '/campaigns',
    },
    chrome_extension_installed: {
      label: 'Chrome extension (optional)',
      helpText: 'Install the extension for real-time notifications and inline replies.',
      // Was /settings/extensions (404). Use canonical integrations page for now.
      helpLink: '/integrations?focus=website',
    },
    api_configured: {
      label: 'API keys configured',
      helpText: 'Set up API keys to enable campaign automation and scheduled publishing.',
      // Was /settings/api (404). Canonical API surface is the integrations page.
      helpLink: '/integrations?focus=website',
    },
  };

  return requiredFeatures
    .map((featureKey) => {
      const desc = featureDescriptions[featureKey];
      if (!desc) return null;

      const feature = features.find((f) => f.key === featureKey);
      const status: RequirementStatus = feature?.status === 'completed' ? 'done' : 'missing';

      return {
        label: desc.label,
        helpText: desc.helpText,
        helpLink: desc.helpLink,
        status,
      };
    })
    .filter((req): req is NonNullable<typeof req> => req !== null) as Requirement[];
}

/** Fallback: derive a readiness score directly from FeatureStatus array */
function deriveReadinessFromFeatures(features: FeatureStatus[]): ReadinessData {
  const completed = features.filter((f) => f.score >= 1).length;
  const total = features.length || 1;
  const score = Math.round(features.reduce((sum, f) => sum + f.score, 0) / total * 100);
  return { score, level: '', completedFeatures: completed, totalFeatures: total, features };
}

function buildProfileFallbackFeatures(profileSignals: CompanyProfileSignal): FeatureStatus[] {
  let features: FeatureStatus[] = [];
  features = upsertFeatureScore(features, 'company_profile_completed', profileSignals.profileScore);
  features = upsertFeatureScore(features, 'website_connected', profileSignals.hasWebsite ? 1 : 0);
  features = upsertFeatureScore(features, 'social_accounts_connected', profileSignals.socialScore);
  return features;
}

function statusFromScore(score: number): FeatureStatus['status'] {
  if (score >= 1) return 'completed';
  if (score > 0) return 'in_progress';
  return 'not_started';
}

function upsertFeatureScore(
  features: FeatureStatus[],
  key: string,
  nextScore: number,
): FeatureStatus[] {
  const next = [...features];
  const index = next.findIndex((feature) => feature.key === key);
  const normalizedScore = Math.max(0, Math.min(1, nextScore));
  const existingScore = index >= 0 ? next[index]?.score ?? 0 : 0;
  const mergedScore = Math.max(existingScore, normalizedScore);
  const normalized: FeatureStatus = {
    key,
    status: statusFromScore(mergedScore),
    score: mergedScore,
  };

  if (index >= 0) {
    next[index] = { ...next[index], ...normalized };
  } else {
    next.push(normalized);
  }

  return next;
}

async function fetchCompanyProfileSignals(companyId: string): Promise<CompanyProfileSignal> {
  try {
    const response = await fetch(
      `/api/company-profile?companyId=${encodeURIComponent(companyId)}&includeCompleteness=0`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (!response.ok) {
      return { hasWebsite: false, profileScore: 0, socialScore: 0 };
    }

    const data = await response.json() as any;
    const profile = data?.profile || null;
    const teamSize =
      profile?.team_size ??
      profile?.company_size ??
      profile?.size ??
      profile?.report_settings?.company_facts?.team_size ??
      null;
    const profileFields = [
      Boolean(profile?.name?.trim?.()),
      Boolean(profile?.industry?.trim?.()),
      Boolean(String(teamSize ?? '').trim()),
    ];
    const socialCount = [
      profile?.linkedin_url,
      profile?.facebook_url,
      profile?.instagram_url,
      profile?.x_url,
      profile?.youtube_url,
      profile?.tiktok_url,
      profile?.reddit_url,
      profile?.pinterest_url,
      profile?.whatsapp_url,
    ]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .length;

    return {
      hasWebsite: Boolean(profile?.website_url?.trim()),
      profileScore: profileFields.filter(Boolean).length / profileFields.length,
      socialScore: socialCount === 0 ? 0 : socialCount === 1 ? 0.4 : socialCount === 2 ? 0.7 : 1,
    };
  } catch {
    return { hasWebsite: false, profileScore: 0, socialScore: 0 };
  }
}

/**
 * Fetch feature completion and readiness data from backend
 */
export async function fetchReadinessData(
  companyId: string,
): Promise<{ features: FeatureStatus[]; readiness: ReadinessData } | null> {
  try {
    const profileSignalsPromise = fetchCompanyProfileSignals(companyId);

    // Fetch features — sync=true recomputes from live DB data on every visit
    const featuresRes = await fetch(
      `/api/feature-completion?sync=true&company_id=${encodeURIComponent(companyId)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const profileSignals = await profileSignalsPromise;
    let features: FeatureStatus[] = [];

    if (!featuresRes.ok) {
      console.warn('[readiness-service] Failed to fetch features:', featuresRes.statusText);
      features = buildProfileFallbackFeatures(profileSignals);
    } else {
      const featuresData = await featuresRes.json() as any;
      features = (featuresData.data?.features || []).map((f: any) => ({
        key: f.key ?? f.feature_key,
        status: f.status,
        score: typeof f.score === 'number' ? f.score : (f.status === 'completed' ? 1 : 0),
        completedAt: f.completedAt ?? f.completed_at,
      }));
      features = upsertFeatureScore(features, 'website_connected', profileSignals.hasWebsite ? 1 : 0);
      features = upsertFeatureScore(features, 'company_profile_completed', profileSignals.profileScore);
      features = upsertFeatureScore(features, 'social_accounts_connected', profileSignals.socialScore);
    }

    // Fetch readiness score — no_cache=true bypasses the 5-min in-memory cache
    let readiness: ReadinessData;
    try {
      const scoreRes = await fetch(
        `/api/readiness-score?no_cache=true&company_id=${encodeURIComponent(companyId)}`,
        // keep readiness tied to the selected company, not whichever company happens to be latest
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      if (scoreRes.ok) {
        const scoreData = await scoreRes.json() as any;
        const derived = deriveReadinessFromFeatures(features);
        readiness = {
          score: derived.score,
          level: scoreData.data?.level || '',
          completedFeatures: derived.completedFeatures,
          totalFeatures: derived.totalFeatures,
          features,
        };
      } else {
        // Derive score locally from features if the score endpoint is unavailable
        readiness = deriveReadinessFromFeatures(features);
      }
    } catch {
      readiness = deriveReadinessFromFeatures(features);
    }

    return { features, readiness };
  } catch (err) {
    console.error('[readiness-service] Failed to fetch readiness data:', err);
    return null;
  }
}

/**
 * Compute card states for all cards based on features
 */
export function computeCardStates(
  cards: CommandCenterCard[],
  features: FeatureStatus[],
): Map<string, CardState> {
  return new Map(
    cards.map((card) => [
      card.id,
      getCardStateFromFeatures(card.id, features),
    ]),
  );
}
