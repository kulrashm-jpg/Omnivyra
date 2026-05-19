/**
 * Replay lineage & forensics (READ-ONLY).
 *
 * Builds a per-dedupeKey lineage chain from the existing append-only audit
 * substrate (dead_letter → replay_ingress → replay_job/replay_executor →
 * replay_executed) plus quarantine visibility. No mutation, tenant-scoped,
 * export-safe (plain JSON). Deterministic ordering by event time.
 */
import { ownedDbTable } from '../../db/writeOwner';

const REPLAY_RESOURCE_TYPES = [
  'dead_letter',
  'replay_ingress',
  'replay_job',
  'replay_executed',
  'quarantine_payload',
];

export interface ReplayLineageNode {
  dedupeKey: string;
  chain: Array<{ at: string; stage: string; action: string; outcome?: string; detail?: unknown }>;
  terminal: 'executed' | 'deduped' | 'failed' | 'pending' | 'quarantined';
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface ReplayLineageReport {
  companyId: string;
  generatedAt: string;
  nodes: ReplayLineageNode[];
  /** Aggregated stage graph for rendering (additive). */
  graph?: {
    nodes: Array<{ stage: string; count: number }>;
    edges: Array<{ from: string; to: string; count: number }>;
  };
  summary: { total: number; executed: number; failed: number; pending: number; quarantined: number };
}

function terminalOf(stages: string[]): ReplayLineageNode['terminal'] {
  if (stages.some((s) => s.includes('quarantine'))) return 'quarantined';
  if (stages.some((s) => /\.(executed|succeeded)/.test(s) || s.endsWith('.webhook_lead'))) return 'executed';
  if (stages.some((s) => /\.(deduped|idempotent_skip)/.test(s))) return 'deduped';
  if (stages.some((s) => /\.(failed)/.test(s))) return 'failed';
  return 'pending';
}

export async function buildReplayLineage(
  companyId: string,
  limit = 800,
): Promise<ReplayLineageReport> {
  let rows: any[] = [];
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('action, resource_type, resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .in('resource_type', REPLAY_RESOURCE_TYPES)
      .order('created_at', { ascending: true })
      .limit(limit);
    rows = (data ?? []) as any[];
  } catch {
    rows = [];
  }

  const byKey = new Map<string, ReplayLineageNode>();
  for (const r of rows) {
    const key = String(r.resource_id ?? 'unknown');
    if (!byKey.has(key)) {
      byKey.set(key, { dedupeKey: key, chain: [], terminal: 'pending', firstSeen: r.created_at, lastSeen: r.created_at });
    }
    const node = byKey.get(key)!;
    node.chain.push({
      at: r.created_at,
      stage: String(r.resource_type),
      action: String(r.action),
      outcome: (r.metadata ?? {})?.outcome,
      detail: (r.metadata ?? {})?.detail,
    });
    node.lastSeen = r.created_at;
  }

  const nodes = Array.from(byKey.values()).map((n) => ({
    ...n,
    terminal: terminalOf(n.chain.map((c) => c.action)),
  }));

  // Aggregated stage graph (deterministic): node = stage occurrence count,
  // edge = consecutive stage transition count across all chains.
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  for (const n of nodes) {
    for (let i = 0; i < n.chain.length; i += 1) {
      const s = n.chain[i].stage;
      nodeCounts.set(s, (nodeCounts.get(s) ?? 0) + 1);
      if (i > 0) {
        const key = `${n.chain[i - 1].stage}→${s}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const graph = {
    nodes: Array.from(nodeCounts.entries()).map(([stage, count]) => ({ stage, count })),
    edges: Array.from(edgeCounts.entries()).map(([k, count]) => {
      const [from, to] = k.split('→');
      return { from, to, count };
    }),
  };

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    nodes: nodes.slice(0, 200),
    graph,
    summary: {
      total: nodes.length,
      executed: nodes.filter((n) => n.terminal === 'executed').length,
      failed: nodes.filter((n) => n.terminal === 'failed').length,
      pending: nodes.filter((n) => n.terminal === 'pending').length,
      quarantined: nodes.filter((n) => n.terminal === 'quarantined').length,
    },
  };
}
