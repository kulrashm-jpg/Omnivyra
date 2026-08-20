/**
 * Command Center Card Configuration
 * 
 * Config-driven card definitions for the pre-dashboard landing page.
 * Each card is role-aware and shows requirements for access.
 */

/**
 * K2: `unknown` is a FOURTH state, not a degree of incompleteness.
 *
 * It means "we do not currently hold trustworthy feature information for this
 * capability" — a backend read was unavailable, not that the user has done
 * nothing. Collapsing that into `not_started` is what made a transient failure
 * render as "Setup needed" on a workspace that was already configured.
 */
export type CardState = 'not_started' | 'in_progress' | 'ready' | 'unknown';
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
    description: 'See how your site aligns with market demand, where you are losing, and what to improve.',
    hint: 'Get a clearer score and next actions in minutes.',
    cta: 'Analyze My Website',
    route: '/reports',
    icon: 'chart-bar',
    color: 'blue',
    requirements: [
      {
        label: 'Add your website',
        helpText: 'We crawl your site to find content gaps and ranking opportunities.',
        helpLink: '/company-profile',
      },
      {
        label: 'Add business details',
        helpText: 'Company name and industry help benchmark your position against competitors.',
        helpLink: '/company-profile',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'],
  },

  {
    id: 'blogs',
    title: 'Create Content',
    description: 'Create blogs, articles, and posts that match your business, capture current trends, and stay on-brand.',
    hint: 'Turn hours of company focused/ tailored drafting into minutes.',
    cta: 'Start Writing',
    route: '/command-center/content',
    icon: 'pencil',
    color: 'purple',
    requirements: [
      {
        label: 'Add business details',
        helpText: 'Profile details help generate content that fits your audience and positioning.',
        helpLink: '/company-profile',
      },
      {
        label: 'Add your website',
        helpText: 'Website context aligns ideas with your pages, offers, and positioning.',
        helpLink: '/company-profile',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  },

  {
    id: 'campaigns',
    title: 'Launch Campaigns',
    description: 'Plan, schedule, and distribute campaigns across channels with clearer execution, tracking.',
    hint: 'Go from idea to launch with far less guesswork.',
    cta: 'Plan a Campaign',
    route: '/command-center/campaigns',
    icon: 'rocket',
    color: 'green',
    requirements: [
      {
        label: 'Connect a social account',
        helpText: 'Link LinkedIn, Twitter, or other platforms to publish directly from the app.',
        helpLink: '/social-platforms',
      },
      {
        label: 'Add business details',
        helpText: 'Business context helps AI suggest better messaging and campaign direction.',
        helpLink: '/company-profile',
      },
    ],
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  },

  {
    id: 'engagement',
    title: 'Engagement Center',
    description: 'Monitor conversations, reply faster, and surface the comments or leads that deserve action first.',
    hint: 'Stay on top of engagement without chasing tabs.',
    cta: 'Open Engagement',
    route: '/command-center/engagement',
    icon: 'message-square',
    color: 'orange',
    requirements: [
      {
        label: 'Connect a social account',
        helpText: 'Link your platforms to track conversations and respond from one workspace.',
        helpLink: '/social-platforms',
      },
      {
        label: 'Add the Chrome extension',
        helpText: 'Use the extension to reply faster and follow conversations from your browser.',
        helpLink: '/integrations',
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

/**
 * Single source of truth for whether a role may access a work-area.
 * Mirrors the dashboard's card gating exactly so nav, deep-linked pages,
 * and the dashboard never disagree. `cardId` is one of the
 * COMMAND_CENTER_CARDS ids: 'reports' | 'blogs' | 'campaigns' | 'engagement'.
 *
 * Uses ROLE_ACCESS_MAP (NOT the stricter permissionMatrix) so that
 * CONTENT_REVIEWER / CONTENT_PUBLISHER keep the content + campaign access
 * the dashboard already grants them. Only VIEW_ONLY (and its aliases) is
 * limited to reports + engagement.
 */
export function roleCanAccessArea(userRole: string | null | undefined, cardId: string): boolean {
  if (!userRole) return false;
  const allowed = ROLE_ACCESS_MAP[userRole];
  // Unknown/unmapped roles are treated permissively to avoid locking out
  // legitimate roles the map hasn't enumerated (fail-open matches how the
  // rest of the app treats non-VIEW_ONLY roles); VIEW_ONLY is explicitly
  // enumerated and therefore correctly restricted.
  if (!allowed) return true;
  return allowed.includes(cardId);
}
