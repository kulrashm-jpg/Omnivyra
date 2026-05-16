import { ownedDbTable } from '../db/writeOwner';

type ViewType = 'executive' | 'operational' | 'compliance' | 'workforce' | 'funding';
type LifecycleState = 'new' | 'acknowledged' | 'monitored' | 'escalating' | 'stabilized' | 'resolved' | 'muted';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function areaToDepartment(area: string): string {
  if (['compliance', 'regulation', 'taxation'].includes(area)) return 'legal_compliance';
  if (['workforce', 'hiring_pressure', 'hiring_delay'].includes(area)) return 'hr_talent';
  if (['technology', 'infrastructure', 'vendor_dependency', 'infrastructure_reliability_risk'].includes(area)) return 'engineering_operations';
  if (['fundraising', 'investor_pressure', 'margin'].includes(area)) return 'finance_investor_relations';
  if (['customer_demand', 'revenue', 'retention', 'brand'].includes(area)) return 'go_to_market';
  if (['supply_chain', 'delivery', 'logistics_pressure'].includes(area)) return 'supply_chain';
  return 'leadership';
}

function lifecycleFromEvolution(evolution: string | null | undefined, severity: number, previousSeverity?: number | null): LifecycleState {
  if (severity < 20) return 'resolved';
  if (evolution === 'compounding' || evolution === 'worsening' || (previousSeverity != null && severity >= previousSeverity + 12)) return 'escalating';
  if (evolution === 'stabilizing') return 'stabilized';
  if (evolution === 'decaying' || evolution === 'improving') return 'monitored';
  return 'new';
}

function digestTypeFor(item: any): ViewType[] {
  const text = `${item.impact_area ?? ''} ${item.pressure_type ?? ''} ${item.consequence_type ?? ''} ${item.narrative_type ?? ''}`.toLowerCase();
  const out: ViewType[] = ['executive'];
  if (/(technology|operations|delivery|supply|infrastructure|vendor)/.test(text)) out.push('operational');
  if (/(compliance|regulation|tax)/.test(text)) out.push('compliance');
  if (/(workforce|hiring|talent)/.test(text)) out.push('workforce');
  if (/(funding|investor|fundraising|margin)/.test(text)) out.push('funding');
  return unique(out);
}

async function loadExperienceInputs(companyId: string) {
  const [pressures, impacts, consequences, narratives, watchlists, lifecycle] = await Promise.all([
    ownedDbTable('marketpulse_business_pressures').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_business_impacts').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_operational_consequences').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_narratives').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_watchlists').select('*').eq('company_id', companyId),
    ownedDbTable('marketpulse_lifecycle_states').select('*').eq('company_id', companyId),
  ]);
  return {
    pressures: pressures.data ?? [],
    impacts: impacts.data ?? [],
    consequences: consequences.data ?? [],
    narratives: narratives.data ?? [],
    watchlists: watchlists.data ?? [],
    lifecycle: lifecycle.data ?? [],
  };
}

function watchlistBoost(item: any, watchlists: any[]): number {
  const text = JSON.stringify(item).toLowerCase();
  let boost = 0;
  for (const watch of watchlists) {
    const value = String(watch.watchlist_value ?? '').toLowerCase();
    if (!value || !text.includes(value)) continue;
    if (watch.muted) boost -= 25;
    else boost += watch.priority_level === 'critical' ? 18 : watch.priority_level === 'high' ? 12 : 6;
  }
  return boost;
}

function priorityScore(item: any, watchlists: any[]): number {
  const severity = Number(item.severity ?? 0);
  const confidence = Number(item.confidence ?? 0);
  const materiality = String(item.materiality_level ?? '');
  const materialityBoost = materiality === 'critical' ? 30 : materiality === 'strategic' ? 22 : materiality === 'significant' ? 14 : materiality === 'moderate' ? 6 : 0;
  const evolutionBoost = ['escalating', 'compounding', 'worsening'].includes(String(item.evolution_status ?? item.pressure_direction)) ? 18 : 0;
  const contradictionPenalty = Array.isArray(item.contradiction_factors) && item.contradiction_factors.length > 0 ? 10 : 0;
  return clamp(severity * 0.48 + confidence * 0.28 + materialityBoost + evolutionBoost + watchlistBoost(item, watchlists) - contradictionPenalty);
}

function drilldownFor(item: any, kind: string) {
  return {
    entity_type: kind,
    entity_id: item.id,
    originating_signals: item.contributing_signals ?? item.supporting_signals ?? item.source_signal_id ? [item.source_signal_id].filter(Boolean) : [],
    trends: item.contributing_trends ?? item.supporting_trends ?? item.source_trend_id ? [item.source_trend_id].filter(Boolean) : [],
    pressures: item.contributing_pressures ?? item.supporting_pressures ?? item.source_pressure_id ? [item.source_pressure_id].filter(Boolean) : [],
    impacts: item.contributing_impacts ?? [],
    causal_chain: item.causal_chain ?? item.executive_framing?.causal_chain ?? [],
    contradictory_evidence: item.contradictory_factors ?? item.contradiction_factors ?? [],
    uncertainty_factors: item.uncertainty_factors ?? [],
  };
}

async function upsertLifecycle(companyId: string, entityType: string, item: any) {
  const existing = await ownedDbTable('marketpulse_lifecycle_states')
    .select('*')
    .eq('company_id', companyId)
    .eq('entity_type', entityType)
    .eq('entity_id', item.id)
    .maybeSingle();
  const previousSeverity = existing.data?.severity == null ? null : Number(existing.data.severity);
  const state = existing.data?.lifecycle_state === 'muted' || existing.data?.lifecycle_state === 'acknowledged'
    ? existing.data.lifecycle_state
    : lifecycleFromEvolution(item.evolution_status ?? item.pressure_direction, Number(item.severity ?? 0), previousSeverity);
  const reason = previousSeverity == null
    ? 'New MarketPulse intelligence item.'
    : Number(item.severity ?? 0) > previousSeverity
      ? 'Severity increased since prior synthesis.'
      : Number(item.severity ?? 0) < previousSeverity
        ? 'Severity decreased since prior synthesis.'
        : 'Severity is stable.';
  const result = await ownedDbTable('marketpulse_lifecycle_states')
    .upsert({
      company_id: companyId,
      entity_type: entityType,
      entity_id: item.id,
      lifecycle_state: state,
      severity: Number(item.severity ?? 0),
      previous_severity: previousSeverity,
      last_transition_reason: reason,
      transition_key: `${entityType}:${item.id}:${state}`,
      transition_count: Number(existing.data?.transition_count ?? 0) + 1,
      last_material_transition_at: previousSeverity == null || Math.abs(Number(item.severity ?? 0) - previousSeverity) >= 8
        ? new Date().toISOString()
        : existing.data?.last_material_transition_at ?? null,
    }, { onConflict: 'company_id,entity_type,entity_id' })
    .select('*')
    .single();
  return result.data ?? { lifecycle_state: state, previous_severity: previousSeverity, last_transition_reason: reason };
}

async function createEscalationIfNeeded(companyId: string, entityType: string, item: any, lifecycle: any, routedDepartments: string[]) {
  const state = lifecycle.lifecycle_state as LifecycleState;
  const previousSeverity = lifecycle.previous_severity == null ? null : Number(lifecycle.previous_severity);
  const currentSeverity = Number(item.severity ?? 0);
  const recent = await ownedDbTable('marketpulse_escalation_events')
    .select('id, created_at')
    .eq('company_id', companyId)
    .eq('entity_type', entityType)
    .eq('entity_id', item.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const recentAt = recent.data?.created_at ? new Date(recent.data.created_at).getTime() : 0;
  const fatigueHold = recentAt && Date.now() - recentAt < 12 * 60 * 60 * 1000;
  const escalationState =
    fatigueHold ? 'held' :
      state === 'escalating' ? 'escalated' :
        previousSeverity != null && currentSeverity <= previousSeverity - 12 ? 'de_escalated' :
          state === 'muted' ? 'muted' :
            null;
  if (!escalationState) return null;
  const dedupeKey = `${entityType}:${item.id}:${escalationState}:${new Date().toISOString().slice(0, 10)}`;
  const existing = await ownedDbTable('marketpulse_escalation_events')
    .select('*')
    .eq('company_id', companyId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (existing.data) {
    const result = await ownedDbTable('marketpulse_escalation_events')
      .update({
        previous_severity: previousSeverity,
        current_severity: currentSeverity,
        reason: fatigueHold ? 'Attention guard held repeated escalation to prevent alert fatigue.' : lifecycle.last_transition_reason ?? 'Lifecycle transition.',
        routed_departments: routedDepartments,
        coalesced_count: Number(existing.data.coalesced_count ?? 1) + 1,
        last_coalesced_at: new Date().toISOString(),
        alert_fatigue_guard: {
          ...(existing.data.alert_fatigue_guard ?? {}),
          recent_escalation_found: Boolean(recent.data),
          held_for_fatigue: Boolean(fatigueHold),
          window_hours: 12,
          duplicate_suppressed: true,
        },
      })
      .eq('id', existing.data.id)
      .select('*')
      .single();
    return result.data ?? existing.data;
  }
  const result = await ownedDbTable('marketpulse_escalation_events').insert({
    company_id: companyId,
    entity_type: entityType,
    entity_id: item.id,
    escalation_state: escalationState,
    previous_severity: previousSeverity,
    current_severity: currentSeverity,
    dedupe_key: dedupeKey,
    reason: fatigueHold ? 'Attention guard held escalation to prevent alert fatigue.' : lifecycle.last_transition_reason ?? 'Lifecycle transition.',
    routed_departments: routedDepartments,
    alert_fatigue_guard: {
      recent_escalation_found: Boolean(recent.data),
      held_for_fatigue: Boolean(fatigueHold),
      window_hours: 12,
    },
  }).select('*').single();
  return result.data ?? null;
}

async function createWorkflowHook(companyId: string, entityType: string, item: any, routedDepartments: string[]) {
  if (Number(item.severity ?? 0) < 65) return null;
  const result = await ownedDbTable('marketpulse_workflow_hooks').insert({
    company_id: companyId,
    source_entity_type: entityType,
    source_entity_id: item.id,
    hook_type: 'leadership_summary',
    readiness_state: 'prepared',
    hook_payload: {
      title: item.title ?? item.consequence_type ?? item.impact_type ?? item.pressure_type,
      routed_departments: routedDepartments,
      severity: item.severity,
      confidence: item.confidence,
      drilldown: drilldownFor(item, entityType),
    },
  }).select('*').single();
  return result.data ?? null;
}

async function buildDigestItems(companyId: string, inputs: Awaited<ReturnType<typeof loadExperienceInputs>>) {
  const sourceItems = [
    ...inputs.pressures.map((item: any) => ({ kind: 'pressure', item })),
    ...inputs.impacts.map((item: any) => ({ kind: 'impact', item })),
    ...inputs.consequences.map((item: any) => ({ kind: 'consequence', item })),
    ...inputs.narratives.map((item: any) => ({ kind: 'narrative', item })),
  ].sort((a, b) => priorityScore(b.item, inputs.watchlists) - priorityScore(a.item, inputs.watchlists)).slice(0, 16);

  const persisted: any[] = [];
  for (const { kind, item } of sourceItems) {
    const lifecycle = await upsertLifecycle(companyId, kind, item);
    const affectedAreas = unique([
      ...(item.affected_business_areas ?? []),
      ...(item.affected_business_units ?? []),
      item.impact_area,
      item.narrative_type,
      item.pressure_type,
      item.consequence_type,
    ].filter(Boolean));
    const routedDepartments = unique(affectedAreas.map(areaToDepartment));
    await createEscalationIfNeeded(companyId, kind, item, lifecycle, routedDepartments);
    await createWorkflowHook(companyId, kind, item, routedDepartments);
    for (const digestType of digestTypeFor(item)) {
      const result = await ownedDbTable('marketpulse_digest_items').insert({
        company_id: companyId,
        digest_type: digestType,
        item_type: kind,
        source_pressure_id: kind === 'pressure' ? item.id : item.source_pressure_id ?? null,
        source_impact_id: kind === 'impact' ? item.id : null,
        source_consequence_id: kind === 'consequence' ? item.id : null,
        source_narrative_id: kind === 'narrative' ? item.id : null,
        summary: item.narrative_summary ?? item.rationale ?? item.title ?? `${kind} requires attention`,
        why_this_matters: item.executive_framing?.why_this_matters ?? item.rationale ?? 'Material MarketPulse intelligence item.',
        affected_areas: affectedAreas,
        severity: Number(item.severity ?? 0),
        confidence: Number(item.confidence ?? 0),
        evolution_status: item.evolution_status ?? item.pressure_direction ?? 'new',
        supporting_evidence: {
          signals: item.contributing_signals ?? item.supporting_signals ?? [],
          trends: item.contributing_trends ?? item.supporting_trends ?? [],
          pressures: item.contributing_pressures ?? item.supporting_pressures ?? [],
          impacts: item.contributing_impacts ?? [],
        },
        drilldown_payload: drilldownFor(item, kind),
        priority_rank: priorityScore(item, inputs.watchlists),
        lifecycle_state: lifecycle.lifecycle_state,
      }).select('*').single();
      if (!result.error && result.data) persisted.push(result.data);
    }
  }
  return persisted;
}

async function buildOverview(companyId: string, viewType: ViewType, inputs: Awaited<ReturnType<typeof loadExperienceInputs>>, digestItems: any[]) {
  const relevantDigestItems = digestItems
    .filter((item) => item.digest_type === viewType)
    .sort((a, b) => Number(b.priority_rank ?? 0) - Number(a.priority_rank ?? 0))
    .slice(0, 8);
  const strategicPressures = inputs.pressures.filter((item: any) => Number(item.severity ?? 0) >= 65).slice(0, 5);
  const operationalPressures = inputs.pressures.filter((item: any) => (item.affected_business_areas ?? []).some((area: string) => ['operations', 'technology', 'supply_chain', 'delivery'].includes(area))).slice(0, 5);
  const emergingRisks = relevantDigestItems.filter((item) => item.evolution_status === 'escalating' || Number(item.severity ?? 0) >= 70).map((item) => item.id);
  const stabilizing = relevantDigestItems.filter((item) => ['stabilized', 'stable', 'stabilizing'].includes(String(item.evolution_status))).map((item) => item.id);
  const confidenceValues = relevantDigestItems.map((item) => Number(item.confidence ?? 0)).filter(Boolean);
  const overview = {
    company_id: companyId,
    view_type: viewType,
    overview_payload: {
      summary: relevantDigestItems.length
        ? `${relevantDigestItems.length} material MarketPulse item${relevantDigestItems.length === 1 ? '' : 's'} prioritized for ${viewType} review.`
        : `No materially relevant ${viewType} MarketPulse items at this time.`,
      digest_items: relevantDigestItems,
      routing_summary: unique(relevantDigestItems.flatMap((item) => item.affected_areas ?? []).map(areaToDepartment)),
      watchlist_matches: inputs.watchlists.filter((watch: any) => JSON.stringify(relevantDigestItems).toLowerCase().includes(String(watch.watchlist_value ?? '').toLowerCase())),
    },
    top_strategic_pressures: strategicPressures.map((item: any) => item.id),
    top_operational_pressures: operationalPressures.map((item: any) => item.id),
    emerging_risks: emergingRisks,
    opportunity_highlights: inputs.narratives.filter((item: any) => String(item.narrative_summary ?? '').toLowerCase().includes('opportunity')).map((item: any) => item.id).slice(0, 5),
    worsening_conditions: relevantDigestItems.filter((item) => ['worsening', 'escalating', 'compounding'].includes(String(item.evolution_status))).map((item) => item.id),
    stabilizing_conditions: stabilizing,
    critical_narratives: inputs.narratives.filter((item: any) => Number(item.severity ?? 0) >= 75).map((item: any) => item.id).slice(0, 5),
    confidence: clamp(confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0),
  };
  const result = await ownedDbTable('marketpulse_executive_overviews').insert(overview).select('*').single();
  return result.data ?? overview;
}

export async function synthesizeMarketPulseExecutiveExperience(companyId: string) {
  const inputs = await loadExperienceInputs(companyId);
  const digestItems = await buildDigestItems(companyId, inputs);
  const overviews = await Promise.all([
    buildOverview(companyId, 'executive', inputs, digestItems),
    buildOverview(companyId, 'operational', inputs, digestItems).catch(() => null),
    buildOverview(companyId, 'compliance', inputs, digestItems).catch(() => null),
    buildOverview(companyId, 'workforce', inputs, digestItems).catch(() => null),
    buildOverview(companyId, 'funding', inputs, digestItems).catch(() => null),
  ]);
  return {
    overviews: overviews.filter(Boolean),
    digestItems,
  };
}

export async function getMarketPulseExecutiveExperience(companyId: string, viewType: ViewType = 'executive') {
  const [overview, digestItems, lifecycle, escalations, hooks, watchlists] = await Promise.all([
    ownedDbTable('marketpulse_executive_overviews').select('*').eq('company_id', companyId).eq('view_type', viewType).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
    ownedDbTable('marketpulse_digest_items').select('*').eq('company_id', companyId).eq('digest_type', viewType).order('priority_rank', { ascending: true }).limit(12),
    ownedDbTable('marketpulse_lifecycle_states').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_escalation_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(12),
    ownedDbTable('marketpulse_workflow_hooks').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(12),
    ownedDbTable('marketpulse_watchlists').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
  ]);
  return {
    overview: overview.data ?? null,
    digestItems: digestItems.data ?? [],
    lifecycle: lifecycle.data ?? [],
    escalations: escalations.data ?? [],
    workflowHooks: hooks.data ?? [],
    watchlists: watchlists.data ?? [],
  };
}

export async function saveMarketPulseWatchlistItem(params: {
  companyId: string;
  watchlistType: string;
  watchlistValue: string;
  priorityLevel?: string;
  muted?: boolean;
  actorUserId?: string | null;
}) {
  const result = await ownedDbTable('marketpulse_watchlists')
    .upsert({
      company_id: params.companyId,
      watchlist_type: params.watchlistType,
      watchlist_value: params.watchlistValue,
      priority_level: params.priorityLevel ?? 'normal',
      muted: Boolean(params.muted),
      created_by: params.actorUserId ?? null,
    }, { onConflict: 'company_id,watchlist_type,watchlist_value' })
    .select('*')
    .single();
  if (result.error) throw new Error(`Failed to save MarketPulse watchlist item: ${result.error.message}`);
  return result.data;
}
