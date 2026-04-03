/**
 * Monetization Triggers Service
 *
 * Identifies revenue opportunities based on feature completion states.
 * Non-intrusive: inline hints only, no popups.
 *
 * Trigger Strategy:
 * - reports: Suggest premium analytics after first report
 * - campaigns: Promote campaign creation when social is ready
 * - engagement: Upsell monitoring tools when social connected
 */

import { FeatureStatus } from './commandCenterReadinessService';

export type MonetizationTriggerType =
  | 'reports_upgrade'        // "Generate more reports with Premium"
  | 'reports_limit_warning'  // "You've used your free report"
  | 'campaigns_first'        // "Create your first campaign"
  | 'campaigns_scheduling'   // "Upgrade for scheduling"
  | 'engagement_monitoring'  // "Monitor all channels with Pro"
  | 'integration_required'   // "Connect social to unlock"
  | 'api_automation'         // "Automate with API keys"
  | null;                    // No trigger

export interface MonetizationTrigger {
  type: MonetizationTriggerType;
  cardId: string;
  badge: string;              // Inline badge text (e.g., "Premium Feature")
  hint: string;               // User-friendly hint
  cta: string;                // Call-to-action label
  ctaRoute: string;           // Where CTA leads (e.g., /pricing)
  tier: 'free' | 'starter' | 'pro'; // Minimum tier needed
  priority: 'high' | 'medium' | 'low';
}

export interface UserContext {
  userId: string;
  tier: 'free' | 'starter' | 'pro';
  reportsGenerated?: number;  // 0, 1, 2+
  campaignsCreated?: number;
  reportClickCount?: number;  // Tracking repeat clicks
}

/**
 * Check if user has generated a report and is clicking again
 * (Indicates they want to create more)
 */
export function checkReportUpgradeTrigger(
  features: FeatureStatus[],
  context: UserContext,
): MonetizationTrigger | null {
  const hasReport = features.find(f => f.key === 'report_generated')?.status === 'completed';

  if (!hasReport) return null;

  // FREE tier: Show upgrade after first report
  if (context.tier === 'free') {
    return {
      type: 'reports_upgrade',
      cardId: 'reports',
      badge: 'Premium Feature',
      hint: 'Unlock unlimited reports, custom benchmarks, and competitor analysis',
      cta: 'Upgrade to Premium',
      ctaRoute: '/pricing?upgrade=reports',
      tier: 'starter',
      priority: 'medium',
    };
  }

  return null;
}

/**
 * Check if social accounts connected but no campaigns created
 * (Perfect moment to encourage campaign creation)
 */
export function checkCampaignsFirstTrigger(
  features: FeatureStatus[],
  context: UserContext,
): MonetizationTrigger | null {
  const hasSocial = features.find(f => f.key === 'social_accounts_connected')?.status === 'completed';
  const hasCampaign = features.find(f => f.key === 'campaign_created')?.status === 'completed';

  // Social connected but no campaigns = best moment to promote
  if (hasSocial && !hasCampaign) {
    // STARTER+ tier: Can create campaigns
    if (context.tier !== 'free') {
      return {
        type: 'campaigns_first',
        cardId: 'campaigns',
        badge: 'Quick Win',
        hint: 'You\'re all set to launch your first campaign across all connected channels',
        cta: 'Create Campaign',
        ctaRoute: '/campaigns/new',
        tier: 'starter',
        priority: 'high',
      };
    }

    // FREE tier: Show upgrade needed
    return {
      type: 'campaigns_first',
      cardId: 'campaigns',
      badge: 'Starter+',
      hint: 'Campaign creation requires Starter plan or higher. Upgrade to distribute to all channels.',
      cta: 'See Plans',
      ctaRoute: '/pricing?upgrade=campaigns',
      tier: 'starter',
      priority: 'medium',
    };
  }

  return null;
}

/**
 * Check if no social connected
 * (Need social for engagement - strong conversion moment)
 */
export function checkEngagementIntegrationTrigger(
  features: FeatureStatus[],
  context: UserContext,
): MonetizationTrigger | null {
  const hasSocial = features.find(f => f.key === 'social_accounts_connected')?.status === 'completed';

  if (hasSocial) return null; // Already has social

  // No social = blocking feature for engagement
  return {
    type: 'integration_required',
    cardId: 'engagement',
    badge: 'Requires Setup',
    hint: 'Connect your social accounts to monitor conversations and reply directly',
    cta: 'Connect Social',
    ctaRoute: '/integrations?tab=social',
    tier: 'free',
    priority: 'high',
  };
}

/**
 * Check if API not configured but could unlock automation
 * (Advanced feature for power users)
 */
export function checkApiAutomationTrigger(
  features: FeatureStatus[],
  context: UserContext,
): MonetizationTrigger | null {
  const hasApi = features.find(f => f.key === 'api_configured')?.status === 'completed';
  const hasCampaigns = features.find(f => f.key === 'campaign_created')?.status === 'completed';

  // Already using campaigns but no API = upsell automation
  if (!hasApi && hasCampaigns && context.tier !== 'free') {
    return {
      type: 'api_automation',
      cardId: 'campaigns',
      badge: 'Pro Feature',
      hint: 'Configure API keys to automate campaign scheduling and publishing',
      cta: 'Setup API',
      ctaRoute: '/settings/api?guide=true',
      tier: 'pro',
      priority: 'low',
    };
  }

  return null;
}

/**
 * Get all active monetization triggers for a card
 */
export function getTriggersForCard(
  cardId: string,
  features: FeatureStatus[],
  context: UserContext,
): MonetizationTrigger[] {
  const triggers: (MonetizationTrigger | null)[] = [];

  // Check all trigger types
  triggers.push(checkReportUpgradeTrigger(features, context));
  triggers.push(checkCampaignsFirstTrigger(features, context));
  triggers.push(checkEngagementIntegrationTrigger(features, context));
  triggers.push(checkApiAutomationTrigger(features, context));

  // Filter to card-specific triggers
  return triggers
    .filter((t): t is MonetizationTrigger => t !== null && t.cardId === cardId)
    .sort((a, b) => {
      // Sort by priority: high → medium → low
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
}

/**
 * Compute monetization state for a card
 * Returns suggestion or upgrade message to display inline
 */
export interface MonetizationState {
  hasUpgradePath: boolean;      // Can user upgrade/unlock this?
  upgradeTier?: string;         // Which tier unlocks this?
  trigger?: MonetizationTrigger; // Active trigger (highest priority)
  inline?: string;               // Inline hint to show
  badge?: string;                // Badge text (FREE_AVAILABLE, Premium, etc)
}

export function computeMonetizationState(
  cardId: string,
  features: FeatureStatus[],
  context: UserContext,
): MonetizationState {
  const triggers = getTriggersForCard(cardId, features, context);

  if (triggers.length === 0) {
    return { hasUpgradePath: false };
  }

  const primaryTrigger = triggers[0]; // Highest priority

  return {
    hasUpgradePath: primaryTrigger.tier !== 'free' && context.tier !== 'pro',
    upgradeTier: primaryTrigger.tier,
    trigger: primaryTrigger,
    inline: primaryTrigger.hint,
    badge: primaryTrigger.badge,
  };
}

/**
 * Example: Pricing tier feature matrix
 * Used to determine which features unlock at which tier
 */
export const TIER_FEATURES = {
  free: [
    'company_profile_completed',
    'website_connected',
    'blog_created',
    'report_generated',        // 1 free report
    'report_1_view',           // Can view that 1 report
    'social_accounts_connected',
    'chrome_extension_installed',
  ],
  starter: [
    ...['free'][0], // All free features
    'report_unlimited',         // Unlimited reports
    'campaign_created',         // Can create campaigns
    'campaign_scheduling',      // Can schedule posts
    'engagement_monitoring_basic',
  ],
  pro: [
    'report_unlimited',
    'report_benchmarks',        // Vs. competitors
    'report_ai_insights',       // AI-powered recommendations
    'campaign_created',
    'campaign_scheduling',
    'campaign_automation',      // Via API
    'engagement_monitoring_full', // All channels
    'team_collaboration',
    'custom_branding',
    'priority_support',
  ],
};

/**
 * Check if feature requires upgrade
 */
export function featureRequiresUpgrade(
  featureKey: string,
  userTier: 'free' | 'starter' | 'pro',
): boolean {
  const featureTiers = ['free', 'starter', 'pro'] as const;

  for (const tier of featureTiers) {
    if (TIER_FEATURES[tier].includes(featureKey)) {
      // User tier is equal or higher = they have access
      return featureTiers.indexOf(tier) > featureTiers.indexOf(userTier);
    }
  }

  return false; // Feature not found (shouldn't happen)
}
