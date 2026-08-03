/**
 * INT-001 Phase 1 — client-side visitor journey intelligence.
 *
 * First-party, storage-only recorder for OmniVyra's own marketing site. It
 * restores the visitor/session spine that the tenant tracker provides on
 * customer sites but that never ran on omnivyra.com:
 *
 *   • mints a durable anonymous id (localStorage) and a per-tab session id
 *     (sessionStorage `omn_session` — the SAME key public/tracker.js uses, so
 *     a real tracker install later simply takes precedence),
 *   • records the page sequence + behaviour events (bounded, append-only)
 *     in sessionStorage,
 *   • captures ad click ids (gclid & friends) first-touch style.
 *
 * NOTHING here transmits by itself. The data leaves the browser only inside a
 * lead-capture submission (which carries its own explicit consent checkbox),
 * as `attribution.metadata.journey` — the server treats it as enrichment.
 * Everything is consent-gated (`omnivyra_analytics_consent` !== 'denied'),
 * SSR-safe and fail-safe: any storage error degrades to a no-op.
 */

const ANONYMOUS_ID_KEY = 'omn_anon_id';
const TRACKER_SESSION_KEY = 'omn_session'; // shared with public/tracker.js
const JOURNEY_KEY = 'omn_journey';
const CLICK_IDS_KEY = 'omn_click_ids';
const CONSENT_KEY = 'omnivyra_analytics_consent';

const MAX_PAGES = 50;
const MAX_EVENTS = 100;

/** Ad-platform click identifiers captured first-touch style from the URL. */
export const CLICK_ID_PARAMS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid'] as const;

export interface JourneyPage {
  /** page url (path + query as navigated) */
  p: string;
  /** ISO timestamp */
  t: string;
}

export interface JourneyEvent {
  /** event type: page_view | cta_click | form_start | form_abandon | form_submit | download | video_play | search | engagement */
  e: string;
  /** ISO timestamp */
  t: string;
  /** page the event happened on */
  p?: string;
  /** small free-form detail (label, intent, …) */
  m?: Record<string, string>;
}

export interface JourneySummary {
  entered_at: string | null;
  pages: JourneyPage[];
  events: JourneyEvent[];
  /** last recorded page — the exit-page candidate at submission time */
  exit_page: string | null;
  /** deterministic ordering: 1-based sequence length of the page trail */
  sequence: number;
  click_ids: Record<string, string>;
}

type JourneyState = { entered_at?: string; pages?: JourneyPage[]; events?: JourneyEvent[] };

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function hasJourneyConsent(): boolean {
  if (!hasWindow()) return false;
  try { return window.localStorage.getItem(CONSENT_KEY) !== 'denied'; } catch { return false; }
}

function readJourney(): JourneyState {
  try { return JSON.parse(window.sessionStorage.getItem(JOURNEY_KEY) || '{}') as JourneyState; } catch { return {}; }
}

function writeJourney(state: JourneyState): void {
  try { window.sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(state)); } catch { /* storage disabled */ }
}

function mintId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ensure the visitor ids exist. Values already minted by the real tracker
 * (or a previous call) are always reused — this only fills the gap when no
 * tracker runs on the page. Consent-denied visitors get no ids at all.
 */
export function ensureVisitorIds(): { anonymousId: string; sessionId: string } {
  if (!hasWindow() || !hasJourneyConsent()) return { anonymousId: '', sessionId: '' };
  let anonymousId = '';
  let sessionId = '';
  try {
    anonymousId = window.localStorage.getItem(ANONYMOUS_ID_KEY) || '';
    if (!anonymousId) {
      anonymousId = mintId('anon');
      window.localStorage.setItem(ANONYMOUS_ID_KEY, anonymousId);
    }
  } catch { anonymousId = ''; }
  try {
    sessionId = window.sessionStorage.getItem(TRACKER_SESSION_KEY) || '';
    if (!sessionId) {
      sessionId = mintId('sess');
      window.sessionStorage.setItem(TRACKER_SESSION_KEY, sessionId);
    }
  } catch { sessionId = ''; }
  return { anonymousId, sessionId };
}

/** Capture ad click ids from the current URL, first-touch style (never overwritten). */
export function captureClickIds(): Record<string, string> {
  if (!hasWindow() || !hasJourneyConsent()) return {};
  let stored: Record<string, string> = {};
  try { stored = JSON.parse(window.localStorage.getItem(CLICK_IDS_KEY) || '{}') as Record<string, string>; } catch { stored = {}; }
  try {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    for (const key of CLICK_ID_PARAMS) {
      const value = params.get(key);
      if (value && !stored[key]) { stored[key] = value; changed = true; }
    }
    if (changed) window.localStorage.setItem(CLICK_IDS_KEY, JSON.stringify(stored));
  } catch { /* fail-safe */ }
  return stored;
}

/** Append a page view to the journey trail (skips a consecutive duplicate). */
export function recordJourneyPage(url?: string): void {
  if (!hasWindow() || !hasJourneyConsent()) return;
  try {
    const page = url || window.location.pathname + window.location.search;
    const state = readJourney();
    const pages = Array.isArray(state.pages) ? state.pages : [];
    if (pages.length > 0 && pages[pages.length - 1].p === page) return; // consecutive dup
    const now = new Date().toISOString();
    pages.push({ p: page, t: now });
    writeJourney({
      entered_at: state.entered_at || now,
      pages: pages.slice(-MAX_PAGES),
      events: Array.isArray(state.events) ? state.events : [],
    });
  } catch { /* fail-safe */ }
}

/** Append a behaviour event to the journey (append-only, bounded). */
export function recordJourneyEvent(type: string, meta?: Record<string, string>): void {
  if (!hasWindow() || !hasJourneyConsent()) return;
  try {
    const state = readJourney();
    const events = Array.isArray(state.events) ? state.events : [];
    events.push({
      e: String(type).slice(0, 40),
      t: new Date().toISOString(),
      p: window.location.pathname,
      ...(meta && Object.keys(meta).length > 0 ? { m: meta } : {}),
    });
    writeJourney({
      entered_at: state.entered_at || new Date().toISOString(),
      pages: Array.isArray(state.pages) ? state.pages : [],
      events: events.slice(-MAX_EVENTS),
    });
  } catch { /* fail-safe */ }
}

/** Snapshot of the current journey, attached to capture submissions as enrichment. */
export function getJourneySummary(): JourneySummary {
  const empty: JourneySummary = { entered_at: null, pages: [], events: [], exit_page: null, sequence: 0, click_ids: {} };
  if (!hasWindow() || !hasJourneyConsent()) return empty;
  try {
    const state = readJourney();
    const pages = Array.isArray(state.pages) ? state.pages : [];
    const events = Array.isArray(state.events) ? state.events : [];
    return {
      entered_at: state.entered_at || null,
      pages,
      events,
      exit_page: pages.length > 0 ? pages[pages.length - 1].p : null,
      sequence: pages.length,
      click_ids: captureClickIds(),
    };
  } catch {
    return empty;
  }
}
