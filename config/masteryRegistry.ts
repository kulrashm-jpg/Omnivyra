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
  };
  intelligence: {
    /** Competitors declared for monitoring (canonical profile data). */
    competitors: number;
    competitorsAvailable: boolean;
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
        description: 'Saved template collections you actively reuse.',
        weight: 1,
        evaluate: (s) =>
          graded(s.content.templates, [1, 3], 'No template collections saved', 'Save and reuse templates to speed up creation.', {
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
      {
        id: 'content.consistency',
        title: 'Publishing consistency',
        description: 'A steady publishing cadence over time.',
        weight: 1,
        evaluate: () => noSignal('Publishing cadence is not a canonical adoption signal yet.'),
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
        description: 'Campaigns you have actually built and run.',
        weight: 3,
        evaluate: (s) =>
          graded(s.campaign.completed, [2, 5], 'No campaigns yet', 'Build and run campaigns to reach your audience.', {
            label: 'Create campaign',
            actionId: 'campaign.create',
          }),
      },
      {
        id: 'campaign.cadence',
        title: 'Campaign cadence',
        description: 'A regular campaign rhythm over time.',
        weight: 1,
        evaluate: () => noSignal('Campaign cadence is not a canonical adoption signal yet.'),
      },
      {
        id: 'campaign.optimization',
        title: 'Campaign optimization',
        description: 'Iterating on campaigns based on results.',
        weight: 1,
        evaluate: () => noSignal('Campaign optimization is not a canonical adoption signal yet.'),
      },
      {
        id: 'campaign.ab_testing',
        title: 'A/B testing',
        description: 'Running experiments across campaign variants.',
        weight: 1,
        evaluate: () => noSignal('A/B testing adoption is not a canonical signal yet.'),
      },
      {
        id: 'campaign.reuse',
        title: 'Campaign reuse',
        description: 'Reusing proven campaign structures.',
        weight: 1,
        evaluate: () => noSignal('Campaign reuse is not a canonical adoption signal yet.'),
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
        id: 'ai.acceptance',
        title: 'AI acceptance',
        description: 'Accepting AI output into published work.',
        weight: 1,
        evaluate: () => noSignal('AI acceptance rate is not a canonical adoption signal yet.'),
      },
      {
        id: 'ai.refinement',
        title: 'AI refinement',
        description: 'Refining AI drafts before publishing.',
        weight: 1,
        evaluate: () => noSignal('AI refinement is not a canonical adoption signal yet.'),
      },
      {
        id: 'ai.publishing',
        title: 'AI-assisted publishing',
        description: 'Publishing AI-assisted content end-to-end.',
        weight: 1,
        evaluate: () => noSignal('AI-assisted publishing is not a canonical adoption signal yet.'),
      },
      {
        id: 'ai.optimization',
        title: 'AI optimization usage',
        description: 'Using AI to optimize existing content.',
        weight: 1,
        evaluate: () => noSignal('AI optimization usage is not a canonical adoption signal yet.'),
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
        title: 'Market insights reviewed',
        description: 'Engaging with market-pulse insights.',
        weight: 1,
        // Reviewing an insight is a usage event (forbidden as a metric); no
        // canonical adoption artifact exists.
        evaluate: () => noSignal('Insight review depth is not a canonical adoption signal (usage, not adoption).'),
      },
      {
        id: 'intelligence.recommendations_acted',
        title: 'Recommendations acted upon',
        description: 'Recommendations turned into action.',
        weight: 1,
        evaluate: () => noSignal('Recommendation action is not a canonical adoption signal yet.'),
      },
      {
        id: 'intelligence.alerts',
        title: 'Alerts configured',
        description: 'Monitoring alerts set up.',
        weight: 1,
        evaluate: () => noSignal('Alert configuration is not a canonical adoption signal yet.'),
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
      {
        id: 'analytics.conversions',
        title: 'Conversions tracked',
        description: 'Conversion tracking in use.',
        weight: 1,
        evaluate: () => noSignal('Conversion tracking is not a canonical adoption signal yet.'),
      },
      {
        id: 'analytics.kpi',
        title: 'KPI monitoring',
        description: 'Monitoring KPIs over time.',
        weight: 1,
        evaluate: () => noSignal('KPI monitoring is not a canonical adoption signal yet.'),
      },
      {
        id: 'analytics.attribution',
        title: 'Attribution usage',
        description: 'Using attribution to connect outcomes to work.',
        weight: 1,
        evaluate: () => noSignal('Attribution usage is not a canonical adoption signal yet.'),
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
      {
        id: 'collaboration.approvals',
        title: 'Approvals',
        description: 'Using review/approval on content.',
        weight: 1,
        evaluate: () => noSignal('Approval activity is not a canonical adoption signal yet.'),
      },
      {
        id: 'collaboration.comments',
        title: 'Comments',
        description: 'Collaborating through comments.',
        weight: 1,
        evaluate: () => noSignal('Comment activity is not a canonical adoption signal yet.'),
      },
      {
        id: 'collaboration.tasks',
        title: 'Task completion',
        description: 'Completing assigned work items.',
        weight: 1,
        evaluate: () => noSignal('Task completion is not a canonical adoption signal yet.'),
      },
    ],
  },
  {
    id: 'automation',
    title: 'Automation',
    weight: 10,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'automation.recurring',
        title: 'Recurring automations',
        description: 'Automation enabled and running.',
        weight: 2,
        evaluate: (s) =>
          fromFlag(s.automation.workflows, 'No automation enabled', 'Enable automation to reduce manual work.', {
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
      {
        id: 'automation.workflow_adoption',
        title: 'Workflow adoption',
        description: 'Adopting multi-step automation workflows.',
        weight: 1,
        evaluate: () => noSignal('Multi-step workflow adoption is not a canonical adoption signal yet.'),
      },
      {
        id: 'automation.autonomous',
        title: 'Autonomous publishing',
        description: 'Fully autonomous publishing in use.',
        weight: 1,
        evaluate: () => noSignal('Autonomous publishing is not a canonical adoption signal yet.'),
      },
    ],
  },
];
