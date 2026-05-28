/**
 * Phase 7 — Thread runtime timeline builder.
 *
 * Translates a raw `ThreadRuntimeTrace` into a chronologically-ordered list
 * of human-readable timeline entries. Operators / debuggers should read
 * this view instead of raw events.
 *
 * Pure / deterministic.
 */

import type {
  ThreadRuntimeTrace,
  ThreadRuntimeTraceEvent,
} from './threadRuntimeTypes';

export type TimelineEntryKind =
  | 'session_started'
  | 'generation_started'
  | 'node_inserted'
  | 'node_edited'
  | 'node_reordered'
  | 'persist_attempted'
  | 'persist_succeeded'
  | 'persist_failed'
  | 'join_attempted'
  | 'join_succeeded'
  | 'join_failed'
  | 'refresh_observed'
  | 'recovery_attempted'
  | 'recovery_succeeded'
  | 'recovery_failed'
  | 'session_ended'
  | 'topology_stabilized';

export interface TimelineEntry {
  index: number;
  timestamp: string;
  orchestrationSequence: number;
  kind: TimelineEntryKind;
  /** One short sentence an operator can scan. */
  headline: string;
  /** Optional follow-up sentence for context. */
  subline?: string;
  /** Originating event id (1-to-1 mapping for most kinds; topology_stabilized synthesizes). */
  sourceEventId: string | null;
  /** Visual hint for UI rendering ("ok" / "warning" / "error" / "info"). */
  severity: 'ok' | 'info' | 'warning' | 'error';
}

export interface ThreadRuntimeTimeline {
  threadId: string;
  runtimeSessionId: string;
  entries: TimelineEntry[];
  summary: {
    totalEntries: number;
    errors: number;
    warnings: number;
    durationMs: number | null;
  };
}

function summarizeForKind(e: ThreadRuntimeTraceEvent): { kind: TimelineEntryKind | null; headline: string; subline?: string; severity: TimelineEntry['severity'] } {
  switch (e.transitionType) {
    case 'session_start':
      return { kind: 'session_started', headline: `Runtime session opened for thread ${e.threadId}`, severity: 'info' };
    case 'session_end':
      return { kind: 'session_ended', headline: 'Runtime session closed', severity: 'info' };
    case 'node_create': {
      const id = e.childNodeIds[0] ?? '(unknown)';
      const pos = (e.payload?.position as number | undefined) ?? null;
      const mode = e.nodeGenerationMode;
      const headline = pos === 0
        ? `Root node ${id.slice(0, 8)} created (${mode})`
        : `Node ${id.slice(0, 8)} inserted at position ${pos} (${mode})`;
      return {
        kind: 'node_inserted',
        headline,
        subline: e.detail,
        severity: 'ok',
      };
    }
    case 'node_edit':
      return {
        kind: 'node_edited',
        headline: `Node ${e.childNodeIds[0]?.slice(0, 8) ?? '(unknown)'} edited`,
        subline: e.detail,
        severity: 'info',
      };
    case 'node_reorder': {
      const newPos = (e.payload?.newPosition as number | undefined) ?? null;
      return {
        kind: 'node_reordered',
        headline: newPos !== null
          ? `Node ${e.childNodeIds[0]?.slice(0, 8) ?? '(unknown)'} reordered to position ${newPos}`
          : `Node ${e.childNodeIds[0]?.slice(0, 8) ?? '(unknown)'} reordered`,
        subline: e.detail,
        severity: 'info',
      };
    }
    case 'persist_attempt':
      return { kind: 'persist_attempted', headline: 'Persistence attempt started', subline: e.detail, severity: 'info' };
    case 'persist_success':
      return {
        kind: 'persist_succeeded',
        headline: e.latencyMs !== undefined
          ? `Persistence succeeded in ${e.latencyMs}ms`
          : 'Persistence succeeded',
        subline: e.detail,
        severity: 'ok',
      };
    case 'persist_failure':
      return {
        kind: 'persist_failed',
        headline: `Persistence FAILED${e.latencyMs !== undefined ? ` after ${e.latencyMs}ms` : ''}`,
        subline: e.detail,
        severity: 'error',
      };
    case 'join_attempt':
      return { kind: 'join_attempted', headline: 'Join operation started', subline: e.detail, severity: 'info' };
    case 'join_success':
      return { kind: 'join_succeeded', headline: 'Join succeeded', subline: e.detail, severity: 'ok' };
    case 'join_failure':
      return { kind: 'join_failed', headline: 'Join FAILED', subline: e.detail, severity: 'error' };
    case 'refresh_observed':
      return { kind: 'refresh_observed', headline: 'Tab refresh observed', subline: e.detail, severity: 'warning' };
    case 'recovery_attempt':
      return { kind: 'recovery_attempted', headline: 'Recovery initiated', subline: e.detail, severity: 'warning' };
    case 'recovery_success':
      return {
        kind: 'recovery_succeeded',
        headline: e.latencyMs !== undefined
          ? `Recovery completed in ${e.latencyMs}ms`
          : 'Recovery completed',
        subline: e.detail,
        severity: 'ok',
      };
    case 'recovery_failure':
      return { kind: 'recovery_failed', headline: 'Recovery FAILED', subline: e.detail, severity: 'error' };
    default:
      return { kind: null, headline: '(unknown event)', severity: 'info' };
  }
}

export function buildThreadRuntimeTimeline(trace: ThreadRuntimeTrace): ThreadRuntimeTimeline {
  const entries: TimelineEntry[] = [];
  const ordered = [...trace.events].sort((a, b) => {
    if (a.orchestrationSequence !== b.orchestrationSequence) return a.orchestrationSequence - b.orchestrationSequence;
    return a.timestamp.localeCompare(b.timestamp);
  });

  // Insert a synthetic "generation_started" entry the first time we see a node_create.
  let generationStartEmitted = false;
  let lastPersistSucceededAtSequence: number | null = null;

  for (let i = 0; i < ordered.length; i += 1) {
    const e = ordered[i];
    if (!generationStartEmitted && e.transitionType === 'node_create') {
      entries.push({
        index: entries.length,
        timestamp: e.timestamp,
        orchestrationSequence: e.orchestrationSequence,
        kind: 'generation_started',
        headline: `Thread generation started — first node ${e.childNodeIds[0]?.slice(0, 8) ?? '?'}`,
        sourceEventId: null,
        severity: 'info',
      });
      generationStartEmitted = true;
    }

    const summary = summarizeForKind(e);
    if (!summary.kind) continue;
    entries.push({
      index: entries.length,
      timestamp: e.timestamp,
      orchestrationSequence: e.orchestrationSequence,
      kind: summary.kind,
      headline: summary.headline,
      subline: summary.subline,
      sourceEventId: e.eventId,
      severity: summary.severity,
    });

    if (summary.kind === 'persist_succeeded') {
      lastPersistSucceededAtSequence = e.orchestrationSequence;
    }
  }

  // Synthetic "topology_stabilized" after the last persist_success if no
  // subsequent persist_failure / recovery_failure exists in the trace.
  if (lastPersistSucceededAtSequence !== null) {
    const subsequentFailure = ordered.some((e) =>
      e.orchestrationSequence > lastPersistSucceededAtSequence!
      && (e.transitionType === 'persist_failure' || e.transitionType === 'recovery_failure'),
    );
    if (!subsequentFailure) {
      const refEvent = ordered.find((e) => e.orchestrationSequence === lastPersistSucceededAtSequence && e.transitionType === 'persist_success');
      entries.push({
        index: entries.length,
        timestamp: refEvent?.timestamp ?? trace.startedAt,
        orchestrationSequence: (lastPersistSucceededAtSequence ?? 0) + 0.5,
        kind: 'topology_stabilized',
        headline: 'Topology stabilized after persist',
        sourceEventId: null,
        severity: 'ok',
      });
    }
  }

  // Re-sort entries by orchestrationSequence so synthetic entries
  // (generation_started, topology_stabilized) end up in their semantic
  // position rather than insertion order.
  entries.sort((a, b) => a.orchestrationSequence - b.orchestrationSequence);
  // Re-index after sort so `index` matches list position.
  entries.forEach((e, i) => { e.index = i; });

  // Summary stats
  const errors = entries.filter((e) => e.severity === 'error').length;
  const warnings = entries.filter((e) => e.severity === 'warning').length;
  const startMs = Date.parse(trace.startedAt);
  const endMs = trace.endedAt ? Date.parse(trace.endedAt) : Date.parse(ordered[ordered.length - 1]?.timestamp ?? trace.startedAt);
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;

  return {
    threadId: trace.threadId,
    runtimeSessionId: trace.runtimeSessionId,
    entries,
    summary: { totalEntries: entries.length, errors, warnings, durationMs },
  };
}

/** Render the timeline as a flat text block suitable for logs / dashboards. */
export function formatThreadRuntimeTimeline(t: ThreadRuntimeTimeline): string {
  const lines: string[] = [];
  lines.push(`Timeline · thread=${t.threadId} · session=${t.runtimeSessionId}`);
  lines.push(`  entries=${t.summary.totalEntries} · errors=${t.summary.errors} · warnings=${t.summary.warnings}`
    + (t.summary.durationMs !== null ? ` · duration=${t.summary.durationMs}ms` : ''));
  for (const e of t.entries) {
    const sevTag = e.severity === 'error' ? '[!]' : e.severity === 'warning' ? '[~]' : e.severity === 'ok' ? '[+]' : '[·]';
    lines.push(`  ${sevTag} seq=${String(e.orchestrationSequence).padStart(3, ' ')} · ${e.headline}`);
    if (e.subline) lines.push(`      ↳ ${e.subline}`);
  }
  return lines.join('\n');
}
