/**
 * INT-001 Phase 2 — Opportunity Timeline.
 *
 * Builds a chronological lead timeline purely from stored events plus the
 * capture milestone, and (when requested) the intelligence milestones. Events
 * are deduped on a stable key so re-running the builder never duplicates
 * entries. Ordering is by timestamp, with a stable tiebreak.
 */

import type { LeadCaptureSnapshot, LeadEvolutionIntelligence, LeadTimelineEntry, TimelineStageType } from './types';
import { classifyPage, pagePathOf } from './pageClassifier';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';

const CONVERSION_EVENTS = new Set(['form_submit', 'cta_click']);

const stageRank: Record<TimelineStageType, number> = {
  page_view: 0,
  engagement: 1,
  conversion: 2,
  // WS-2 M3: derived meaning ranks AFTER the raw events at the same instant,
  // so a timeline reads "viewed pricing" then "advanced to consideration".
  journey_milestone: 3,
  funnel_transition: 4,
  intent_shift: 5,
  lead_submitted: 6,
  qualified: 7,
  recommendation_generated: 8,
};

const titleCase = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const metaText = (metadata: Record<string, unknown>, keys: string[], max = 80): string | null => {
  for (const k of keys) {
    const v = metadata?.[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, max);
  }
  return null;
};

const metaPct = (metadata: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const raw = metadata?.[k];
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n === 'number' && Number.isFinite(n)) return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
  }
  return null;
};

/**
 * WS-2 M2 — descriptive labels for the download / video / search families.
 *
 * These events already reached the timeline (any non-page_view event does), but
 * as bare title-cased names: "Video Progress" tells an operator nothing. The
 * label now carries WHAT — the asset, the video and how far through it, the
 * query. Purely a labelling change: no new entries are emitted, the dedupe key
 * is untouched, and ordering is unchanged.
 */
function labelForEvent(
  eventName: string,
  pageUrl: string | null,
  category: string,
  metadata: Record<string, unknown> = {},
  config?: LeadIntelligenceEngineConfig,
): string {
  if (eventName === 'page_view') {
    const path = pagePathOf(pageUrl);
    if (category === 'home' || path === '/') return 'Homepage';
    const pretty = titleCase(category);
    return category === 'other' ? `Viewed ${path || 'a page'}` : pretty;
  }

  const intent = config?.intent;
  if (intent) {
    if (intent.downloadEventNames.includes(eventName)) {
      const asset = metaText(metadata, ['asset_name', 'assetName', 'file_name', 'fileName', 'title', 'asset']);
      return asset ? `Downloaded ${asset}` : 'Downloaded a file';
    }
    const video = intent.video;
    const isVideo =
      video.startedEventNames.includes(eventName) ||
      video.progressEventNames.includes(eventName) ||
      video.completedEventNames.includes(eventName);
    if (isVideo) {
      const title = metaText(metadata, ['video_title', 'videoTitle', 'video_id', 'videoId', 'title']);
      const named = title ? ` "${title}"` : '';
      if (video.completedEventNames.includes(eventName)) return `Finished video${named}`;
      if (video.startedEventNames.includes(eventName)) return `Started video${named}`;
      const pct = metaPct(metadata, ['percent', 'progress', 'progress_pct', 'progressPct', 'position_pct']);
      return pct !== null ? `Watched ${Math.round(pct)}% of video${named}` : `Video progress${named}`;
    }
    if (intent.search.eventNames.includes(eventName)) {
      const q = metaText(metadata, ['query', 'search_term', 'searchTerm', 'q', 'term', 'keyword']);
      return q ? `Searched "${q}"` : 'Searched the site';
    }
  }

  return titleCase(eventName);
}

export interface TimelineMilestones {
  /** When qualification was generated (usually snapshot.now). */
  qualifiedAt?: string;
  /** When recommendations were generated (usually snapshot.now). */
  recommendationGeneratedAt?: string;
  /**
   * WS-2 M3 — evolution to project onto the timeline. Optional: omitting it
   * yields exactly the pre-M3 timeline.
   */
  evolution?: LeadEvolutionIntelligence;
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
      label: labelForEvent(event.eventName, event.pageUrl, category, event.metadata, config),
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

  /**
   * WS-2 M3 — evolution entries.
   *
   * Journey milestones, funnel transitions and intent shifts are derived from
   * the SAME events already in this timeline, so they are deliberately added
   * with their own `type` values and their own dedupe namespace. That keeps
   * "viewed the pricing page" (a tracking event) distinct from "reached the
   * consideration stage" (what that event MEANT) instead of collapsing the two
   * into a duplicate row.
   */
  if (milestones.evolution) {
    const evo = milestones.evolution;
    const add = (type: TimelineStageType, key: string, label: string, at: string): void => {
      if (!at || !Number.isFinite(Date.parse(at))) return;
      const dedupeKey = `${type}:${key}:${at}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      entries.push({ type, label, occurredAt: at, pageUrl: null, category: null, source: 'intelligence' });
    };

    for (const m of evo.journey.milestones) {
      // `first_visit` and `lead_submitted` are already represented by the
      // tracking and capture entries above — adding them again would be a
      // genuine duplicate rather than a distinct layer of meaning.
      if (m.key === 'first_visit' || m.key === 'lead_submitted') continue;
      add('journey_milestone', m.key, m.label, m.at);
    }
    for (const t of evo.funnel.transitions) {
      add('funnel_transition', `${t.from}->${t.to}`, t.direction === 'advance' ? `Advanced to ${t.to}` : `Moved back to ${t.to}`, t.at);
    }
    for (const t of evo.intent.transitions) {
      // Only band changes are timeline-worthy; every point of score movement
      // would bury the events that caused it.
      if (t.previous.band === t.current.band) continue;
      add('intent_shift', `${t.previous.band}->${t.current.band}`, `Intent ${t.previous.band} → ${t.current.band}`, t.at);
    }
  }

  return entries.sort((a, z) => {
    const diff = Date.parse(a.occurredAt) - Date.parse(z.occurredAt);
    if (diff !== 0) return diff;
    const rank = stageRank[a.type] - stageRank[z.type];
    if (rank !== 0) return rank;
    // Stable final tiebreak: labels are unique within a type at one instant.
    return (a.pageUrl ?? '').localeCompare(z.pageUrl ?? '') || a.label.localeCompare(z.label);
  });
}
