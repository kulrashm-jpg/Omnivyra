import type { PreflightItem } from './CommandCenterPreflightModal';

export function withCompanyId(href: string, companyId?: string) {
  if (!companyId) return href;
  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}companyId=${encodeURIComponent(companyId)}`;
}

const CARD_GUIDANCE: Record<
  string,
  {
    required: Array<{ key: string; label: string; helpText: string; href: string }>;
    recommended: Array<{ key: string; label: string; helpText: string; href: string }>;
  }
> = {
  reports: {
    required: [
      {
        key: 'website_connected',
        label: 'Add your website',
        helpText: 'We use your site to analyze authority gaps and generate the report.',
        href: '/company-profile',
      },
    ],
    recommended: [
      {
        key: 'company_profile_completed',
        label: 'Complete company details',
        helpText: 'Completing company details will further align the report with your business context and recommendations.',
        href: '/company-profile',
      },
    ],
  },
  blogs: {
    required: [
      {
        key: 'company_profile_completed',
        label: 'Add business details',
        helpText: 'Helps content align with your company philosophy, audience, and positioning.',
        href: '/company-profile',
      },
    ],
    recommended: [
      {
        key: 'website_connected',
        label: 'Add your website',
        helpText: 'Improves relevance by grounding topics in your pages, offers, and current positioning.',
        href: '/company-profile',
      },
    ],
  },
  campaigns: {
    required: [
      {
        key: 'social_accounts_connected',
        label: 'Connect LinkedIn',
        helpText: 'Lets you distribute the campaign through at least one live channel.',
        href: '/social-platforms',
      },
    ],
    recommended: [
      {
        key: 'company_profile_completed',
        label: 'Complete company profile',
        helpText: 'Improves messaging quality so campaign plans match the business better.',
        href: '/company-profile',
      },
      {
        key: 'api_configured',
        label: 'Configure API keys',
        helpText: 'Unlocks stronger automation and smoother publishing once the campaign is ready.',
        href: '/external-apis',
      },
    ],
  },
  engagement: {
    required: [
      {
        key: 'social_accounts_connected',
        label: 'Connect LinkedIn',
        helpText: 'Brings conversations and engagement into one place from a live social channel.',
        href: '/social-platforms',
      },
    ],
    recommended: [
      {
        key: 'chrome_extension_installed',
        label: 'Install the Chrome extension',
        helpText: 'Makes replying faster and keeps engagement closer to where work actually happens.',
        href: '/integrations',
      },
    ],
  },
};

export function toPreflightItems(
  cardId: string,
  features: Array<{ key: string; score: number; status: 'done' | 'in_progress' | 'missing' | 'completed' | 'not_started' }>,
  companyId?: string,
  profileStatus?: { score?: number | null; connectedPlatforms?: string[] | null } | null,
) {
  const config = CARD_GUIDANCE[cardId] || { required: [], recommended: [] };
  const normalize = (items: typeof config.required): PreflightItem[] =>
    items.flatMap((item) => {
      if (item.key === 'company_profile_completed' && (profileStatus?.score ?? 0) >= 90) {
        return [];
      }
      const feature = features.find((entry) => entry.key === item.key);
      const rawStatus = feature?.status;
      const score = feature?.score ?? 0;
      const socialReady = item.key === 'social_accounts_connected' && score > 0;
      const status: PreflightItem['status'] =
        socialReady || rawStatus === 'completed' || rawStatus === 'done'
          ? 'done'
          : rawStatus === 'in_progress' || score > 0
            ? 'in_progress'
            : 'missing';

      const connectedPlatforms =
        item.key === 'social_accounts_connected' && profileStatus?.connectedPlatforms?.length
          ? ` Connected: ${profileStatus.connectedPlatforms.join(', ')}.`
          : '';

      return {
        ...item,
        helpText: `${item.helpText}${connectedPlatforms}`.trim(),
        href: withCompanyId(item.href, companyId),
        status,
      };
    });

  return {
    required: normalize(config.required),
    recommended: normalize(config.recommended),
  };
}

const CARD_HOVER_MESSAGES: Record<
  string,
  {
    required: Record<string, string>;
    recommended: Record<string, string>;
  }
> = {
  reports: {
    required: {
      website_connected: 'Add your website first so we can analyze the right pages and generate the report.',
    },
    recommended: {
      company_profile_completed: 'Complete company details to make the report recommendations more aligned to your business.',
    },
  },
  blogs: {
    required: {
      company_profile_completed: 'Complete company details first so writing stays aligned to your business and audience.',
    },
    recommended: {
      website_connected: 'Add your website to make ideas and drafts feel more grounded in your real business.',
    },
  },
  campaigns: {
    required: {
      social_accounts_connected: 'Connect LinkedIn first so campaigns can actually be distributed through a live channel.',
    },
    recommended: {
      company_profile_completed: 'Complete company details to improve campaign direction and messaging quality.',
      api_configured: 'Add API keys to unlock smoother automation and publishing once your campaign is ready.',
    },
  },
  engagement: {
    required: {
      social_accounts_connected: 'Connect LinkedIn first so conversations and replies can flow into the engagement center.',
    },
    recommended: {
      chrome_extension_installed: 'Install the Chrome extension to reply faster and keep engagement closer to your workflow.',
    },
  },
};

export function getCardHoverMessage(
  cardId: string,
  features: Array<{ key: string; score: number; status: 'done' | 'in_progress' | 'missing' | 'completed' | 'not_started' }>,
  profileStatus?: { missingSections?: string[] | null; score?: number | null; connectedPlatforms?: string[] | null } | null,
) {
  const guidance = CARD_GUIDANCE[cardId];
  const messages = CARD_HOVER_MESSAGES[cardId];
  if (!guidance || !messages) return null;

  const getStatus = (key: string) => {
    const feature = features.find((entry) => entry.key === key);
    const rawStatus = feature?.status;
    const score = feature?.score ?? 0;
    if (key === 'social_accounts_connected' && score > 0) return 'done';
    if (rawStatus === 'completed' || rawStatus === 'done') return 'done';
    if (rawStatus === 'in_progress' || score > 0) return 'in_progress';
    return 'missing';
  };

  for (const item of guidance.required) {
    if (getStatus(item.key) !== 'done') {
      return messages.required[item.key] || null;
    }
  }

  for (const item of guidance.recommended) {
    if (getStatus(item.key) !== 'done') {
      if (item.key === 'company_profile_completed' && (profileStatus?.score ?? 0) >= 90) {
        continue;
      }
      if (item.key === 'company_profile_completed' && profileStatus?.missingSections?.length) {
        const sectionLabels: Record<string, string> = {
          identity: 'identity',
          brand_strategy: 'brand strategy',
          customer_icp: 'customer and ICP',
          problem_transformation: 'problem transformation',
          campaign_guidance: 'campaign guidance',
          commercial: 'commercial details',
        };
        const topSections = profileStatus.missingSections
          .slice(0, 2)
          .map((section) => sectionLabels[section] || section.replace(/_/g, ' '));
        if (topSections.length > 0) {
          const joined = topSections.join(' and ');
          if (cardId === 'reports') {
            return `Complete ${joined} in company profile to align the report better to your business.`;
          }
          if (cardId === 'blogs') {
            return `Complete ${joined} in company profile so writing aligns better to your business and audience.`;
          }
          if (cardId === 'campaigns') {
            return `Complete ${joined} in company profile to improve campaign direction and messaging quality.`;
          }
        }
      }
      return messages.recommended[item.key] || null;
    }
  }

  return null;
}
