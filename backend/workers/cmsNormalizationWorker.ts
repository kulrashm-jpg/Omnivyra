/**
 * CMS connection normalization worker (idempotent, opt-in).
 *
 * Thin scheduler entrypoint around the existing, already-tested
 * `normalizeCmsConnections` service. It is NOT auto-registered in cron — wiring
 * a recurring schedule is an operational decision (deploy discipline / avoid
 * mass writes on deploy). Invoke manually, from an admin job, or register in
 * the scheduler when ready. Safe to run repeatedly: the underlying service
 * early-returns on already-normalized integrations.
 */
import { normalizeCmsConnections, type NormalizationSummary } from '../services/cms/cmsConnectionNormalizationService';

let running = false;

export async function runCmsNormalizationWorker(
  companyId?: string,
): Promise<NormalizationSummary | { skipped: true; reason: string }> {
  if (running) {
    return { skipped: true, reason: 'normalization already in progress' };
  }
  running = true;
  const startedAt = Date.now();
  try {
    const summary = await normalizeCmsConnections(companyId);
    console.warn(
      `[cms.normalizationWorker] done ${JSON.stringify({
        companyId: companyId ?? 'all',
        durationMs: Date.now() - startedAt,
        ...summary,
        errors: summary.errors.length,
      })}`,
    );
    return summary;
  } catch (err) {
    console.error(
      `[cms.normalizationWorker] failed ${JSON.stringify({
        companyId: companyId ?? 'all',
        error: err instanceof Error ? err.message : String(err),
      })}`,
    );
    throw err;
  } finally {
    running = false;
  }
}
