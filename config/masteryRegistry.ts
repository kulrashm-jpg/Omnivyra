/**
 * Canonical Mastery Registry (capability-aware, adoption-based)
 * ------------------------------------------------------------
 * Replaces the legacy feature-usage Mastery model. Every factor measures REAL
 * adoption (artifacts actually created / configured), never feature-usage
 * (button clicks, page visits, "feature opened/enabled"). Factors with no
 * canonical adoption signal are capability providers (available:false + reason),
 * never heuristics. Uses the SHARED contract + engine (lib/shared/capabilityRegistry).
 *
 * Signals are produced only by lib/mastery/buildMasterySignals — no UI logic,
 * no raw API access here.
 */

import type { CapabilityCategoryDef, FactorEvalResult, CategoryCapability } from '../lib/shared/capabilityRegistry';

interface SignalCount {
  available: boolean;
  reason: string | null;
  count: number;
}
interface SignalFlag {
  available: boolean;
  reason: string | null;
  configured: boolean;
}

/** Canonical, tenant-specific adoption signals. */
export interface MasterySignals {
  content: {
    published: SignalCount;
    templates: SignalCount;
    media: SignalCount;
    /** Distinct content surfaces in use (e.g. written + creator). */
    surfaces: number;
  };
  campaign: {
    completed: SignalCount;
  };
  ai: {
    /** AI-generated creator assets actually produced. */
    assets: SignalCount;
    /** Latched 0..1: real credit-consuming AI generation actions ever run. */
    generationUsed: number;
  };
  intelligence: {
    /** Competitors declared for monitoring (canonical profile data). */
    competitors: number;
    competitorsAvailable: boolean;
    /** Latched 0..1: Market Pulse comparative/opportunity signals ever used. */
    marketInsights: number;
    /** Latched 0..1: active lead signals ever surfaced. */
    leadIntelligence: number;
  };
  analytics: {
    reports: SignalCount;
  };
  collaboration: {
    available: boolean;
    reason: string | null;
    memberCount: number;
  };
  automation: {
    workflows: SignalFlag;
    leadAutomation: SignalFlag;
    /** Latched 0..1: blogs published (auto-posted to the connected website). */
    blogPublishing: number;
    /** Latched 0..1: campaigns distributed across social platforms. */
    socialDistribution: number;
  };
}

const ALWAYS: CategoryCapability = { supported: true, enabled: true, available: true, reason: null };

/** Score a milestone-count factor at graded thresholds (adoption depth). */
const graded = (
  sig: SignalCount,
  tiers: [number, number],
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult => {
  if (!sig.available) return { available: false, reason: sig.reason ?? 'Adoption signal temporarily unavailable.' };
  const [active, expert] = tiers;
  if (sig.count >= expert) return { score: 1 };
  if (sig.count >= active) return { score: 0.5, missing: [`${sig.count} so far — keep going`], recommendation, nextAction };
  if (sig.count > 0) return { score: 0.25, missing: [`${sig.count} so far`], recommendation, nextAction };
  return { score: 0, missing: [missing], recommendation, nextAction };
};

/**
 * Capability proof: doing something ONCE proves the user knows how — full score,
 * latched (the underlying count is floored at 1 by feature-completion, so the credit
 * never drops). Use for factors where mastery = "can you do it", not "how many times":
 * saving one template proves you can template; running one campaign proves you can
 * campaign. Depth-graded factors stay on `graded`.
 */
const provenOnce = (
  sig: SignalCount,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  !sig.available
    ? { available: false, reason: sig.reason ?? 'Adoption signal temporarily unavailable.' }
    : sig.count > 0
      ? { score: 1 }
      : { score: 0, missing: [missing], recommendation, nextAction };

const fromFlag = (
  sig: SignalFlag,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  !sig.available
    ? { available: false, reason: sig.reason ?? 'Adoption signal temporarily unavailable.' }
    : sig.configured
      ? { score: 1 }
      : { score: 0, missing: [missing], recommendation, nextAction };

/** Score a latched 0..1 adoption score: used-once is credited and never lost. */
const fromScore = (
  score: number,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  score >= 1
    ? { score: 1 }
    : score > 0
      ? { score, recommendation, nextAction }
      : { score: 0, missing: [missing], recommendation, nextAction };

/** No canonical adoption signal exists for this factor (capability provider). */
const noSignal = (reason: string): FactorEvalResult => ({ available: false, reason });

export const MASTERY_REGISTRY: CapabilityCategoryDef<MasterySignals>[] = [
  {
    id: 'content_excellence',
    title: 'Content Excellence',
    weight: 20,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'content.published',
        title: 'Published content',
        description: 'Content assets you have actually published.',
        weight: 3,
        evaluate: (s) =>
          graded(s.content.published, [3, 10], 'No content published yet', 'Publish content regularly to build authority.', {
            label: 'Create content',
            actionId: 'content.create',
          }),
      },
      {
        id: 'content.diversity',
        title: 'Content diversity',
        description: 'Using more than one content surface (written + creator).',
        weight: 1,
        evaluate: (s): FactorEvalResult =>
          s.content.surfaces >= 2
            ? { score: 1 }
            : s.content.surfaces === 1
              ? { score: 0.5, missing: ['Only one content surface in use'], recommendation: 'Diversify across written and creator content.', nextAction: { label: 'Explore content', actionId: 'content.create' } }
              : { score: 0, missing: ['No content surfaces in use'], recommendation: 'Diversify across written and creator content.', nextAction: { label: 'Explore content', actionId: 'content.create' } },
      },
      {
        id: 'content.templates',
        title: 'Template utilization',
        description: 'Saving one template proves you can template — mastery credited.',
        weight: 1,
        // Capability proof: one saved template is enough to prove mastery (done once = scored).
        evaluate: (s) =>
          provenOnce(s.content.templates, 'No template saved yet', 'Save a template to prove you can reuse your best work.', {
            label: 'Manage templates',
            actionId: 'creator.open',
          }),
      },
      {
        id: 'content.media',
        title: 'Media utilization',
        description: 'Media assets you have produced and reuse.',
        weight: 1,
        evaluate: (s) =>
          graded(s.content.media, [3, 10], 'No media assets yet', 'Build a media library you can reuse across content.', {
            label: 'Add media',
            actionId: 'creator.open',
          }),
      },
    ],
  },
  {
    id: 'campaign_excellence',
    title: 'Campaign Excellence',
    weight: 20,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'campaign.completed',
        title: 'Campaigns completed',
        description: 'Building and running one campaign proves you can — mastery credited.',
        weight: 3,
        // Capability proof: one completed campaign is enough to prove mastery (done once = scored).
        evaluate: (s) =>
          provenOnce(s.campaign.completed, 'No campaign run yet', 'Build and run a campaign to prove you can reach your audience.', {
            label: 'Create campaign',
            actionId: 'campaign.create',
          }),
      },
    ],
  },
  {
    id: 'ai_adoption',
    title: 'AI Adoption',
    weight: 15,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'ai.assets',
        title: 'AI-generated assets',
        description: 'Assets actually produced with AI assistance.',
        weight: 3,
        evaluate: (s) =>
          graded(s.ai.assets, [3, 10], 'No AI-generated assets yet', 'Use AI generation to produce assets faster.', {
            label: 'Generate with AI',
            actionId: 'creator.open',
          }),
      },
      {
        id: 'ai.generation_used',
        title: 'AI generation used',
        description: 'Real credit-consuming AI generation actions you have run.',
        weight: 1,
        // Latched: credit-consuming AI actions used once stay credited.
        evaluate: (s) =>
          fromScore(s.ai.generationUsed, 'No AI generation actions run yet', 'Use AI generation to create content, campaigns, or assets.', {
            label: 'Generate with AI',
            actionId: 'creator.open',
          }),
      },
    ],
  },
  {
    id: 'intelligence',
    title: 'Intelligence',
    weight: 10,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'intelligence.competitors',
        title: 'Competitor monitoring',
        description: 'Competitors declared for ongoing monitoring.',
        weight: 2,
        evaluate: (s): FactorEvalResult => {
          if (!s.intelligence.competitorsAvailable) return noSignal('Competitor data is temporarily unavailable.');
          return s.intelligence.competitors > 0
            ? { score: s.intelligence.competitors >= 3 ? 1 : 0.5, ...(s.intelligence.competitors >= 3 ? {} : { missing: [`${s.intelligence.competitors} competitor(s) tracked`], recommendation: 'Track more competitors for sharper monitoring.', nextAction: { label: 'Add competitors', actionId: 'profile.edit' } }) }
            : { score: 0, missing: ['No competitors declared'], recommendation: 'Declare competitors to monitor their movements.', nextAction: { label: 'Add competitors', actionId: 'profile.edit' } };
        },
      },
      {
        id: 'intelligence.insights_reviewed',
        title: 'Market insights used',
        description: 'Market Pulse comparative / opportunity intelligence generated.',
        weight: 1,
        // Latched: Market Pulse used once stays credited (once = forever).
        evaluate: (s) =>
          fromScore(s.intelligence.marketInsights, 'Market Pulse not used yet', 'Run Market Pulse to surface comparative and opportunity intelligence.', {
            label: 'Open Market Pulse',
            actionId: 'engagement.open',
          }),
      },
      {
        id: 'intelligence.lead_intelligence',
        title: 'Lead intelligence used',
        description: 'Active lead signals surfaced for the workspace.',
        weight: 1,
        // Latched: active-leads usage once stays credited.
        evaluate: (s) =>
          fromScore(s.intelligence.leadIntelligence, 'No active-lead signals yet', 'Use Active Leads to surface and act on lead intelligence.', {
            label: 'Open Active Leads',
            actionId: 'leads.setup',
          }),
      },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    weight: 15,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'analytics.reports',
        title: 'Reports generated',
        description: 'Intelligence reports you have generated.',
        weight: 2,
        evaluate: (s) =>
          graded(s.analytics.reports, [2, 5], 'No reports generated yet', 'Generate reports to understand your position.', {
            label: 'Generate report',
            actionId: 'reports.generate',
          }),
      },
    ],
  },
  {
    id: 'collaboration',
    title: 'Collaboration',
    weight: 10,
    capability: (s) =>
      s.collaboration.available
        ? ALWAYS
        : { supported: true, enabled: true, available: false, reason: s.collaboration.reason ?? 'Team data is temporarily unavailable.' },
    factors: (s) => [
      {
        id: 'collaboration.team',
        title: 'Team participation',
        description: 'More than one active member in the workspace.',
        weight: 2,
        evaluate: (): FactorEvalResult =>
          s.collaboration.memberCount > 1
            ? { score: 1 }
            : { score: 0, missing: ['Working solo'], recommendation: 'Invite teammates to collaborate.', nextAction: { label: 'Invite team', actionId: 'team.manage' } },
      },
    ],
  },
  {
    id: 'automation',
    title: 'Automation',
    weight: 10,
    capability: () => ALWAYS,
    // Adoption of Omnivyra's integrated flows: blog auto-published to the website,
    // campaigns distributed to social, recurring engagement, and lead automation.
    factors: () => [
      {
        id: 'automation.blog_publishing',
        title: 'Blog publishing',
        description: 'Blogs published — auto-posted to your connected website.',
        weight: 2,
        // Latched: publishing a blog once stays credited.
        evaluate: (s) =>
          fromScore(s.automation.blogPublishing, 'No blog published yet', 'Publish a blog — it is automatically posted to your connected website.', {
            label: 'Create content',
            actionId: 'content.create',
          }),
      },
      {
        id: 'automation.social_distribution',
        title: 'Social distribution',
        description: 'Campaigns distributed across your connected social platforms.',
        weight: 1,
        // Latched: distributing a campaign once stays credited.
        evaluate: (s) =>
          fromScore(s.automation.socialDistribution, 'No campaign distributed yet', 'Run a campaign to distribute posts across your social platforms.', {
            label: 'Create campaign',
            actionId: 'campaign.create',
          }),
      },
      {
        id: 'automation.recurring',
        title: 'Recurring engagement',
        description: 'Auto-reply / auto-DM engagement running.',
        weight: 1,
        evaluate: (s) =>
          fromFlag(s.automation.workflows, 'No recurring engagement enabled', 'Enable recurring engagement (auto-reply / auto-DM) to reduce manual work.', {
            label: 'Configure automation',
            actionId: 'engagement.open',
          }),
      },
      {
        id: 'automation.lead',
        title: 'Lead automation',
        description: 'Automated lead capture in place.',
        weight: 1,
        evaluate: (s) =>
          fromFlag(s.automation.leadAutomation, 'Lead automation not configured', 'Automate lead capture to build pipeline.', {
            label: 'Set up leads',
            actionId: 'leads.setup',
          }),
      },
    ],
  },
];
