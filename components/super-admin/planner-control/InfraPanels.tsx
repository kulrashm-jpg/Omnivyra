/**
 * Read-only infra panels grouped for compactness:
 *   - Overload state
 *   - Distributed semaphore pools
 *   - Provider token buckets
 *   - Stream lag
 *   - Refinement queue / split-brain / orphans
 *   - SSE connections
 *   - Canary health gates
 *
 * Each is a pure render component — no API calls, no state. All inputs come
 * from `data` returned by `usePlannerControl`.
 */

import React from 'react';
import {
  Card, MetricTile, SectionHeader, StatusBadge, TableCompact, formatNumber,
  type StatusTone,
} from './PrimitiveTiles';
import type {
  InspectPayload, OpsSnapshot, CanaryGateEvaluation, SplitBrainReport, OrphanRefinement,
} from '../../../hooks/usePlannerControl';

function modeTone(mode?: string | null): StatusTone {
  switch (mode) {
    case 'normal':   return 'ok';
    case 'elevated': return 'info';
    case 'degraded': return 'warn';
    case 'critical': return 'critical';
    default:         return 'neutral';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Overload
// ─────────────────────────────────────────────────────────────────────────
export function OverloadPanel({ ops }: { ops: OpsSnapshot }) {
  const o = ops.cluster_overload;
  return (
    <Card>
      <SectionHeader
        title="Cluster overload"
        subtitle="Aggregate pressure score → mode with hysteresis"
        right={<StatusBadge tone={modeTone(o?.mode)}>{o?.mode?.toUpperCase() ?? 'UNKNOWN'}</StatusBadge>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile label="Mode" value={o?.mode ?? '—'} tone={modeTone(o?.mode)} />
        <MetricTile label="Pressure score" value={o ? o.pressure_score.toFixed(2) : '—'} />
        <MetricTile label="Source" value={o?.source ?? '—'} hint={o?.source === 'fallback' ? 'Redis unhealthy' : undefined} />
        <MetricTile
          label="BullMQ pressure"
          value={ops.bullmq_pressure?.pressure_high ? 'HIGH' : 'OK'}
          tone={ops.bullmq_pressure?.pressure_high ? 'warn' : 'ok'}
          hint={ops.bullmq_pressure ? `w${ops.bullmq_pressure.waiting} d${ops.bullmq_pressure.delayed} a${ops.bullmq_pressure.active} f${ops.bullmq_pressure.failed}` : '—'}
        />
      </div>
      {ops.bullmq_pressure?.reasons.length ? (
        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          BullMQ reasons: {ops.bullmq_pressure.reasons.join(', ')}
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Distributed semaphore
// ─────────────────────────────────────────────────────────────────────────
export function SemaphorePanel({
  ops, splitBrain,
}: {
  ops: OpsSnapshot;
  splitBrain: SplitBrainReport[];
}) {
  const driftByPool = new Map(splitBrain.map((r) => [r.pool, r]));
  return (
    <Card>
      <SectionHeader
        title="Distributed semaphore pools"
        subtitle="Lease-backed cluster-wide concurrency caps"
      />
      <TableCompact
        rows={ops.semaphore_pools}
        columns={[
          { key: 'pool', label: 'Pool', render: (r) => <span className="font-mono">{r.pool}</span> },
          { key: 'local', label: 'Local active', render: (r) => `${r.local_active}/${r.max_allowed}` },
          { key: 'pending', label: 'Pending', render: (r) => r.local_pending },
          { key: 'distributed', label: 'Cluster active', render: (r) => r.distributed_active ?? '—' },
          { key: 'wait', label: 'Avg wait', render: (r) => `${r.recent_avg_wait_ms}ms` },
          {
            key: 'drift', label: 'Drift',
            render: (r) => {
              const d = driftByPool.get(r.pool);
              if (!d) return '—';
              return d.driftHigh
                ? <StatusBadge tone="critical">{d.drift}</StatusBadge>
                : <span className="text-slate-600">{d.drift}</span>;
            },
          },
          {
            key: 'fallback', label: 'Fallback',
            render: (r) => r.fallback_in_use
              ? <StatusBadge tone="warn">local-only</StatusBadge>
              : <StatusBadge tone="ok">cluster</StatusBadge>,
          },
        ]}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Provider buckets
// ─────────────────────────────────────────────────────────────────────────
export function ProviderBucketPanel({ ops }: { ops: OpsSnapshot }) {
  return (
    <Card>
      <SectionHeader
        title="Provider token buckets"
        subtitle="Cluster-wide QPS governance per provider"
      />
      <TableCompact
        rows={ops.provider_buckets}
        columns={[
          { key: 'provider', label: 'Provider', render: (b) => <span className="font-mono">{b.provider}</span> },
          { key: 'local', label: 'Local tokens', render: (b) => formatNumber(b.local_tokens, { digits: 2 }) },
          {
            key: 'cluster', label: 'Cluster tokens',
            render: (b) => b.distributed_tokens != null ? formatNumber(b.distributed_tokens, { digits: 2 }) : '—',
          },
          { key: 'qps', label: 'QPS', render: (b) => formatNumber(b.qps, { digits: 1 }) },
          { key: 'burst', label: 'Burst', render: (b) => b.burst },
          {
            key: 'state', label: 'State',
            render: (b) => b.distributed_enabled && b.distributed_healthy
              ? <StatusBadge tone="ok">cluster</StatusBadge>
              : b.distributed_enabled
              ? <StatusBadge tone="warn">degraded</StatusBadge>
              : <StatusBadge tone="neutral">local-only</StatusBadge>,
          },
        ]}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Streams
// ─────────────────────────────────────────────────────────────────────────
export function StreamLagPanel({ ops }: { ops: OpsSnapshot }) {
  return (
    <Card>
      <SectionHeader
        title="Event stream lag"
        subtitle="Redis Streams consumer-group depth + oldest pending entry"
      />
      {ops.stream_lag === null ? (
        <div className="text-xs text-slate-500">Stream consumers not enabled or Redis unhealthy.</div>
      ) : (
        <TableCompact
          rows={ops.stream_lag}
          columns={[
            { key: 'stream', label: 'Stream', render: (s) => <span className="font-mono">{s.stream}</span> },
            { key: 'length', label: 'Length', render: (s) => s.length },
            { key: 'pending', label: 'Pending', render: (s) => (
              s.pending > 100
                ? <StatusBadge tone="warn">{s.pending}</StatusBadge>
                : s.pending
            ) },
            {
              key: 'oldest', label: 'Oldest pending',
              render: (s) => s.oldest_pending_age_ms == null
                ? '—'
                : s.oldest_pending_age_ms > 5 * 60_000
                ? <StatusBadge tone="critical">{Math.round(s.oldest_pending_age_ms / 1000)}s</StatusBadge>
                : `${Math.round(s.oldest_pending_age_ms / 1000)}s`,
            },
          ]}
        />
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Refinement queue + orphans + SSE
// ─────────────────────────────────────────────────────────────────────────
export function RefinementAndSsePanel({
  orphan,
  sseConnections,
}: {
  orphan: OrphanRefinement | null;
  sseConnections: number | null;
}) {
  return (
    <Card>
      <SectionHeader title="Refinement queue & SSE" subtitle="Worker-side health" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricTile
          label="Orphan refinements"
          value={orphan?.count ?? '—'}
          tone={orphan?.healthy === false ? 'warn' : 'ok'}
          hint={orphan == null ? 'queue check unavailable' : orphan.healthy ? 'all jobs progressing' : 'stale active jobs detected'}
        />
        <MetricTile
          label="SSE connections"
          value={sseConnections ?? 'n/a'}
          hint={sseConnections == null ? 'counter not wired (advisory)' : 'this instance only'}
        />
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Canary health gates
// ─────────────────────────────────────────────────────────────────────────
export function CanaryGatePanel({
  gates,
  rolloutInCanary,
}: {
  gates: CanaryGateEvaluation[];
  rolloutInCanary: boolean;
}) {
  return (
    <Card>
      <SectionHeader
        title="Canary health gates"
        subtitle={rolloutInCanary
          ? 'Gates are LIVE — a triggered gate auto-rolls back.'
          : 'Gates observe only (no rollout in canary).'}
        right={<StatusBadge tone={rolloutInCanary ? 'info' : 'neutral'}>{rolloutInCanary ? 'LIVE' : 'idle'}</StatusBadge>}
      />
      <TableCompact
        rows={gates}
        columns={[
          { key: 'label', label: 'Metric', render: (g) => g.label },
          {
            key: 'observed', label: 'Observed',
            render: (g) => g.observed == null
              ? <span className="text-slate-400 text-[11px]">skipped (no source)</span>
              : g.unhealthy
              ? <StatusBadge tone="warn">{typeof g.observed === 'number' ? g.observed.toFixed(2) : g.observed}</StatusBadge>
              : <span>{typeof g.observed === 'number' ? g.observed.toFixed(2) : g.observed}</span>,
          },
          {
            key: 'consec', label: 'Consecutive',
            render: (g) => g.consecutiveUnhealthy > 0
              ? <StatusBadge tone="warn">{g.consecutiveUnhealthy} unhealthy</StatusBadge>
              : g.consecutiveHealthy > 0
              ? <StatusBadge tone="ok">{g.consecutiveHealthy} healthy</StatusBadge>
              : '—',
          },
          {
            key: 'triggered', label: 'Triggered',
            render: (g) => g.triggered
              ? <StatusBadge tone="critical">TRIPPED</StatusBadge>
              : g.cleared
              ? <StatusBadge tone="ok">cleared</StatusBadge>
              : '—',
          },
        ]}
      />
    </Card>
  );
}
