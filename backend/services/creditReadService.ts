import { ownedDbTable } from '../db/writeOwner';

export interface CreditTransaction {
  id: string;
  transaction_type: string;
  credits_delta: number;
  balance_after: number;
  usd_equivalent: number | null;
  reference_type: string | null;
  note: string | null;
  created_at: string;
}

export interface OrgCreditSummary {
  organization_id: string;
  balance_credits: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  credit_rate_usd: number;
  balance_usd_equivalent: number;
  recent_transactions: CreditTransaction[];
}

export async function getOrgCreditSummary(organizationId: string): Promise<OrgCreditSummary | null> {
  const { data: credit } = await ownedDbTable('organization_credits')
    .select('free_balance, paid_balance, incentive_balance, lifetime_purchased, lifetime_consumed, credit_rate_usd')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!credit) return null;

  const { data: txRows } = await ownedDbTable('credit_transactions')
    .select('id, transaction_type, credits_delta, balance_after, usd_equivalent, reference_type, note, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const c = credit as {
    free_balance: number;
    paid_balance: number;
    incentive_balance: number;
    lifetime_purchased: number;
    lifetime_consumed: number;
    credit_rate_usd: number;
  };

  const totalBalance = (c.free_balance ?? 0) + (c.paid_balance ?? 0) + (c.incentive_balance ?? 0);

  return {
    organization_id: organizationId,
    balance_credits: totalBalance,
    lifetime_purchased: c.lifetime_purchased,
    lifetime_consumed: c.lifetime_consumed,
    credit_rate_usd: c.credit_rate_usd,
    balance_usd_equivalent: totalBalance * c.credit_rate_usd,
    recent_transactions: (txRows ?? []) as CreditTransaction[],
  };
}
