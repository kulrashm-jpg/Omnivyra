/**
 * Alert Service — operator-facing fan-out from anomalies + job detections.
 *
 * cost_anomalies is the raw data layer. alerts is the acknowledgeable queue
 * humans work from. This service owns inserts into `alerts` and a small
 * dedup helper so the weekly job doesn't spam duplicate rows.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export type AlertType =
  | 'high_cost'
  | 'negative_margin'
  | 'leak_detected'
  | 'org_blocked'
  | 'pricing_missing'
  | 'weekly_over_limit';

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface CreateAlertOpts {
  type:             AlertType;
  organizationId?:  string | null;
  severity?:        AlertSeverity;
  message:          string;
  metadata?:        Record<string, unknown>;
  /**
   * When set, caller suppresses duplicate inserts if an unacknowledged
   * alert of the same (type, organizationId, dedupKey) exists. The
   * dedupKey lives in metadata.dedup_key — no schema change needed.
   */
  dedupKey?:        string;
}

/**
 * Insert an alert. Never throws. Dedup against unacknowledged alerts of the
 * same (type, organizationId, dedup_key) so a repeating condition (e.g.
 * ongoing negative margin) doesn't create N rows per week.
 */
export async function createAlert(opts: CreateAlertOpts): Promise<void> {
  try {
    if (opts.dedupKey) {
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('type', opts.type)
        .eq('acknowledged', false)
        .eq('organization_id', opts.organizationId ?? null)
        .contains('metadata', { dedup_key: opts.dedupKey })
        .limit(1);
      if (existing && existing.length > 0) return;
    }

    const metadata = opts.dedupKey
      ? { ...(opts.metadata ?? {}), dedup_key: opts.dedupKey }
      : opts.metadata ?? {};

    const { error } = await supabase.from('alerts').insert({
      type:            opts.type,
      organization_id: opts.organizationId ?? null,
      severity:        opts.severity ?? 'warn',
      message:         opts.message,
      metadata,
    });
    if (error) {
      logger.warn('alert_insert_failed', { type: opts.type, message: error.message });
    }
  } catch (err: any) {
    logger.warn('alert_create_error', { type: opts.type, message: err?.message });
  }
}
