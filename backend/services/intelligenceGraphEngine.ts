/**
 * Intelligence Graph Engine
 * Phase 3: Builds relationships between signals. Edges stored in intelligence_graph_edges.
 * Edge types: topic_similarity, competitor_involvement, market_shift_linkage, customer_trend_linkage
 */

import { supabase } from '../db/supabaseClient';

export const EDGE_TYPES = [
  'topic_similarity',
  'competitor_involvement',
  'market_shift_linkage',
  'customer_trend_linkage',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export type GraphEdgeInput = {
  source_signal_id: string;
  target_signal_id: string;
  edge_type: EdgeType;
  edge_strength: number;
};

export type SignalForGraph = {
  id: string;
  topic: string | null;
  signal_type?: string | null;
  primary_category?: string | null;
  detected_at: string;
};

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const TOPIC_SIMILARITY_THRESHOLD = 0.25;
const COMPETITOR_PATTERN = /competitor|competition|rival|competes|market share/i;
const MARKET_SHIFT_PATTERN = /market|shift|trend|growth|disruption|emerging/i;
const CUSTOMER_PATTERN = /customer|complaint|feedback|pain|sentiment|issue|problem/i;

/**
 * Insert graph edges. Skips duplicates (source, target, edge_type).
 */
export async function insertGraphEdges(
  edges: GraphEdgeInput[]
): Promise<{ inserted: number; skipped: number }> {
  if (edges.length === 0) return { inserted: 0, skipped: 0 };

  const rows = edges
    .filter((e) => e.source_signal_id !== e.target_signal_id)
    .map((e) => ({
      source_signal_id: e.source_signal_id,
      target_signal_id: e.target_signal_id,
      edge_type: e.edge_type,
      edge_strength: Math.min(1, Math.max(0, e.edge_strength)),
    }));

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  const { data, error } = await supabase
    .from('intelligence_graph_edges')
    .upsert(rows, {
      onConflict: 'source_signal_id,target_signal_id,edge_type',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw new Error(`intelligence_graph_edges insert failed: ${error.message}`);
  const count = Array.isArray(data) ? data.length : 0;
  return { inserted: count, skipped: rows.length - count };
}

/**
 * Build edges between a batch of signals.
 */
export function buildEdgesFromSignals(signals: SignalForGraph[]): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];
  const topicTokens = new Map<string, Set<string>>();

  for (const s of signals) {
    const topic = (s.topic ?? '').trim();
    if (topic) topicTokens.set(s.id, tokenize(topic));
  }

  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i];
      const b = signals[j];
      if (a.id === b.id) continue;

      const tokensA = topicTokens.get(a.id);
      const tokensB = topicTokens.get(b.id);
      if (tokensA && tokensB) {
        const sim = jaccard(tokensA, tokensB);
        if (sim >= TOPIC_SIMILARITY_THRESHOLD) {
          edges.push({
            source_signal_id: a.id,
            target_signal_id: b.id,
            edge_type: 'topic_similarity',
            edge_strength: sim,
          });
        }
      }

      const topicA = (a.topic ?? '').toLowerCase();
      const topicB = (b.topic ?? '').toLowerCase();
      const catA = (a.primary_category ?? a.signal_type ?? '').toLowerCase();
      const catB = (b.primary_category ?? b.signal_type ?? '').toLowerCase();

      if (COMPETITOR_PATTERN.test(topicA) && COMPETITOR_PATTERN.test(topicB)) {
        edges.push({
          source_signal_id: a.id,
          target_signal_id: b.id,
          edge_type: 'competitor_involvement',
          edge_strength: 0.7,
        });
      }
      if (MARKET_SHIFT_PATTERN.test(topicA) && MARKET_SHIFT_PATTERN.test(topicB)) {
        edges.push({
          source_signal_id: a.id,
          target_signal_id: b.id,
          edge_type: 'market_shift_linkage',
          edge_strength: 0.6,
        });
      }
      if (CUSTOMER_PATTERN.test(topicA) && CUSTOMER_PATTERN.test(topicB)) {
        edges.push({
          source_signal_id: a.id,
          target_signal_id: b.id,
          edge_type: 'customer_trend_linkage',
          edge_strength: 0.6,
        });
      }
    }
  }

  return edges;
}

/**
 * Build and persist graph edges for signals in a time window.
 */
export async function buildGraphForCompanySignals(
  companyId: string,
  windowHours: number = 24
): Promise<{ edges_inserted: number }> {
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data: cisRows, error: cisError } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id, intelligence_signals!inner(id, topic, signal_type, primary_category, detected_at)')
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  if (cisError) throw new Error(`Failed to fetch company signals: ${cisError.message}`);

  type CisRow = {
    signal_id: string;
    intelligence_signals: { id: string; topic: string | null; signal_type: string | null; primary_category: string | null; detected_at: string } | null;
  };
  const raw = (cisRows ?? []) as unknown as Array<CisRow>;

  const signals: SignalForGraph[] = raw
    .filter((r) => r.intelligence_signals)
    .map((r) => {
      const s = r.intelligence_signals!;
      return {
        id: s.id,
        topic: s.topic,
        signal_type: s.signal_type,
        primary_category: s.primary_category,
        detected_at: s.detected_at,
      };
    });

  if (signals.length < 2) return { edges_inserted: 0 };

  const edges = buildEdgesFromSignals(signals);
  const deduped = deduplicateEdgesByType(edges);
  const result = await insertGraphEdges(deduped);
  return { edges_inserted: result.inserted };
}

function deduplicateEdgesByType(edges: GraphEdgeInput[]): GraphEdgeInput[] {
  const key = (e: GraphEdgeInput) =>
    [e.source_signal_id, e.target_signal_id, e.edge_type].sort().join(':');
  const seen = new Set<string>();
  const out: GraphEdgeInput[] = [];
  for (const e of edges) {
    const k = key(e);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

/**
 * Fetch edges for a signal (incoming or outgoing).
 */
export async function getEdgesForSignal(
  signalId: string,
  options?: { direction?: 'out' | 'in' | 'both'; edgeType?: EdgeType }
): Promise<Array<{ id: string; source_signal_id: string; target_signal_id: string; edge_type: string; edge_strength: number | null }>> {
  let query = supabase.from('intelligence_graph_edges').select('id, source_signal_id, target_signal_id, edge_type, edge_strength');

  if (options?.direction === 'out') {
    query = query.eq('source_signal_id', signalId);
  } else if (options?.direction === 'in') {
    query = query.eq('target_signal_id', signalId);
  } else {
    query = query.or(`source_signal_id.eq.${signalId},target_signal_id.eq.${signalId}`);
  }

  if (options?.edgeType) {
    query = query.eq('edge_type', options.edgeType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch graph edges: ${error.message}`);
  return (data ?? []) as Array<{ id: string; source_signal_id: string; target_signal_id: string; edge_type: string; edge_strength: number | null }>;
}
