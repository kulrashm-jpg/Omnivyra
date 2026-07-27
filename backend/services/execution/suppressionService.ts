/**
 * LC-501 (W5.1) — C1 Suppression & Consent Platform (THE ONE suppression engine).
 *
 * Every outbound connector MUST consult `isSuppressed` before dispatch — there is no
 * other suppression logic anywhere. Covers global + tenant scope, per-channel, and the
 * reasons unsubscribe / consent_withdrawn / dsar / legal_hold / bounce / complaint / manual.
 * Reuses `ownedDbTable` (same write seam + observability). Fail-CLOSED for safety: a
 * lookup error suppresses (never lets a message through on an error).
 */

import { ownedDbTable } from '../../db/writeOwner';

const T = 'suppression_entries';
const norm = (v: string): string => String(v ?? '').trim().toLowerCase();

export type SuppressionReason = 'unsubscribe' | 'consent_withdrawn' | 'dsar' | 'legal_hold' | 'bounce' | 'complaint' | 'manual';

export interface SuppressionResult { suppressed: boolean; reason?: string; scope?: string }

/** Is this target suppressed for this channel? Global OR tenant, any-channel OR the channel. */
export async function isSuppressed(companyId: string, channel: string, target: string): Promise<SuppressionResult> {
  const t = norm(target);
  if (!t) return { suppressed: false };
  try {
    const { data, error } = await ownedDbTable(T)
      .select('reason, scope, company_id, channel')
      .eq('target', t)
      .eq('active', true)
      .in('channel', ['*', channel])
      .in('company_id', ['__global__', companyId])
      .limit(1);
    if (error) return { suppressed: true, reason: 'suppression_lookup_error_failclosed' }; // fail-closed
    const row = Array.isArray(data) && data[0] ? (data[0] as Record<string, unknown>) : null;
    return row ? { suppressed: true, reason: String(row.reason), scope: String(row.scope) } : { suppressed: false };
  } catch {
    return { suppressed: true, reason: 'suppression_exception_failclosed' };
  }
}

export async function addSuppression(input: { companyId: string | null; channel?: string; target: string; reason: SuppressionReason; actor?: string | null; metadata?: Record<string, unknown> }): Promise<{ id: string | null }> {
  const { data } = await ownedDbTable(T).upsert({
    company_id: input.companyId ?? '__global__', scope: input.companyId ? 'tenant' : 'global', channel: input.channel ?? '*',
    target: norm(input.target), reason: input.reason, created_by: input.actor ?? null, metadata: input.metadata ?? {}, active: true, released_at: null,
  }, { onConflict: 'company_id,channel,target' }).select('id').maybeSingle();
  return { id: data ? String((data as any).id) : null };
}

export async function releaseSuppression(companyId: string | null, channel: string, target: string): Promise<void> {
  await ownedDbTable(T).update({ active: false, released_at: new Date().toISOString() })
    .eq('target', norm(target)).eq('channel', channel).eq('active', true)
    .eq('company_id', companyId ?? '__global__');
}

/** Convenience: record an unsubscribe (the most common consumer-facing path). */
export const unsubscribe = (companyId: string, target: string, channel = '*', actor?: string) =>
  addSuppression({ companyId, channel, target, reason: 'unsubscribe', actor });
