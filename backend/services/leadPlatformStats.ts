/**
 * Platform conversion stats for lead prioritization.
 */

import { supabase } from '../db/supabaseClient';

export async function getConversionRate(
  companyId: string,
  platform: string
): Promise<number> {
  const { data } = await supabase
    .from('lead_platform_stats_v1')
    .select('conversion_rate')
    .eq('company_id', companyId)
    .eq('platform', platform.toLowerCase())
    .maybeSingle();

  const rate = Number(data?.conversion_rate ?? 0);
  return Math.max(0, Math.min(1, rate));
}

export function applyPlatformWeight(
  totalScore: number,
  conversionRate: number
): number {
  const platformWeight = conversionRate > 0 ? 1 + conversionRate * 0.25 : 1;
  return Math.max(0, Math.min(1, totalScore * platformWeight));
}
