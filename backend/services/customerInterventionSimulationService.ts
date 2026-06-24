/**
 * customerInterventionSimulationService.ts
 *
 * SIMULATION ONLY. Answers "if we acted, what would happen?" WITHOUT acting. Pure functions
 * over the Intervention Governance (15A) output — no new reads, no execution, no delivery,
 * no automation, no writes, no persisted simulation state. UNKNOWN stays UNKNOWN. Governance
 * (population-integrity / confidence / state suppression) is inherited and enforced;
 * non-customers are excluded from every eligible/collision/capacity figure.
 *
 * No prediction, no success-rate estimation, no AI, no forecasting — observable operational
 * impact only.
 */

import { INTERVENTION_CATALOG, type InterventionId, type Severity, type CompanyGovernance } from './customerInterventionGovernanceService';
import type { ConfidenceLevel } from './customerSignalConfidenceService';

export type SimInput = CompanyGovernance & { confidence: ConfidenceLevel };

const SEVERITY: Record<InterventionId, Severity> = Object.fromEntries(INTERVENTION_CATALOG.map((d) => [d.id, d.severity])) as Record<InterventionId, Severity>;
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const CATALOG_ORDER = new Map(INTERVENTION_CATALOG.map((d, i) => [d.id, i]));
type ConfDist = Record<ConfidenceLevel, number>;
const emptyConf = (): ConfDist => ({ HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });

export interface InterventionSim {
  id: InterventionId; severity: Severity;
  eligible: number; suppressed: number; blocked: number; unknown: number;
  customer_count: number; non_customer_count: number;
  confidence_distribution: ConfDist; // confidence of the ELIGIBLE companies
}

/** Pure: per-intervention simulation (observable counts only). */
export function simulateInterventions(companies: SimInput[]): InterventionSim[] {
  const nonCustomers = companies.filter((c) => c.tenant_class !== 'CUSTOMER').length;
  return INTERVENTION_CATALOG.map((def) => {
    const sim: InterventionSim = { id: def.id, severity: def.severity, eligible: 0, suppressed: 0, blocked: 0, unknown: 0, customer_count: 0, non_customer_count: nonCustomers, confidence_distribution: emptyConf() };
    for (const c of companies) {
      if (c.eligible_interventions.includes(def.id)) {
        sim.eligible += 1; sim.confidence_distribution[c.confidence] += 1;
        if (c.tenant_class === 'CUSTOMER') sim.customer_count += 1;
        continue;
      }
      const status = c.ineligible_interventions.find((e) => e.id === def.id)?.status;
      if (status === 'SUPPRESSED') sim.suppressed += 1;
      else if (status === 'BLOCKED') sim.blocked += 1;
      else if (status === 'UNKNOWN') sim.unknown += 1;
    }
    return sim;
  });
}

export interface CustomerSim {
  company_id: string; company_name: string; customer_state: string; confidence: ConfidenceLevel;
  eligible_count: number; eligible_interventions: InterventionId[];
  highest_priority_intervention: InterventionId | null; collision: boolean; deferred_in_collision: InterventionId[];
}

const sortBySeverity = (a: InterventionId, b: InterventionId) => SEVERITY_RANK[SEVERITY[b]] - SEVERITY_RANK[SEVERITY[a]] || (CATALOG_ORDER.get(a)! - CATALOG_ORDER.get(b)!);

/** Pure: per-customer simulation (CUSTOMER only — governance enforced). */
export function simulatePerCustomer(companies: SimInput[]): CustomerSim[] {
  return companies.filter((c) => c.tenant_class === 'CUSTOMER').map((c) => {
    const ranked = [...c.eligible_interventions].sort(sortBySeverity);
    return {
      company_id: c.company_id, company_name: c.company_name, customer_state: c.customer_state, confidence: c.confidence,
      eligible_count: ranked.length, eligible_interventions: ranked,
      highest_priority_intervention: ranked[0] ?? null, collision: ranked.length >= 2, deferred_in_collision: ranked.slice(1),
    };
  });
}

export interface CollisionAnalysis {
  collision_count: number; // customers with ≥ 2 simultaneous eligible interventions
  collision_matrix: Array<{ pair: string; count: number }>;
  customers_in_collision: Array<{ company_id: string; company_name: string; highest_priority_intervention: InterventionId | null; deferred: InterventionId[] }>;
}

export function analyzeCollisions(perCustomer: CustomerSim[]): CollisionAnalysis {
  const colliding = perCustomer.filter((c) => c.collision);
  const pairs = new Map<string, number>();
  for (const c of colliding) {
    const ids = c.eligible_interventions;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = [ids[i], ids[j]].sort().join(' + ');
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  return {
    collision_count: colliding.length,
    collision_matrix: Array.from(pairs.entries()).map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair)).slice(0, 20),
    customers_in_collision: colliding.map((c) => ({ company_id: c.company_id, company_name: c.company_name, highest_priority_intervention: c.highest_priority_intervention, deferred: c.deferred_in_collision })),
  };
}

export interface CapacityAnalysis {
  eligible_customers: number;
  customers_with_1_intervention: number; customers_with_2_interventions: number; customers_with_3_plus_interventions: number;
  total_eligible_interventions: number; interventions_per_eligible_customer: number | null;
  queue_pressure: number; // total eligible interventions awaiting action
}

export function analyzeCapacity(perCustomer: CustomerSim[]): CapacityAnalysis {
  const eligible = perCustomer.filter((c) => c.eligible_count > 0);
  const total = eligible.reduce((a, c) => a + c.eligible_count, 0);
  return {
    eligible_customers: eligible.length,
    customers_with_1_intervention: perCustomer.filter((c) => c.eligible_count === 1).length,
    customers_with_2_interventions: perCustomer.filter((c) => c.eligible_count === 2).length,
    customers_with_3_plus_interventions: perCustomer.filter((c) => c.eligible_count >= 3).length,
    total_eligible_interventions: total,
    interventions_per_eligible_customer: eligible.length ? Math.round((total / eligible.length) * 10) / 10 : null,
    queue_pressure: total,
  };
}

export interface ExecutiveSimView {
  top_interventions_by_reach: Array<{ id: InterventionId; eligible: number }>;
  top_interventions_by_confidence: Array<{ id: InterventionId; high_confidence: number; medium_confidence: number }>;
  top_customers_by_eligibility: Array<{ company_id: string; company_name: string; eligible_count: number }>;
  top_customers_by_collision: Array<{ company_id: string; company_name: string; eligible_count: number }>;
}

export interface SimulationPortfolio {
  per_intervention: InterventionSim[];
  per_customer: CustomerSim[];
  collision: CollisionAnalysis;
  capacity: CapacityAnalysis;
  executive: ExecutiveSimView;
  portfolio_summary: { total_companies: number; customer_companies: number; non_customer_excluded: number; total_eligible: number; total_suppressed: number; total_blocked: number; total_unknown: number };
  unknown_gaps: string[];
}

/** Pure orchestrator. Read-only, simulation only. */
export function simulatePortfolio(companies: SimInput[]): SimulationPortfolio {
  const per_intervention = simulateInterventions(companies);
  const per_customer = simulatePerCustomer(companies);
  const collision = analyzeCollisions(per_customer);
  const capacity = analyzeCapacity(per_customer);
  const totals = per_intervention.reduce((t, s) => ({ e: t.e + s.eligible, s: t.s + s.suppressed, b: t.b + s.blocked, u: t.u + s.unknown }), { e: 0, s: 0, b: 0, u: 0 });

  const executive: ExecutiveSimView = {
    top_interventions_by_reach: [...per_intervention].sort((a, b) => b.eligible - a.eligible || a.id.localeCompare(b.id)).map((s) => ({ id: s.id, eligible: s.eligible })).slice(0, 10),
    top_interventions_by_confidence: [...per_intervention].sort((a, b) => b.confidence_distribution.HIGH - a.confidence_distribution.HIGH || b.confidence_distribution.MEDIUM - a.confidence_distribution.MEDIUM || a.id.localeCompare(b.id)).map((s) => ({ id: s.id, high_confidence: s.confidence_distribution.HIGH, medium_confidence: s.confidence_distribution.MEDIUM })).slice(0, 10),
    top_customers_by_eligibility: [...per_customer].sort((a, b) => b.eligible_count - a.eligible_count || a.company_id.localeCompare(b.company_id)).map((c) => ({ company_id: c.company_id, company_name: c.company_name, eligible_count: c.eligible_count })).slice(0, 10),
    top_customers_by_collision: [...per_customer].filter((c) => c.collision).sort((a, b) => b.eligible_count - a.eligible_count || a.company_id.localeCompare(b.company_id)).map((c) => ({ company_id: c.company_id, company_name: c.company_name, eligible_count: c.eligible_count })).slice(0, 10),
  };

  return {
    per_intervention, per_customer, collision, capacity, executive,
    portfolio_summary: {
      total_companies: companies.length, customer_companies: companies.filter((c) => c.tenant_class === 'CUSTOMER').length,
      non_customer_excluded: companies.filter((c) => c.tenant_class !== 'CUSTOMER').length,
      total_eligible: totals.e, total_suppressed: totals.s, total_blocked: totals.b, total_unknown: totals.u,
    },
    unknown_gaps: [
      'simulation reports observable eligibility only — NO success-rate / outcome prediction',
      'collision deferral is simulated (highest-severity wins) — not persisted, not executed',
      'governance suppression (population/confidence/state) is inherited from 15A and enforced',
    ],
  };
}
