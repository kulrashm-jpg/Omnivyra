/**
 * Command Center Card Configuration
 * 
 * Config-driven card definitions for the pre-dashboard landing page.
 * Each card is role-aware and shows requirements for access.
 */

export type CardState = 'not_started' | 'in_progress' | 'ready';
export type RequirementStatus = 'done' | 'missing';

export interface Requirement {
  label: string;
  status?: RequirementStatus; // Computed at runtime
  helpText?: string; // Contextual help explanation
  helpLink?: string; // Link to settings or documentation
}

export interface CommandCenterCard {
  id: string;
  title: string;
  description: string;
  hint?: string; // Optional secondary hint/prerequisite text
  cta: string;
  route: string;
  icon: string; // icon name for UI rendering
  requirements: Requirement[] | string[]; // Support both old and new format
  roles: string[]; // which roles can see this card
  color?: string; // optional tailwind color class (e.g. 'blue', 'green')
  state?: CardState; // Computed at runtime
  badge?: 'FREE_AVAILABLE' | 'GENERATING' | 'USED'; // Special badge for cards
}

export const COMMAND_CENTER_CARDS: CommandCenterCard[] = [
  {
    id: 'reports',
    title: 'Content Readiness Score',
    description: 'Is your content actually ready to rank and convert? Get a comprehensive analysis of your digital presence.',
    hint: '📊 Reveals gaps • Identifies opportunities • Suggests wins | Free for first use',
    cta: 'View Reports',
    route: '/reports',
    icon: 'chart-bar',
    color: 'blue',
    requirements: [
      {
        label: 'Website URL saved',
        helpText: 'Add your website URL so we can crawl and analyze your content performance and identify gaps.',
        helpLink: '/settings/company',
      },
      {
        label: 'Company profile created',
        helpText: 'Set up your company profile with branding details to personalize your content analysis.',
        helpLink: '/settings/company',
      },
      {
        label: 'Admin access (for free report)',
        helpText: 'Only Company Admins can generate the free report. Other roles can view existing reports.',
        helpLink: '/settings/team',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'],
  },

  {
    id: 'blogs',
    title: 'Create Content',
    description: 'Turn insights into impact. Based on your analysis, you\'re missing content on 76+ high-value topics. Start writing the content your audience is searching for.',
    hint: '💡 Smart suggestions • 5–15 credits per article • Publish instantly',
    cta: 'Create Content',
    route: '/command-center/content',
    icon: 'pencil',
    color: 'purple',
    requirements: [
      {
        label: 'Company profile setup',
        helpText: 'Complete your company profile to enable all content features and personalization.',
        helpLink: '/settings/company',
      },
      {
        label: 'Content creator access',
        helpText: 'Your role has been granted permission to create and publish content.',
        helpLink: '/settings/team',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  },

  {
    id: 'campaigns',
    title: 'Launch Campaigns',
    description: 'Create campaigns, schedule posts, and manage content distribution across channels.',
    hint: 'Connect your social accounts first to enable campaigns',
    cta: 'Launch Campaign',
    route: '/command-center/campaigns',
    icon: 'rocket',
    color: 'green',
    requirements: [
      {
        label: 'Company profile setup',
        helpText: 'Complete your company profile to enable campaign creation and publishing.',
        helpLink: '/settings/company',
      },
      {
        label: 'Social media integration',
        helpText: 'Connect your LinkedIn, Twitter, Instagram, or other social accounts to publish campaigns.',
        helpLink: '/integrations',
      },
      {
        label: 'API configurations',
        helpText: 'Set up required API keys for campaign automation and scheduled publishing.',
        helpLink: '/settings/api',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  },

  {
    id: 'engagement',
    title: 'Engagement Center',
    description: 'Monitor conversations, reply to comments, and connect with your community.',
    cta: 'Open Engagement',
    route: '/command-center/engagement',
    icon: 'message-square',
    color: 'orange',
    requirements: [
      {
        label: 'Social media integration',
        helpText: 'Connect your social accounts to monitor and respond to community conversations.',
        helpLink: '/integrations',
      },
      {
        label: 'Chrome extension (optional)',
        helpText: 'Install the Chrome extension to get real-time notifications and inline replies.',
        helpLink: '/settings/extensions',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'],
  },
];

/**
 * Role-based access control for command center cards
 * Maps each role to which cards they can see
 */
export const ROLE_ACCESS_MAP: Record<string, string[]> = {
  SUPER_ADMIN: ['reports', 'blogs', 'campaigns', 'engagement'],
  COMPANY_ADMIN: ['reports', 'blogs', 'campaigns', 'engagement'],
  CONTENT_CREATOR: ['reports', 'blogs', 'campaigns', 'engagement'],
  CONTENT_REVIEWER: ['reports', 'blogs', 'campaigns', 'engagement'],
  CONTENT_PUBLISHER: ['reports', 'blogs', 'campaigns', 'engagement'],
  CONTENT_MANAGER: ['reports', 'blogs', 'campaigns', 'engagement'],
  CONTENT_PLANNER: ['reports', 'blogs', 'campaigns', 'engagement'],
  VIEW_ONLY: ['reports', 'engagement'],
  CONTENT_ENGAGER: ['reports', 'engagement'],
  VIEWER: ['reports', 'engagement'],
  ADMIN: ['reports', 'blogs', 'campaigns', 'engagement'],
};

/**
 * Get visible cards for a user role
 */
export function getVisibleCards(userRole: string | undefined): CommandCenterCard[] {
  if (!userRole) {
    // Default to empty (fail-safe)
    console.warn('[commandCenterCards] No user role provided');
    return [];
  }

  const allowedCardIds = ROLE_ACCESS_MAP[userRole] ?? [];

  return COMMAND_CENTER_CARDS.filter((card) => allowedCardIds.includes(card.id));
}

/**
 * Get a single card by ID
 */
export function getCardById(id: string): CommandCenterCard | undefined {
  return COMMAND_CENTER_CARDS.find((card) => card.id === id);
}
