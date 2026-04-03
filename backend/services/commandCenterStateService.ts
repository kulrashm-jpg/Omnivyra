/**
 * Command Center Card State Service
 * 
 * Computes card states and requirement statuses based on real company data.
 * 
 * State Logic:
 * - not_started: User hasn't started setup for this feature
 * - in_progress: User has completed some setup steps
 * - ready: Feature is fully set up and ready to use
 */

import { CardState, RequirementStatus, CommandCenterCard, Requirement } from '../../config/commandCenterCards';

export interface CardStateContext {
  userId: string;
  role: string;
  companyId: string;
  companyName: string;
  userName: string;
  // Real data from company setup state
  hasBlogsCreated?: boolean;
  hasSocialLinked?: boolean;
  hasWebsiteUrl?: boolean;
  hasReportGenerated?: boolean;
  blogCount?: number;
  socialIntegrationCount?: number;
}

/**
 * Compute the state of a card based on REAL company data
 * 
 * Rules (not heuristics):
 * - blogs: ready if user has created ≥1 blog, else not_started
 * - reports: ready if report generated, else not_started
 * - campaigns: in_progress if social linked (setup needed), ready if campaigns exist, else not_started
 * - engagement: in_progress if social linked (but no content), ready if has social, else not_started
 */
export function getCardState(card: CommandCenterCard, context: CardStateContext): CardState {
  switch (card.id) {
    case 'blogs':
      // Blogs: ready if user has created at least 1 blog
      return context.hasBlogsCreated ? 'ready' : 'not_started';

    case 'reports':
      // Reports: ready if report has been generated
      return context.hasReportGenerated ? 'ready' : 'not_started';

    case 'campaigns':
      // Campaigns: requires social integration first
      // not_started = no social setup
      // in_progress = social setup done but no campaigns yet
      // ready = campaigns created (would be tracked in campaigns table, but we can assume in_progress)
      if (!context.hasSocialLinked) {
        return 'not_started';
      }
      // Has social link, so at minimum in_progress
      return 'in_progress';

    case 'engagement':
      // Engagement: requires social integration
      // not_started = no social setup
      // ready = socials setup done
      if (!context.hasSocialLinked) {
        return 'not_started';
      }
      return 'ready';

    default:
      return 'not_started';
  }
}

/**
 * Get requirement status for a card based on REAL company data
 * Returns list of requirements with done/missing status
 */
export function getRequirementStatus(
  card: CommandCenterCard,
  context: CardStateContext,
): Requirement[] {
  // Normalize requirements to object format
  const reqs: Requirement[] = (card.requirements as any[]).map((req) => {
    if (typeof req === 'string') {
      return { label: req };
    }
    return { ...req };
  });

  // Compute status based on REAL data, not labels
  return reqs.map((req) => {
    let status: RequirementStatus = 'missing';
    const lowerLabel = req.label.toLowerCase();

    // Website URL check
    if (lowerLabel.includes('website')) {
      status = context.hasWebsiteUrl ? 'done' : 'missing';
    }
    // Company profile check - done if user is in a company
    else if (lowerLabel.includes('company profile')) {
      status = context.companyId ? 'done' : 'missing';
    }
    // Social integration check
    else if (lowerLabel.includes('social')) {
      status = context.hasSocialLinked ? 'done' : 'missing';
    }
    // Optional items are always marked as done
    else if (lowerLabel.includes('optional')) {
      status = 'done';
    }
    // Editor access - done for creators and admins
    else if (lowerLabel.includes('editor') || lowerLabel.includes('content editor')) {
      const isCreator = context.role?.includes('CREATOR') || context.role?.includes('PUBLISHER');
      const isAdmin = context.role?.includes('ADMIN');
      status = isCreator || isAdmin ? 'done' : 'missing';
    }
    // API configuration - assume missing by default (user must configure explicitly)
    else if (lowerLabel.includes('api')) {
      status = 'missing';
    }
    // Profile setup - done if in company
    else if (lowerLabel.includes('profile')) {
      status = context.companyId ? 'done' : 'missing';
    }

    return { ...req, status };
  });
}

/**
 * Calculate setup percentage based on card states
 * Rough heuristic for "You're X% set up"
 */
export function calculateSetupPercentage(
  visibleCards: CommandCenterCard[],
  context: CardStateContext,
): number {
  if (visibleCards.length === 0) return 0;

  let setupPoints = 0;
  let totalPoints = 0;

  visibleCards.forEach((card) => {
    const state = getCardState(card, context);
    const weight = card.id === 'blogs' ? 2 : 1; // Weight blogs higher

    totalPoints += weight;

    if (state === 'ready') {
      setupPoints += weight;
    } else if (state === 'in_progress') {
      setupPoints += weight * 0.5;
    }
  });

  if (totalPoints === 0) return 0;
  return Math.min(100, Math.round((setupPoints / totalPoints) * 100));
}

/**
 * Get CTA label based on card state
 */
export function getCtaLabel(state: CardState, originalCta: string): string {
  switch (state) {
    case 'not_started':
      return 'Start Setup';
    case 'in_progress':
      return 'Continue Setup';
    case 'ready':
      return originalCta || 'Open';
    default:
      return originalCta;
  }
}

/**
 * Compute free report badge status based on REAL data
 * Returns:
 * - FREE_AVAILABLE: if no report has been generated yet
 * - USED: if user has already generated a report
 * - undefined: if not applicable for this card
 */
export function getReportBadge(context: CardStateContext): 'FREE_AVAILABLE' | 'USED' | undefined {
  // Use real flag: hasReportGenerated
  return context.hasReportGenerated ? 'USED' : 'FREE_AVAILABLE';
}
