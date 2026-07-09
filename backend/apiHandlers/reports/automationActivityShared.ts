/** automation-activity API (Agent-B split — backend module, not a route). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';

export type HighlightTone = 'good' | 'warn' | 'neutral';

export type HighlightItem = {
  id: string;
  title: string;
  detail: string;
  tone: HighlightTone;
  sourceLabel?: string;
  sourceHref?: string;
};

export type AutomationEvent = {
  id: string;
  type: 'scheduled' | 'content_change' | 'traffic_change';
  domain: string;
  triggered_at: string;
  report_id: string | null;
  details?: Record<string, unknown>;
};

export type NotificationEvent = {
  id: string;
  type: 'improvement' | 'decline' | 'opportunity';
  domain: string;
  message: string;
  linked_report_id: string | null;
  created_at: string;
};

export type AutomationContext = {
  connectedPlatforms: number;
  activeCampaigns: number;
  scheduledPosts30d: number;
  publishedPosts30d: number;
};

export type ScoredHighlight = {
  highlight: HighlightItem;
  qualityScore: number;
};

export function isMissingTableError(message: string | undefined): boolean {
  return (message || '').toLowerCase().includes('could not find the table');
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'not available yet';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return 'just now';
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'not scheduled yet';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function toNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function readList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function getReviewWindowCopy(latestReport: Record<string, any> | null): {
  days: number;
  label: string;
} {
  const score = toNumber(latestReport?.data?.composed_report?.unified_intelligence_summary?.unified_score
    ?? latestReport?.data?.composed_report?.score?.value);
  if (score > 0 && score < 55) {
    return { days: 90, label: 'about 3 months' };
  }
  return { days: 120, label: 'about 4 months' };
}

export async function resolveCompanyId(userId: string, requestedCompanyId?: string): Promise<string | null> {
  if (requestedCompanyId) {
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', requestedCompanyId)
      .eq('status', 'active')
      .maybeSingle();
    return data?.company_id ?? null;
  }

  const { data } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data?.company_id ?? null;
}

export function buildAutomationHighlights(params: {
  config: Record<string, any> | null;
  events: AutomationEvent[];
  latestReport: Record<string, any> | null;
}): HighlightItem[] {
  const highlights: HighlightItem[] = [];
  const { config, events, latestReport } = params;

  if (config) {
    const reviewWindow = getReviewWindowCopy(latestReport);
    highlights.push({
      id: 'automation-active',
      title: 'Monitoring is active',
      detail: `${String(config.domain || latestReport?.domain || 'This domain')} is enrolled in automated snapshot monitoring.`,
      tone: 'good',
      sourceLabel: 'Open reports',
      sourceHref: '/reports',
    });

    highlights.push({
      id: 'automation-next-run',
      title: 'Next scan is change-driven',
      detail: `The system should rescan sooner when meaningful content or traffic changes are detected, otherwise it falls back to a strategic review in ${reviewWindow.label}. The current fallback date is ${formatDate(String(config.next_run_at || ''))}.`,
      tone: 'neutral',
      sourceLabel: 'Open reports',
      sourceHref: '/reports',
    });

    highlights.push({
      id: 'automation-last-report',
      title: 'Latest snapshot is already in place',
      detail: latestReport?.created_at
        ? `A completed snapshot report was generated ${timeAgo(String(latestReport.created_at))}.`
        : 'The system is configured, but no completed snapshot has been found yet.',
      tone: latestReport?.created_at ? 'good' : 'warn',
      sourceLabel: latestReport?.id ? 'View snapshot report' : 'Open reports',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    });

    if (events.length > 0) {
      const latestEvent = events[0];
      highlights.push({
        id: 'automation-last-trigger',
        title: 'Recent trigger recorded',
        detail: `${String(latestEvent.domain || 'The domain')} triggered a ${String(latestEvent.type || 'scheduled').replace('_', ' ')} run ${timeAgo(latestEvent.triggered_at)}.`,
        tone: 'good',
        sourceLabel: latestEvent.report_id ? 'View triggered report' : 'Open reports',
        sourceHref: latestEvent.report_id ? `/reports/view/${encodeURIComponent(String(latestEvent.report_id))}?type=snapshot` : '/reports',
      });
    } else {
      highlights.push({
        id: 'automation-history-pending',
        title: 'Trigger history is still empty',
        detail: 'Automation is configured, but no meaningful content-change, traffic-change, or review-cycle trigger has been recorded yet.',
        tone: 'warn',
        sourceLabel: 'Open reports',
        sourceHref: '/reports',
      });
    }

    highlights.push({
      id: 'automation-change-detection',
      title: 'Change detection is required for richer triggers',
      detail: 'Traffic movement and content updates will only become visible here after the automation cycle records them as actual trigger events.',
      tone: 'neutral',
      sourceLabel: 'Review Market Pulse',
      sourceHref: '/dashboard/intelligence?intelTab=market-pulse',
    });

    return highlights.slice(0, 3);
  }

  return [
    {
      id: 'automation-missing',
      title: 'Automation is not set up yet',
      detail: 'No snapshot monitoring configuration was found for this company, so trigger highlights cannot be generated yet.',
      tone: 'warn',
      sourceLabel: 'Create snapshot report',
      sourceHref: '/reports/digital-authority-snapshot',
    },
    {
      id: 'automation-required',
      title: 'A domain is required',
      detail: 'Create or regenerate a snapshot report on the primary domain so future rescans can react to change and fall back to periodic strategic reviews.',
      tone: 'neutral',
      sourceLabel: 'Create snapshot report',
      sourceHref: '/reports/digital-authority-snapshot',
    },
    {
      id: 'automation-report',
      title: latestReport ? 'A snapshot exists' : 'No snapshot exists yet',
      detail: latestReport
        ? `There is at least one completed snapshot report, but monitoring has not been formalized into an automation config.`
        : 'Run the first snapshot report to create the baseline state used by later highlights.',
      tone: latestReport ? 'neutral' : 'warn',
      sourceLabel: latestReport?.id ? 'View snapshot report' : 'Open reports',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    },
  ];
}

export function buildAlertHighlights(params: {
  notifications: NotificationEvent[];
  latestReport: Record<string, any> | null;
}): HighlightItem[] {
  const { notifications, latestReport } = params;
  const composed = (latestReport?.data?.composed_report ?? {}) as Record<string, any>;
  const score = (composed.score ?? {}) as Record<string, any>;
  const unified = (composed.unified_intelligence_summary ?? {}) as Record<string, any>;
  const weakest = readList(score.weakest_dimensions);
  const dimensions = readList(score.dimensions)
    .filter((item) => item && typeof item === 'object')
    .sort((a, b) => toNumber((b as any).value) - toNumber((a as any).value));
  const topActions = readList(unified.top_3_unified_actions);
  const highlights: HighlightItem[] = [];

  if (notifications.length > 0) {
    notifications.slice(0, 2).forEach((item, index) => {
      highlights.push({
        id: `notification-${index}`,
        title: item.type === 'improvement' ? 'Something improved' : item.type === 'decline' ? 'A decline was detected' : 'A new opportunity was detected',
        detail: item.message,
        tone: item.type === 'decline' ? 'warn' : 'good',
        sourceLabel: item.linked_report_id ? 'View source report' : 'Open reports',
        sourceHref: item.linked_report_id ? `/reports/view/${encodeURIComponent(String(item.linked_report_id))}?type=snapshot` : '/reports',
      });
    });
  }

  if (score.label || score.value != null) {
    highlights.push({
      id: 'alert-score',
      title: 'Current snapshot status',
      detail: `${String(score.label || 'Snapshot available')} with an overall score of ${toNumber(score.value)}/100.`,
      tone: toNumber(score.value) >= 50 ? 'good' : 'warn',
      sourceLabel: latestReport?.id ? 'View snapshot report' : 'Open reports',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    });
  }

  if (dimensions.length > 0) {
    const best = dimensions[0] as Record<string, any>;
    highlights.push({
      id: 'alert-best',
      title: 'What is working best',
      detail: `${String(best.label || best.key || 'Top area')} is currently the strongest signal at ${toNumber(best.value)}/100.`,
      tone: 'good',
      sourceLabel: 'View source report',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    });
  }

  if (weakest.length > 0) {
    const labels = weakest.slice(0, 3).map((item) => `${String((item as any).label || (item as any).key || 'Area')} ${toNumber((item as any).value)}/100`);
    highlights.push({
      id: 'alert-weakest',
      title: 'What needs attention now',
      detail: `${labels.join(', ')} are the biggest constraints holding the score back.`,
      tone: 'warn',
      sourceLabel: 'View source report',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    });
  }

  if (topActions.length > 0) {
    const action = topActions[0] as Record<string, any>;
    highlights.push({
      id: 'alert-next-action',
      title: 'What is required next',
      detail: String(action.action_title || action.title || 'A high-priority action is ready for review.'),
      tone: 'neutral',
      sourceLabel: action.source === 'geo_aeo' ? 'Review Market Pulse' : action.source === 'seo' ? 'View snapshot report' : 'Open reports',
      sourceHref: action.source === 'geo_aeo'
        ? '/dashboard/intelligence?intelTab=market-pulse'
        : latestReport?.id
          ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot`
          : '/reports',
    });
  }

  if (highlights.length === 0) {
    return [
      {
        id: 'alerts-empty',
        title: 'Snapshot highlights are not ready yet',
        detail: 'This area will summarize what is working, what is pending, and what needs action after the next completed snapshot report.',
        tone: 'neutral',
        sourceLabel: 'Open reports',
        sourceHref: '/reports',
      },
    ];
  }

  return highlights.slice(0, 3);
}

export function buildAutomationPrioritySignal(params: {
  automation: AutomationContext;
}): ScoredHighlight {
  const { automation } = params;

  if (automation.connectedPlatforms === 0) {
    return {
      qualityScore: 95,
      highlight: {
        id: 'automation-no-platforms',
        title: 'No social platform is connected yet',
        detail: 'Automation cannot become meaningful until at least one publishing channel is connected.',
        tone: 'warn',
        sourceLabel: 'Connect platform',
        sourceHref: '/social-platforms',
      },
    };
  }

  if (automation.connectedPlatforms === 1 && automation.activeCampaigns === 0) {
    return {
      qualityScore: 92,
      highlight: {
        id: 'automation-one-platform-low-motion',
        title: 'Only one platform is connected and campaign activity is still low',
        detail: 'This is the clearest sign that automation is underused right now. Launch a campaign so the connected channel starts producing real execution activity.',
        tone: 'warn',
        sourceLabel: 'Open campaigns',
        sourceHref: '/campaigns',
      },
    };
  }

  if (automation.connectedPlatforms > 0 && automation.activeCampaigns === 0) {
    return {
      qualityScore: 88,
      highlight: {
        id: 'automation-no-active-campaigns',
        title: 'Channels are connected but no campaign is currently pushing activity',
        detail: 'The setup exists, but automation value will stay low until at least one campaign is actively running.',
        tone: 'warn',
        sourceLabel: 'Open campaigns',
        sourceHref: '/campaigns',
      },
    };
  }

  if (automation.activeCampaigns > 0 && automation.scheduledPosts30d === 0) {
    return {
      qualityScore: 90,
      highlight: {
        id: 'automation-no-scheduled-posts',
        title: 'Campaigns exist, but nothing has been scheduled recently',
        detail: 'Execution has gone quiet. The most important fix is to move campaign plans into the calendar so automation has something real to push forward.',
        tone: 'warn',
        sourceLabel: 'Open calendar',
        sourceHref: '/dashboard?tab=calendar',
      },
    };
  }

  if (automation.activeCampaigns > 0 && automation.publishedPosts30d <= 3) {
    return {
      qualityScore: 84,
      highlight: {
        id: 'automation-low-publishing',
        title: 'Publishing activity is still very low for the connected setup',
        detail: `There ${automation.publishedPosts30d === 1 ? 'was only 1 published post' : `were only ${automation.publishedPosts30d} published posts`} in the last 30 days, so the next automation gain should come from increasing campaign execution volume.`,
        tone: 'warn',
        sourceLabel: 'Open campaigns',
        sourceHref: '/campaigns',
      },
    };
  }

  return {
    qualityScore: 72,
    highlight: {
      id: 'automation-running',
      title: 'Automation has real execution to work with',
      detail: `${automation.connectedPlatforms} connected platform${automation.connectedPlatforms === 1 ? '' : 's'}, ${automation.activeCampaigns} active campaign${automation.activeCampaigns === 1 ? '' : 's'}, and ${automation.scheduledPosts30d} scheduled post${automation.scheduledPosts30d === 1 ? '' : 's'} in the last 30 days give the system enough motion to automate meaningfully.`,
      tone: 'good',
      sourceLabel: 'Open campaigns',
      sourceHref: '/campaigns',
    },
  };
}

export function buildSnapshotPrioritySignal(params: {
  latestReport: Record<string, any> | null;
}): ScoredHighlight {
  const { latestReport } = params;
  const composed = (latestReport?.data?.composed_report ?? {}) as Record<string, any>;
  const unified = (composed.unified_intelligence_summary ?? {}) as Record<string, any>;
  const score = (composed.score ?? {}) as Record<string, any>;
  const weakest = readList(score.weakest_dimensions);
  const topActions = readList(unified.top_3_unified_actions);

  const primaryConstraint = unified.primary_constraint as Record<string, any> | undefined;
  const weakestLabels = weakest.slice(0, 3).map((item) => String((item as any).label || (item as any).key || 'Area'));

  if (topActions.length > 0) {
    const action = topActions[0] as Record<string, any>;
    return {
      qualityScore: 94,
      highlight: {
        id: 'snapshot-priority-action',
        title: 'The most important action is to fix the main growth constraint',
        detail: String(action.action_title || action.title || 'A high-priority action is ready for review.'),
        tone: 'warn',
        sourceLabel: latestReport?.id ? 'View snapshot report' : 'Open reports',
        sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
      },
    };
  }

  return {
    qualityScore: primaryConstraint?.title || weakestLabels.length > 0 ? 82 : 20,
    highlight: {
      id: 'snapshot-priority',
      title: 'The snapshot is pointing to the main thing holding performance back',
      detail: primaryConstraint?.title
        ? String(primaryConstraint.title)
        : weakestLabels.length > 0
          ? `${weakestLabels.join(', ')} are currently the main constraints in the latest snapshot.`
          : 'Run a fresh snapshot to surface the strongest current issue.',
      tone: weakestLabels.length > 0 || primaryConstraint?.title ? 'warn' : 'neutral',
      sourceLabel: latestReport?.id ? 'View snapshot report' : 'Open reports',
      sourceHref: latestReport?.id ? `/reports/view/${encodeURIComponent(String(latestReport.id))}?type=snapshot` : '/reports',
    },
  };
}

