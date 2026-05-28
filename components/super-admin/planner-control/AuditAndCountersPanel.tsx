/**
 * Audit trail explorer + alert counters.
 *
 * Two panels:
 *   - AlertCountersPanel — per-counter local + cluster rates with threshold
 *   - AuditTrailPanel    — rolling list of rollout state transitions with
 *                          operator + reason + request-id correlation
 */

import React, { useState } from 'react';
import { Card, SectionHeader, StatusBadge, TableCompact, relativeTimeMs } from './PrimitiveTiles';
import type { InspectPayload, OpsSnapshot } from '../../../hooks/usePlannerControl';

export function AlertCountersPanel({ ops }: { ops: OpsSnapshot }) {
  const rows = ops.alert_counters.slice().sort((a, b) => b.recent_local - a.recent_local);
  return (
    <Card>
      <SectionHeader
        title="Alert counters"
        subtitle="Sliding-window rates per counter. Cluster column null when distributed metrics off."
      />
      <TableCompact
        rows={rows}
        columns={[
          { key: 'counter', label: 'Counter', render: (c) => <span className="font-mono text-[11px]">{c.counter}</span> },
          {
            key: 'local', label: 'Local',
            render: (c) => c.recent_local >= c.threshold
              ? <StatusBadge tone="warn">{c.recent_local}</StatusBadge>
              : c.recent_local,
          },
          {
            key: 'cluster', label: 'Cluster',
            render: (c) => c.recent_cluster == null
              ? <span className="text-slate-400">—</span>
              : c.recent_cluster >= c.threshold
              ? <StatusBadge tone="critical">{c.recent_cluster}</StatusBadge>
              : c.recent_cluster,
          },
          { key: 'threshold', label: 'Threshold', render: (c) => c.threshold },
          { key: 'window', label: 'Window', render: (c) => `${Math.round(c.window_ms / 60_000)}m` },
          { key: 'total', label: 'Since boot', render: (c) => c.total_since_boot },
        ]}
      />
    </Card>
  );
}

function statusToneFromRow(status: string | undefined): 'ok' | 'warn' | 'critical' | 'neutral' | 'info' {
  switch (status) {
    case 'in_canary':   return 'info';
    case 'promoting':   return 'info';
    case 'paused':      return 'warn';
    case 'rolled_back': return 'critical';
    case 'idle':        return 'neutral';
    default:            return 'neutral';
  }
}

export function AuditTrailPanel({ audit }: { audit: Array<Record<string, string>> }) {
  const [filter, setFilter] = useState('');
  const filtered = filter
    ? audit.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(filter.toLowerCase())),
      )
    : audit;
  return (
    <Card>
      <SectionHeader
        title="Rollout audit trail"
        subtitle={`${audit.length} most-recent transitions — auto-refreshes with the page`}
        right={
          <input
            type="text"
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs rounded border border-slate-300 px-2 py-0.5"
          />
        }
      />
      <TableCompact
        rows={filtered}
        empty="No audit entries (Redis may be unhealthy or no rollouts have occurred)"
        columns={[
          {
            key: 'when', label: 'When',
            render: (r) => relativeTimeMs(Number(r.ts)),
            className: 'whitespace-nowrap',
          },
          {
            key: 'status', label: 'Status',
            render: (r) => <StatusBadge tone={statusToneFromRow(r.status)}>{r.status}</StatusBadge>,
          },
          {
            key: 'mode', label: 'Mode',
            render: (r) => (
              <span className="font-mono">
                {r.active_mode} <span className="text-slate-400">←</span> {r.rollback_mode}
              </span>
            ),
          },
          { key: 'operator', label: 'Operator', render: (r) => r.operator_id || '—' },
          { key: 'reason', label: 'Reason', render: (r) => <span className="text-slate-700">{r.reason}</span> },
          {
            key: 'reqId', label: 'Req ID',
            render: (r) => r.request_id
              ? <span className="font-mono text-[10px] text-slate-500">{r.request_id.slice(0, 8)}</span>
              : '—',
          },
        ]}
      />
    </Card>
  );
}
