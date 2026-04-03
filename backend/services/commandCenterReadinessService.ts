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
  completedAt?: string;
}

export interface ReadinessData {
  score: number; // 0-100
  level: string;
  completedFeatures: number;
  totalFeatures: number;
  features: FeatureStatus[];
}

/**
 * Feature to Card mapping
 */
const FEATURE_CARD_MAP: Record<string, string[]> = {
  report_generated: ['reports'],
  blog_created: ['blogs'],
  campaign_created: ['campaigns'],
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

  const completedCount = features.filter(
    (f) => requiredFeatures.includes(f.key) && f.status === 'completed',
  ).length;

  if (completedCount === requiredFeatures.length) {
    return 'ready';
  } else if (completedCount > 0) {
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
      helpLink: '/settings/company',
    },
    website_connected: {
      label: 'Website URL added',
      helpText: 'Add your website URL to enable content analysis and readiness insights.',
      helpLink: '/settings/company',
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
      helpLink: '/integrations',
    },
    campaign_created: {
      label: 'Launch first campaign',
      helpText: 'Create and launch your first campaign to distribute content across channels.',
      helpLink: '/campaigns',
    },
    chrome_extension_installed: {
      label: 'Chrome extension (optional)',
      helpText: 'Install the extension for real-time notifications and inline replies.',
      helpLink: '/settings/extensions',
    },
    api_configured: {
      label: 'API keys configured',
      helpText: 'Set up API keys to enable campaign automation and scheduled publishing.',
      helpLink: '/settings/api',
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

/**
 * Fetch feature completion and readiness data from backend
 */
export async function fetchReadinessData(
  companyId: string,
): Promise<{ features: FeatureStatus[]; readiness: ReadinessData } | null> {
  try {
    // Fetch features
    const featuresRes = await fetch(
      `/api/feature-completion?sync=false`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (!featuresRes.ok) {
      console.warn('[readiness-service] Failed to fetch features:', featuresRes.statusText);
      return null;
    }

    const featuresData = await featuresRes.json() as any;
    const features: FeatureStatus[] = (featuresData.data?.features || []).map((f: any) => ({
      key: f.feature_key,
      status: f.status,
      completedAt: f.completed_at,
    }));

    // Fetch readiness score
    const scoreRes = await fetch(
      `/api/readiness-score`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (!scoreRes.ok) {
      console.error('[readiness-service] Failed to fetch readiness score:', scoreRes.statusText);
      return null;
    }

    const scoreData = await scoreRes.json() as any;
    const readiness: ReadinessData = {
      score: scoreData.data?.score || 0,
      level: scoreData.data?.level || '',
      completedFeatures: scoreData.data?.completedFeatures || 0,
      totalFeatures: scoreData.data?.totalFeatures || 0,
      features,
    };

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
