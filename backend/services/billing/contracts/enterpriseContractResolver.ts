/**
 * Enterprise Contract Resolver — Phase 3 F
 *
 * Reads enterprise_contracts and produces the effective pricing/allotment
 * context for an organization at a point in time. Pure read — write paths
 * (signing, status transitions) go through their own admin endpoints.
 *
 * Used by:
 *   - Invoice projection: to know how much of the period's usage is covered
 *     by the contract's allotment vs which is overage
 *   - Cost governance: to apply contract-specific overage rates
 *   - Dashboard: to surface contract status next to wallet state
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export interface ActiveContract {
  id:                       string;
  contractNumber:           string;
  organizationId:           string;
  startDate:                string;
  endDate:                  string;
  currency:                 string;
  totalContractValue:       number;
  paymentTerms:             string;
  totalCreditAllotment:     number;
  creditOverageRateUsd:     number | null;
  customActionPricing:      Record<string, unknown>;
  metadata:                 Record<string, unknown>;
}

export interface ContractContext {
  contract:             ActiveContract | null;
  isCovered:            boolean;
  periodAllotment:      number;
  overageRateUsd:       number | null;
  customActionOverrides: Record<string, number>;
}

export async function resolveActiveContract(orgId: string, atDate?: string): Promise<ActiveContract | null> {
  const checkDate = atDate ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('enterprise_contracts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .lte('start_date', checkDate)
    .gte('end_date', checkDate)
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn('contract_resolve_failed', { orgId, message: error.message });
    return null;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id:                   String(row.id),
    contractNumber:       String(row.contract_number),
    organizationId:       String(row.organization_id),
    startDate:            String(row.start_date),
    endDate:              String(row.end_date),
    currency:             String(row.currency),
    totalContractValue:   Number(row.total_contract_value),
    paymentTerms:         String(row.payment_terms),
    totalCreditAllotment: Number(row.total_credit_allotment),
    creditOverageRateUsd: row.credit_overage_rate_usd != null ? Number(row.credit_overage_rate_usd) : null,
    customActionPricing:  (row.custom_action_pricing as Record<string, unknown>) ?? {},
    metadata:             (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Produce the contract context applicable to a billing decision at this
 * moment. Callers that need point-in-time historical context pass `atDate`.
 */
export async function getContractContext(orgId: string, atDate?: string): Promise<ContractContext> {
  const contract = await resolveActiveContract(orgId, atDate);
  if (!contract) {
    return {
      contract: null,
      isCovered: false,
      periodAllotment: 0,
      overageRateUsd: null,
      customActionOverrides: {},
    };
  }
  // Derive per-action overrides — keys are action names, values are USD/action.
  const overrides: Record<string, number> = {};
  for (const [k, v] of Object.entries(contract.customActionPricing)) {
    const n = Number(v);
    if (Number.isFinite(n)) overrides[k] = n;
  }
  return {
    contract,
    isCovered: true,
    periodAllotment: contract.totalCreditAllotment,
    overageRateUsd: contract.creditOverageRateUsd,
    customActionOverrides: overrides,
  };
}

export async function listUpcomingContractExpirations(daysAhead = 60): Promise<ActiveContract[]> {
  const cutoff = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('enterprise_contracts')
    .select('*')
    .eq('status', 'active')
    .lte('end_date', cutoff)
    .order('end_date', { ascending: true });
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    id:                   String(row.id),
    contractNumber:       String(row.contract_number),
    organizationId:       String(row.organization_id),
    startDate:            String(row.start_date),
    endDate:              String(row.end_date),
    currency:             String(row.currency),
    totalContractValue:   Number(row.total_contract_value),
    paymentTerms:         String(row.payment_terms),
    totalCreditAllotment: Number(row.total_credit_allotment),
    creditOverageRateUsd: row.credit_overage_rate_usd != null ? Number(row.credit_overage_rate_usd) : null,
    customActionPricing:  (row.custom_action_pricing as Record<string, unknown>) ?? {},
    metadata:             (row.metadata as Record<string, unknown>) ?? {},
  }));
}
