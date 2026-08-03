/**
 * INT-001 Phase 3 — shared, pure signal extraction over the capture snapshot.
 * Read-only over already-captured data; no I/O, no clock (uses snapshot.now).
 */

import type { LeadCaptureSnapshot } from './types';
import {
  FREE_EMAIL_DOMAINS,
  STUDENT_EMAIL_MARKERS,
  PAGE_SIGNAL_PATTERNS,
  RECENCY_HOURS,
} from './planningConfig';

export type EmailClass = 'company' | 'free' | 'student' | 'unknown';

export function classifyEmail(email: string | null | undefined): EmailClass {
  const normalized = String(email ?? '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) return 'unknown';
  const domain = normalized.slice(at + 1);
  if (STUDENT_EMAIL_MARKERS.some((marker) => domain.includes(marker))) return 'student';
  if (FREE_EMAIL_DOMAINS.has(domain)) return 'free';
  return 'company';
}

/** Classify one URL into zero-or-more page signals (pricing, demo, …). */
export function pageSignalsFor(url: string | null | undefined): string[] {
  const target = String(url ?? '').toLowerCase();
  if (!target) return [];
  const hits: string[] = [];
  for (const { signal, patterns } of PAGE_SIGNAL_PATTERNS) {
    if (patterns.some((p) => target.includes(p))) hits.push(signal);
  }
  return hits;
}

export interface SnapshotSignals {
  emailClass: EmailClass;
  sessionCount: number;
  repeatVisitor: boolean;
  eventCount: number;
  pageViewCount: number;
  /** distinct page-signal → number of matching page views/events */
  pageSignalCounts: Record<string, number>;
  /** hours between snapshot.now and the newest event/session activity; null when no activity. */
  hoursSinceLastActivity: number | null;
  recency: 'immediate' | 'same_day' | 'same_week' | 'older' | 'none';
  demoRequested: boolean;
  formEngaged: boolean;
}

function hoursBetween(nowIso: string, thenIso: string | null | undefined): number | null {
  const now = Date.parse(nowIso);
  const then = Date.parse(String(thenIso ?? ''));
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, (now - then) / 3_600_000);
}

/** Deterministic one-pass extraction of everything the engines consume. */
export function extractSnapshotSignals(snapshot: LeadCaptureSnapshot): SnapshotSignals {
  const pageSignalCounts: Record<string, number> = {};
  let pageViewCount = 0;
  let demoRequested = false;
  let formEngaged = false;
  let newestActivity: string | null = null;

  const consider = (timestamp: string | null | undefined) => {
    const value = String(timestamp ?? '');
    if (!value || !Number.isFinite(Date.parse(value))) return;
    if (!newestActivity || value > newestActivity) newestActivity = value;
  };

  for (const event of snapshot.events) {
    consider(event.occurredAt);
    const name = String(event.eventName ?? '').toLowerCase();
    if (name === 'page_view') pageViewCount += 1;
    if (name.startsWith('form_')) formEngaged = true;
    for (const signal of pageSignalsFor(event.pageUrl)) {
      pageSignalCounts[signal] = (pageSignalCounts[signal] ?? 0) + 1;
      if (signal === 'demo') demoRequested = true;
    }
  }
  for (const session of snapshot.sessions) {
    consider(session.lastSeenAt ?? session.startedAt);
    for (const signal of pageSignalsFor(session.firstLandingPage)) {
      pageSignalCounts[signal] = (pageSignalCounts[signal] ?? 0) + 1;
    }
  }
  consider(snapshot.lead.createdAt);

  // A demo-intent submission counts as a demo request even without page events.
  const interest = String(snapshot.lead.primaryInterest ?? '').toLowerCase();
  if (interest.includes('demo')) demoRequested = true;

  const hoursSinceLastActivity = newestActivity ? hoursBetween(snapshot.now, newestActivity) : null;
  const recency: SnapshotSignals['recency'] =
    hoursSinceLastActivity == null ? 'none'
      : hoursSinceLastActivity <= RECENCY_HOURS.immediate ? 'immediate'
        : hoursSinceLastActivity <= RECENCY_HOURS.sameDay ? 'same_day'
          : hoursSinceLastActivity <= RECENCY_HOURS.sameWeek ? 'same_week'
            : 'older';

  const sessionCount = snapshot.sessions.length;
  return {
    emailClass: classifyEmail(snapshot.lead.email),
    sessionCount,
    repeatVisitor: sessionCount > 1,
    eventCount: snapshot.events.length,
    pageViewCount,
    pageSignalCounts,
    hoursSinceLastActivity,
    recency,
    demoRequested,
    formEngaged,
  };
}

/** Clamp helper shared by every engine. */
export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
