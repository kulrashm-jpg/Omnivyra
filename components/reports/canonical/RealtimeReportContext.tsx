'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// ── Realtime UX context ───────────────────────────────────────────────────────
//
// Wraps the canonical report and exposes hooks that subscribe to realtime
// events (scan progress, collaboration). The transport is pluggable — the
// production app wires Supabase Realtime; tests inject an in-memory transport
// that pushes deterministic events.

export type ScanProgressEvent = {
  scan_id: string;
  kind: 'enqueued' | 'started' | 'progress' | 'completed' | 'cancelled' | 'failed';
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type CollaborationEvent = {
  kind: 'annotation_added' | 'annotation_resolved' | 'action_assigned' | 'finding_pinned' | 'recommendation_status_changed';
  payload: Record<string, unknown>;
  actor: { id: string; label: string };
  occurred_at: string;
};

type Subscriber<T> = (event: T) => void;

export type RealtimeClient = {
  subscribeScanProgress: (companyId: string, listener: Subscriber<ScanProgressEvent>) => () => void;
  subscribeCollaboration: (companyId: string, listener: Subscriber<CollaborationEvent>) => () => void;
};

const RealtimeReportContext = createContext<RealtimeClient | null>(null);

export function RealtimeReportProvider({
  client,
  children,
}: {
  client: RealtimeClient;
  children: ReactNode;
}) {
  return <RealtimeReportContext.Provider value={client}>{children}</RealtimeReportContext.Provider>;
}

function useRealtimeClient(): RealtimeClient | null {
  return useContext(RealtimeReportContext);
}

// ── useScanProgress ───────────────────────────────────────────────────────────

export type ScanProgressState = {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  lastEvent: ScanProgressEvent | null;
  history: ScanProgressEvent[];
};

export function useScanProgress(companyId: string | null): ScanProgressState {
  const client = useRealtimeClient();
  const [state, setState] = useState<ScanProgressState>({ status: 'idle', lastEvent: null, history: [] });

  useEffect(() => {
    if (!client || !companyId) return;
    const unsubscribe = client.subscribeScanProgress(companyId, (event) => {
      setState((prev) => {
        const nextStatus: ScanProgressState['status'] =
          event.kind === 'enqueued'
            ? 'queued'
            : event.kind === 'started' || event.kind === 'progress'
              ? 'running'
              : event.kind === 'completed'
                ? 'completed'
                : event.kind === 'failed'
                  ? 'failed'
                  : event.kind === 'cancelled'
                    ? 'cancelled'
                    : prev.status;
        return {
          status: nextStatus,
          lastEvent: event,
          history: [event, ...prev.history].slice(0, 50),
        };
      });
    });
    return unsubscribe;
  }, [client, companyId]);

  return state;
}

// ── useCollaborationStream ────────────────────────────────────────────────────

export function useCollaborationStream(companyId: string | null): {
  events: CollaborationEvent[];
} {
  const client = useRealtimeClient();
  const [events, setEvents] = useState<CollaborationEvent[]>([]);

  useEffect(() => {
    if (!client || !companyId) return;
    const unsubscribe = client.subscribeCollaboration(companyId, (event) => {
      setEvents((prev) => [event, ...prev].slice(0, 100));
    });
    return unsubscribe;
  }, [client, companyId]);

  return { events };
}

// ── In-memory transport (default; tests + dev) ───────────────────────────────

type Listener<T> = (event: T) => void;

class InMemoryRealtimeClient implements RealtimeClient {
  private scanListeners = new Map<string, Set<Listener<ScanProgressEvent>>>();
  private collabListeners = new Map<string, Set<Listener<CollaborationEvent>>>();

  subscribeScanProgress(companyId: string, listener: Listener<ScanProgressEvent>): () => void {
    const set = this.scanListeners.get(companyId) ?? new Set();
    set.add(listener);
    this.scanListeners.set(companyId, set);
    return () => set.delete(listener);
  }

  subscribeCollaboration(companyId: string, listener: Listener<CollaborationEvent>): () => void {
    const set = this.collabListeners.get(companyId) ?? new Set();
    set.add(listener);
    this.collabListeners.set(companyId, set);
    return () => set.delete(listener);
  }

  emitScan(companyId: string, event: ScanProgressEvent): void {
    this.scanListeners.get(companyId)?.forEach((l) => l(event));
  }

  emitCollab(companyId: string, event: CollaborationEvent): void {
    this.collabListeners.get(companyId)?.forEach((l) => l(event));
  }
}

export function createInMemoryRealtimeClient(): InMemoryRealtimeClient {
  return new InMemoryRealtimeClient();
}

// ── Live scan banner UI ──────────────────────────────────────────────────────

const STATUS_TONE: Record<ScanProgressState['status'], string> = {
  idle: 'bg-slate-100 text-slate-700 border-slate-200',
  queued: 'bg-amber-50 text-amber-800 border-amber-200',
  running: 'bg-blue-50 text-blue-800 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  failed: 'bg-rose-50 text-rose-800 border-rose-200',
  cancelled: 'bg-slate-200 text-slate-700 border-slate-300',
};

const STATUS_LABEL: Record<ScanProgressState['status'], string> = {
  idle: 'No active scan',
  queued: 'Scan queued',
  running: 'Scan running',
  completed: 'Scan completed',
  failed: 'Scan failed',
  cancelled: 'Scan cancelled',
};

export function LiveScanBanner({ companyId }: { companyId: string }) {
  const progress = useScanProgress(companyId);
  if (progress.status === 'idle') return null;
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm font-medium ${STATUS_TONE[progress.status]}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{STATUS_LABEL[progress.status]}</span>
        {progress.lastEvent ? (
          <span className="text-[11px] font-normal opacity-70">
            {new Date(progress.lastEvent.occurred_at).toLocaleTimeString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
