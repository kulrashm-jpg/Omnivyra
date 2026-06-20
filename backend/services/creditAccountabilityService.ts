/**
 * Credit accountability — READ-ONLY view of the separate credit buckets.
 *
 * The wallet already keeps three accountable buckets and spends them in a fixed
 * order (free → incentive → paid; see creditPriorityService.computeSplit). This
 * service surfaces that separation for the customer:
 *
 *   plan   (free bucket)      — included with the plan; spent FIRST; can expire.
 *   bonus  (incentive bucket) — promotional; spent SECOND; can expire.
 *   topup  (paid bucket)      — purchased; spent LAST; NEVER expires (DB-guarded).
 *
 * So top-up credits are only ever consumed once plan (monthly) + bonus credits
 * are fully used — and they don't expire. Read-only: mutates nothing.
 */
import { getWalletSnapshot, computeAvailable } from './creditPriorityService';

export type CreditBucketKey = 'plan' | 'bonus' | 'topup';

export interface CreditBucket {
  key: CreditBucketKey;
  label: string;
  /** Spendable now (balance − reserved). */
  available: number;
  reserved: number;
  balance: number;
  neverExpires: boolean;
  /** 1 = consumed first. */
  consumptionRank: number;
  note: string;
}

export interface CreditAccountability {
  buckets: CreditBucket[];
  totalAvailable: number;
  consumptionOrder: CreditBucketKey[];
  summary: string;
}

export async function getCreditAccountability(orgId: string): Promise<CreditAccountability | null> {
  const wallet = await getWalletSnapshot(orgId);
  if (!wallet) return null;
  const avail = computeAvailable(wallet);

  const buckets: CreditBucket[] = [
    {
      key: 'plan',
      label: 'Plan credits',
      available: avail.free,
      reserved: wallet.reserved_free,
      balance: wallet.free_balance,
      neverExpires: false,
      consumptionRank: 1,
      note: 'Included with your plan. Spent first; refresh each billing cycle.',
    },
    {
      key: 'bonus',
      label: 'Bonus credits',
      available: avail.incentive,
      reserved: wallet.reserved_incentive,
      balance: wallet.incentive_balance,
      neverExpires: false,
      consumptionRank: 2,
      note: 'Promotional credits. Spent after plan credits; may expire.',
    },
    {
      key: 'topup',
      label: 'Top-up credits',
      available: avail.paid,
      reserved: wallet.reserved_paid,
      balance: wallet.paid_balance,
      neverExpires: true,
      consumptionRank: 3,
      note: 'Purchased credits. Spent only after plan & bonus credits are fully consumed; never expire.',
    },
  ];

  return {
    buckets,
    totalAvailable: avail.total,
    consumptionOrder: ['plan', 'bonus', 'topup'],
    summary: 'Plan credits are spent first, then bonus, then top-ups. Top-up credits never expire.',
  };
}
