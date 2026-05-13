/**
 * Market Pulse — Executive Panels Service.
 *
 * Phase 2: pre-computes the panels that the executive feed renders so the
 * UI doesn't need to re-aggregate per render. All panels are persisted
 * onto the run row (`market_pulse_runs.{momentum_overview,
 * category_acceleration, competitor_pressure, escalation_timeline,
 * propagation_map, trend_persistence}`) by `syncLegacyJobIntoRun`.
 *
 * Panels:
 *   - momentum_overview     — last N runs' P0/P1/P2 counts (sparkline data)
 *   - category_acceleration — top categories and their change vs prior run
 *   - competitor_pressure   — count of findings per named competitor
 *   - escalation_timeline   — time-ordered list of recent tier escalations
 *   - propagation_map       — region → finding-count distribution
 *   - trend_persistence     — top recurring canonical events (memory.times_seen ≥ 2)
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { MarketPulseExecutorContext } from './executorContext';

const HISTORY_RUN_WINDOW = 12;
const TREND_PERSISTENCE_LIMIT = 8;

export interface ExecutivePanelsFinding {
  finding_id: string;
  title: string;
  category: string;
  regions: string[];
  priority_tier: 'P0' | 'P1' | 'P2';
  impact_type: 'opportunity' | 'risk' | 'watch';
  alert_class: string | null;
  mentioned_competitors: string[];
  escalation_level?: string | null;
  trajectory?: string | null;
}

export interface MomentumOverviewPanel {
  /** Most recent runs first. */
  history: Array<{ run_id: string; created_at: string; p0: number; p1: number; p2: number; total: number }>;
  trend: 'rising' | 'falling' | 'flat';
  current_p0: number;
  delta_p0_vs_prior: number;
}

export interface CategoryAccelerationPanel {
  /** Categories ranked by current-run finding count. */
  categories: Array<{
    category: string;
    current_count: number;
    prior_count: number;
    delta: number;
    direction: 'up' | 'down' | 'flat';
  }>;
}

export interface CompetitorPressurePanel {
  competitors: Array<{
    name: string;
    finding_count: number;
    p0_count: number;
    has_escalation: boolean;
  }>;
}

export interface EscalationTimelinePanel {
  events: Array<{
    finding_id: string;
    title: string;
    category: string;
    escalation_level: string;
    detected_at: string;
  }>;
}

export interface PropagationMapPanel {
  regions: Array<{
    region: string;
    finding_count: number;
    p0_count: number;
  }>;
}

export interface TrendPersistencePanel {
  trends: Array<{
    canonical_event_key: string;
    title: string;
    times_seen: number;
    last_priority_tier: string | null;
    trajectory: string | null;
    last_seen_at: string;
  }>;
}

export interface ExecutivePanels {
  momentum_overview: MomentumOverviewPanel;
  category_acceleration: CategoryAccelerationPanel;
  competitor_pressure: CompetitorPressurePanel;
  escalation_timeline: EscalationTimelinePanel;
  propagation_map: PropagationMapPanel;
  trend_persistence: TrendPersistencePanel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal aggregations (pure)
// ─────────────────────────────────────────────────────────────────────────────

function buildCategoryAcceleration(
  current: ExecutivePanelsFinding[],
  priorCounts: Map<string, number>,
): CategoryAccelerationPanel {
  const currentCounts = new Map<string, number>();
  for (const f of current) currentCounts.set(f.category, (currentCounts.get(f.category) ?? 0) + 1);

  const categories: CategoryAccelerationPanel['categories'] = [];
  // Union of categories across current + prior so disappearing ones still surface.
  const allCategories = new Set<string>([...currentCounts.keys(), ...priorCounts.keys()]);
  for (const cat of allCategories) {
    const current_count = currentCounts.get(cat) ?? 0;
    const prior_count = priorCounts.get(cat) ?? 0;
    const delta = current_count - prior_count;
    categories.push({
      category: cat,
      current_count,
      prior_count,
      delta,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    });
  }
  categories.sort((a, b) => b.current_count - a.current_count || b.delta - a.delta);
  return { categories: categories.slice(0, 8) };
}

function buildCompetitorPressure(
  current: ExecutivePanelsFinding[],
  executorContext: MarketPulseExecutorContext | null,
): CompetitorPressurePanel {
  const namedCompetitors = (executorContext?.named_competitors ?? []).map((c) => c.toLowerCase());
  const competitorCounts = new Map<string, { count: number; p0: number; escalation: boolean }>();
  for (const f of current) {
    for (const mention of f.mentioned_competitors ?? []) {
      const lc = mention.toLowerCase();
      // Only count NAMED competitors; auto-discovered chatter is filtered out.
      if (namedCompetitors.length > 0 && !namedCompetitors.includes(lc)) continue;
      const existing = competitorCounts.get(lc) ?? { count: 0, p0: 0, escalation: false };
      existing.count++;
      if (f.priority_tier === 'P0') existing.p0++;
      if (f.escalation_level === 'escalating_pattern' || f.escalation_level === 'market_wide_propagation') {
        existing.escalation = true;
      }
      competitorCounts.set(lc, existing);
    }
  }
  const competitors: CompetitorPressurePanel['competitors'] = [];
  for (const [name, agg] of competitorCounts) {
    competitors.push({ name, finding_count: agg.count, p0_count: agg.p0, has_escalation: agg.escalation });
  }
  competitors.sort((a, b) => b.p0_count - a.p0_count || b.finding_count - a.finding_count);
  return { competitors: competitors.slice(0, 10) };
}

function buildPropagationMap(current: ExecutivePanelsFinding[]): PropagationMapPanel {
  const regionMap = new Map<string, { count: number; p0: number }>();
  for (const f of current) {
    const regions = f.regions.length > 0 ? f.regions : ['GLOBAL'];
    for (const r of regions) {
      const key = r.toUpperCase().trim() || 'GLOBAL';
      const existing = regionMap.get(key) ?? { count: 0, p0: 0 };
      existing.count++;
      if (f.priority_tier === 'P0') existing.p0++;
      regionMap.set(key, existing);
    }
  }
  const regions: PropagationMapPanel['regions'] = [];
  for (const [region, agg] of regionMap) regions.push({ region, finding_count: agg.count, p0_count: agg.p0 });
  regions.sort((a, b) => b.p0_count - a.p0_count || b.finding_count - a.finding_count);
  return { regions };
}

function buildEscalationTimeline(
  current: ExecutivePanelsFinding[],
  detectedAt: string,
): EscalationTimelinePanel {
  const events: EscalationTimelinePanel['events'] = [];
  for (const f of current) {
    if (
      f.escalation_level === 'escalating_pattern' ||
      f.escalation_level === 'market_wide_propagation'
    ) {
      events.push({
        finding_id: f.finding_id,
        title: f.title,
        category: f.category,
        escalation_level: f.escalation_level,
        detected_at: detectedAt,
      });
    }
  }
  // Most-impactful first (market_wide_propagation > escalating_pattern).
  events.sort((a, b) => {
    const aRank = a.escalation_level === 'market_wide_propagation' ? 2 : 1;
    const bRank = b.escalation_level === 'market_wide_propagation' ? 2 : 1;
    return bRank - aRank;
  });
  return { events: events.slice(0, 10) };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed loaders for momentum + trend persistence
// ─────────────────────────────────────────────────────────────────────────────

async function loadMomentumHistory(
  companyId: string,
  currentRunId: string,
  currentCounts: { p0: number; p1: number; p2: number; total: number },
  currentCreatedAt: string,
): Promise<MomentumOverviewPanel> {
  const { data: priorRuns } = await ownedDbTable('market_pulse_runs')
    .select('id, created_at')
    .eq('company_id', companyId)
    .neq('id', currentRunId)
    .in('status', ['completed', 'completed_with_warnings'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_RUN_WINDOW);

  const history: MomentumOverviewPanel['history'] = [
    { run_id: currentRunId, created_at: currentCreatedAt, ...currentCounts },
  ];

  for (const r of (priorRuns ?? []) as Array<{ id: string; created_at: string }>) {
    const { data: tierCounts } = await ownedDbTable('market_pulse_findings')
      .select('priority_tier')
      .eq('run_id', r.id);
    const counts = { p0: 0, p1: 0, p2: 0, total: 0 };
    for (const row of (tierCounts ?? []) as Array<{ priority_tier: string | null }>) {
      counts.total++;
      if (row.priority_tier === 'P0') counts.p0++;
      else if (row.priority_tier === 'P1') counts.p1++;
      else counts.p2++;
    }
    history.push({ run_id: r.id, created_at: r.created_at, ...counts });
  }

  // Sort newest-first so UI sparkline can read left-to-right backward in time.
  history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const priorP0 = history[1]?.p0 ?? 0;
  const delta_p0_vs_prior = currentCounts.p0 - priorP0;
  const trend: MomentumOverviewPanel['trend'] =
    delta_p0_vs_prior > 0 ? 'rising'
    : delta_p0_vs_prior < 0 ? 'falling'
    : 'flat';

  return {
    history,
    trend,
    current_p0: currentCounts.p0,
    delta_p0_vs_prior,
  };
}

async function loadCategoryPriorCounts(
  companyId: string,
  currentRunId: string,
): Promise<Map<string, number>> {
  // Find the immediately-prior completed run.
  const { data: prior } = await ownedDbTable('market_pulse_runs')
    .select('id, created_at')
    .eq('company_id', companyId)
    .neq('id', currentRunId)
    .in('status', ['completed', 'completed_with_warnings'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prior?.id) return new Map();

  const { data: rows } = await ownedDbTable('market_pulse_findings')
    .select('category')
    .eq('run_id', (prior as { id: string }).id);

  const counts = new Map<string, number>();
  for (const row of (rows ?? []) as Array<{ category: string | null }>) {
    if (!row.category) continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return counts;
}

async function loadTrendPersistence(companyId: string): Promise<TrendPersistencePanel> {
  const { data: rows } = await ownedDbTable('market_pulse_memory')
    .select('canonical_event_key, times_seen, last_priority_tier, trajectory, last_seen_at, latest_finding_hash')
    .eq('company_id', companyId)
    .gte('times_seen', 2)
    .order('times_seen', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(TREND_PERSISTENCE_LIMIT);

  const trends: TrendPersistencePanel['trends'] = [];
  for (const row of (rows ?? []) as Array<{
    canonical_event_key: string;
    times_seen: number;
    last_priority_tier: string | null;
    trajectory: string | null;
    last_seen_at: string;
  }>) {
    // Reverse-engineer a readable title from the canonical_event_key. We
    // don't store the latest title on memory rows, so we derive a humanized
    // form from the slug. Phase 3 may move title onto memory for fidelity.
    const title = row.canonical_event_key
      .split('-')
      .filter(Boolean)
      .slice(0, 8)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    trends.push({
      canonical_event_key: row.canonical_event_key,
      title,
      times_seen: row.times_seen,
      last_priority_tier: row.last_priority_tier,
      trajectory: row.trajectory,
      last_seen_at: row.last_seen_at,
    });
  }
  return { trends };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildExecutivePanelsInput {
  companyId: string;
  runId: string;
  runCreatedAt: string;
  findings: ExecutivePanelsFinding[];
  executorContext: MarketPulseExecutorContext | null;
}

export async function buildExecutivePanels(input: BuildExecutivePanelsInput): Promise<ExecutivePanels> {
  const { companyId, runId, runCreatedAt, findings, executorContext } = input;

  const currentCounts = { p0: 0, p1: 0, p2: 0, total: findings.length };
  for (const f of findings) {
    if (f.priority_tier === 'P0') currentCounts.p0++;
    else if (f.priority_tier === 'P1') currentCounts.p1++;
    else currentCounts.p2++;
  }

  const [momentum, priorCategoryCounts, persistence] = await Promise.all([
    loadMomentumHistory(companyId, runId, currentCounts, runCreatedAt),
    loadCategoryPriorCounts(companyId, runId),
    loadTrendPersistence(companyId),
  ]);

  return {
    momentum_overview: momentum,
    category_acceleration: buildCategoryAcceleration(findings, priorCategoryCounts),
    competitor_pressure: buildCompetitorPressure(findings, executorContext),
    escalation_timeline: buildEscalationTimeline(findings, runCreatedAt),
    propagation_map: buildPropagationMap(findings),
    trend_persistence: persistence,
  };
}
