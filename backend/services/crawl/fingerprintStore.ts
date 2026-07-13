/**
 * fingerprintStore.ts — persist the latest website fingerprint (CKRE-001 §4).
 *
 * Reuses the EXISTING company_profiles.report_settings JSONB — NO new table,
 * no migration. The latest bundle lives at report_settings.website_fingerprint
 * (which already carries hash + timestamp + algorithm + source + version per §4).
 * Reads/writes are best-effort and fail-safe: a store failure never breaks a
 * crawl. report_settings is merged (never overwritten) so sibling keys
 * (discovered_metadata, activation_latch, market_pulse, …) are preserved.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import type { WebsiteFingerprint } from './websiteFingerprintService';

const FINGERPRINT_KEY = 'website_fingerprint';

/** Read the latest stored fingerprint for a company, or null. Never throws. */
export async function getLatestWebsiteFingerprint(companyId: string): Promise<WebsiteFingerprint | null> {
  if (!companyId) return null;
  try {
    const { data } = await supabase
      .from('company_profiles')
      .select('report_settings')
      .eq('company_id', companyId)
      .maybeSingle();
    const rs = (data as { report_settings?: Record<string, unknown> } | null)?.report_settings;
    const fp = rs?.[FINGERPRINT_KEY];
    return fp && typeof fp === 'object' ? (fp as WebsiteFingerprint) : null;
  } catch {
    return null;
  }
}

/**
 * Merge the latest fingerprint into report_settings. Best-effort; a failure is
 * logged and swallowed. Idempotent — storing the same bundle twice is a no-op
 * in effect (overwrites with identical data).
 */
export async function saveWebsiteFingerprint(companyId: string, fingerprint: WebsiteFingerprint): Promise<void> {
  if (!companyId) return;
  try {
    const { data } = await supabase
      .from('company_profiles')
      .select('report_settings')
      .eq('company_id', companyId)
      .maybeSingle();

    const current = ((data as { report_settings?: Record<string, unknown> } | null)?.report_settings) ?? {};
    const next = { ...current, [FINGERPRINT_KEY]: fingerprint };

    const { error } = await supabase
      .from('company_profiles')
      .update({ report_settings: next, updated_at: new Date().toISOString() })
      .eq('company_id', companyId);
    if (error) {
      logger.warn('website_fingerprint_store_failed', { companyId, message: error.message });
    }
  } catch (err) {
    logger.warn('website_fingerprint_store_threw', {
      companyId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
