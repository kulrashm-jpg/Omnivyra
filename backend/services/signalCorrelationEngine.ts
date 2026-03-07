/**
 * Signal Correlation Engine
 * Phase 3: Detects correlations between signals via topic similarity, temporal proximity,
 * shared entities, competitor overlap.
 */

import { supabase } from '../db/supabaseClient';
import { tokenizeTopic, tokenSimilarity } from './signalClusterEngine';

export type CorrelationType =
  | 'topic_similarity'
  | 'temporal_proximity'
  | 'shared_entities'
  | 'competitor_overlap';

export type CorrelatedSignalPair = {
  signal_a_id: string;
  signal_b_id: string;
  correlation_score: number;
  correlation_type: CorrelationType;
  topic_a: string | null;
  topic_b: string | null;
  detected_at_a: string;
  detected_at_b: string;
};

export type CorrelationResult = {
  correlated_signals: CorrelatedSignalPair[];
  correlation_score: number;
  correlation_type: CorrelationType;
};

const TOPIC_THRESHOLD = 0.2;
const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_PAIRS = 100;

/**
 * Detect correlations among company signals in a time window.
 */
export async function detectCorrelations(
  companyId: string,
  windowHours: number = 24
): Promise<CorrelationResult[]> {
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data: rows, error } = await supabase
    .from('company_intelligence_signals')
    .select(
      'signal_id, relevance_score, signal_type, intelligence_signals!inner(id, topic, detected_at, normalized_payload)'
    )
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  if (error) throw new Error(`Failed to fetch signals: ${error.message}`);

  type CisRow = {
    signal_id: string;
    relevance_score: number | null;
    signal_type: string | null;
    intelligence_signals: { id: string; topic: string | null; detected_at: string; normalized_payload: Record<string, unknown> | null } | null;
  };
  const raw = (rows ?? []) as unknown as Array<CisRow>;

  const signals = raw
    .filter((r) => r.intelligence_signals)
    .map((r) => {
      const s = r.intelligence_signals!;
      return {
        id: s.id,
        topic: s.topic,
        detected_at: s.detected_at,
        normalized_payload: s.normalized_payload,
        company_relevance: r.relevance_score ?? 0,
        signal_type: r.signal_type,
      };
    });

  if (signals.length < 2) return [];

  const pairs: CorrelatedSignalPair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < signals.length && pairs.length < MAX_PAIRS; i++) {
    for (let j = i + 1; j < signals.length && pairs.length < MAX_PAIRS; j++) {
      const a = signals[i];
      const b = signals[j];
      const key = [a.id, b.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      const tokensA = tokenizeTopic(a.topic);
      const tokensB = tokenizeTopic(b.topic);
      const topicSim = tokenSimilarity(tokensA, tokensB);
      if (topicSim >= TOPIC_THRESHOLD) {
        pairs.push({
          signal_a_id: a.id,
          signal_b_id: b.id,
          correlation_score: topicSim,
          correlation_type: 'topic_similarity',
          topic_a: a.topic,
          topic_b: b.topic,
          detected_at_a: a.detected_at,
          detected_at_b: b.detected_at,
        });
        continue;
      }

      const timeA = new Date(a.detected_at).getTime();
      const timeB = new Date(b.detected_at).getTime();
      const timeDiff = Math.abs(timeA - timeB);
      if (timeDiff <= TEMPORAL_WINDOW_MS && topicSim > 0) {
        const temporalScore = 1 - timeDiff / TEMPORAL_WINDOW_MS;
        pairs.push({
          signal_a_id: a.id,
          signal_b_id: b.id,
          correlation_score: temporalScore * 0.5 + topicSim * 0.5,
          correlation_type: 'temporal_proximity',
          topic_a: a.topic,
          topic_b: b.topic,
          detected_at_a: a.detected_at,
          detected_at_b: b.detected_at,
        });
        continue;
      }

      const competitorPattern = /competitor|competition|rival|market share/i;
      if (competitorPattern.test(a.topic ?? '') && competitorPattern.test(b.topic ?? '')) {
        pairs.push({
          signal_a_id: a.id,
          signal_b_id: b.id,
          correlation_score: 0.6,
          correlation_type: 'competitor_overlap',
          topic_a: a.topic,
          topic_b: b.topic,
          detected_at_a: a.detected_at,
          detected_at_b: b.detected_at,
        });
      }
    }
  }

  const byType = new Map<CorrelationType, CorrelatedSignalPair[]>();
  for (const p of pairs) {
    const arr = byType.get(p.correlation_type) ?? [];
    arr.push(p);
    byType.set(p.correlation_type, arr);
  }

  return Array.from(byType.entries()).map(([type, pairs]) => ({
    correlated_signals: pairs.slice(0, 20),
    correlation_score: pairs.length > 0 ? pairs.reduce((s, x) => s + x.correlation_score, 0) / pairs.length : 0,
    correlation_type: type,
  }));
}
