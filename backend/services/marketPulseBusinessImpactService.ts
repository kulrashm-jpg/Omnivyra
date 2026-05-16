import { ownedDbTable } from '../db/writeOwner';
import { getCompanyContextIntelligence } from './companyContextIntelligenceService';
import { calculateContextQualityMetadata } from './companyContextEnrichmentService';

type PressureRow = {
  id: string;
  company_id: string;
  pressure_type: string;
  pressure_direction: string;
  severity: number;
  confidence: number;
  contributing_signals?: string[] | null;
  contributing_trends?: string[] | null;
  rationale: string;
  affected_business_areas?: string[] | null;
  causal_chain?: Array<Record<string, unknown>> | null;
  uncertainty_factors?: string[] | null;
  contradictory_factors?: string[] | null;
  synthesis_strength?: string | null;
  created_at?: string;
  updated_at?: string;
};

type TrendRow = {
  id: string;
  trend_category: string;
  title: string;
  summary: string;
  involved_signal_count: number;
  signal_velocity: number;
  confidence: number;
  trend_direction: string;
  impact_domains?: string[] | null;
  affected_geographies?: string[] | null;
  supporting_signals?: string[] | null;
};

type Materiality = 'informational' | 'moderate' | 'significant' | 'strategic' | 'critical';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function materialityFor(score: number, confidence: number, contextReliable: boolean, contradictory: boolean): Materiality {
  const adjusted = score * (confidence < 45 ? 0.78 : 1) * (contextReliable ? 1 : 0.82) * (contradictory ? 0.75 : 1);
  if (adjusted >= 85) return 'critical';
  if (adjusted >= 72) return 'strategic';
  if (adjusted >= 58) return 'significant';
  if (adjusted >= 38) return 'moderate';
  return 'informational';
}

function impactAreaForPressure(pressureType: string, areas: string[]): string {
  if (pressureType === 'hiring_pressure') return 'workforce';
  if (pressureType === 'compliance_pressure') return 'compliance';
  if (pressureType === 'margin_pressure' || pressureType === 'pricing_pressure') return 'margin';
  if (pressureType === 'logistics_pressure') return 'delivery';
  if (pressureType === 'supply_chain_pressure') return 'supply_chain';
  if (pressureType === 'technology_pressure') return 'technology';
  if (pressureType === 'investor_pressure') return 'fundraising';
  if (pressureType === 'competitive_pressure') return 'customer_demand';
  if (areas.includes('revenue')) return 'revenue';
  if (areas.includes('technology')) return 'technology';
  if (areas.includes('compliance')) return 'compliance';
  return 'operations';
}

function consequenceTypeFor(impactArea: string, pressureTypes: string[]): string {
  if (impactArea === 'workforce') return pressureTypes.includes('hiring_pressure') ? 'hiring_delay' : 'workforce_attrition_risk';
  if (impactArea === 'margin') return 'margin_compression';
  if (impactArea === 'compliance') return 'compliance_overhead_increase';
  if (impactArea === 'delivery' || impactArea === 'supply_chain') return 'delivery_slowdown_risk';
  if (impactArea === 'technology') return 'infrastructure_reliability_risk';
  if (impactArea === 'customer_demand') return 'customer_acquisition_slowdown';
  if (impactArea === 'expansion') return 'expansion_friction';
  return 'operational_bottleneck';
}

function executiveFrame(params: {
  why: string;
  affected: string[];
  confidence: number;
  severity: number;
  timeHorizon: string;
  uncertainty: string[];
  contradictions: string[];
}) {
  return {
    why_this_matters: params.why,
    what_is_affected: params.affected,
    confidence_level: params.confidence >= 70 ? 'high' : params.confidence >= 45 ? 'medium' : 'low',
    severity: params.severity,
    time_horizon: params.timeHorizon,
    uncertainty_factors: params.uncertainty,
    contradiction_factors: params.contradictions,
  };
}

async function loadInputs(companyId: string) {
  const [pressures, trends, impacts, consequences, intelligence] = await Promise.all([
    ownedDbTable('marketpulse_business_pressures').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_trends').select('*').order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('marketpulse_business_impacts').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
    ownedDbTable('marketpulse_operational_consequences').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(50),
    getCompanyContextIntelligence(companyId).catch(() => null),
  ]);
  return {
    pressures: (pressures.data ?? []) as PressureRow[],
    trends: (trends.data ?? []) as TrendRow[],
    priorImpacts: impacts.data ?? [],
    priorConsequences: consequences.data ?? [],
    intelligence,
  };
}

function contextWeight(intelligence: Awaited<ReturnType<typeof getCompanyContextIntelligence>> | null, pressure: PressureRow) {
  const area = impactAreaForPressure(pressure.pressure_type, pressure.affected_business_areas ?? []);
  const dependencies = [
    ...(intelligence?.dependencies ?? []).filter((row) => ['high', 'critical'].includes(String(row.criticality_key || row.criticality))),
    ...(intelligence?.technology_dependencies ?? []).filter((row) => ['high', 'critical'].includes(String(row.criticality_key || row.criticality))),
  ];
  const workforceSensitive = intelligence?.workforce_profile && ['high', 'critical'].includes(String(intelligence.workforce_profile.labor_sensitivity_level_key || intelligence.workforce_profile.labor_sensitivity_level));
  const geoExposure = (intelligence?.geographic_exposures ?? []).filter((row) => Number(row.exposure_percentage ?? 0) >= 40 || ['high', 'critical'].includes(String(row.criticality_key || row.criticality)));
  const revenueExposure = (intelligence?.revenue_segments ?? []).filter((row) => Number(row.revenue_percentage ?? 0) >= 30 || ['high', 'critical'].includes(String(row.strategic_priority_key || row.strategic_priority)));
  let weight = 1;
  if (['technology', 'vendor_dependency', 'infrastructure'].includes(area) && dependencies.length > 0) weight += 0.18;
  if (area === 'workforce' && workforceSensitive) weight += 0.2;
  if (geoExposure.length > 0) weight += 0.08;
  if (['revenue', 'customer_demand', 'margin'].includes(area) && revenueExposure.length > 0) weight += 0.16;
  return {
    weight,
    affected_dependencies: dependencies.map((row: any) => row.dependency_name ?? row.provider_name ?? row.dependency_type ?? row.provider_category).filter(Boolean),
    affected_geographies: geoExposure.map((row) => row.geography).filter(Boolean),
    affected_customer_segments: revenueExposure.map((row) => row.customer_segment ?? row.customer_industry).filter(Boolean),
    affected_workforce_segments: workforceSensitive ? intelligence?.workforce_profile?.key_skill_dependencies ?? [] : [],
  };
}

function evolutionStatus(previous: any | undefined, severity: number): string {
  if (!previous) return 'new';
  const prior = Number(previous.severity ?? 0);
  if (severity >= prior + 10) return 'worsening';
  if (severity <= prior - 10) return 'improving';
  if (severity < 30) return 'decaying';
  return 'stabilizing';
}

async function synthesizeImpacts(companyId: string, inputs: Awaited<ReturnType<typeof loadInputs>>) {
  const quality = calculateContextQualityMetadata(inputs.intelligence);
  const rows: any[] = [];
  for (const pressure of inputs.pressures) {
    const matchedTrend = inputs.trends.find((trend) => (pressure.contributing_trends ?? []).includes(trend.id));
    const area = impactAreaForPressure(pressure.pressure_type, pressure.affected_business_areas ?? []);
    const ctx = contextWeight(inputs.intelligence, pressure);
    const contradictory = (pressure.contradictory_factors ?? []).length > 0;
    const severity = clamp(Number(pressure.severity ?? 0) * ctx.weight * (contradictory ? 0.82 : 1));
    const confidence = clamp(Number(pressure.confidence ?? 0) * (quality.context_reliability_score < 45 ? 0.82 : 1) * (contradictory ? 0.78 : 1));
    const materiality = materialityFor(severity, confidence, quality.context_reliability_score >= 45, contradictory);
    const duplicateKey = slugify(`${pressure.id}-${area}-${pressure.pressure_direction}`);
    const previous = inputs.priorImpacts.find((row: any) => row.duplicate_key === duplicateKey);
    const uncertainty = unique([
      ...(pressure.uncertainty_factors ?? []),
      quality.context_reliability_score < 45 ? 'Company context reliability is low; impact materiality is reduced.' : '',
      pressure.synthesis_strength === 'weak' ? 'Pressure synthesis is weak; impact should be treated as directional only.' : '',
    ]);
    const contradictions = pressure.contradictory_factors ?? [];
    const affected = unique([area, ...(pressure.affected_business_areas ?? [])]);
    rows.push({
      company_id: companyId,
      source_signal_id: (pressure.contributing_signals ?? [])[0] ?? null,
      source_trend_id: matchedTrend?.id ?? null,
      source_pressure_id: pressure.id,
      impact_area: area,
      impact_type: pressure.pressure_type,
      impact_direction: pressure.pressure_direction === 'increasing' ? 'negative' : pressure.pressure_direction === 'decreasing' ? 'positive' : 'mixed',
      severity,
      confidence,
      materiality_level: materiality,
      affected_business_units: affected,
      affected_dependencies: ctx.affected_dependencies,
      affected_geographies: ctx.affected_geographies,
      affected_workforce_segments: ctx.affected_workforce_segments,
      affected_customer_segments: ctx.affected_customer_segments,
      rationale: `${pressure.pressure_type.replace(/_/g, ' ')} propagates to ${area.replace(/_/g, ' ')} with context weight ${ctx.weight.toFixed(2)}.`,
      executive_framing: executiveFrame({
        why: `This may create ${materiality} ${area.replace(/_/g, ' ')} impact because ${pressure.rationale}`,
        affected,
        confidence,
        severity,
        timeHorizon: severity >= 75 ? 'immediate' : 'near_term',
        uncertainty,
        contradictions,
      }),
      uncertainty_factors: uncertainty,
      contradiction_factors: contradictions,
      evolution_status: evolutionStatus(previous, severity),
      duplicate_key: duplicateKey,
    });
  }
  const persisted: any[] = [];
  for (const row of rows) {
    const result = await ownedDbTable('marketpulse_business_impacts')
      .upsert(row, { onConflict: 'company_id,duplicate_key' })
      .select('*')
      .single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

async function synthesizeAmplifications(companyId: string, pressures: PressureRow[]) {
  const rows: any[] = [];
  for (let i = 0; i < pressures.length; i += 1) {
    for (let j = i + 1; j < pressures.length; j += 1) {
      const a = pressures[i];
      const b = pressures[j];
      const pair = [a.pressure_type, b.pressure_type].sort().join('+');
      let amplificationType: string | null = null;
      let factor = 1;
      if (pair.includes('hiring_pressure') && pair.includes('margin_pressure')) {
        amplificationType = 'compounding';
        factor = 1.22;
      } else if (pair.includes('technology_pressure') && pair.includes('margin_pressure')) {
        amplificationType = 'reinforcing';
        factor = 1.18;
      } else if (pair.includes('compliance_pressure') && pair.includes('hiring_pressure')) {
        amplificationType = 'cascading';
        factor = 1.16;
      } else if (pair.includes('logistics_pressure') && pair.includes('supply_chain_pressure')) {
        amplificationType = 'reinforcing';
        factor = 1.2;
      } else if (a.pressure_direction !== b.pressure_direction) {
        amplificationType = 'offsetting';
        factor = 0.86;
      }
      if (!amplificationType) continue;
      rows.push({
        company_id: companyId,
        primary_pressure_id: a.id,
        secondary_pressure_id: b.id,
        amplification_type: amplificationType,
        amplification_factor: factor,
        rationale: `${a.pressure_type.replace(/_/g, ' ')} and ${b.pressure_type.replace(/_/g, ' ')} are ${amplificationType}; combined severity should be interpreted with factor ${factor}.`,
        confidence: clamp((Number(a.confidence ?? 0) + Number(b.confidence ?? 0)) / 2 * (amplificationType === 'offsetting' ? 0.8 : 1)),
      });
    }
  }
  const persisted: any[] = [];
  for (const row of rows) {
    const result = await ownedDbTable('marketpulse_pressure_amplifications')
      .upsert(row, { onConflict: 'company_id,primary_pressure_id,secondary_pressure_id,amplification_type' })
      .select('*')
      .single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

async function synthesizeConsequences(companyId: string, impacts: any[], pressures: PressureRow[], amplifications: any[], priorConsequences: any[]) {
  const grouped = new Map<string, any[]>();
  for (const impact of impacts) {
    const pressureTypes = pressures.filter((pressure) => impact.source_pressure_id === pressure.id).map((pressure) => pressure.pressure_type);
    const type = consequenceTypeFor(impact.impact_area, pressureTypes);
    grouped.set(type, [...(grouped.get(type) ?? []), impact]);
  }
  const consequences: any[] = [];
  for (const [type, group] of grouped) {
    if (group.length < 2 && Number(group[0]?.confidence ?? 0) < 60) continue;
    const pressureIds = unique(group.map((impact) => impact.source_pressure_id).filter(Boolean));
    const relatedAmplifications = amplifications.filter((amp) => pressureIds.includes(amp.primary_pressure_id) || pressureIds.includes(amp.secondary_pressure_id));
    const ampFactor = relatedAmplifications.length
      ? Math.max(...relatedAmplifications.map((amp) => Number(amp.amplification_factor ?? 1)))
      : 1;
    const contradictionCount = group.reduce((count, impact) => count + ((impact.contradiction_factors ?? []).length > 0 ? 1 : 0), 0);
    const severity = clamp((group.reduce((sum, impact) => sum + Number(impact.severity ?? 0), 0) / group.length) * ampFactor * (contradictionCount ? 0.84 : 1));
    const confidence = clamp((group.reduce((sum, impact) => sum + Number(impact.confidence ?? 0), 0) / group.length) * (group.length >= 2 ? 1 : 0.78) * (contradictionCount ? 0.8 : 1));
    const materiality = materialityFor(severity, confidence, true, contradictionCount > 0);
    const duplicateKey = slugify(`${companyId}-${type}`);
    const previous = priorConsequences.find((row: any) => row.duplicate_key === duplicateKey);
    const uncertainty = unique(group.flatMap((impact) => impact.uncertainty_factors ?? []));
    const contradictions = unique(group.flatMap((impact) => impact.contradiction_factors ?? []));
    consequences.push({
      company_id: companyId,
      consequence_type: type,
      severity,
      confidence,
      materiality_level: materiality,
      contributing_impacts: unique(group.map((impact) => impact.id)),
      contributing_pressures: pressureIds,
      rationale: `${type.replace(/_/g, ' ')} is supported by ${group.length} business impact${group.length === 1 ? '' : 's'}${relatedAmplifications.length ? ' and reinforced pressure amplification' : ''}.`,
      executive_framing: executiveFrame({
        why: `This may create ${materiality} ${type.replace(/_/g, ' ')} because multiple business impacts affect ${unique(group.map((impact) => impact.impact_area)).join(', ')}.`,
        affected: unique(group.flatMap((impact) => impact.affected_business_units ?? [])),
        confidence,
        severity,
        timeHorizon: severity >= 75 ? 'immediate' : 'near_term',
        uncertainty,
        contradictions,
      }),
      uncertainty_factors: uncertainty,
      contradiction_factors: contradictions,
      evolution_status: relatedAmplifications.some((amp) => Number(amp.amplification_factor ?? 1) > 1) ? 'compounding' : evolutionStatus(previous, severity),
      duplicate_key: duplicateKey,
    });
  }
  const persisted: any[] = [];
  for (const row of consequences) {
    const result = await ownedDbTable('marketpulse_operational_consequences')
      .upsert(row, { onConflict: 'company_id,duplicate_key' })
      .select('*')
      .single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

export async function synthesizeMarketPulseBusinessImpact(companyId: string) {
  const inputs = await loadInputs(companyId);
  if (inputs.pressures.length === 0) {
    return { impacts: [], amplifications: [], consequences: [] };
  }
  const impacts = await synthesizeImpacts(companyId, inputs);
  const amplifications = await synthesizeAmplifications(companyId, inputs.pressures);
  const consequences = await synthesizeConsequences(companyId, impacts, inputs.pressures, amplifications, inputs.priorConsequences);
  return { impacts, amplifications, consequences };
}

export async function getMarketPulseBusinessImpact(companyId: string) {
  const [impacts, amplifications, consequences] = await Promise.all([
    ownedDbTable('marketpulse_business_impacts').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(10),
    ownedDbTable('marketpulse_pressure_amplifications').select('*').eq('company_id', companyId).order('confidence', { ascending: false }).limit(10),
    ownedDbTable('marketpulse_operational_consequences').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(10),
  ]);
  return {
    impacts: impacts.data ?? [],
    amplifications: amplifications.data ?? [],
    consequences: consequences.data ?? [],
  };
}
