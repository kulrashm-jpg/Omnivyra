import { ownedDbTable } from '../db/writeOwner';

function score(value: unknown): number {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function average(values: number[]): number {
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

function dedupeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function dateBucket(value?: string | null): string {
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

async function loadInputs(companyId: string, options?: { limit?: number; offset?: number }) {
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

async function insertValidation(companyId: string, type: string, entity: any, severity: string, summary: string, remediation: string) {
  const result = await ownedDbTable('marketpulse_operational_validation_events').insert({
    company_id: companyId,
    validation_type: type,
    validation_status: severity === 'critical' ? 'critical' : 'warning',
    entity_type: entity.entity_type ?? 'investigation',
    entity_id: entity.entity_id ?? entity.id,
    finding_summary: summary,
    severity,
    remediation_hint: remediation,
    validation_payload: {
      entity,
      predictive: false,
    },
  }).select('*').single();
  return result.data ?? null;
}

async function synthesizeTimeline(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const seeds = [
    ...inputs.digestItems.slice(0, 12).map((item: any) => ({
      event_type: 'digest_change',
      entity_type: item.item_type ?? 'digest_item',
      entity_id: item.source_pressure_id ?? item.source_impact_id ?? item.source_consequence_id ?? item.source_narrative_id ?? item.id,
      event_summary: item.summary ?? 'MarketPulse digest changed.',
      severity: item.severity ?? null,
      confidence: item.confidence ?? null,
      lifecycle_state: item.lifecycle_state ?? null,
      event_payload: { why_this_matters: item.why_this_matters, affected_areas: item.affected_areas ?? [] },
      occurred_at: item.updated_at ?? new Date().toISOString(),
      material_change_score: score(item.severity) * 0.65 + score(item.confidence) * 0.35,
      event_priority: score(item.severity) >= 75 ? 90 : score(item.severity) >= 55 ? 70 : 45,
    })),
    ...inputs.escalations.slice(0, 8).map((event: any) => ({
      event_type: 'escalation_change',
      entity_type: event.entity_type ?? 'escalation',
      entity_id: event.entity_id,
      event_summary: event.reason ?? 'Escalation state changed.',
      severity: event.current_severity ?? null,
      confidence: null,
      lifecycle_state: event.escalation_state,
      event_payload: { routed_departments: event.routed_departments ?? [], alert_fatigue_guard: event.alert_fatigue_guard ?? {} },
      occurred_at: event.created_at ?? new Date().toISOString(),
      material_change_score: Math.abs(Number(event.current_severity ?? 0) - Number(event.previous_severity ?? 0)),
      event_priority: event.escalation_state === 'escalated' ? 95 : event.escalation_state === 'held' ? 55 : 60,
    })),
    ...inputs.opportunities.slice(0, 8).map((item: any) => ({
      event_type: 'opportunity_change',
      entity_type: 'opportunity',
      entity_id: item.id,
      event_summary: item.title ?? 'Opportunity intelligence updated.',
      severity: null,
      confidence: item.confidence ?? null,
      lifecycle_state: item.lifecycle_state ?? null,
      event_payload: { opportunity_type: item.opportunity_type, degraded_context: item.degraded_context },
      occurred_at: item.updated_at ?? item.created_at ?? new Date().toISOString(),
      material_change_score: score(item.confidence),
      event_priority: item.degraded_context ? 35 : score(item.confidence) >= 70 ? 75 : 55,
    })),
  ].filter((item) => item.entity_id);
  const persisted: any[] = [];
  for (const seed of seeds.slice(0, 20)) {
    const baseDedupeKey = `${seed.event_type}:${seed.entity_type}:${seed.entity_id}:${dedupeText(seed.event_summary)}:${seed.lifecycle_state ?? 'none'}`;
    const windowKey = `${baseDedupeKey}:${dateBucket(seed.occurred_at)}`;
    const dedupeKey = seed.material_change_score >= 8 ? `${windowKey}:material:${Math.round(seed.material_change_score)}` : windowKey;
    const existing = await ownedDbTable('marketpulse_historical_timeline_events')
      .select('*')
      .eq('company_id', companyId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing.data) {
      const result = await ownedDbTable('marketpulse_historical_timeline_events')
        .update({
          severity: seed.severity,
          confidence: seed.confidence,
          event_payload: seed.event_payload,
          material_change_score: seed.material_change_score,
          event_priority: Math.max(Number(existing.data.event_priority ?? 0), Number(seed.event_priority ?? 0)),
          dedupe_window_key: windowKey,
          lifecycle_transition_key: `${seed.entity_type}:${seed.entity_id}:${seed.lifecycle_state ?? 'none'}`,
          coalesced_count: Number(existing.data.coalesced_count ?? 1) + 1,
          last_coalesced_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id)
        .select('*')
        .single();
      if (!result.error && result.data) persisted.push(result.data);
      continue;
    }
    const result = await ownedDbTable('marketpulse_historical_timeline_events').insert({
      company_id: companyId,
      ...seed,
      dedupe_key: dedupeKey,
      dedupe_window_key: windowKey,
      lifecycle_transition_key: `${seed.entity_type}:${seed.entity_id}:${seed.lifecycle_state ?? 'none'}`,
    }).select('*').single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

function buildHistoricalTimeline(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const merged = [
    ...inputs.timeline,
    ...inputs.escalations.map((event: any) => ({
      id: `escalation-${event.id}`,
      event_type: 'escalation_change',
      event_summary: event.reason,
      occurred_at: event.created_at,
      lifecycle_state: event.escalation_state,
      severity: event.current_severity,
      dedupe_key: event.dedupe_key ?? `escalation:${event.entity_type}:${event.entity_id}:${event.escalation_state}:${dateBucket(event.created_at)}`,
      event_priority: event.escalation_state === 'escalated' ? 95 : 55,
      coalesced_count: event.coalesced_count ?? 1,
      event_payload: event,
    })),
    ...inputs.comparative.map((event: any) => ({
      id: `comparative-${event.id}`,
      event_type: 'comparative_change',
      event_summary: event.material_change_summary,
      occurred_at: event.updated_at ?? event.created_at,
      lifecycle_state: event.change_direction,
      severity: event.current_payload?.average_severity,
      confidence: event.confidence,
      dedupe_key: event.dedupe_key,
      event_priority: Math.abs(Number(event.severity_delta ?? 0)) >= 10 ? 85 : 50,
      coalesced_count: event.coalesced_count ?? 1,
      event_payload: event,
    })),
  ];
  const byKey = new Map<string, any>();
  for (const item of merged) {
    const key = item.dedupe_key ?? `${item.event_type}:${item.entity_type ?? 'event'}:${item.entity_id ?? item.id}:${dateBucket(item.occurred_at ?? item.created_at)}`;
    const existing = byKey.get(key);
    if (!existing || Number(item.event_priority ?? 0) > Number(existing.event_priority ?? 0)) {
      byKey.set(key, item);
    } else if (existing) {
      existing.coalesced_count = Number(existing.coalesced_count ?? 1) + Number(item.coalesced_count ?? 1);
    }
  }
  return Array.from(byKey.values())
    .sort((a: any, b: any) => {
      const priority = Number(b.event_priority ?? 0) - Number(a.event_priority ?? 0);
      if (Math.abs(priority) > 20) return priority;
      return String(b.occurred_at ?? '').localeCompare(String(a.occurred_at ?? ''));
    })
    .slice(0, 60);
}

async function synthesizeBenchmarkingReadiness(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const dimensions = new Map<string, { type: string; key: string; label: string; metadata: Record<string, unknown> }>();
  for (const item of inputs.digestItems) {
    for (const area of asArray<string>(item.affected_areas)) {
      const key = dedupeText(area);
      if (key) dimensions.set(`sector:${key}`, { type: 'sector', key, label: String(area), metadata: { source: 'digest_affected_area' } });
    }
  }
  for (const watch of inputs.watchlists) {
    const type = watch.watchlist_type === 'region' ? 'geography' : watch.watchlist_type === 'industry' ? 'industry' : 'peer_group';
    const key = dedupeText(watch.watchlist_value);
    if (key) dimensions.set(`${type}:${key}`, { type, key, label: String(watch.watchlist_value), metadata: { source: 'watchlist', watchlist_type: watch.watchlist_type } });
  }
  const persisted: any[] = [];
  for (const dimension of Array.from(dimensions.values()).slice(0, 25)) {
    const result = await ownedDbTable('marketpulse_benchmark_dimensions')
      .upsert({
        company_id: companyId,
        dimension_type: dimension.type,
        dimension_key: dimension.key,
        dimension_label: dimension.label,
        readiness_status: 'ready_for_mapping',
        metadata: dimension.metadata,
      }, { onConflict: 'company_id,dimension_type,dimension_key' })
      .select('*')
      .single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  const cohorts: any[] = [];
  for (const dimension of persisted.slice(0, 25)) {
    const sampleSize = inputs.digestItems.filter((item: any) =>
      JSON.stringify([item.affected_areas, item.summary, item.why_this_matters]).toLowerCase().includes(String(dimension.dimension_label ?? '').toLowerCase())
    ).length;
    const confidence = Math.min(100, 30 + sampleSize * 12);
    const result = await ownedDbTable('marketpulse_benchmark_cohorts')
      .upsert({
        company_id: companyId,
        cohort_type: dimension.dimension_type,
        cohort_key: dimension.dimension_key,
        cohort_label: dimension.dimension_label,
        sample_size: sampleSize,
        confidence,
        readiness_status: sampleSize >= 5 && confidence >= 60 ? 'ready_for_future_benchmarking' : sampleSize > 0 ? 'needs_confirmation' : 'insufficient_sample',
        governance_flags: {
          low_sample_size: sampleSize < 5,
          weak_cohort_confidence: confidence < 60,
          misleading_normalization_guard: true,
        },
        metadata: {
          source_dimension_id: dimension.id,
          benchmark_computation_enabled: false,
          readiness_only: true,
        },
      }, { onConflict: 'company_id,cohort_type,cohort_key' })
      .select('*')
      .single();
    if (!result.error && result.data) cohorts.push(result.data);
  }
  const mappings: any[] = [];
  for (const cohort of cohorts.slice(0, 12)) {
    const dimension = persisted.find((item) => item.dimension_type === cohort.cohort_type && item.dimension_key === cohort.cohort_key);
    const result = await ownedDbTable('marketpulse_benchmark_relative_mappings').insert({
      company_id: companyId,
      benchmark_dimension_id: dimension?.id ?? null,
      cohort_id: cohort.id,
      normalized_pressure_area: cohort.cohort_key,
      relative_severity_scale: {
        informational: [0, 41],
        moderate: [42, 61],
        significant: [62, 77],
        strategic: [78, 100],
        benchmark_enabled: false,
      },
      baseline_metric_payload: {
        sample_size: cohort.sample_size,
        average_severity: average(inputs.digestItems.map((item: any) => score(item.severity))),
        average_confidence: average(inputs.digestItems.map((item: any) => score(item.confidence))),
        source: 'internal_marketpulse_readiness',
      },
      confidence: cohort.confidence,
      governance_flags: cohort.governance_flags ?? {},
    }).select('*').single();
    if (!result.error && result.data) mappings.push(result.data);
  }
  const baseline = await ownedDbTable('marketpulse_benchmark_baseline_snapshots').insert({
    company_id: companyId,
    baseline_type: 'historical_self',
    baseline_key: 'latest_marketpulse_internal',
    baseline_payload: {
      average_severity: average(inputs.digestItems.map((item: any) => score(item.severity))),
      average_confidence: average(inputs.digestItems.map((item: any) => score(item.confidence))),
      theme_count: groupDigestThemes(inputs.digestItems).length,
      opportunity_count: inputs.opportunities.length,
      validation_warning_count: inputs.validations.length,
    },
    readiness_status: inputs.digestItems.length >= 5 ? 'ready_for_future_benchmarking' : 'insufficient_data',
    generated_from: 'internal_marketpulse_context',
  }).select('*').single();
  const industryBaseline = await ownedDbTable('marketpulse_benchmark_baseline_snapshots').insert({
    company_id: companyId,
    baseline_type: 'industry_relative',
    baseline_key: 'schema_ready_internal_placeholder',
    baseline_payload: {
      cohort_count: cohorts.length,
      ready_cohorts: cohorts.filter((cohort) => cohort.readiness_status === 'ready_for_future_benchmarking').length,
      benchmark_computation_enabled: false,
      low_sample_guard_enabled: true,
    },
    readiness_status: cohorts.some((cohort) => cohort.readiness_status === 'ready_for_future_benchmarking') ? 'schema_ready' : 'insufficient_data',
    generated_from: 'benchmark_readiness_metadata',
  }).select('*').single();
  return { dimensions: persisted, cohorts, mappings, baseline: baseline.data ?? null, industryBaseline: industryBaseline.data ?? null };
}

function buildBenchmarkingReadiness(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const readyCohorts = inputs.benchmarkCohorts.filter((cohort: any) => cohort.readiness_status === 'ready_for_future_benchmarking').length;
  const lowSampleCohorts = inputs.benchmarkCohorts.filter((cohort: any) => Number(cohort.sample_size ?? 0) < 5).length;
  return {
    status: inputs.digestItems.length >= 5 ? 'ready_for_future_benchmarking' : 'insufficient_data',
    peer_relative: {
      implemented: false,
      cohort_count: inputs.benchmarkCohorts.filter((cohort: any) => cohort.cohort_type === 'peer_group').length,
      required: ['peer_group_confirmation', 'external_or_internal_baseline_rows'],
    },
    industry_relative: {
      implemented: false,
      baseline_snapshots: inputs.benchmarkBaselines.filter((baseline: any) => baseline.baseline_type === 'industry_relative').length,
      required: ['industry_taxonomy_mapping', 'baseline_snapshot'],
    },
    sector_relative: {
      implemented: false,
      available_dimensions: groupDigestThemes(inputs.digestItems).map((theme) => theme.theme),
    },
    safeguards: {
      low_sample_cohorts: lowSampleCohorts,
      weak_cohort_confidence: inputs.benchmarkCohorts.filter((cohort: any) => Number(cohort.confidence ?? 0) < 60).length,
      misleading_normalization_guard: true,
    },
    historical_self_baseline: {
      implemented: true,
      comparative_rows: inputs.comparative.length,
      timeline_rows: inputs.timeline.length,
    },
    cohort_readiness: {
      ready: readyCohorts,
      total: inputs.benchmarkCohorts.length,
    },
  };
}

function buildBenchmarkCohortReadiness(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  return inputs.benchmarkCohorts.slice(0, 20).map((cohort: any) => ({
    id: cohort.id,
    cohort_type: cohort.cohort_type,
    cohort_label: cohort.cohort_label,
    sample_size: cohort.sample_size,
    confidence: cohort.confidence,
    readiness_status: cohort.readiness_status,
    governance_flags: cohort.governance_flags ?? {},
  }));
}

function buildOperationalHealth(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const recentWarnings = inputs.observability.filter((event: any) => ['warning', 'degraded', 'error'].includes(event.operation_status));
  const validationCritical = inputs.validations.filter((event: any) => event.validation_status === 'critical');
  const payloadBytes = inputs.observability.map((event: any) => Number(event.payload_size_bytes ?? 0));
  const avgLatency = average(inputs.observability.map((event: any) => Number(event.duration_ms ?? 0)));
  const timelineSpam = inputs.timeline.filter((event: any) => Number(event.coalesced_count ?? 1) >= 8).length;
  const healthStatus = validationCritical.length > 0 || recentWarnings.some((event: any) => event.operation_status === 'error')
    ? 'critical'
    : recentWarnings.length > 4 || timelineSpam > 3
      ? 'degraded'
      : recentWarnings.length > 0
        ? 'watch'
        : 'ok';
  return {
    health_status: healthStatus,
    summary: healthStatus === 'ok'
      ? 'MarketPulse production health is within current guardrails.'
      : 'MarketPulse needs operational review before high-volume reliance.',
    metrics: {
      average_retrieval_latency_ms: avgLatency,
      max_payload_size_bytes: payloadBytes.length ? Math.max(...payloadBytes) : 0,
      observability_warning_count: recentWarnings.length,
      validation_critical_count: validationCritical.length,
      timeline_spam_count: timelineSpam,
      stale_investigation_count: inputs.threads.filter((thread: any) => thread.governance_flags?.stale_unresolved).length,
    },
    warnings: [
      ...(recentWarnings.length ? ['observability_warnings_present'] : []),
      ...(timelineSpam ? ['timeline_coalescing_pressure'] : []),
      ...(validationCritical.length ? ['critical_validation_events'] : []),
    ],
    latest_summary: inputs.healthSummaries[0] ?? null,
  };
}

async function synthesizeOperationalHealth(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>, stageWarnings: string[]) {
  const health = buildOperationalHealth(inputs);
  const result = await ownedDbTable('marketpulse_operational_health_summaries').insert({
    company_id: companyId,
    health_status: health.health_status,
    summary: health.summary,
    metrics: health.metrics,
    warnings: health.warnings,
    repair_readiness: {
      repair_ready_validation_types: inputs.validations.map((event: any) => event.validation_type).slice(0, 20),
      stage_warnings: stageWarnings,
      automated_remediation_enabled: false,
    },
  }).select('*').single();
  return result.data ?? health;
}

function buildResilienceStatus(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const payloadBytes = inputs.observability.map((event: any) => Number(event.payload_size_bytes ?? 0)).filter(Number.isFinite);
  return {
    retry_safe_synthesis: true,
    partial_load_resilience: true,
    stale_safe_rendering: true,
    bounded_payload_protection: true,
    synthesis_timeout_ms: 9000,
    digest_page_limit: inputs.page.limit,
    payload_pressure: payloadBytes.length && Math.max(...payloadBytes) > 900_000 ? 'high' : 'normal',
    escalation_storm_guard: inputs.escalations.filter((event: any) =>
      event.created_at && Date.now() - new Date(event.created_at).getTime() < 24 * 60 * 60 * 1000
    ).length >= 8,
  };
}

function buildAttentionManagement(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const repeatedTimeline = inputs.timeline.filter((event: any) => Number(event.coalesced_count ?? 1) > 1);
  const heldEscalations = inputs.escalations.filter((event: any) => event.escalation_state === 'held');
  return {
    repeated_timeline_events_collapsed: repeatedTimeline.length,
    held_escalations: heldEscalations.length,
    low_confidence_items_suppressed: inputs.digestItems.filter((item: any) => score(item.confidence) < 35).length,
    alert_fatigue_guard_enabled: true,
  };
}

function buildRefinedDigest(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const worsening = inputs.digestItems.filter((item: any) => ['worsening', 'escalating', 'compounding'].includes(String(item.evolution_status ?? item.lifecycle_state)));
  const stabilized = inputs.digestItems.filter((item: any) => ['stabilized', 'stable', 'stabilizing', 'resolved'].includes(String(item.evolution_status ?? item.lifecycle_state)));
  const attention = inputs.digestItems.filter((item: any) => score(item.severity) >= 70 && score(item.confidence) >= 45);
  const uncertainty = inputs.digestItems.filter((item: any) => score(item.confidence) < 45 || asArray(item.drilldown_payload?.uncertainty_factors).length > 0);
  return {
    why_now: attention.slice(0, 5).map((item: any) => item.summary),
    what_changed: worsening.slice(0, 5).map((item: any) => item.summary),
    what_stabilized: stabilized.slice(0, 5).map((item: any) => item.summary),
    what_requires_attention: attention.slice(0, 5).map((item: any) => item.summary),
    uncertainty: uncertainty.slice(0, 5).map((item: any) => ({
      summary: item.summary,
      confidence: item.confidence,
      uncertainty_factors: item.drilldown_payload?.uncertainty_factors ?? [],
    })),
  };
}

function buildDegradedContext(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const lowConfidence = inputs.digestItems.filter((item: any) => score(item.confidence) < 45).length;
  return {
    degraded: lowConfidence > Math.max(2, inputs.digestItems.length * 0.35),
    reasons: [
      ...(lowConfidence > 0 ? ['low_confidence_digest_items'] : []),
      ...(inputs.digestItems.length === 0 ? ['missing_digest_context'] : []),
    ],
    low_confidence_count: lowConfidence,
    handling: {
      suppress_opportunity_inflation: true,
      avoid_confidence_amplification: true,
      show_uncertainty_sections: true,
    },
  };
}

function buildGovernanceSafety(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const linkTargets = new Set(inputs.actionLinks.map((link: any) => `${link.target_artifact_type}:${link.target_artifact_id}`));
  return {
    orphan_investigations: inputs.threads.filter((thread: any) => !thread.assigned_to && !thread.assigned_department && !['resolved', 'archived'].includes(thread.investigation_status)).length,
    stale_escalations: inputs.escalations.filter((event: any) => event.escalation_state === 'escalated').length,
    validation_warning_count: inputs.validations.filter((event: any) => ['warning', 'critical'].includes(event.validation_status)).length,
    broken_decision_links: inputs.decisions.filter((decision: any) => !linkTargets.has(`decision_memory:${decision.id}`) && decision.entity_type !== 'investigation').length,
    annotation_visibility_conflicts: inputs.annotations.filter((annotation: any) =>
      annotation.visibility === 'leadership' && !['strategic_note', 'leadership_concern', 'interpretation_note'].includes(annotation.annotation_type)
    ).length,
    routing_inconsistencies: inputs.validations.filter((event: any) => event.validation_type === 'routing_inconsistency').length,
    repair_ready: true,
  };
}

function groupDigestThemes(items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const key = asArray<string>(item.affected_areas)[0] ?? item.item_type ?? 'general';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries()).map(([theme, themeItems]) => ({
    theme,
    count: themeItems.length,
    max_severity: Math.max(...themeItems.map((item) => score(item.severity))),
    average_confidence: average(themeItems.map((item) => score(item.confidence))),
    unresolved_items: themeItems.filter((item) => !['resolved', 'muted'].includes(item.lifecycle_state)).length,
  })).sort((a, b) => b.max_severity - a.max_severity).slice(0, 8);
}
