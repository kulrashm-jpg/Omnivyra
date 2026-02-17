/**
 * Stage 29 — Governance Lockdown Mode.
 * Global guard layer. Only 1 row in governance_lockdown (enforced in service).
 */

import { supabase } from '../db/supabaseClient';
import { recordGovernanceEvent } from './GovernanceEventService';

const LOCKDOWN_SINGLETON_ID = '00000000-0000-0000-0000-000000000001';
const LOCK_SENTINEL_COMPANY = '00000000-0000-0000-0000-000000000000';
const LOCK_SENTINEL_CAMPAIGN = '00000000-0000-0000-0000-000000000000';

async function emitLockEvent(eventType: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await recordGovernanceEvent({
      companyId: LOCK_SENTINEL_COMPANY,
      campaignId: LOCK_SENTINEL_CAMPAIGN,
      eventType,
      eventStatus: eventType.includes('TRIGGERED') ? 'LOCKED' : 'RELEASED',
      metadata,
    });
  } catch (err) {
    console.error('GovernanceLockdownService: emitLockEvent failed', err);
  }
}

/**
 * Check if governance lockdown is active. Never throws.
 */
export async function isGovernanceLocked(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('governance_lockdown')
      .select('locked')
      .limit(1)
      .maybeSingle();

    if (error || !data) return false;
    return Boolean((data as any).locked);
  } catch {
    return false;
  }
}

/**
 * Trigger governance lock. Throws on write failure.
 */
export async function triggerGovernanceLock(reason: string, userId: string): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('governance_lockdown')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('governance_lockdown')
      .update({
        locked: true,
        reason,
        triggered_at: now,
        triggered_by: userId,
        resolved_at: null,
        resolved_by: null,
      })
      .eq('id', (existing as any).id);

    if (error) throw new Error(`Failed to trigger governance lock: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('governance_lockdown')
      .insert({
        id: LOCKDOWN_SINGLETON_ID,
        locked: true,
        reason,
        triggered_at: now,
        triggered_by: userId,
        resolved_at: null,
        resolved_by: null,
      });

    if (error) throw new Error(`Failed to trigger governance lock: ${error.message}`);
  }

  await emitLockEvent('GOVERNANCE_LOCK_TRIGGERED', { reason, userId, triggered_at: now });
}

/**
 * Release governance lock. Throws on write failure.
 */
export async function releaseGovernanceLock(userId: string): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('governance_lockdown')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (!existing) {
    await emitLockEvent('GOVERNANCE_LOCK_RELEASED', { userId, resolved_at: now });
    return;
  }

  const { error } = await supabase
    .from('governance_lockdown')
    .update({
      locked: false,
      resolved_at: now,
      resolved_by: userId,
    })
    .eq('id', (existing as any).id);

  if (error) throw new Error(`Failed to release governance lock: ${error.message}`);

  await emitLockEvent('GOVERNANCE_LOCK_RELEASED', { userId, resolved_at: now });
}
