/** Part 2/2 of marketPulseProductionHardeningService.ts — verbatim split (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';

import { score, asArray, average, dedupeText, dateBucket, loadInputs } from './marketPulseProductionHardeningServiceGuard';

export async function insertValidation(companyId: string, type: string, entity: any, severity: string, summary: string, remediation: string) {
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

export async function synthesizeTimeline(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildHistoricalTimeline(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export async function synthesizeBenchmarkingReadiness(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildBenchmarkingReadiness(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildBenchmarkCohortReadiness(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildOperationalHealth(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export async function synthesizeOperationalHealth(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>, stageWarnings: string[]) {
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

export function buildResilienceStatus(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildAttentionManagement(inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const repeatedTimeline = inputs.timeline.filter((event: any) => Number(event.coalesced_count ?? 1) > 1);
  const heldEscalations = inputs.escalations.filter((event: any) => event.escalation_state === 'held');
  return {
    repeated_timeline_events_collapsed: repeatedTimeline.length,
    held_escalations: heldEscalations.length,
    low_confidence_items_suppressed: inputs.digestItems.filter((item: any) => score(item.confidence) < 35).length,
    alert_fatigue_guard_enabled: true,
  };
}

export function buildRefinedDigest(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildDegradedContext(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function buildGovernanceSafety(inputs: Awaited<ReturnType<typeof loadInputs>>) {
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

export function groupDigestThemes(items: any[]) {
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

