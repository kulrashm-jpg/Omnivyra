import type { Snapshot } from '../types';

export async function fetchMarketingIntel(companyId: string, days: number): Promise<Snapshot> {
  const res = await fetch(
    `/api/intelligence/snapshot?companyId=${encodeURIComponent(companyId)}&days=${days}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
