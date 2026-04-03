import { supabase } from '../db/supabaseClient';

export const PRIORITIZATION_MODEL_VERSION = 'global-v2-strategic';
export type PrioritizationMode = 'growth' | 'efficiency' | 'risk';
export type PrioritySegment = 'quick_wins' | 'strategic' | 'risk';

const DECISION_SELECT_FIELDS = [
  'id',
  'company_id',
  'report_tier',
  'source_service',
  'entity_type',
  'entity_id',
  'issue_type',
  'title',
  'description',
  'impact_conversion',
  'impact_revenue',
  'effort_score',
  'confidence_score',
  'execution_score',
  'recommendation',
  'action_type',
  'evidence',
  'status',
  'created_at',
].join(', ');

type DecisionRow = {
  id: string;
  company_id: string;
  report_tier: 'snapshot' | 'growth' | 'deep';
  source_service: string;
  entity_type: string;
  entity_id: string | null;
  issue_type: string;
  title: string;
  description: string;
  impact_conversion: number;
  impact_revenue: number;
  effort_score: number;
  confidence_score: number;
  execution_score: number;
  recommendation: string;
  action_type: string;
  evidence?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  status: 'open' | 'resolved' | 'ignored';
  created_at: string;
};

type PriorityComputation = {
  decision_id: string;
  company_id: string;
  report_tier: 'snapshot' | 'growth' | 'deep';
  priority_score: number;
  priority_rank: number;
  score_impact: number;
  score_confidence: number;
  score_revenue_linkage: number;
  score_urgency: number;
  correlation_boost: number;
  priority_rationale: string;
  priority_segment: PrioritySegment;
  prioritization_mode: PrioritizationMode;
  playbook: DecisionPlaybook;
  model_version: string;
  scored_at: string;
};

export type PrioritizedDecision = {
  decision_id: string;
  company_id: string;
  report_tier: 'snapshot' | 'growth' | 'deep';
  priority_score: number;
  priority_rank: number;
  score_impact: number;
  score_confidence: number;
  score_revenue_linkage: number;
  score_urgency: number;
  correlation_boost: number;
  priority_rationale: string;
  priority_segment: PrioritySegment;
  prioritization_mode: PrioritizationMode;
  playbook: DecisionPlaybook;
  model_version: string;
  scored_at: string;
  source_service: string;
  entity_type: string;
  entity_id: string | null;
  issue_type: string;
  title: string;
  description: string;
  execution_score: number;
  confidence_score: number;
  impact_revenue: number;
  impact_conversion: number;
  recommendation: string;
  action_type: string;
  status: 'open' | 'resolved' | 'ignored';
  created_at: string;
};

type PlaybookEffort = 'low' | 'medium' | 'high';

type DecisionPlaybook = {
  objective: string;
  steps: string[];
  estimated_effort: {
    level: PlaybookEffort;
    score: number;
    hours: number;
  };
  expected_impact: {
    traffic: number;
    conversion: number;
    revenue: number;
    confidence: number;
  };
  dependencies: string[];
};

type DecisionContext = {
  issueType: string;
  entityType: string;
  entityId: string | null;
  pageUrl: string | null;
  keywordCluster: string | null;
  cta: string | null;
  funnelStage: string | null;
  channel: string | null;
  contentType: string | null;
};

type ScoreSignals = {
  impact: number;
  confidence: number;
  revenueLinkage: number;
  urgency: number;
  effortInverse: number;
  riskSignal: number;
  correlationBoost: number;
};

type WeightProfile = {
  impact: number;
  confidence: number;
  revenueLinkage: number;
  urgency: number;
  effortInverse: number;
  riskSignal: number;
  correlationBoost: number;
};

const WEIGHT_PROFILES: Record<PrioritizationMode, WeightProfile> = {
  growth: {
    impact: 0.3,
    confidence: 0.2,
    revenueLinkage: 0.28,
    urgency: 0.08,
    effortInverse: 0.04,
    riskSignal: 0.02,
    correlationBoost: 0.08,
  },
  efficiency: {
    impact: 0.2,
    confidence: 0.22,
    revenueLinkage: 0.14,
    urgency: 0.08,
    effortInverse: 0.26,
    riskSignal: 0.02,
    correlationBoost: 0.08,
  },
  risk: {
    impact: 0.18,
    confidence: 0.22,
    revenueLinkage: 0.12,
    urgency: 0.2,
    effortInverse: 0.06,
    riskSignal: 0.14,
    correlationBoost: 0.08,
  },
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round(value: number, precision = 4): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function issueUrgencyBoost(issueType: string): number {
  const normalized = String(issueType || '').toLowerCase();
  if (/(critical|urgent|outage|drop|decline|churn|risk|blocked)/.test(normalized)) return 0.25;
  if (/(degrade|weak|slow|falling|loss)/.test(normalized)) return 0.12;
  return 0;
}

function tierUrgencyBase(reportTier: 'snapshot' | 'growth' | 'deep'): number {
  if (reportTier === 'snapshot') return 0.8;
  if (reportTier === 'growth') return 0.6;
  return 0.45;
}

function ageUrgencyBoost(createdAt: string): number {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 0;
  const ageDays = Math.max(0, (Date.now() - createdMs) / (24 * 60 * 60 * 1000));
  return Math.min(0.2, ageDays * 0.02);
}

function riskSignal(issueType: string): number {
  const normalized = String(issueType || '').toLowerCase();
  if (/(critical|outage|security|compliance|churn|incident|revenue_drop|risk)/.test(normalized)) return 0.95;
  if (/(decline|drop|loss|degrade|weak|blocked)/.test(normalized)) return 0.7;
  return 0.2;
}

function extractClusterKey(decision: DecisionRow): string | null {
  const evidence = decision.evidence;
  if (!evidence || Array.isArray(evidence)) return null;
  const candidate =
    (typeof evidence.cluster_id === 'string' && evidence.cluster_id) ||
    (typeof evidence.content_cluster === 'string' && evidence.content_cluster) ||
    (typeof evidence.topic_cluster === 'string' && evidence.topic_cluster) ||
    (typeof evidence.cluster === 'string' && evidence.cluster) ||
    null;

  return candidate ? candidate.trim().toLowerCase() : null;
}

function readEvidenceString(
  evidence: Record<string, unknown> | Array<Record<string, unknown>> | null | undefined,
  keys: string[]
): string | null {
  if (!evidence || Array.isArray(evidence)) return null;
  for (const key of keys) {
    const value = evidence[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toDecisionContext(decision: DecisionRow): DecisionContext {
  return {
    issueType: String(decision.issue_type || '').toLowerCase(),
    entityType: String(decision.entity_type || '').toLowerCase(),
    entityId: decision.entity_id,
    pageUrl: readEvidenceString(decision.evidence, ['page_url', 'url', 'landing_page', 'page']),
    keywordCluster: readEvidenceString(decision.evidence, ['keyword_cluster', 'content_cluster', 'cluster', 'topic']),
    cta: readEvidenceString(decision.evidence, ['cta', 'call_to_action', 'current_cta']),
    funnelStage: readEvidenceString(decision.evidence, ['funnel_stage', 'stage']),
    channel: readEvidenceString(decision.evidence, ['channel', 'platform']),
    contentType: readEvidenceString(decision.evidence, ['content_type', 'format']),
  };
}

function estimateEffort(effortScore: number): { level: PlaybookEffort; score: number; hours: number } {
  const score = Math.max(0, Math.min(100, Math.round(Number(effortScore ?? 0))));
  if (score <= 33) return { level: 'low', score, hours: 4 };
  if (score <= 66) return { level: 'medium', score, hours: 12 };
  return { level: 'high', score, hours: 24 };
}

function expectedImpact(decision: DecisionRow): DecisionPlaybook['expected_impact'] {
  return {
    traffic: Number(decision.impact_revenue ?? 0) * 0.6,
    conversion: Number(decision.impact_conversion ?? 0),
    revenue: Number(decision.impact_revenue ?? 0),
    confidence: Math.max(0, Math.min(1, Number(decision.confidence_score ?? 0))),
  };
}

function buildPlaybook(decision: DecisionRow): DecisionPlaybook {
  const ctx = toDecisionContext(decision);
  const effort = estimateEffort(Number(decision.effort_score ?? 50));
  const impact = expectedImpact(decision);

  const isSeo = /(seo_gap|ranking_gap|topic_gap|keyword_opportunity|weak_cluster_depth|missing_cluster_support)/.test(ctx.issueType);
  const isFunnel = /(funnel_drop|drop_off|revenue_leak|weak_conversion|cta|dead_end_pages)/.test(ctx.issueType);
  const isDistribution = /(distribution|platform_mismatch|engagement_drop|content_velocity_gap)/.test(ctx.issueType);

  if (isSeo) {
    const cluster = ctx.keywordCluster ?? 'identified opportunity cluster';
    const page = ctx.pageUrl ?? 'target page';
    return {
      objective: `Close SEO gap for ${cluster} and recover qualified traffic.`,
      steps: [
        `Finalize keyword cluster targets for ${cluster} with search intent grouping.`,
        `Create 3 content pieces mapped to ${cluster} and publish to ${page}.`,
        `Add internal links from top authority pages to ${page} using cluster anchors.`,
        `Refresh metadata and headings on ${page} to align with primary query intent.`,
      ],
      estimated_effort: effort,
      expected_impact: impact,
      dependencies: [
        'keyword coverage export available',
        'content production capacity assigned',
        'CMS publishing access',
      ],
    };
  }

  if (isFunnel) {
    const stage = ctx.funnelStage ?? 'conversion stage';
    const cta = ctx.cta ?? 'primary CTA';
    const page = ctx.pageUrl ?? 'funnel page';
    return {
      objective: `Recover conversion loss in ${stage} by fixing page flow and CTA performance.`,
      steps: [
        `Audit ${page} friction points and remove top 2 blockers in user flow.`,
        `Replace ${cta} with value-led CTA variants and launch A/B test.`,
        `Shorten form or handoff path in ${stage} to reduce abandonment.`,
        `Instrument conversion events on ${page} and monitor 7-day drop-off trend.`,
      ],
      estimated_effort: effort,
      expected_impact: impact,
      dependencies: [
        'analytics event tracking enabled',
        'A/B testing capability available',
        'frontend deployment window scheduled',
      ],
    };
  }

  if (isDistribution) {
    const channel = ctx.channel ?? 'underutilized channel';
    const format = ctx.contentType ?? 'best-fit format';
    return {
      objective: 'Fix distribution mismatch and improve content reach-to-conversion efficiency.',
      steps: [
        `Repackage top content into ${format} for ${channel}.`,
        `Schedule 5-post cadence over 14 days on ${channel} with consistent CTA framing.`,
        'Enable channel-specific UTM tagging for attribution and assisted conversion tracking.',
        'Compare engagement and conversion lift against current baseline after 2 weeks.',
      ],
      estimated_effort: effort,
      expected_impact: impact,
      dependencies: [
        'channel access tokens valid',
        'creative templates approved',
        'tracking taxonomy configured',
      ],
    };
  }

  return {
    objective: `Execute prioritized action for ${decision.issue_type} with measurable business impact.`,
    steps: [
      `Validate root cause signals for ${decision.issue_type} from current evidence.`,
      `Apply recommended action: ${decision.action_type}.`,
      'Assign owner and due date, then execute in one delivery cycle.',
      'Measure traffic, conversion, and revenue deltas over 7 days and recalibrate.',
    ],
    estimated_effort: effort,
    expected_impact: impact,
    dependencies: [
      'owner assigned',
      'tracking instrumentation active',
      'execution window approved',
    ],
  };
}

function buildCorrelationMap(decisions: DecisionRow[]): Map<string, number> {
  const byEntity = new Map<string, number>();
  const byCluster = new Map<string, number>();

  for (const decision of decisions) {
    if (decision.entity_id && decision.entity_type !== 'global') {
      const entityKey = `${decision.entity_type}:${decision.entity_id}`;
      byEntity.set(entityKey, (byEntity.get(entityKey) ?? 0) + 1);
    }

    const clusterKey = extractClusterKey(decision);
    if (clusterKey) {
      byCluster.set(clusterKey, (byCluster.get(clusterKey) ?? 0) + 1);
    }
  }

  const output = new Map<string, number>();
  for (const decision of decisions) {
    const entityPeers = decision.entity_id && decision.entity_type !== 'global'
      ? byEntity.get(`${decision.entity_type}:${decision.entity_id}`) ?? 1
      : 1;
    const clusterKey = extractClusterKey(decision);
    const clusterPeers = clusterKey ? (byCluster.get(clusterKey) ?? 1) : 1;

    let boost = 0;
    // Rule 1: shared entity means this issue is reinforced across services.
    if (entityPeers >= 2) boost += 0.06;
    // Rule 2: shared cluster means market/topic-level reinforcement.
    if (clusterPeers >= 2) boost += 0.04;
    // Rule 3: high-density overlap earns an extra strategic boost.
    if (entityPeers + clusterPeers >= 5) boost += 0.03;

    output.set(decision.id, clamp01(boost));
  }

  return output;
}

function classifySegment(signals: ScoreSignals): PrioritySegment {
  if (signals.urgency >= 0.75 || signals.riskSignal >= 0.75) return 'risk';
  if (signals.impact >= 0.6 && signals.confidence >= 0.65 && signals.effortInverse >= 0.55) return 'quick_wins';
  return 'strategic';
}

function buildPriorityRationale(params: {
  decision: DecisionRow;
  mode: PrioritizationMode;
  signals: ScoreSignals;
  profile: WeightProfile;
  segment: PrioritySegment;
}): string {
  const contributions: Array<{ key: string; value: number; label: string }> = [
    { key: 'impact', value: params.signals.impact * params.profile.impact, label: 'revenue impact' },
    { key: 'confidence', value: params.signals.confidence * params.profile.confidence, label: 'confidence' },
    { key: 'revenueLinkage', value: params.signals.revenueLinkage * params.profile.revenueLinkage, label: 'revenue linkage' },
    { key: 'urgency', value: params.signals.urgency * params.profile.urgency, label: 'urgency' },
    { key: 'effortInverse', value: params.signals.effortInverse * params.profile.effortInverse, label: 'low effort' },
    { key: 'riskSignal', value: params.signals.riskSignal * params.profile.riskSignal, label: 'risk signal' },
    { key: 'correlationBoost', value: params.signals.correlationBoost * params.profile.correlationBoost, label: 'cross-engine correlation' },
  ];

  const top = contributions
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((item) => item.label);

  const corrText = params.signals.correlationBoost >= 0.08 ? ' Correlated decisions increased this priority.' : '';
  return `${params.decision.title} is ranked high in ${params.mode} mode due to ${top.join(' and ')} (segment: ${params.segment}).${corrText}`;
}

function computeScores(params: {
  decision: DecisionRow;
  mode: PrioritizationMode;
  correlationBoost: number;
}): Omit<PriorityComputation, 'decision_id' | 'company_id' | 'report_tier' | 'priority_rank' | 'scored_at'> {
  const { decision, mode, correlationBoost } = params;
  const profile = WEIGHT_PROFILES[mode];

  const impact = clamp01(Number(decision.impact_revenue ?? 0) / 100);
  const confidence = clamp01(Number(decision.confidence_score ?? 0));
  const revenueLinkage = clamp01(
    (Number(decision.impact_revenue ?? 0) * 0.7 + Number(decision.impact_conversion ?? 0) * 0.3) / 100
  );
  const urgency = clamp01(
    tierUrgencyBase(decision.report_tier) +
      issueUrgencyBoost(decision.issue_type) +
      ageUrgencyBoost(decision.created_at)
  );
  const effortInverse = clamp01(1 - Number(decision.effort_score ?? 100) / 100);
  const risk = clamp01(riskSignal(decision.issue_type));

  const signals: ScoreSignals = {
    impact,
    confidence,
    revenueLinkage,
    urgency,
    effortInverse,
    riskSignal: risk,
    correlationBoost: clamp01(correlationBoost),
  };

  const weighted =
    signals.impact * profile.impact +
    signals.confidence * profile.confidence +
    signals.revenueLinkage * profile.revenueLinkage +
    signals.urgency * profile.urgency +
    signals.effortInverse * profile.effortInverse +
    signals.riskSignal * profile.riskSignal +
    signals.correlationBoost * profile.correlationBoost;

  const boostedScore = Math.max(0, Math.min(1, weighted + signals.correlationBoost * 0.12));
  const segment = classifySegment(signals);
  const rationale = buildPriorityRationale({
    decision,
    mode,
    signals,
    profile,
    segment,
  });
  const playbook = buildPlaybook(decision);

  return {
    priority_score: Math.max(0, Math.min(100, Math.round(boostedScore * 100))),
    score_impact: round(impact),
    score_confidence: round(confidence),
    score_revenue_linkage: round(revenueLinkage),
    score_urgency: round(urgency),
    correlation_boost: round(signals.correlationBoost),
    priority_rationale: rationale,
    priority_segment: segment,
    prioritization_mode: mode,
    playbook,
    model_version: PRIORITIZATION_MODEL_VERSION,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

async function loadOpenDecisions(params: {
  companyId: string;
  reportTier?: 'snapshot' | 'growth' | 'deep';
  limit: number;
}): Promise<DecisionRow[]> {
  let query = supabase
    .from('decision_objects')
    .select(DECISION_SELECT_FIELDS)
    .eq('company_id', params.companyId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.reportTier) {
    query = query.eq('report_tier', params.reportTier);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load open decision objects for prioritization: ${error.message}`);
  }

  return (data ?? []) as unknown as DecisionRow[];
}

async function persistDecisionPriorityScores(entries: PriorityComputation[]): Promise<void> {
  for (const group of chunk(entries, 100)) {
    await Promise.all(
      group.map(async (entry) => {
        const { error } = await supabase
          .from('decision_objects')
          .update({
            priority_score: entry.priority_score,
            last_changed_by: 'system',
          })
          .eq('id', entry.decision_id)
          .eq('company_id', entry.company_id);

        if (error) {
          throw new Error(`Failed to update decision priority_score for ${entry.decision_id}: ${error.message}`);
        }
      })
    );
  }
}

async function upsertPriorityQueue(entries: PriorityComputation[]): Promise<void> {
  if (entries.length === 0) return;

  const payload = entries.map((entry) => ({
    company_id: entry.company_id,
    decision_id: entry.decision_id,
    report_tier: entry.report_tier,
    priority_score: entry.priority_score,
    priority_rank: entry.priority_rank,
    score_impact: entry.score_impact,
    score_confidence: entry.score_confidence,
    score_revenue_linkage: entry.score_revenue_linkage,
    score_urgency: entry.score_urgency,
    correlation_boost: entry.correlation_boost,
    priority_rationale: entry.priority_rationale,
    priority_segment: entry.priority_segment,
    prioritization_mode: entry.prioritization_mode,
    playbook_json: entry.playbook,
    model_version: entry.model_version,
    scored_at: entry.scored_at,
  }));

  const { error } = await supabase
    .from('decision_priority_queue')
    .upsert(payload, { onConflict: 'company_id,decision_id' });

  if (error) {
    throw new Error(`Failed to upsert decision priority queue: ${error.message}`);
  }
}

async function pruneStaleQueueRows(params: {
  companyId: string;
  reportTier?: 'snapshot' | 'growth' | 'deep';
  activeDecisionIds: string[];
}): Promise<void> {
  let query = supabase
    .from('decision_priority_queue')
    .select('id, decision_id')
    .eq('company_id', params.companyId);

  if (params.reportTier) {
    query = query.eq('report_tier', params.reportTier);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load existing priority queue rows: ${error.message}`);
  }

  const active = new Set(params.activeDecisionIds);
  const staleIds = (data ?? [])
    .filter((row: { decision_id?: string }) => !active.has(String(row.decision_id ?? '')))
    .map((row: { id: string }) => row.id);

  if (staleIds.length === 0) return;

  for (const group of chunk(staleIds, 200)) {
    const { error: deleteError } = await supabase
      .from('decision_priority_queue')
      .delete()
      .in('id', group);

    if (deleteError) {
      throw new Error(`Failed to prune stale priority queue rows: ${deleteError.message}`);
    }
  }
}

export async function recomputePrioritiesForCompany(params: {
  companyId: string;
  reportTier?: 'snapshot' | 'growth' | 'deep';
  mode?: PrioritizationMode;
  limit?: number;
}): Promise<{ companyId: string; reportTier?: 'snapshot' | 'growth' | 'deep'; mode: PrioritizationMode; prioritized: number; modelVersion: string }> {
  const decisions = await loadOpenDecisions({
    companyId: params.companyId,
    reportTier: params.reportTier,
    limit: params.limit ?? 500,
  });

  const mode: PrioritizationMode = params.mode ?? 'growth';
  const correlationMap = buildCorrelationMap(decisions);

  const scored = decisions
    .map((decision) => ({
      decision,
      score: computeScores({
        decision,
        mode,
        correlationBoost: correlationMap.get(decision.id) ?? 0,
      }),
    }))
    .sort((a, b) => {
      if (b.score.priority_score !== a.score.priority_score) {
        return b.score.priority_score - a.score.priority_score;
      }
      const bExec = Number(b.decision.execution_score ?? 0);
      const aExec = Number(a.decision.execution_score ?? 0);
      if (bExec !== aExec) return bExec - aExec;
      return String(b.decision.created_at).localeCompare(String(a.decision.created_at));
    });

  const scoredAt = new Date().toISOString();
  const queueEntries: PriorityComputation[] = scored.map((item, index) => ({
    decision_id: item.decision.id,
    company_id: item.decision.company_id,
    report_tier: item.decision.report_tier,
    priority_rank: index + 1,
    scored_at: scoredAt,
    ...item.score,
  }));

  await persistDecisionPriorityScores(queueEntries);
  await upsertPriorityQueue(queueEntries);
  await pruneStaleQueueRows({
    companyId: params.companyId,
    reportTier: params.reportTier,
    activeDecisionIds: decisions.map((decision) => decision.id),
  });

  return {
    companyId: params.companyId,
    reportTier: params.reportTier,
    mode,
    prioritized: queueEntries.length,
    modelVersion: PRIORITIZATION_MODEL_VERSION,
  };
}

export async function recomputePrioritizationForDecisionWrites(
  rows: Array<{ company_id: string; report_tier: 'snapshot' | 'growth' | 'deep' }>,
  mode: PrioritizationMode = 'growth'
): Promise<void> {
  const scopes = new Set(rows.map((row) => `${row.company_id}:${row.report_tier}`));
  for (const scope of scopes) {
    const [companyId, reportTier] = scope.split(':');
    await recomputePrioritiesForCompany({
      companyId,
      reportTier: reportTier as 'snapshot' | 'growth' | 'deep',
      mode,
      limit: 500,
    });
  }
}

export async function listPrioritizedDecisions(params: {
  companyId: string;
  reportTier?: 'snapshot' | 'growth' | 'deep';
  mode?: PrioritizationMode;
  limit?: number;
}): Promise<PrioritizedDecision[]> {
  let query = supabase
    .from('decision_priority_queue')
    .select([
      'decision_id',
      'company_id',
      'report_tier',
      'priority_score',
      'priority_rank',
      'score_impact',
      'score_confidence',
      'score_revenue_linkage',
      'score_urgency',
      'correlation_boost',
      'priority_rationale',
      'priority_segment',
      'prioritization_mode',
      'playbook_json',
      'model_version',
      'scored_at',
    ].join(', '))
    .eq('company_id', params.companyId)
    .order('priority_rank', { ascending: true })
    .limit(params.limit ?? 50);

  if (params.reportTier) {
    query = query.eq('report_tier', params.reportTier);
  }
  if (params.mode) {
    query = query.eq('prioritization_mode', params.mode);
  }

  const { data: queueRows, error: queueError } = await query;
  if (queueError) {
    throw new Error(`Failed to list prioritized decisions: ${queueError.message}`);
  }

  const decisionIds = (queueRows ?? []).map((row) => (row as unknown as { decision_id: string }).decision_id);
  if (decisionIds.length === 0) return [];

  const { data: decisions, error: decisionError } = await supabase
    .from('decision_objects')
    .select(DECISION_SELECT_FIELDS)
    .eq('company_id', params.companyId)
    .in('id', decisionIds);

  if (decisionError) {
    throw new Error(`Failed to load prioritized decision details: ${decisionError.message}`);
  }

  const byId = new Map((decisions ?? []).map((row) => [String((row as unknown as DecisionRow).id), row as unknown as DecisionRow]));

  return (queueRows ?? [])
    .map((row) => {
      const r = row as unknown as Record<string, unknown>;
      const decision = byId.get(String(r.decision_id));
      if (!decision) return null;

      return {
        decision_id: String(r.decision_id),
        company_id: String(r.company_id),
        report_tier: r.report_tier as 'snapshot' | 'growth' | 'deep',
        priority_score: Number(r.priority_score ?? 0),
        priority_rank: Number(r.priority_rank ?? 0),
        score_impact: Number(r.score_impact ?? 0),
        score_confidence: Number(r.score_confidence ?? 0),
        score_revenue_linkage: Number(r.score_revenue_linkage ?? 0),
        score_urgency: Number(r.score_urgency ?? 0),
        correlation_boost: Number(r.correlation_boost ?? 0),
        priority_rationale: String(r.priority_rationale ?? ''),
        priority_segment: String(r.priority_segment ?? 'strategic') as PrioritySegment,
        prioritization_mode: String(r.prioritization_mode ?? 'growth') as PrioritizationMode,
        playbook: ((r.playbook_json as DecisionPlaybook | undefined) ?? {
          objective: decision.title,
          steps: [],
          estimated_effort: { level: 'medium', score: 50, hours: 12 },
          expected_impact: {
            traffic: Number(decision.impact_revenue ?? 0) * 0.6,
            conversion: Number(decision.impact_conversion ?? 0),
            revenue: Number(decision.impact_revenue ?? 0),
            confidence: Number(decision.confidence_score ?? 0),
          },
          dependencies: [],
        }) as DecisionPlaybook,
        model_version: String(r.model_version ?? PRIORITIZATION_MODEL_VERSION),
        scored_at: String(r.scored_at ?? ''),
        source_service: decision.source_service,
        entity_type: decision.entity_type,
        entity_id: decision.entity_id,
        issue_type: decision.issue_type,
        title: decision.title,
        description: decision.description,
        execution_score: Number(decision.execution_score ?? 0),
        confidence_score: Number(decision.confidence_score ?? 0),
        impact_revenue: Number(decision.impact_revenue ?? 0),
        impact_conversion: Number(decision.impact_conversion ?? 0),
        recommendation: decision.recommendation,
        action_type: decision.action_type,
        status: decision.status,
        created_at: decision.created_at,
      } as PrioritizedDecision;
    })
    .filter((item): item is PrioritizedDecision => Boolean(item));
}
