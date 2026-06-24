/**
 * customerSuccessOperatingSystemService.ts
 *
 * READ-ONLY operating layer on top of Intervention Governance (15A). Builds the single
 * operational queue set from which Customer Success / Product / Growth / Leadership can
 * operate — VISIBILITY ONLY. No execution, no delivery, no automation, no writes, no
 * persisted state. UNKNOWN stays UNKNOWN. Governance (non-customer exclusion) is enforced.
 *
 * A company may belong to multiple queues. Non-customers (per 14I) are excluded from every
 * queue.
 */

import type { CustomerState, InterventionId } from './customerInterventionGovernanceService';
import type { TenantClass } from './customerPopulationIntegrityService';
import type { ConfidenceLevel } from './customerSignalConfidenceService';
import type { PriorityTier } from './customerOpportunityPriorityService';

export type QueueName = 'ACTIVATION' | 'ADOPTION' | 'VALUE' | 'RETENTION' | 'EXPANSION' | 'OBSERVATION';
export const QUEUES: QueueName[] = ['ACTIVATION', 'ADOPTION', 'VALUE', 'RETENTION', 'EXPANSION', 'OBSERVATION'];

export interface OpsCompany {
  company_id: string; company_name: string; tenant_class: TenantClass;
  customer_state: CustomerState; priority_score: number; priority_tier: PriorityTier;
  eligible_interventions: InterventionId[]; globally_suppressed: boolean;
  has_value: boolean; readiness_score: number; overall_confidence: ConfidenceLevel;
}

export interface QueueEntry {
  company_id: string; company_name: string; customer_state: CustomerState;
  priority_score: number; queue_reason: string; evidence: string; confidence: ConfidenceLevel;
}

const ACTIVATION_INTERVENTIONS: InterventionId[] = ['PROFILE_COMPLETION', 'DOMAIN_VERIFICATION', 'ACTIVATION_RECOVERY'];
const ADOPTION_INTERVENTIONS: InterventionId[] = ['GA_CONNECTION', 'GSC_CONNECTION', 'SOCIAL_CONNECTION', 'TEAM_EXPANSION', 'ADOPTION_EXPANSION', 'PROFILE_COMPLETION', 'DOMAIN_VERIFICATION'];

/** Pure, deterministic: which queues a single company belongs to (CUSTOMER only). */
export function queuesFor(c: OpsCompany): Array<{ queue: QueueName; reason: string }> {
  if (c.tenant_class !== 'CUSTOMER') return []; // governance: non-customers excluded
  const e = c.eligible_interventions;
  const qs: Array<{ queue: QueueName; reason: string }> = [];
  if (c.customer_state === 'AT_RISK' || c.customer_state === 'CHURNED') {
    qs.push({ queue: 'RETENTION', reason: `customer in ${c.customer_state}` });
  } else if (c.customer_state === 'EXPANDING' || c.customer_state === 'VALUE_REALIZING') {
    qs.push({ queue: 'EXPANSION', reason: `value-realizing customer (${c.customer_state})` });
  } else {
    if (c.customer_state === 'ACTIVATING' && e.some((x) => ACTIVATION_INTERVENTIONS.includes(x))) qs.push({ queue: 'ACTIVATION', reason: 'activating with eligible activation interventions' });
    if (c.customer_state === 'ADOPTING' && e.some((x) => ADOPTION_INTERVENTIONS.includes(x))) qs.push({ queue: 'ADOPTION', reason: 'adopting with eligible adoption interventions' });
    if ((c.customer_state === 'ADOPTING' || c.customer_state === 'ACTIVATING') && e.includes('VALUE_REALIZATION')) qs.push({ queue: 'VALUE', reason: 'no value yet; VALUE_REALIZATION eligible' });
  }
  if (qs.length === 0) qs.push({ queue: 'OBSERVATION', reason: c.eligible_interventions.length === 0 ? 'no eligible interventions (suppressed/no gap) — observe only' : 'state has no operational queue' });
  return qs;
}

export interface CustomerQueues { activation_queue: QueueEntry[]; adoption_queue: QueueEntry[]; value_queue: QueueEntry[]; retention_queue: QueueEntry[]; expansion_queue: QueueEntry[]; observation_queue: QueueEntry[]; }

const QUEUE_FIELD: Record<QueueName, keyof CustomerQueues> = { ACTIVATION: 'activation_queue', ADOPTION: 'adoption_queue', VALUE: 'value_queue', RETENTION: 'retention_queue', EXPANSION: 'expansion_queue', OBSERVATION: 'observation_queue' };
const byPriority = (a: QueueEntry, b: QueueEntry) => b.priority_score - a.priority_score || a.company_id.localeCompare(b.company_id);

/** Pure: build all six operational queues. */
export function buildCustomerQueues(companies: OpsCompany[]): CustomerQueues {
  const q: CustomerQueues = { activation_queue: [], adoption_queue: [], value_queue: [], retention_queue: [], expansion_queue: [], observation_queue: [] };
  for (const c of companies) {
    for (const { queue, reason } of queuesFor(c)) {
      q[QUEUE_FIELD[queue]].push({ company_id: c.company_id, company_name: c.company_name, customer_state: c.customer_state, priority_score: c.priority_score, queue_reason: reason, evidence: `state=${c.customer_state}; eligible=[${c.eligible_interventions.join(',') || 'none'}]`, confidence: c.overall_confidence });
    }
  }
  for (const f of Object.values(QUEUE_FIELD)) q[f].sort(byPriority);
  return q;
}

export interface AttentionEntry { company_id: string; company_name: string; customer_state: CustomerState; attention_score: number; priority_score: number; confidence: ConfidenceLevel; reason: string; }

const STATE_WEIGHT: Record<CustomerState, number> = { AT_RISK: 30, ACTIVATING: 20, ADOPTING: 15, EXPANDING: 12, VALUE_REALIZING: 10, CHURNED: 5, ONBOARDING: 8, PROSPECT: 3, UNKNOWN: 0 };
const CONF_WEIGHT: Record<ConfidenceLevel, number> = { HIGH: 5, MEDIUM: 2, LOW: 0, UNKNOWN: 0 };

/** Pure: reduce the portfolio to the smallest actionable set (CUSTOMER only). */
export function buildExecutiveAttentionList(companies: OpsCompany[]): { top_5: AttentionEntry[]; top_10: AttentionEntry[] } {
  const ranked = companies
    .filter((c) => c.tenant_class === 'CUSTOMER') // population integrity enforced
    .map((c) => ({
      company_id: c.company_id, company_name: c.company_name, customer_state: c.customer_state,
      attention_score: Math.round((c.priority_score + STATE_WEIGHT[c.customer_state] + (c.has_value ? 5 : 0) + CONF_WEIGHT[c.overall_confidence]) * 10) / 10,
      priority_score: c.priority_score, confidence: c.overall_confidence,
      reason: `priority ${c.priority_score} + state ${c.customer_state} + ${c.has_value ? 'value' : 'no value'} + conf ${c.overall_confidence}`,
    }))
    .sort((a, b) => b.attention_score - a.attention_score || a.company_id.localeCompare(b.company_id));
  return { top_5: ranked.slice(0, 5), top_10: ranked.slice(0, 10) };
}

export interface WorkloadAnalysis {
  total_companies: number; customer_companies: number; suppressed_companies: number;
  companies_per_queue: Record<QueueName, number>;
  overlap_between_queues: number; // customers in ≥ 2 queues
  customer_companies_without_actionable_queue: number; // OBSERVATION-only
  customer_companies_with_multiple_queues: number;
}

export function analyzeWorkload(companies: OpsCompany[]): WorkloadAnalysis {
  const customers = companies.filter((c) => c.tenant_class === 'CUSTOMER');
  const memberships = customers.map((c) => ({ c, qs: queuesFor(c).map((x) => x.queue) }));
  const companies_per_queue = Object.fromEntries(QUEUES.map((q) => [q, memberships.filter((m) => m.qs.includes(q)).length])) as Record<QueueName, number>;
  return {
    total_companies: companies.length,
    customer_companies: customers.length,
    suppressed_companies: companies.filter((c) => c.globally_suppressed || c.tenant_class !== 'CUSTOMER').length,
    companies_per_queue,
    overlap_between_queues: memberships.filter((m) => m.qs.length >= 2).length,
    customer_companies_without_actionable_queue: memberships.filter((m) => m.qs.length === 1 && m.qs[0] === 'OBSERVATION').length,
    customer_companies_with_multiple_queues: memberships.filter((m) => m.qs.length >= 2).length,
  };
}

export interface OperatingSystemResult { queues: CustomerQueues; executive_attention: { top_5: AttentionEntry[]; top_10: AttentionEntry[] }; workload: WorkloadAnalysis; }

/** Pure orchestrator. Read-only. */
export function buildCustomerSuccessOperatingSystem(companies: OpsCompany[]): OperatingSystemResult {
  return { queues: buildCustomerQueues(companies), executive_attention: buildExecutiveAttentionList(companies), workload: analyzeWorkload(companies) };
}
