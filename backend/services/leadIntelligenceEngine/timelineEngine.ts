/**
 * INT-001 Phase 2 — Opportunity Timeline.
 *
 * Builds a chronological lead timeline purely from stored events plus the
 * capture milestone, and (when requested) the intelligence milestones. Events
 * are deduped on a stable key so re-running the builder never duplicates
 * entries. Ordering is by timestamp, with a stable tiebreak.
 */

import type { LeadCaptureSnapshot, LeadTimelineEntry, TimelineStageType } from './types';
import { classifyPage, pagePathOf } from './pageClassifier';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';

const CONVERSION_EVENTS = new Set(['form_submit', 'cta_click']);

const stageRank: Record<TimelineStageType, number> = {
  page_view: 0,
  engagement: 1,
  conversion: 2,
  lead_submitted: 3,
  qualified: 4,
  recommendation_generated: 5,
};

function labelForEvent(eventName: string, pageUrl: string | null, category: string): string {
  if (eventName === 'page_view') {
    const path = pagePathOf(pageUrl);
    if (category === 'home' || path === '/') return 'Homepage';
    const pretty = category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return category === 'other' ? `Viewed ${path || 'a page'}` : pretty;
  }
  return eventName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface TimelineMilestones {
  /** When qualification was generated (usually snapshot.now). */
  qualifiedAt?: string;
  /** When recommendations were generated (usually snapshot.now). */
  recommendationGeneratedAt?: string;
}

export function buildLeadTimeline(
  snapshot: LeadCaptureSnapshot,
  milestones: TimelineMilestones = {},
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
): LeadTimelineEntry[] {
  const config = resolveEngineConfig(configOverride);
  const entries: LeadTimelineEntry[] = [];
  const seen = new Set<string>();

  for (const event of snapshot.events) {
    if (!event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) continue;
    const dedupeKey = event.id
      ? `id:${event.id}`
      : `${event.eventName}|${pagePathOf(event.pageUrl)}|${event.occurredAt}|${event.sessionId ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const category = classifyPage(event.pageUrl, config.pageClassifier);
    const type: TimelineStageType = event.eventName === 'page_view' ? 'page_view' : CONVERSION_EVENTS.has(event.eventName) ? 'conversion' : 'engagement';
    entries.push({
      type,
      label: labelForEvent(event.eventName, event.pageUrl, category),
      occurredAt: event.occurredAt,
      pageUrl: event.pageUrl,
      category: event.eventName === 'page_view' ? category : null,
      source: 'tracking',
    });
  }

  if (snapshot.lead.createdAt && Number.isFinite(Date.parse(snapshot.lead.createdAt))) {
    entries.push({
      type: 'lead_submitted',
      label: 'Lead Submitted',
      occurredAt: snapshot.lead.createdAt,
      pageUrl: null,
      category: null,
      source: 'capture',
    });
  }

  if (milestones.qualifiedAt && Number.isFinite(Date.parse(milestones.qualifiedAt))) {
    entries.push({ type: 'qualified', label: 'Qualified', occurredAt: milestones.qualifiedAt, pageUrl: null, category: null, source: 'intelligence' });
  }
  if (milestones.recommendationGeneratedAt && Number.isFinite(Date.parse(milestones.recommendationGeneratedAt))) {
    entries.push({
      type: 'recommendation_generated',
      label: 'Recommendation Generated',
      occurredAt: milestones.recommendationGeneratedAt,
      pageUrl: null,
      category: null,
      source: 'intelligence',
    });
  }

  return entries.sort((a, z) => {
    const diff = Date.parse(a.occurredAt) - Date.parse(z.occurredAt);
    if (diff !== 0) return diff;
    const rank = stageRank[a.type] - stageRank[z.type];
    if (rank !== 0) return rank;
    return (a.pageUrl ?? '').localeCompare(z.pageUrl ?? '');
  });
}
