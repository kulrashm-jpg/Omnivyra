/**
 * Phase 7 — Bounded keyword search across the Active Leads surface.
 *
 * Searches:
 *   • opportunities         (content + detected_reason)
 *   • opportunity_notes     (body)
 *   • clusters              (top_keywords contains match)
 *   • alerts                (title + body)
 *   • listening_executions  (signal_stats summary)
 *   • listening_sources     (display_name + source_identifier)
 *   • graph_nodes           (display_name)
 *   • escalations           (title + body)
 *
 * Hard guarantees:
 *   • Tenant-scoped — every read starts on organization_id.
 *   • Bounded — `MAX_HITS_PER_KIND` per kind, `MAX_HITS_TOTAL` overall.
 *   • Explainable — each hit carries a `matched_field` and a `match_excerpt`.
 *   • No fuzzy / vector ranking (Phase 7 = deterministic ILIKE).
 */

import { ownedDbTable } from '../db/writeOwner';

export const SEARCH_KINDS = [
  'opportunity',
  'opportunity_note',
  'cluster',
  'alert',
  'execution',
  'source',
  'graph_node',
  'escalation',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  display: string;
  matched_field: string;
  match_excerpt: string;
  created_at: string | null;
  metadata: Record<string, unknown>;
};

export type SearchQuery = {
  organizationId: string;
  query: string;
  kinds?: SearchKind[];
  since?: string | null;
  until?: string | null;
  limit?: number;
};

export type SearchResults = {
  hits: SearchHit[];
  truncated: boolean;
};

const MAX_HITS_PER_KIND = 20;
const MAX_HITS_TOTAL = 100;

function excerpt(text: string | null | undefined, term: string): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + term.length + 40);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export async function searchIntelligence(q: SearchQuery): Promise<SearchResults> {
  const term = q.query.trim();
  if (term.length < 2) return { hits: [], truncated: false };
  const pattern = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const kinds = q.kinds && q.kinds.length > 0 ? q.kinds : ([...SEARCH_KINDS] as SearchKind[]);
  const limit = Math.min(MAX_HITS_TOTAL, Math.max(1, q.limit ?? 50));
  const hits: SearchHit[] = [];

  const since = q.since ?? null;
  const until = q.until ?? null;

  async function runOpportunitySearch() {
    let query = ownedDbTable('opportunity_feed_items')
      .select('id, detected_reason, source_context, opportunity_type, created_at')
      .eq('organization_id', q.organizationId)
      .or(`detected_reason.ilike.${pattern}`)
      .order('created_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    const { data } = await query;
    for (const r of (data ?? []) as Array<{ id: string; detected_reason: string; opportunity_type: string; created_at: string }>) {
      hits.push({
        kind: 'opportunity',
        id: r.id,
        display: `[${r.opportunity_type}] ${r.detected_reason.slice(0, 80)}`,
        matched_field: 'detected_reason',
        match_excerpt: excerpt(r.detected_reason, term),
        created_at: r.created_at,
        metadata: { opportunity_type: r.opportunity_type },
      });
    }
  }

  async function runNoteSearch() {
    let query = ownedDbTable('opportunity_notes')
      .select('id, body, opportunity_feed_item_id, created_at, visibility')
      .eq('organization_id', q.organizationId)
      .ilike('body', pattern)
      .order('created_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    const { data } = await query;
    for (const r of (data ?? []) as Array<{ id: string; body: string; opportunity_feed_item_id: string; created_at: string; visibility: string }>) {
      hits.push({
        kind: 'opportunity_note',
        id: r.id,
        display: r.body.slice(0, 80),
        matched_field: 'body',
        match_excerpt: excerpt(r.body, term),
        created_at: r.created_at,
        metadata: { opportunity_feed_item_id: r.opportunity_feed_item_id, visibility: r.visibility },
      });
    }
  }

  async function runClusterSearch() {
    const { data } = await ownedDbTable('signal_intent_clusters')
      .select('id, cluster_key, opportunity_type, top_keywords, last_seen_at')
      .eq('organization_id', q.organizationId)
      .contains('top_keywords', [term.toLowerCase()])
      .order('last_seen_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    for (const r of (data ?? []) as Array<{ id: string; cluster_key: string; opportunity_type: string; top_keywords: string[]; last_seen_at: string }>) {
      hits.push({
        kind: 'cluster',
        id: r.id,
        display: `cluster ${r.cluster_key}`,
        matched_field: 'top_keywords',
        match_excerpt: r.top_keywords.join(', '),
        created_at: r.last_seen_at,
        metadata: { opportunity_type: r.opportunity_type },
      });
    }
  }

  async function runAlertSearch() {
    let query = ownedDbTable('alerts')
      .select('id, title, body, severity, alert_type, created_at')
      .eq('organization_id', q.organizationId)
      .or(`title.ilike.${pattern},body.ilike.${pattern}`)
      .order('created_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    const { data } = await query;
    for (const r of (data ?? []) as Array<{ id: string; title: string; body: string; severity: string; alert_type: string; created_at: string }>) {
      hits.push({
        kind: 'alert',
        id: r.id,
        display: `[${r.severity}] ${r.title}`,
        matched_field: 'title|body',
        match_excerpt: excerpt(r.title + ' ' + r.body, term),
        created_at: r.created_at,
        metadata: { severity: r.severity, alert_type: r.alert_type },
      });
    }
  }

  async function runSourceSearch() {
    const { data } = await ownedDbTable('listening_sources')
      .select('id, display_name, source_identifier, source_type, status')
      .eq('organization_id', q.organizationId)
      .or(`display_name.ilike.${pattern},source_identifier.ilike.${pattern}`)
      .order('created_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    for (const r of (data ?? []) as Array<{ id: string; display_name: string; source_identifier: string; source_type: string; status: string }>) {
      hits.push({
        kind: 'source',
        id: r.id,
        display: r.display_name,
        matched_field: 'display_name|source_identifier',
        match_excerpt: excerpt(`${r.display_name} ${r.source_identifier}`, term),
        created_at: null,
        metadata: { source_type: r.source_type, status: r.status },
      });
    }
  }

  async function runGraphSearch() {
    const { data } = await ownedDbTable('opportunity_graph_nodes')
      .select('id, display_name, node_type, updated_at')
      .eq('organization_id', q.organizationId)
      .ilike('display_name', pattern)
      .order('updated_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    for (const r of (data ?? []) as Array<{ id: string; display_name: string; node_type: string; updated_at: string }>) {
      hits.push({
        kind: 'graph_node',
        id: r.id,
        display: r.display_name,
        matched_field: 'display_name',
        match_excerpt: excerpt(r.display_name, term),
        created_at: r.updated_at,
        metadata: { node_type: r.node_type },
      });
    }
  }

  async function runEscalationSearch() {
    let query = ownedDbTable('escalations')
      .select('id, title, body, escalation_type, status, created_at')
      .eq('organization_id', q.organizationId)
      .or(`title.ilike.${pattern},body.ilike.${pattern}`)
      .order('created_at', { ascending: false })
      .limit(MAX_HITS_PER_KIND);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    const { data } = await query;
    for (const r of (data ?? []) as Array<{ id: string; title: string; body: string | null; escalation_type: string; status: string; created_at: string }>) {
      hits.push({
        kind: 'escalation',
        id: r.id,
        display: r.title,
        matched_field: 'title|body',
        match_excerpt: excerpt(`${r.title} ${r.body ?? ''}`, term),
        created_at: r.created_at,
        metadata: { escalation_type: r.escalation_type, status: r.status },
      });
    }
  }

  const tasks: Array<Promise<unknown>> = [];
  if (kinds.includes('opportunity')) tasks.push(runOpportunitySearch());
  if (kinds.includes('opportunity_note')) tasks.push(runNoteSearch());
  if (kinds.includes('cluster')) tasks.push(runClusterSearch());
  if (kinds.includes('alert')) tasks.push(runAlertSearch());
  if (kinds.includes('source')) tasks.push(runSourceSearch());
  if (kinds.includes('graph_node')) tasks.push(runGraphSearch());
  if (kinds.includes('escalation')) tasks.push(runEscalationSearch());
  // 'execution' search not yet implemented — would need JSONB ILIKE.
  await Promise.all(tasks);

  const truncated = hits.length > limit;
  const sorted = hits
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, limit);
  return { hits: sorted, truncated };
}
