/** Part 1/2 of marketPulseProductionHardeningService.ts — verbatim split (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';

import { insertValidation, synthesizeTimeline, buildHistoricalTimeline, synthesizeBenchmarkingReadiness, buildBenchmarkingReadiness, buildBenchmarkCohortReadiness, buildOperationalHealth, synthesizeOperationalHealth, buildResilienceStatus, buildAttentionManagement, buildRefinedDigest, buildDegradedContext, buildGovernanceSafety, groupDigestThemes } from './marketPulseProductionHardeningServiceOps';

export function score(value: unknown): number {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function average(values: number[]): number {
  const cleaned = values.filter((value) => Number.isFinite(value));
  return cleaned.length ? Math.round(cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length) : 0;
}

function sum(values: number[]): number {
  return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  } catch {
    return 0;
  }
}

export function dedupeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

export function dateBucket(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function initials(value: unknown): string {
  const words = String(value ?? '')
    .replace(/@.*/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const seed = words.length ? words : ['U'];
  return seed.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || 'U';
}

function displayNameFromUser(user: any, fallbackEmail: string): string {
  const name = String(user?.full_name ?? user?.display_name ?? '').trim();
  if (name) return name;
  const emailPrefix = fallbackEmail.includes('@') ? fallbackEmail.split('@')[0] : fallbackEmail;
  return emailPrefix || 'Unassigned user';
}

async function withTimeout<T>(name: string, work: Promise<T>, timeoutMs = 9000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordObservability(params: {
  companyId?: string | null;
  operationName: string;
  operationStatus?: 'ok' | 'warning' | 'error' | 'degraded';
  durationMs?: number;
  payloadSizeBytes?: number;
  rowCount?: number;
  cacheStatus?: 'hit' | 'miss' | 'stale' | 'not_applicable';
  fallbackUsed?: boolean;
  errorSummary?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ownedDbTable('marketpulse_operational_observability_events').insert({
    company_id: params.companyId ?? null,
    operation_name: params.operationName,
    operation_status: params.operationStatus ?? 'ok',
    duration_ms: params.durationMs ?? null,
    payload_size_bytes: params.payloadSizeBytes ?? null,
    row_count: params.rowCount ?? null,
    cache_status: params.cacheStatus ?? 'not_applicable',
    fallback_used: Boolean(params.fallbackUsed),
    error_summary: params.errorSummary ?? null,
    metadata: params.metadata ?? {},
  });
}

function materialityLevel(severity: number, confidence: number): string {
  const weighted = severity * 0.65 + confidence * 0.35;
  if (weighted >= 78) return 'strategic';
  if (weighted >= 62) return 'significant';
  if (weighted >= 42) return 'moderate';
  return 'informational';
}

function classifyOpportunity(item: any): string | null {
  const text = `${item.summary ?? ''} ${item.why_this_matters ?? ''} ${item.evolution_status ?? ''} ${(item.affected_areas ?? []).join(' ')}`.toLowerCase();
  if (!/(opportunity|tailwind|opening|relief|advantage|demand|growth|stabiliz|improving|positive)/.test(text)) return null;
  if (/funding|investor/.test(text)) return 'funding_momentum';
  if (/talent|workforce|hiring/.test(text)) return 'workforce_availability';
  if (/regulation|compliance/.test(text)) return 'regulatory_clarity';
  if (/technology|cloud|ai/.test(text)) return 'technology_leverage';
  if (/customer|demand|revenue/.test(text)) return 'demand_acceleration';
  if (/competitor|competitive/.test(text)) return 'competitor_weakness';
  if (/cost|margin|pricing/.test(text)) return 'cost_relief';
  return 'market_expansion';
}

export async function loadInputs(companyId: string, options?: { limit?: number; offset?: number }) {
  const limit = Math.max(10, Math.min(100, Number(options?.limit ?? 60)));
  const offset = Math.max(0, Number(options?.offset ?? 0));
  const [
    digest,
    lifecycle,
    escalations,
    threads,
    watchlists,
    comparative,
    opportunities,
    validations,
    timeline,
    benchmarkDimensions,
    benchmarkCohorts,
    benchmarkBaselines,
    benchmarkMappings,
    observability,
    healthSummaries,
    actionLinks,
    decisions,
    annotations,
    routingRules,
  ] = await Promise.all([
    ownedDbTable('marketpulse_digest_items').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).range(offset, offset + limit - 1),
    ownedDbTable('marketpulse_lifecycle_states').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(limit),
    ownedDbTable('marketpulse_escalation_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(30),
    ownedDbTable('marketpulse_investigation_threads').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(limit),
    ownedDbTable('marketpulse_watchlists').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(40),
    ownedDbTable('marketpulse_comparative_intelligence').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_opportunity_intelligence').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_operational_validation_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(30),
    ownedDbTable('marketpulse_historical_timeline_events').select('*').eq('company_id', companyId).order('occurred_at', { ascending: false }).limit(60),
    ownedDbTable('marketpulse_benchmark_dimensions').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_benchmark_cohorts').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_benchmark_baseline_snapshots').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_benchmark_relative_mappings').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_operational_observability_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(60),
    ownedDbTable('marketpulse_operational_health_summaries').select('*').eq('company_id', companyId).order('generated_at', { ascending: false }).limit(10),
    ownedDbTable('marketpulse_intelligence_action_links').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(80),
    ownedDbTable('marketpulse_decision_memory').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_annotations').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_routing_rules').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
  ]);
  return {
    digestItems: digest.data ?? [],
    lifecycle: lifecycle.data ?? [],
    escalations: escalations.data ?? [],
    threads: threads.data ?? [],
    watchlists: watchlists.data ?? [],
    comparative: comparative.data ?? [],
    opportunities: opportunities.data ?? [],
    validations: validations.data ?? [],
    timeline: timeline.data ?? [],
    benchmarkDimensions: benchmarkDimensions.data ?? [],
    benchmarkCohorts: benchmarkCohorts.data ?? [],
    benchmarkBaselines: benchmarkBaselines.data ?? [],
    benchmarkMappings: benchmarkMappings.data ?? [],
    observability: observability.data ?? [],
    healthSummaries: healthSummaries.data ?? [],
    actionLinks: actionLinks.data ?? [],
    decisions: decisions.data ?? [],
    annotations: annotations.data ?? [],
    routingRules: routingRules.data ?? [],
    page: { limit, offset, hasMore: (digest.data ?? []).length === limit },
  };
}

async function synthesizeComparative(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const previous = inputs.comparative[0];
  const currentSeverity = average(inputs.digestItems.slice(0, 20).map((item: any) => score(item.severity)));
  const currentConfidence = average(inputs.digestItems.slice(0, 20).map((item: any) => score(item.confidence)));
  const unresolvedCritical = inputs.threads.filter((thread: any) =>
    thread.priority === 'critical' && !['resolved', 'archived'].includes(thread.investigation_status)
  ).length;
  const heldEscalations = inputs.escalations.filter((event: any) => event.escalation_state === 'held').length;
  const baselineSeverity = score(previous?.current_payload?.average_severity);
  const severityDelta = currentSeverity - baselineSeverity;
  const direction = !previous
    ? 'emerging'
    : severityDelta >= 8
      ? 'worsening'
      : severityDelta <= -8
        ? 'improving'
        : 'stable';
  const materialChangeScore = Math.abs(severityDelta) + Math.abs(currentConfidence - score(previous?.current_payload?.average_confidence)) * 0.3;
  const baseDedupeKey = `view:executive_marketpulse:${direction}`;
  const dedupeKey = materialChangeScore >= 6 ? `${baseDedupeKey}:${dateBucket()}` : baseDedupeKey;
  const existing = inputs.comparative.find((row: any) => row.dedupe_key === dedupeKey);
  if (existing && materialChangeScore < 6) {
    const result = await ownedDbTable('marketpulse_comparative_intelligence')
      .update({
        current_payload: {
          ...(existing.current_payload ?? {}),
          average_severity: currentSeverity,
          average_confidence: currentConfidence,
          unresolved_critical_investigations: unresolvedCritical,
          held_escalations: heldEscalations,
          digest_item_count: inputs.digestItems.length,
        },
        evidence_count: inputs.digestItems.length + inputs.escalations.length + inputs.threads.length,
        confidence: currentConfidence,
        material_change_score: materialChangeScore,
        coalesced_count: Number(existing.coalesced_count ?? 1) + 1,
        last_coalesced_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    return result.data ?? existing;
  }
  const result = await ownedDbTable('marketpulse_comparative_intelligence').insert({
    company_id: companyId,
    comparison_type: 'view',
    comparison_subject: 'executive_marketpulse',
    baseline_payload: previous?.current_payload ?? {},
    current_payload: {
      average_severity: currentSeverity,
      average_confidence: currentConfidence,
      unresolved_critical_investigations: unresolvedCritical,
      held_escalations: heldEscalations,
      digest_item_count: inputs.digestItems.length,
    },
    material_change_summary: direction === 'worsening'
      ? 'Material MarketPulse severity increased since the prior comparison snapshot.'
      : direction === 'improving'
        ? 'Material MarketPulse severity eased since the prior comparison snapshot.'
        : direction === 'emerging'
          ? 'Initial MarketPulse comparative baseline created.'
          : 'No material severity movement since the prior comparison snapshot.',
    change_direction: direction,
    severity_delta: severityDelta,
    confidence_delta: currentConfidence - score(previous?.current_payload?.average_confidence),
    evidence_count: inputs.digestItems.length + inputs.escalations.length + inputs.threads.length,
    confidence: currentConfidence,
    dedupe_key: dedupeKey,
    material_change_score: materialChangeScore,
    comparison_window: 'latest',
    peer_relative_readiness: {
      status: 'ready_for_future_mapping',
      required_inputs: ['peer_group', 'industry_baseline', 'sector_taxonomy'],
    },
    industry_baseline_readiness: {
      status: 'schema_ready_not_benchmarked',
      benchmark_implemented: false,
    },
    sector_relative_interpretation: {
      interpretation: direction,
      predictive: false,
      rationale: 'Current severity delta compared with prior MarketPulse comparative snapshot.',
    },
  }).select('*').single();
  return result.data ?? null;
}

async function synthesizeOpportunities(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const candidates = inputs.digestItems
    .map((item: any) => ({ item, opportunityType: classifyOpportunity(item) }))
    .filter((entry: any) => entry.opportunityType)
    .slice(0, 8);
  const persisted: any[] = [];
  for (const { item, opportunityType } of candidates) {
    const text = JSON.stringify(item).toLowerCase();
    const alignedWatchlists = inputs.watchlists.filter((watch: any) =>
      !watch.muted && String(watch.watchlist_value ?? '').trim() && text.includes(String(watch.watchlist_value).toLowerCase())
    );
    const evidenceCount = Object.values(item.supporting_evidence ?? {}).reduce<number>((sum, value) => sum + asArray(value).length, 0);
    const degradedContext = score(item.confidence) < 45 || evidenceCount < 2;
    const result = await ownedDbTable('marketpulse_opportunity_intelligence').insert({
      company_id: companyId,
      opportunity_type: opportunityType,
      title: item.summary ?? 'MarketPulse opportunity signal',
      summary: item.why_this_matters ?? item.summary ?? 'MarketPulse opportunity surfaced from non-predictive digest evidence.',
      source_entity_type: item.item_type ?? 'digest_item',
      source_entity_id: item.source_pressure_id ?? item.source_impact_id ?? item.source_consequence_id ?? item.source_narrative_id ?? item.id,
      opportunity_direction: /mixed|uncertain|watch/.test(String(item.evolution_status ?? '').toLowerCase()) ? 'watch' : 'positive',
      materiality_level: materialityLevel(score(item.severity), score(item.confidence)),
      confidence: score(item.confidence),
      supporting_evidence: {
        digest_item_id: item.id,
        evidence_count: evidenceCount,
        affected_areas: item.affected_areas ?? [],
      },
      watchlist_alignment: {
        aligned_watchlists: alignedWatchlists.map((watch: any) => ({
          type: watch.watchlist_type,
          value: watch.watchlist_value,
          priority: watch.priority_level,
        })),
      },
      quality_payload: {
        evidence_derived: true,
        non_predictive: true,
        weak_signal_suppressed: degradedContext,
        confidence_floor_met: score(item.confidence) >= 45,
      },
      degraded_context: degradedContext,
      degradation_reasons: [
        ...(score(item.confidence) < 45 ? ['low_confidence'] : []),
        ...(evidenceCount < 2 ? ['low_corroboration'] : []),
      ],
      lifecycle_state: item.lifecycle_state ?? 'new',
    }).select('*').single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

export async function listMarketPulseAssignablePeople(companyId: string, search?: string | null) {
  const roles = await ownedDbTable('user_company_roles')
    .select('user_id, role, status, accepted_at, created_at')
    .eq('company_id', companyId)
    .limit(80);
  const rows = (roles.data ?? []).filter((row: any) => row.status !== 'deactivated');
  const userIds = rows.map((row: any) => row.user_id).filter(Boolean);
  const users = userIds.length
    ? await ownedDbTable('users').select('id, email, full_name, department').in('id', userIds)
    : { data: [] };
  const userById = new Map((users.data ?? []).map((user: any) => [user.id, user]));
  const workload = new Map<string, number>();
  const assigned = userIds.length
    ? await ownedDbTable('marketpulse_investigation_threads')
      .select('assigned_to')
      .eq('company_id', companyId)
      .in('assigned_to', userIds)
      .not('investigation_status', 'in', '("resolved","archived")')
      .limit(500)
    : { data: [] };
  for (const row of assigned.data ?? []) {
    if (row.assigned_to) workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
  }
  const query = String(search ?? '').toLowerCase().trim();
  return rows
    .map((row: any) => {
      const user = userById.get(row.user_id) ?? {};
      const email = String(user.email ?? row.user_id ?? '');
      const displayName = displayNameFromUser(user, email);
      const department = user.department || roleToDepartment(row.role);
      const role = row.role ?? 'MEMBER';
      return {
        id: row.user_id,
        label: displayName,
        display_name: displayName,
        email,
        initials: initials(displayName || email),
        role,
        department,
        leadership: /ADMIN|SUPER|OWNER|LEAD/i.test(String(role)),
        active_investigation_count: workload.get(row.user_id) ?? 0,
        accountability_label: `${displayName} - ${labelRole(role)} - ${labelRole(department)}`,
        assignment_eligible: Boolean(row.user_id),
      };
    })
    .filter((person: any) => !query || `${person.label} ${person.email} ${person.role} ${person.department}`.toLowerCase().includes(query))
    .slice(0, 25);
}

function labelRole(value: string | null | undefined): string {
  const raw = String(value ?? '').replace(/_/g, ' ').trim();
  return raw ? raw.replace(/\b\w/g, (char) => char.toUpperCase()) : 'General';
}

function roleToDepartment(role: string | null | undefined): string {
  const normalized = String(role ?? '').toUpperCase();
  if (/ADMIN|SUPER/.test(normalized)) return 'leadership';
  if (/LEGAL|COMPLIANCE/.test(normalized)) return 'legal_compliance';
  if (/HR|TALENT/.test(normalized)) return 'hr_talent';
  if (/ENGINEER|OPS|TECH/.test(normalized)) return 'engineering_operations';
  if (/FINANCE|INVESTOR/.test(normalized)) return 'finance_investor_relations';
  return 'general';
}

export async function synthesizeMarketPulseProductionHardening(companyId: string) {
  const started = Date.now();
  const inputs = await loadInputs(companyId);
  const stageWarnings: string[] = [];
  const runStage = async <T>(name: string, fallback: T, work: Promise<T>): Promise<T> => {
    try {
      return await withTimeout(name, work, 9000);
    } catch (error: any) {
      stageWarnings.push(`${name}:${error?.message ?? 'failed'}`);
      await recordObservability({
        companyId,
        operationName: `marketpulse.production_hardening.${name}`,
        operationStatus: 'degraded',
        fallbackUsed: true,
        errorSummary: error?.message ?? `${name} failed`,
      }).catch(() => undefined);
      return fallback;
    }
  };
  const comparative = await runStage('comparative_synthesis', null, synthesizeComparative(companyId, inputs));
  const opportunities = await runStage('opportunity_synthesis', [], synthesizeOpportunities(companyId, inputs));
  const validation = await runStage('validation_synthesis', [], synthesizeOperationalValidation(companyId, inputs));
  const timeline = await runStage('timeline_synthesis', [], synthesizeTimeline(companyId, inputs));
  const benchmarking = await runStage('benchmarking_readiness', null, synthesizeBenchmarkingReadiness(companyId, inputs));
  const health = await runStage('operational_health', null, synthesizeOperationalHealth(companyId, inputs, stageWarnings));
  const payload = { comparative, opportunities, validation, timeline, benchmarking, health };
  await recordObservability({
    companyId,
    operationName: 'marketpulse.production_hardening.synthesize',
    operationStatus: stageWarnings.length ? 'warning' : 'ok',
    durationMs: Date.now() - started,
    payloadSizeBytes: jsonSize(payload),
    rowCount: (opportunities?.length ?? 0) + (validation?.length ?? 0) + (timeline?.length ?? 0),
    metadata: { predictive: false, autonomous_actions: false, stage_warnings: stageWarnings },
  }).catch(() => undefined);
  return payload;
}

export async function getMarketPulseProductionHardening(companyId: string, options?: { limit?: number; offset?: number }) {
  const started = Date.now();
  try {
    const inputs = await loadInputs(companyId, options);
    const payload = {
    comparativeIntelligence: inputs.comparative,
    opportunityIntelligence: inputs.opportunities,
    benchmarkingReadiness: buildBenchmarkingReadiness(inputs),
    benchmarkingCohorts: buildBenchmarkCohortReadiness(inputs),
    historicalTimeline: buildHistoricalTimeline(inputs),
    validationEvents: inputs.validations,
    operationalHealth: buildOperationalHealth(inputs),
    resilience: buildResilienceStatus(inputs),
    pagination: inputs.page,
    executiveOptimization: {
      unresolvedCriticalInvestigations: inputs.threads.filter((thread: any) =>
        thread.priority === 'critical' && !['resolved', 'archived'].includes(thread.investigation_status)
      ),
      heldEscalations: inputs.escalations.filter((event: any) => event.escalation_state === 'held'),
      lowConfidenceNoise: inputs.digestItems.filter((item: any) => score(item.confidence) < 35).slice(0, 10),
      groupedThemes: groupDigestThemes(inputs.digestItems),
      refinedDigest: buildRefinedDigest(inputs),
      degradedContext: buildDegradedContext(inputs),
      governanceSafety: buildGovernanceSafety(inputs),
      attentionManagement: buildAttentionManagement(inputs),
    },
  };
    await recordObservability({
      companyId,
      operationName: 'marketpulse.production_hardening.retrieve',
      durationMs: Date.now() - started,
      payloadSizeBytes: jsonSize(payload),
      rowCount: inputs.digestItems.length + inputs.timeline.length + inputs.validations.length,
      cacheStatus: 'miss',
      metadata: { limit: inputs.page.limit, offset: inputs.page.offset },
    }).catch(() => undefined);
    return payload;
  } catch (error: any) {
    await recordObservability({
      companyId,
      operationName: 'marketpulse.production_hardening.retrieve',
      operationStatus: 'degraded',
      durationMs: Date.now() - started,
      fallbackUsed: true,
      errorSummary: error?.message ?? 'MarketPulse production hardening retrieval failed',
    }).catch(() => undefined);
    return {
      comparativeIntelligence: [],
      opportunityIntelligence: [],
      benchmarkingReadiness: { status: 'degraded', fallback_used: true },
      benchmarkingCohorts: [],
      historicalTimeline: [],
      validationEvents: [],
      operationalHealth: { health_status: 'degraded', warnings: ['retrieval_failed'], metrics: {} },
      resilience: { partial_load: true, stale_safe_rendering: true, bounded_payload: true },
      pagination: { limit: options?.limit ?? 60, offset: options?.offset ?? 0, hasMore: false },
      executiveOptimization: {
        unresolvedCriticalInvestigations: [],
        heldEscalations: [],
        lowConfidenceNoise: [],
        groupedThemes: [],
        refinedDigest: {},
        degradedContext: { degraded: true, reasons: ['retrieval_failed'], handling: { fallback_used: true } },
        governanceSafety: {},
        attentionManagement: {},
      },
    };
  }
}

async function synthesizeOperationalValidation(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const events: any[] = [];
  const now = Date.now();
  const staleThreads = inputs.threads.filter((thread: any) =>
    !['resolved', 'archived'].includes(thread.investigation_status) &&
    thread.stale_at &&
    new Date(thread.stale_at).getTime() < now
  );
  const orphanThreads = inputs.threads.filter((thread: any) =>
    ['open', 'investigating', 'blocked'].includes(thread.investigation_status) &&
    !thread.assigned_to &&
    !thread.assigned_department
  );
  const staleEscalations = inputs.escalations.filter((event: any) =>
    event.escalation_state === 'escalated' &&
    event.created_at &&
    now - new Date(event.created_at).getTime() > 7 * 24 * 60 * 60 * 1000
  );
  const linkedTargets = new Set(inputs.actionLinks.map((link: any) => `${link.target_artifact_type}:${link.target_artifact_id}`));
  const invalidDecisionReferences = inputs.decisions.filter((decision: any) =>
    !linkedTargets.has(`decision_memory:${decision.id}`) && decision.entity_type !== 'investigation'
  );
  const visibilityConflicts = inputs.annotations.filter((annotation: any) =>
    annotation.visibility === 'leadership' && !['strategic_note', 'leadership_concern', 'interpretation_note'].includes(annotation.annotation_type)
  );
  const timelineSpam = inputs.timeline.filter((event: any) => Number(event.coalesced_count ?? 1) >= 8);
  const recentEscalations = inputs.escalations.filter((event: any) =>
    event.created_at && now - new Date(event.created_at).getTime() < 24 * 60 * 60 * 1000
  );
  const lowSampleCohorts = inputs.benchmarkCohorts.filter((cohort: any) =>
    Number(cohort.sample_size ?? 0) < 5 || Number(cohort.confidence ?? 0) < 45
  );
  const routingGaps = inputs.digestItems.filter((item: any) =>
    score(item.severity) >= 75 &&
    !inputs.routingRules.some((rule: any) =>
      asArray<string>(item.affected_areas).some((area) => String(area).toLowerCase().includes(String(rule.trigger_value ?? '').toLowerCase()))
    )
  );
  for (const thread of staleThreads.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'orphan_investigation', thread, 'medium', 'Unresolved investigation is stale.', 'Assign an owner, mark monitoring, or resolve the thread.'));
  }
  for (const thread of orphanThreads.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'orphan_investigation', thread, 'high', 'Investigation has no accountable owner or department.', 'Assign a person or department before escalating.'));
  }
  for (const escalation of staleEscalations.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'stale_escalation', escalation, 'high', 'Escalation has not changed state in over seven days.', 'Review whether it should be monitored, resolved, or re-escalated.'));
  }
  for (const decision of invalidDecisionReferences.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'invalid_decision_reference', decision, 'medium', 'Decision memory is missing an intelligence-action trace link.', 'Repair the action link before relying on this decision in retrospectives.'));
  }
  for (const annotation of visibilityConflicts.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'annotation_visibility_conflict', annotation, 'medium', 'Leadership-visible annotation uses a low-specificity annotation type.', 'Review visibility and annotation type for permission-aware presentation.'));
  }
  for (const event of timelineSpam.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'timeline_spam', event, 'medium', 'Timeline event has been coalesced many times.', 'Keep the event collapsed unless a material severity or lifecycle change occurs.'));
  }
  if (recentEscalations.length >= 8) {
    events.push(await insertValidation(companyId, 'escalation_storm', recentEscalations[0], 'critical', 'Escalation volume is unusually high in the last 24 hours.', 'Group related escalations and hold repeated low-materiality alerts.'));
  }
  for (const cohort of lowSampleCohorts.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'low_sample_benchmark', cohort, 'low', 'Benchmark cohort is not ready for interpretation.', 'Require more sample evidence or human confirmation before future benchmarking.'));
  }
  for (const item of routingGaps.slice(0, 10)) {
    events.push(await insertValidation(companyId, 'routing_inconsistency', item, 'medium', 'High-severity digest item has no matching routing rule.', 'Add or confirm routing for the affected business area.'));
  }
  return events.filter(Boolean);
}

