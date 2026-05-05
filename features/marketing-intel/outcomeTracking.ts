import type { Snapshot, NextAction } from './types';
import { computeEnhancedPriority } from './derives';
import { deriveSystemActionLines } from './actionLines';

export type ActionStatus = 'not_started' | 'in_progress' | 'completed';
export type ConstraintConfidence = 'Low' | 'Medium' | 'High';
export type ConfidenceDirection = 'up' | 'flat' | 'down';

export type ActionProgressEntry = {
  status: ActionStatus;
  updatedAt: string;
  completedAt?: string;
};

export type OutcomeSignalSnapshot = {
  publishingCount: number;
  activeChannels: number;
  publishedPosts: number;
  engagementSignals: number;
  activeLeads: number;
  qualifiedLeads: number;
};

export type ActionOutcomeBaseline = {
  capturedAt: string;
  signals: OutcomeSignalSnapshot;
};

export const MARKETING_INTEL_PROGRESS_STORAGE_KEY = 'marketing-intel-progress';
export const MARKETING_INTEL_CONFIDENCE_STORAGE_KEY = 'marketing-intel-constraint-confidence';
export const MARKETING_INTEL_OUTCOME_STORAGE_KEY = 'marketing-intel-outcomes';
export const STALE_ACTION_MS = 48 * 60 * 60 * 1000;
export const EARLY_OUTCOME_WINDOW_MS = 48 * 60 * 60 * 1000;

export function normalizeActionProgress(raw: unknown): Record<string, ActionProgressEntry> {
  if (!raw || typeof raw !== 'object') return {};

  const now = new Date().toISOString();
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, ActionProgressEntry>>((acc, [key, value]) => {
    if (typeof value === 'string' && ['not_started', 'in_progress', 'completed'].includes(value)) {
      acc[key] = { status: value as ActionStatus, updatedAt: now };
      return acc;
    }

    if (
      value &&
      typeof value === 'object' &&
      'status' in value &&
      typeof (value as { status?: unknown }).status === 'string' &&
      ['not_started', 'in_progress', 'completed'].includes((value as { status: string }).status)
    ) {
      const candidate = value as Partial<ActionProgressEntry>;
      acc[key] = {
        status: candidate.status as ActionStatus,
        updatedAt: candidate.updatedAt ?? now,
        completedAt: candidate.completedAt,
      };
    }

    return acc;
  }, {});
}

export function buildActionProgressEntry(status: ActionStatus, previous?: ActionProgressEntry): ActionProgressEntry {
  const now = new Date().toISOString();
  if (status === 'completed') {
    return {
      status,
      updatedAt: now,
      completedAt: now,
    };
  }

  return {
    status,
    updatedAt: now,
    completedAt: previous?.completedAt,
  };
}

export function deriveOutcomeSignals(snapshot: Snapshot): OutcomeSignalSnapshot {
  return {
    publishingCount: snapshot.content_summary.recent_blogs,
    activeChannels: snapshot.distribution_summary.active_platforms,
    publishedPosts: snapshot.distribution_summary.published_posts,
    engagementSignals: snapshot.lead_summary.engagement_signals,
    activeLeads: snapshot.lead_summary.active_leads,
    qualifiedLeads: snapshot.lead_summary.qualified_active_leads,
  };
}

export function normalizeOutcomeBaselines(raw: unknown): Record<string, ActionOutcomeBaseline> {
  if (!raw || typeof raw !== 'object') return {};

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, ActionOutcomeBaseline>>((acc, [key, value]) => {
    if (
      value &&
      typeof value === 'object' &&
      'capturedAt' in value &&
      'signals' in value &&
      typeof (value as { capturedAt?: unknown }).capturedAt === 'string'
    ) {
      const candidate = value as Partial<ActionOutcomeBaseline> & { signals?: Partial<OutcomeSignalSnapshot> };
      acc[key] = {
        capturedAt: candidate.capturedAt as string,
        signals: {
          publishingCount: candidate.signals?.publishingCount ?? 0,
          activeChannels: candidate.signals?.activeChannels ?? 0,
          publishedPosts: candidate.signals?.publishedPosts ?? 0,
          engagementSignals: candidate.signals?.engagementSignals ?? 0,
          activeLeads: candidate.signals?.activeLeads ?? 0,
          qualifiedLeads: candidate.signals?.qualifiedLeads ?? 0,
        },
      };
    }
    return acc;
  }, {});
}

export function countImprovingOutcomes(snapshot: Snapshot, baselines: Record<string, ActionOutcomeBaseline>): number {
  return deriveCurrentDoNowItems(snapshot).reduce((count, item) => {
    const baseline = baselines[item.id];
    if (!baseline) return count;

    const current = deriveOutcomeSignals(snapshot);
    const previous = baseline.signals;
    const improved =
      current.publishingCount > previous.publishingCount ||
      current.activeChannels > previous.activeChannels ||
      current.engagementSignals > previous.engagementSignals ||
      current.activeLeads > previous.activeLeads ||
      current.qualifiedLeads > previous.qualifiedLeads;
    return improved ? count + 1 : count;
  }, 0);
}

export function getActionCompletionFeedback(item: { id: string; label: string }): string {
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    return 'Good — this will improve signal consistency over the next cycle.';
  }
  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    return 'Good — this will improve signal reliability across channels.';
  }
  if (normalized.includes('stage') || normalized.includes('journey')) {
    return 'Good — this will strengthen progression through the buyer journey.';
  }
  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    return 'Good — this will sharpen the path from demand into commercial action.';
  }
  return 'Good — this will make the next decision cycle more reliable.';
}

export function getRecommendedActionReason(item: { id: string; label: string }): string {
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    return 'This will improve signal consistency and unlock clearer performance patterns.';
  }
  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    return 'This will reduce channel bias and make traction signals more reliable.';
  }
  if (normalized.includes('stage') || normalized.includes('journey')) {
    return 'This will strengthen buyer progression and make weak journey gaps measurable.';
  }
  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    return 'This will turn warm demand into clearer commercial signal faster.';
  }
  return 'This will make the next decision cycle clearer and easier to trust.';
}

export function deriveOutcomeMessages(
  item: { id: string; label: string },
  baseline: ActionOutcomeBaseline | undefined,
  snapshot: Snapshot
): string[] {
  if (!baseline) return ['→ No measurable impact yet'];

  const current = deriveOutcomeSignals(snapshot);
  const previous = baseline.signals;
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  const lines: string[] = [];
  const ageMs = Date.now() - new Date(baseline.capturedAt).getTime();
  const pushIfMeaningful = (line: string | null) => {
    if (line && lines.length < 3) lines.push(line);
  };

  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    const publishingDelta = current.publishingCount - previous.publishingCount;
    const engagementDelta = current.engagementSignals - previous.engagementSignals;
    pushIfMeaningful(
      publishingDelta > 0
        ? `↑ Publishing increased (+${publishingDelta} piece${publishingDelta === 1 ? '' : 's'})`
        : publishingDelta < 0
          ? `↓ Publishing slowed (${Math.abs(publishingDelta)} fewer piece${Math.abs(publishingDelta) === 1 ? '' : 's'})`
          : null
    );
    pushIfMeaningful(
      engagementDelta > 0
        ? `↑ Engagement signals improving (+${engagementDelta})`
        : engagementDelta < 0
          ? `↓ Engagement signals softer (${Math.abs(engagementDelta)} lower)`
          : null
    );
  }

  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    const channelDelta = current.activeChannels - previous.activeChannels;
    const postsDelta = current.publishedPosts - previous.publishedPosts;
    pushIfMeaningful(
      channelDelta > 0
        ? `↑ Distribution broader (+${channelDelta} active channel${channelDelta === 1 ? '' : 's'})`
        : channelDelta < 0
          ? `↓ Distribution narrowed (${Math.abs(channelDelta)} fewer active channel${Math.abs(channelDelta) === 1 ? '' : 's'})`
          : '→ Distribution unchanged'
    );
    pushIfMeaningful(
      postsDelta > 0
        ? `↑ More delivery signal visible (+${postsDelta} published post${postsDelta === 1 ? '' : 's'})`
        : postsDelta < 0
          ? `↓ Published output slipped (${Math.abs(postsDelta)} fewer post${Math.abs(postsDelta) === 1 ? '' : 's'})`
          : null
    );
  }

  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    const qualifiedDelta = current.qualifiedLeads - previous.qualifiedLeads;
    const leadDelta = current.activeLeads - previous.activeLeads;
    pushIfMeaningful(
      qualifiedDelta > 0
        ? `↑ Qualified demand increased (+${qualifiedDelta})`
        : qualifiedDelta < 0
          ? `↓ Qualified demand slipped (${Math.abs(qualifiedDelta)} lower)`
          : null
    );
    pushIfMeaningful(
      leadDelta > 0
        ? `↑ Active leads increased (+${leadDelta})`
        : leadDelta < 0
          ? `↓ Active leads decreased (${Math.abs(leadDelta)} lower)`
          : null
    );
  }

  if (lines.length === 0) {
    const engagementDelta = current.engagementSignals - previous.engagementSignals;
    const publishingDelta = current.publishingCount - previous.publishingCount;
    if (engagementDelta > 0) {
      lines.push(`↑ Engagement signals improving (+${engagementDelta})`);
    } else if (publishingDelta > 0) {
      lines.push(`↑ Publishing increased (+${publishingDelta} piece${publishingDelta === 1 ? '' : 's'})`);
    }
  }

  if (lines.length > 0) return lines.slice(0, 3);
  return [ageMs < EARLY_OUTCOME_WINDOW_MS ? '→ Too early to measure impact — check back next cycle' : '→ No measurable impact yet'];
}

export function deriveCurrentDoNowItems(snapshot: Snapshot) {
  return deriveSystemActionLines(snapshot).doNow.slice(0, 2).map((item) => ({
    id: item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: item.text,
    href: item.href,
    ctaLabel: item.label,
  }));
}

export function splitActionBuckets(actions: NextAction[]) {
  const grouped = { doNow: [] as NextAction[], doNext: [] as NextAction[], monitor: [] as NextAction[] };

  actions.forEach((action) => {
    const priority = computeEnhancedPriority(action).priority;
    if (priority === 'high') grouped.doNow.push(action);
    else if (priority === 'medium') grouped.doNext.push(action);
    else grouped.monitor.push(action);
  });

  return grouped;
}

export function deriveConstraintConfidence(snapshot: Snapshot): ConstraintConfidence {
  return snapshot.system_snapshot.evaluated_campaigns >= 6 && snapshot.lead_summary.engagement_signals > 0
    ? 'High'
    : snapshot.system_snapshot.evaluated_campaigns >= 3
      ? 'Medium'
      : 'Low';
}

function getConfidenceRank(confidence: ConstraintConfidence): number {
  return confidence === 'High' ? 3 : confidence === 'Medium' ? 2 : 1;
}

export function deriveConstraintConfidenceDirection(snapshot: Snapshot): ConfidenceDirection {
  if (typeof window === 'undefined') return 'flat';

  try {
    const saved = window.localStorage.getItem(MARKETING_INTEL_CONFIDENCE_STORAGE_KEY);
    const outcomeSaved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
    const improvingOutcomes = outcomeSaved ? countImprovingOutcomes(snapshot, normalizeOutcomeBaselines(JSON.parse(outcomeSaved))) : 0;
    const current = {
      confidence: deriveConstraintConfidence(snapshot),
      evaluatedCampaigns: snapshot.system_snapshot.evaluated_campaigns,
      engagementSignals: snapshot.lead_summary.engagement_signals,
      improvingOutcomes,
    };

    window.localStorage.setItem(MARKETING_INTEL_CONFIDENCE_STORAGE_KEY, JSON.stringify(current));

    if (!saved) return 'flat';

    const previous = JSON.parse(saved) as Partial<{
      confidence: ConstraintConfidence;
      evaluatedCampaigns: number;
      engagementSignals: number;
      improvingOutcomes: number;
    }>;

    if (!previous.confidence) return 'flat';

    const currentRank = getConfidenceRank(current.confidence);
    const previousRank = getConfidenceRank(previous.confidence);
    if (currentRank > previousRank) return 'up';
    if (currentRank < previousRank) return 'down';

    const currentSupport = current.evaluatedCampaigns + current.engagementSignals;
    const previousSupport = (previous.evaluatedCampaigns ?? 0) + (previous.engagementSignals ?? 0);
    if (currentSupport > previousSupport) return 'up';
    if (currentSupport < previousSupport) return 'down';

    if (current.improvingOutcomes > (previous.improvingOutcomes ?? 0)) return 'up';
    if (current.improvingOutcomes < (previous.improvingOutcomes ?? 0)) return 'down';
  } catch {}

  return 'flat';
}
