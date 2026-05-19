/**
 * orchestrationEventClient — Phase-2 Step-23.
 *
 * ONE shared, ref-counted EventSource per campaign (mirrors the Step-22
 * shared feed-store pattern — N cards, 1 connection). Auto-reconnect with
 * capped backoff. Fully fail-soft: if EventSource is unavailable / errors,
 * subscribers are told `status:'fallback'` so the Step-22 invalidate/
 * revalidate + focus path stays authoritative (no hard dependency on push).
 */

import { orchestrationEventClientDiagnostics } from './orchestrationEventDiagnostics';

export interface ClientOrchestrationEvent {
  type: string;
  campaign_id: string;
  execution_id: string | null;
  asset_state: string | null;
  preview_url: string | null;
  fallback_mode: boolean;
  orchestration_version?: string;
  emitted_at?: string;
  /** Step-25 durable replay cursor (Redis Stream id). */
  event_id?: string | null;
}

export type ChannelStatus = 'connecting' | 'open' | 'fallback';

/** Persisted resume cursor so a cold start / full reload resumes replay. */
const LAST_ID_KEY = (campaignId: string) => `orch:lastEventId:${campaignId}`;

function readLastId(campaignId: string): string | null {
  try { return window.sessionStorage.getItem(LAST_ID_KEY(campaignId)); } catch { return null; }
}
function writeLastId(campaignId: string, id: string): void {
  try { window.sessionStorage.setItem(LAST_ID_KEY(campaignId), id); } catch { /* noop */ }
}

/** Compare Redis Stream ids `ms-seq` numerically (not lexicographically). */
function idGreater(a: string, b: string): boolean {
  const [am, as_] = a.split('-').map((n) => Number(n) || 0);
  const [bm, bs] = b.split('-').map((n) => Number(n) || 0);
  return am !== bm ? am > bm : as_ > bs;
}

type Sub = {
  onEvent: (e: ClientOrchestrationEvent) => void;
  onStatus?: (s: ChannelStatus) => void;
};

type Conn = {
  es: EventSource | null;
  subs: Set<Sub>;
  status: ChannelStatus;
  retries: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  /** Idempotency: durable ids already delivered (bounded). */
  seen: Set<string>;
  /** Out-of-order guard: highest stream id delivered so far. */
  maxId: string | null;
};

const conns = new Map<string, Conn>();
const MAX_BACKOFF_MS = 30_000;

function setStatus(campaignId: string, c: Conn, s: ChannelStatus): void {
  if (c.status === s) return;
  c.status = s;
  c.subs.forEach((sub) => { try { sub.onStatus?.(s); } catch { /* noop */ } });
}

function connect(campaignId: string, c: Conn): void {
  if (c.closed) return;
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    setStatus(campaignId, c, 'fallback');
    orchestrationEventClientDiagnostics.fallback({ campaign_id: campaignId, reason: 'eventsource_unavailable' });
    return;
  }
  setStatus(campaignId, c, 'connecting');
  let es: EventSource;
  try {
    // Cold-start / full-reload resume: native EventSource only sends the
    // Last-Event-ID header on its OWN auto-reconnect, so seed the cursor
    // from sessionStorage via query param for a fresh connection.
    const resume = readLastId(campaignId);
    const url =
      `/api/campaigns/${encodeURIComponent(campaignId)}/orchestration-events` +
      (resume ? `?lastEventId=${encodeURIComponent(resume)}` : '');
    es = new EventSource(url);
  } catch {
    setStatus(campaignId, c, 'fallback');
    orchestrationEventClientDiagnostics.fallback({ campaign_id: campaignId, reason: 'eventsource_ctor_failed' });
    scheduleReconnect(campaignId, c);
    return;
  }
  c.es = es;

  es.addEventListener('ready', () => {
    c.retries = 0;
    setStatus(campaignId, c, 'open');
  });

  es.addEventListener('orchestration', (ev: Event) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as ClientOrchestrationEvent;
      const eid = data.event_id ?? null;
      // Idempotency: drop exact-id redelivery (replay overlap / reconnect).
      if (eid) {
        if (c.seen.has(eid)) {
          orchestrationEventClientDiagnostics.receive({
            campaign_id: campaignId, event_type: data.type,
            event_id: eid, duplicate_suppressed: true,
          });
          return;
        }
        c.seen.add(eid);
        if (c.seen.size > 1000) {
          const oldest = c.seen.values().next().value;
          if (oldest !== undefined) c.seen.delete(oldest);
        }
        // Out-of-order guard: advance the persisted cursor monotonically so
        // a late replay entry can never rewind the resume point.
        if (!c.maxId || idGreater(eid, c.maxId)) {
          c.maxId = eid;
          writeLastId(campaignId, eid);
        }
      }
      orchestrationEventClientDiagnostics.receive({
        campaign_id: campaignId,
        execution_id: data.execution_id,
        event_type: data.type,
        asset_state: data.asset_state,
        event_id: eid,
      });
      c.subs.forEach((sub) => { try { sub.onEvent(data); } catch { /* one bad subscriber must not break others */ } });
    } catch {
      orchestrationEventClientDiagnostics.fail({ campaign_id: campaignId, reason: 'event_parse_failed' });
    }
  });

  es.onerror = () => {
    // Browser auto-retries EventSource, but fall the consumers back to the
    // Step-22 path immediately so nothing waits on a possibly-dead pipe.
    setStatus(campaignId, c, 'fallback');
    orchestrationEventClientDiagnostics.fallback({ campaign_id: campaignId, reason: 'eventsource_error', retries: c.retries });
    try { es.close(); } catch { /* noop */ }
    c.es = null;
    scheduleReconnect(campaignId, c);
  };
}

function scheduleReconnect(campaignId: string, c: Conn): void {
  if (c.closed || c.reconnectTimer) return;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(c.retries, 5));
  c.retries += 1;
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null;
    if (!c.closed && c.subs.size > 0) connect(campaignId, c);
  }, delay);
}

export function subscribeCampaignEvents(campaignId: string, sub: Sub): () => void {
  if (!campaignId) return () => {};
  let c = conns.get(campaignId);
  if (!c) {
    c = { es: null, subs: new Set(), status: 'connecting', retries: 0, reconnectTimer: null, closed: false, seen: new Set(), maxId: readLastId(campaignId) };
    conns.set(campaignId, c);
    connect(campaignId, c);
  }
  c.subs.add(sub);
  try { sub.onStatus?.(c.status); } catch { /* noop */ }

  return () => {
    const conn = conns.get(campaignId);
    if (!conn) return;
    conn.subs.delete(sub);
    if (conn.subs.size === 0) {
      conn.closed = true;
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      try { conn.es?.close(); } catch { /* noop */ }
      conns.delete(campaignId);
    }
  };
}
