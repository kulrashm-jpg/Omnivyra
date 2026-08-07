/**
 * INT-001 Phase 2 — shared, pure behaviour analysis over a capture snapshot.
 *
 * Computed once and consumed by the intent, qualification, segmentation and
 * recommendation engines so they all agree on the same derived facts.
 */

import type { CapturedEvent, CapturedGeoContext, LeadCaptureSnapshot, PageCategory } from './types';
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

  // ── WS-2 M1 (2): durable visitor signals, now that sessions carry them ────
  /**
   * True when the visitor is known to have prior sessions. Sourced from the
   * durable per-session `returning` flag, falling back to observing more than
   * one distinct session. Null only when neither source is available.
   */
  returningVisitor: boolean | null;
  /** Highest durable visit ordinal seen across the loaded sessions. */
  visitCount: number | null;
  /** Earliest known first-visit timestamp for this visitor (ISO). */
  firstVisitAt: string | null;
  /** Days from the visitor's first known visit to `snapshot.now`. */
  daysSinceFirstVisit: number | null;
  /** Mean gap between consecutive session starts, ms. Null with <2 sessions. */
  avgTimeBetweenSessionsMs: number | null;
  /** Shortest gap between consecutive session starts, ms. */
  minTimeBetweenSessionsMs: number | null;
  /** Summed measured session duration, ms. Null when nothing was measured. */
  totalSessionDurationMs: number | null;
  /** Distinct exit pages observed across sessions (deduped, sorted). */
  exitPages: string[];

  // ── WS-2 M2: visitor dimensions + new event families ─────────────────────
  /**
   * Device the visitor uses MOST across their sessions (ties broken
   * alphabetically for determinism). Null when no session carried a device.
   */
  primaryDeviceCategory: string | null;
  /** Every distinct device category observed, sorted. */
  deviceCategories: string[];
  /** True when the visitor has been seen on more than one device category. */
  multiDevice: boolean | null;
  /** Distinct browsers observed, sorted. */
  browsers: string[];
  /** Distinct platform families observed (apple/android/windows/linux), sorted. */
  platforms: string[];
  /** Distinct operating systems observed, sorted. */
  operatingSystems: string[];
  /** Most recent known geography across sessions (falls back to the lead's). */
  geo: CapturedGeoContext | null;
  /** Distinct countries observed, sorted. */
  countries: string[];
  /**
   * True when every known session came from ONE country. False when the
   * visitor appears from several. Null when no country was ever resolved.
   */
  geoConsistent: boolean | null;
  /** IANA timezone to use when reasoning about local time. */
  timezone: string | null;

  /** Distinct normalized on-site search queries, sorted. */
  searchQueries: string[];
  /** Total search events (including repeats of the same query). */
  searchCount: number;
  /** Distinct downloaded asset names, sorted. */
  downloadedAssets: string[];
  /** Distinct videos started. */
  videoStartCount: number;
  /** Distinct videos completed. */
  videoCompleteCount: number;
  /** Highest observed video progress percentage (0–100), null when none. */
  maxVideoProgressPct: number | null;
  /** Distinct video identifiers/titles seen, sorted. */
  videosEngaged: string[];
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

// ── WS-2 M2 helpers ─────────────────────────────────────────────────────────

/** First non-empty string among the given metadata keys. */
const metaString = (event: CapturedEvent, keys: string[], max = 120): string | null => {
  for (const k of keys) {
    const raw = event.metadata?.[k];
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim().slice(0, max);
  }
  return null;
};

const metaNumber = (event: CapturedEvent, keys: string[]): number | null => {
  for (const k of keys) {
    const raw = event.metadata?.[k];
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
};

/**
 * Normalize a search query for DEDUPE only: lowercased, collapsed whitespace.
 * The original casing is not preserved because the query is used as evidence
 * text and grouping "Pricing" with "pricing" is the behaviour operators expect.
 */
const normalizeQuery = (q: string | null): string | null => {
  if (!q) return null;
  const n = q.toLowerCase().replace(/\s+/g, ' ').trim();
  return n.length > 0 && n.length <= 120 ? n : null;
};

/** Most frequent value, ties broken alphabetically so output is deterministic. */
const modeOf = (values: string[]): string | null => {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
};

const sortedUnique = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))].sort();

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
  // WS-2 M2: the new event families, resolved once outside the loop.
  const videoCfg = config.intent.video;
  const videoStartNames = new Set(videoCfg.startedEventNames);
  const videoProgressNames = new Set(videoCfg.progressEventNames);
  const videoCompleteNames = new Set(videoCfg.completedEventNames);
  const searchNames = new Set(config.intent.search.eventNames);

  const searchQuerySet = new Set<string>();
  const downloadedAssetSet = new Set<string>();
  const videoIdSet = new Set<string>();
  const videosStarted = new Set<string>();
  const videosCompleted = new Set<string>();
  let searchCount = 0;
  let maxVideoProgressPct: number | null = null;

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
    if (downloadNames.has(event.eventName) || (event.eventName === 'page_view' && category === 'download')) {
      downloadCount += 1;
      // WS-2 M2: WHAT was downloaded, when the tracker reported it.
      const asset = metaString(event, ['asset_name', 'assetName', 'file_name', 'fileName', 'title', 'asset']);
      if (asset) downloadedAssetSet.add(asset);
    }

    // WS-2 M2 — video engagement. A single video may emit start → progress →
    // complete; identity comes from the tracker so the three are attributed to
    // ONE video rather than counted as three separate engagements.
    const isStart = videoStartNames.has(event.eventName);
    const isProgress = videoProgressNames.has(event.eventName);
    const isComplete = videoCompleteNames.has(event.eventName);
    if (isStart || isProgress || isComplete) {
      const videoId = metaString(event, ['video_id', 'videoId', 'video_title', 'videoTitle', 'title', 'asset_name']) ?? pagePathOf(event.pageUrl) ?? 'video';
      videoIdSet.add(videoId);
      if (isStart) videosStarted.add(videoId);
      if (isComplete) {
        videosCompleted.add(videoId);
        // A completion implies 100 % regardless of whether progress was sent.
        maxVideoProgressPct = 100;
      }
      const pctRaw = metaNumber(event, ['percent', 'progress', 'progress_pct', 'progressPct', 'position_pct']);
      if (pctRaw !== null) {
        const pct = Math.max(0, Math.min(100, pctRaw <= 1 ? pctRaw * 100 : pctRaw));
        maxVideoProgressPct = maxVideoProgressPct === null ? pct : Math.max(maxVideoProgressPct, pct);
      }
    }

    // WS-2 M2 — on-site search.
    if (searchNames.has(event.eventName)) {
      searchCount += 1;
      const q = normalizeQuery(metaString(event, ['query', 'search_term', 'searchTerm', 'q', 'term', 'keyword']));
      if (q) searchQuerySet.add(q);
    }
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

  // ── WS-2 M1 (2): derive the durable visitor signals ──────────────────────
  // Reuses the sessions already loaded by this same pass — no extra read, no
  // parallel pipeline. Every value is a pure function of snapshot input, so
  // identical input still yields an identical analysis.
  const visitCounts = snapshot.sessions
    .map((s) => s.visitCount)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const visitCount = visitCounts.length > 0 ? Math.max(...visitCounts) : null;

  const durableReturning = snapshot.sessions.some((s) => s.returning === true)
    ? true
    : snapshot.sessions.some((s) => s.returning === false)
      ? false
      : null;
  // Observed multi-session activity is itself proof of returning behaviour;
  // it can only ever upgrade an unknown/false durable flag, never downgrade it.
  const returningVisitor =
    durableReturning === true || (visitCount !== null && visitCount > 1) || sessionIds.size > 1
      ? true
      : durableReturning;

  const firstVisitTimes = snapshot.sessions
    .map((s) => toMs(s.firstVisitAt))
    .filter((v): v is number => v !== null);
  const firstVisitMs = firstVisitTimes.length > 0 ? Math.min(...firstVisitTimes) : null;
  const firstVisitAt = firstVisitMs !== null ? new Date(firstVisitMs).toISOString() : null;
  const daysSinceFirstVisit =
    nowMs !== null && firstVisitMs !== null ? Math.max(0, (nowMs - firstVisitMs) / 86_400_000) : null;

  // Gaps between consecutive session starts, ascending — deterministic.
  const sessionStarts = snapshot.sessions
    .map((s) => toMs(s.startedAt))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sessionStarts.length; i += 1) gaps.push(sessionStarts[i] - sessionStarts[i - 1]);
  const avgTimeBetweenSessionsMs =
    gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const minTimeBetweenSessionsMs = gaps.length > 0 ? Math.min(...gaps) : null;

  const durations = snapshot.sessions
    .map((s) => s.sessionDurationMs)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const totalSessionDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;

  const exitPages = [
    ...new Set(
      snapshot.sessions
        .map((s) => pagePathOf(s.lastCurrentPage))
        .filter((p): p is string => p !== ''),
    ),
  ].sort();

  // ── WS-2 M2: derive the visitor dimensions from the same loaded sessions ──
  // Sessions are ordered newest-last by start time so "most recent geography"
  // is deterministic regardless of the order rows arrived in.
  const sessionsByStart = [...snapshot.sessions].sort((a, b) => (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0));
  const deviceCategoryValues = sessionsByStart.map((s) => s.device?.deviceCategory).filter((v): v is string => !!v);
  const deviceCategories = sortedUnique(deviceCategoryValues);
  const primaryDeviceCategory = modeOf(deviceCategoryValues);
  const multiDevice = deviceCategories.length > 0 ? deviceCategories.length > 1 : null;
  const browsers = sortedUnique(sessionsByStart.map((s) => s.device?.browser));
  const platforms = sortedUnique(sessionsByStart.map((s) => s.device?.platform));
  const operatingSystems = sortedUnique(sessionsByStart.map((s) => s.device?.os));

  // Most recent known geography, falling back to the conversion-moment geo on
  // the lead itself when no session carried one.
  const geoSessions = sessionsByStart.filter((s) => s.geo !== null);
  const geo: CapturedGeoContext | null = geoSessions.length > 0 ? geoSessions[geoSessions.length - 1].geo : snapshot.lead.geo;
  const countries = sortedUnique([...sessionsByStart.map((s) => s.geo?.country), snapshot.lead.geo?.country]);
  const geoConsistent = countries.length > 0 ? countries.length === 1 : null;
  const timezone = geo?.timezone ?? snapshot.lead.geo?.timezone ?? null;

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
    returningVisitor,
    visitCount,
    firstVisitAt,
    daysSinceFirstVisit,
    avgTimeBetweenSessionsMs,
    minTimeBetweenSessionsMs,
    totalSessionDurationMs,
    exitPages,
    primaryDeviceCategory,
    deviceCategories,
    multiDevice,
    browsers,
    platforms,
    operatingSystems,
    geo,
    countries,
    geoConsistent,
    timezone,
    searchQueries: [...searchQuerySet].sort(),
    searchCount,
    downloadedAssets: [...downloadedAssetSet].sort(),
    videoStartCount: videosStarted.size,
    videoCompleteCount: videosCompleted.size,
    maxVideoProgressPct,
    videosEngaged: [...videoIdSet].sort(),
  };
}
