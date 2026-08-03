/**
 * INT-001 Phase 2 — shared, pure behaviour analysis over a capture snapshot.
 *
 * Computed once and consumed by the intent, qualification, segmentation and
 * recommendation engines so they all agree on the same derived facts.
 */

import type { CapturedEvent, LeadCaptureSnapshot, PageCategory } from './types';
import { classifyPage, pagePathOf } from './pageClassifier';
import type { LeadIntelligenceEngineConfig } from './engineConfig';

export interface BehaviorAnalysis {
  totalEvents: number;
  pageViews: number;
  /** Distinct page paths visited (page_view events only). */
  distinctPages: string[];
  /** Distinct visited page paths per category (page_view events only). */
  categoryPages: Map<PageCategory, Set<string>>;
  /** Distinct session ids observed across events + sessions. */
  sessionCount: number;
  /** Distinct UTC calendar days with at least one event. */
  activeDays: string[];
  /** Events whose scroll depth met the deep-scroll threshold. */
  deepScrollCount: number;
  /** Page views followed by another event ≥ dwell threshold later in-session. */
  engagedDwellCount: number;
  /** Download-type events (by configured event names or download-page views). */
  downloadCount: number;
  /** ISO timestamp of the most recent event (null when no events). */
  lastActivityAt: string | null;
  /** Days between lastActivityAt and snapshot.now (null when no events). */
  daysSinceLastActivity: number | null;
  /** Categories visited in the chronologically last session. */
  lastSessionCategories: Set<PageCategory>;
  /** True when the second half of the observation window has more events than the first. */
  acceleratingVisits: boolean;
  /** Event-hour histogram (UTC hour → count) for contact-time inference. */
  hourHistogram: Map<number, number>;
}

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const scrollDepthOf = (event: CapturedEvent): number | null => {
  const raw = event.metadata?.scroll_depth ?? event.metadata?.scrollDepth;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
};

export function analyzeBehavior(snapshot: LeadCaptureSnapshot, config: LeadIntelligenceEngineConfig): BehaviorAnalysis {
  const events = [...snapshot.events].sort((a, b) => {
    const am = toMs(a.occurredAt) ?? 0;
    const bm = toMs(b.occurredAt) ?? 0;
    return am - bm;
  });

  const categoryPages = new Map<PageCategory, Set<string>>();
  const distinctPages = new Set<string>();
  const sessionIds = new Set<string>();
  const activeDays = new Set<string>();
  const hourHistogram = new Map<number, number>();
  let pageViews = 0;
  let deepScrollCount = 0;
  let downloadCount = 0;

  const downloadNames = new Set(config.intent.downloadEventNames);

  for (const event of events) {
    if (event.sessionId) sessionIds.add(event.sessionId);
    const ms = toMs(event.occurredAt);
    if (ms !== null) {
      const d = new Date(ms);
      activeDays.add(d.toISOString().slice(0, 10));
      const hour = d.getUTCHours();
      hourHistogram.set(hour, (hourHistogram.get(hour) ?? 0) + 1);
    }
    const path = pagePathOf(event.pageUrl);
    const category = classifyPage(event.pageUrl, config.pageClassifier);
    if (event.eventName === 'page_view') {
      pageViews += 1;
      if (path) {
        distinctPages.add(path);
        if (!categoryPages.has(category)) categoryPages.set(category, new Set());
        categoryPages.get(category)!.add(path);
      }
    }
    const depth = scrollDepthOf(event);
    if (depth !== null && depth >= config.intent.deepScrollThreshold) deepScrollCount += 1;
    if (downloadNames.has(event.eventName) || (event.eventName === 'page_view' && category === 'download')) downloadCount += 1;
  }

  for (const session of snapshot.sessions) {
    if (session.id) sessionIds.add(session.id);
  }

  // Engaged dwell: within a session, a page_view followed by any later event at
  // least dwellSecondsThreshold seconds after it.
  let engagedDwellCount = 0;
  const bySession = new Map<string, CapturedEvent[]>();
  for (const event of events) {
    const key = event.sessionId ?? '__nosession__';
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push(event);
  }
  for (const sessionEvents of bySession.values()) {
    for (let i = 0; i < sessionEvents.length; i += 1) {
      if (sessionEvents[i].eventName !== 'page_view') continue;
      const start = toMs(sessionEvents[i].occurredAt);
      if (start === null) continue;
      const next = sessionEvents.slice(i + 1).find((e) => {
        const t = toMs(e.occurredAt);
        return t !== null && (t - start) / 1000 >= config.intent.dwellSecondsThreshold;
      });
      if (next) engagedDwellCount += 1;
    }
  }

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastActivityAt = lastEvent ? lastEvent.occurredAt : null;
  const nowMs = toMs(snapshot.now);
  const lastMs = toMs(lastActivityAt);
  const daysSinceLastActivity = nowMs !== null && lastMs !== null ? Math.max(0, (nowMs - lastMs) / 86_400_000) : null;

  // Categories seen in the chronologically last session (by last event's session).
  const lastSessionCategories = new Set<PageCategory>();
  if (lastEvent) {
    const key = lastEvent.sessionId ?? '__nosession__';
    for (const e of bySession.get(key) ?? []) {
      if (e.eventName === 'page_view') lastSessionCategories.add(classifyPage(e.pageUrl, config.pageClassifier));
    }
  }

  // Accelerating: strictly more events in the second half of [first, last] window.
  let acceleratingVisits = false;
  if (events.length >= 4) {
    const first = toMs(events[0].occurredAt);
    const last = toMs(events[events.length - 1].occurredAt);
    if (first !== null && last !== null && last > first) {
      const mid = first + (last - first) / 2;
      let firstHalf = 0;
      let secondHalf = 0;
      for (const e of events) {
        const t = toMs(e.occurredAt);
        if (t === null) continue;
        if (t <= mid) firstHalf += 1;
        else secondHalf += 1;
      }
      acceleratingVisits = secondHalf > firstHalf;
    }
  }

  return {
    totalEvents: events.length,
    pageViews,
    distinctPages: [...distinctPages].sort(),
    categoryPages,
    sessionCount: sessionIds.size,
    activeDays: [...activeDays].sort(),
    deepScrollCount,
    engagedDwellCount,
    downloadCount,
    lastActivityAt,
    daysSinceLastActivity,
    lastSessionCategories,
    acceleratingVisits,
    hourHistogram,
  };
}
