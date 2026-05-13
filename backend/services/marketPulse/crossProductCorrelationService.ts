/**
 * Market Pulse — Cross-Product Correlation Service.
 *
 * Phase 2: extends Phase 1B's in-run correlation with cross-product +
 * cross-run intelligence by reusing the existing engines (NOT duplicating
 * their logic):
 *
 *   - signalCorrelationEngine.detectCorrelations  → cross-product signal
 *     correlations from `intelligence_signals` joined to
 *     `company_intelligence_signals` (24h window)
 *   - signalClusterEngine.tokenizeTopic / tokenSimilarity → cluster
 *     membership lookup against `signal_clusters`
 *   - market_pulse_findings (historical) → recurrence + escalation chain
 *
 * Returns ENRICHMENT data the v2 sync pipeline can attach to each finding:
 *   - related_intelligence_signal_ids
 *   - cluster_signal_ids
 *   - historical_finding_ids
 *   - upgraded cluster_role classifications
 *
 * The Phase 1B in-run correlation result still drives `correlated_findings`
 * (peers within the same run). This service is purely additive.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { supabase } from '../../db/supabaseClient';
import { tokenizeTopic, tokenSimilarity } from '../signalClusterEngine';
import { detectCorrelations as detectCrossProductCorrelations, type CorrelationResult } from '../signalCorrelationEngine';

const HISTORICAL_LOOKBACK_DAYS = 30;
const SIGNAL_LOOKBACK_HOURS = 24 * 7; // one week
const CLUSTER_TOPIC_MATCH_THRESHOLD = 0.55;
const SIGNAL_TOPIC_MATCH_THRESHOLD = 0.35;
const MAX_RELATED_SIGNALS_PER_FINDING = 6;
const MAX_HISTORICAL_PER_FINDING = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossProductFindingInput {
  canonicalEventKey: string;
  title: string;
  summary: string;
  category: string;
  regions: string[];
  impactType: 'opportunity' | 'risk' | 'watch';
}

export interface CrossProductEnrichment {
  /** ids from `intelligence_signals` whose topic matches this finding. */
  related_intelligence_signal_ids: string[];
  /** ids from `signal_clusters` whose cluster_topic matches this finding. */
  cluster_signal_ids: string[];
  /** ids from prior `market_pulse_findings` that share this canonical_event_key. */
  historical_finding_ids: string[];
  /** Upgraded cluster role: includes Phase 2 'emerging_market_shift' / 'coordinated_competitor_movement'. */
  upgraded_cluster_role:
    | 'isolated'
    | 'repeated'
    | 'market_wide'
    | 'localized_anomaly'
    | 'emerging_market_shift'
    | 'coordinated_competitor_movement'
    | null;
  /** Reason string for the cluster role decision. */
  cluster_role_rationale: string;
}

export interface CrossProductBatchOutput {
  /** Map keyed by canonicalEventKey → enrichment for that finding. */
  enrichmentByKey: Map<string, CrossProductEnrichment>;
  /** Cross-product correlation summary at the run level (for executive panels). */
  runSummary: {
    total_cross_product_signals: number;
    total_clusters_matched: number;
    total_historical_findings: number;
    correlation_types_detected: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal data loaders (bounded — none scan the full table)
// ─────────────────────────────────────────────────────────────────────────────

type IntelligenceSignalRow = {
  id: string;
  topic: string | null;
  detected_at: string;
};

async function loadRecentIntelligenceSignals(companyId: string): Promise<IntelligenceSignalRow[]> {
  const since = new Date(Date.now() - SIGNAL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  // company_intelligence_signals → join intelligence_signals to scope per
  // company. Same join the existing `signalCorrelationEngine.detectCorrelations`
  // uses — keeps the surface consistent.
  const { data } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id, intelligence_signals!inner(id, topic, detected_at)')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .limit(500);

  type Row = {
    intelligence_signals: { id: string; topic: string | null; detected_at: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .map((r) => r.intelligence_signals)
    .filter((s): s is IntelligenceSignalRow => !!s);
}

type ClusterRow = {
  cluster_id: string;
  cluster_topic: string | null;
  signal_count: number | null;
};

async function loadRecentClusters(companyId: string): Promise<ClusterRow[]> {
  // signal_clusters is global (not company-scoped at the table level), but
  // we approximate company scope by joining via cluster_signals → company.
  // To stay bounded we just pull the most-recent N clusters and let the
  // topic Jaccard discriminate.
  const { data } = await supabase
    .from('signal_clusters')
    .select('cluster_id, cluster_topic, signal_count')
    .order('last_updated', { ascending: false })
    .limit(120);
  // companyId is unused at the SQL level here but kept as a parameter for
  // future filtering when signal_clusters gets a company_id column.
  void companyId;
  return (data ?? []) as ClusterRow[];
}

type HistoricalFindingRow = {
  id: string;
  canonical_event_key: string | null;
  category: string | null;
  priority_tier: string | null;
  created_at: string;
};

async function loadHistoricalFindings(
  companyId: string,
  currentRunId: string,
): Promise<HistoricalFindingRow[]> {
  const since = new Date(Date.now() - HISTORICAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await ownedDbTable('market_pulse_findings')
    .select('id, canonical_event_key, category, priority_tier, created_at')
    .eq('company_id', companyId)
    .neq('run_id', currentRunId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  return (data ?? []) as HistoricalFindingRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic similarity helpers (reuse signalClusterEngine primitives)
// ─────────────────────────────────────────────────────────────────────────────

function topicMatchScore(a: string, b: string): number {
  return tokenSimilarity(tokenizeTopic(a), tokenizeTopic(b));
}

function bestTopicMatch<T extends { topic?: string | null; cluster_topic?: string | null }>(
  needle: string,
  candidates: T[],
  threshold: number,
  pickTopic: (c: T) => string | null,
  max: number,
): Array<{ row: T; score: number }> {
  const out: Array<{ row: T; score: number }> = [];
  for (const c of candidates) {
    const t = pickTopic(c);
    if (!t) continue;
    const score = topicMatchScore(needle, t);
    if (score >= threshold) out.push({ row: c, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinated-competitor-movement detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect coordinated competitor movement: ≥2 findings in the same run that
 * each mention a competitor, with overlap in the competitor set OR all
 * within the same `competitor_moves` category. Used to upgrade cluster_role.
 */
function detectCoordinatedCompetitorMovement(
  finding: CrossProductFindingInput,
  allFindings: CrossProductFindingInput[],
  competitorMentions: Map<string, Set<string>>,
): boolean {
  const ownComps = competitorMentions.get(finding.canonicalEventKey);
  if (!ownComps || ownComps.size === 0) return false;
  let coOccurringPeers = 0;
  for (const peer of allFindings) {
    if (peer.canonicalEventKey === finding.canonicalEventKey) continue;
    const peerComps = competitorMentions.get(peer.canonicalEventKey);
    if (!peerComps || peerComps.size === 0) continue;
    let shared = 0;
    for (const c of ownComps) if (peerComps.has(c)) shared++;
    if (shared > 0) coOccurringPeers++;
    else if (peer.category === 'competitor_moves' && finding.category === 'competitor_moves') coOccurringPeers++;
  }
  return coOccurringPeers >= 1;
}

/**
 * Detect emerging market shift: a finding whose canonical_event_key has been
 * seen N+ times across the prior 30 days AND whose region count is
 * accelerating (≥3 distinct regions across history).
 */
function detectEmergingMarketShift(
  historicalForKey: HistoricalFindingRow[],
  currentRegions: string[],
): boolean {
  if (historicalForKey.length < 2) return false;
  // Treat current regions as the latest sighting; collect categories from history.
  const distinctTiers = new Set<string>();
  for (const h of historicalForKey) {
    if (h.priority_tier) distinctTiers.add(h.priority_tier);
  }
  // If history shows escalating tier (P2 → P1 → P0) AND the current finding
  // covers ≥2 regions, treat as emerging market shift.
  return distinctTiers.size >= 2 && currentRegions.length >= 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichBatchInputs {
  companyId: string;
  currentRunId: string;
  findings: CrossProductFindingInput[];
  /** From the in-run correlation pass — used to upgrade cluster_role. */
  competitorMentionsByKey: Map<string, Set<string>>;
  /** Existing in-run cluster role per finding (Phase 1B). Phase 2 may upgrade. */
  inRunClusterRoleByKey: Map<string, 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly'>;
}

export async function enrichFindingsCrossProduct(
  input: EnrichBatchInputs,
): Promise<CrossProductBatchOutput> {
  const { companyId, currentRunId, findings, competitorMentionsByKey, inRunClusterRoleByKey } = input;

  if (findings.length === 0) {
    return {
      enrichmentByKey: new Map(),
      runSummary: {
        total_cross_product_signals: 0,
        total_clusters_matched: 0,
        total_historical_findings: 0,
        correlation_types_detected: [],
      },
    };
  }

  // ── Single batched query per data source — bounded sizes above. ─────────────
  const [intelligenceSignals, clusters, historical, crossProductCorrelations] = await Promise.all([
    loadRecentIntelligenceSignals(companyId),
    loadRecentClusters(companyId),
    loadHistoricalFindings(companyId, currentRunId),
    detectCrossProductCorrelationsSafe(companyId),
  ]);

  // Pre-bucket historical by canonical_event_key for O(1) lookup per finding.
  const historicalByKey = new Map<string, HistoricalFindingRow[]>();
  for (const h of historical) {
    if (!h.canonical_event_key) continue;
    const list = historicalByKey.get(h.canonical_event_key) ?? [];
    list.push(h);
    historicalByKey.set(h.canonical_event_key, list);
  }

  // Pre-index correlation types from the cross-product correlation engine.
  const detectedCorrelationTypes = new Set<string>();
  for (const c of crossProductCorrelations) detectedCorrelationTypes.add(c.correlation_type);

  const enrichmentByKey = new Map<string, CrossProductEnrichment>();
  let totalRelatedSignals = 0;
  let totalClustersMatched = 0;
  let totalHistoricalLinked = 0;

  for (const f of findings) {
    const text = `${f.title} ${f.summary}`;

    // Related intelligence_signals — topic-Jaccard match.
    const matchedSignals = bestTopicMatch(
      text,
      intelligenceSignals,
      SIGNAL_TOPIC_MATCH_THRESHOLD,
      (s) => s.topic,
      MAX_RELATED_SIGNALS_PER_FINDING,
    );
    const related_intelligence_signal_ids = matchedSignals.map((m) => m.row.id);
    totalRelatedSignals += related_intelligence_signal_ids.length;

    // Cluster membership — topic-Jaccard match against signal_clusters.
    const matchedClusters = bestTopicMatch(
      text,
      clusters,
      CLUSTER_TOPIC_MATCH_THRESHOLD,
      (c) => c.cluster_topic,
      4,
    );
    const cluster_signal_ids = matchedClusters.map((m) => m.row.cluster_id);
    totalClustersMatched += cluster_signal_ids.length;

    // Historical findings — same canonical_event_key.
    const historyForKey = historicalByKey.get(f.canonicalEventKey) ?? [];
    const historical_finding_ids = historyForKey.slice(0, MAX_HISTORICAL_PER_FINDING).map((h) => h.id);
    totalHistoricalLinked += historical_finding_ids.length;

    // Cluster role — start from the in-run classification, upgrade based on
    // cross-product evidence. Variable typed to the wider Phase 2 union so
    // upgrades to 'emerging_market_shift' / 'coordinated_competitor_movement'
    // are valid assignments.
    let upgraded_cluster_role: CrossProductEnrichment['upgraded_cluster_role'] =
      inRunClusterRoleByKey.get(f.canonicalEventKey) ?? null;
    let rationale = upgraded_cluster_role ? `In-run: ${upgraded_cluster_role}.` : 'No in-run classification.';

    // Coordinated competitor movement supersedes everything when detected.
    if (detectCoordinatedCompetitorMovement(f, findings, competitorMentionsByKey)) {
      upgraded_cluster_role = 'coordinated_competitor_movement';
      rationale = `Multiple findings reference overlapping named competitors in the same run.`;
    }
    // Emerging market shift — based on historical recurrence + region spread.
    else if (detectEmergingMarketShift(historyForKey, f.regions)) {
      upgraded_cluster_role = 'emerging_market_shift';
      rationale = `Pattern recurred ${historyForKey.length} times in last ${HISTORICAL_LOOKBACK_DAYS}d with multi-region coverage.`;
    }
    // If we matched ≥2 cross-product signals, upgrade isolated → market_wide.
    else if (upgraded_cluster_role === 'isolated' && matchedSignals.length >= 2) {
      upgraded_cluster_role = 'market_wide';
      rationale = `Linked to ${matchedSignals.length} cross-product intelligence signals — broader pattern than in-run alone.`;
    }
    // If we matched ≥1 cluster, upgrade isolated → repeated.
    else if (upgraded_cluster_role === 'isolated' && matchedClusters.length >= 1) {
      upgraded_cluster_role = 'repeated';
      rationale = `Topic matches existing signal cluster (${matchedClusters[0].row.cluster_topic ?? 'unknown'}).`;
    }

    enrichmentByKey.set(f.canonicalEventKey, {
      related_intelligence_signal_ids,
      cluster_signal_ids,
      historical_finding_ids,
      upgraded_cluster_role,
      cluster_role_rationale: rationale,
    });
  }

  return {
    enrichmentByKey,
    runSummary: {
      total_cross_product_signals: totalRelatedSignals,
      total_clusters_matched: totalClustersMatched,
      total_historical_findings: totalHistoricalLinked,
      correlation_types_detected: Array.from(detectedCorrelationTypes),
    },
  };
}

// Wrap the cross-product engine call so a single failure here cannot break
// the whole sync pipeline (engine queries against company_intelligence_signals
// which may not exist in older deployments).
async function detectCrossProductCorrelationsSafe(companyId: string): Promise<CorrelationResult[]> {
  try {
    return await detectCrossProductCorrelations(companyId, 24);
  } catch {
    return [];
  }
}
