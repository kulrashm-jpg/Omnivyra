/**
 * Company Signal Distribution Service
 * Phase-4: Distributes newly inserted intelligence signals to all companies with active configuration.
 */

import { supabase } from '../db/supabaseClient';

const BATCH_SIZE = 50;

/**
 * Fetch company_ids that have at least one enabled entry in any Phase-3 config table.
 */
export async function fetchActiveCompanies(): Promise<string[]> {
  const tables = [
    'company_intelligence_topics',
    'company_intelligence_competitors',
    'company_intelligence_products',
    'company_intelligence_regions',
    'company_intelligence_keywords',
  ] as const;

  const companyIds = new Set<string>();

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('company_id')
      .eq('enabled', true);

    if (error) continue;
    for (const row of data ?? []) {
      const cid = (row as { company_id: string }).company_id;
      if (cid) companyIds.add(cid);
    }
  }

  return [...companyIds];
}

/**
 * Get signal_ids from insertedSignalIds that company does not yet have in company_intelligence_signals.
 */
async function getNewSignalIdsForCompany(
  companyId: string,
  signalIds: string[]
): Promise<string[]> {
  if (signalIds.length === 0) return [];

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id')
    .eq('company_id', companyId)
    .in('signal_id', signalIds);

  if (error) return signalIds;

  const existing = new Set((data ?? []).map((r: { signal_id: string }) => r.signal_id));
  return signalIds.filter((id) => !existing.has(id));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function processCompanyBatches(
  companyId: string,
  batches: string[][]
): Promise<{ inserted: number; skipped: number }> {
  const { processInsertedSignalsForCompany } = await import('./companyIntelligenceStore');
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const batch of batches) {
    if (batch.length === 0) continue;
    const result = await processInsertedSignalsForCompany(companyId, batch);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
  }

  return { inserted: totalInserted, skipped: totalSkipped };
}

/**
 * Distribute inserted signals to all active companies.
 * Runs processInsertedSignalsForCompany for each company.
 * Batches signal IDs if > 50. Runs asynchronously (fire-and-forget).
 */
export async function distributeSignalsToCompanies(
  insertedSignalIds: string[]
): Promise<{ companiesProcessed: number; totalInserted: number; totalSkipped: number }> {
  if (insertedSignalIds.length === 0) {
    return { companiesProcessed: 0, totalInserted: 0, totalSkipped: 0 };
  }

  const companyIds = await fetchActiveCompanies();
  if (companyIds.length === 0) {
    return { companiesProcessed: 0, totalInserted: 0, totalSkipped: 0 };
  }

  const batches =
    insertedSignalIds.length > BATCH_SIZE ? chunk(insertedSignalIds, BATCH_SIZE) : [insertedSignalIds];

  let totalInserted = 0;
  let totalSkipped = 0;
  let companiesProcessed = 0;

  for (const companyId of companyIds) {
    const newSignalIds = await getNewSignalIdsForCompany(companyId, insertedSignalIds);
    if (newSignalIds.length === 0) continue;

    const companyBatches = newSignalIds.length > BATCH_SIZE ? chunk(newSignalIds, BATCH_SIZE) : [newSignalIds];

    try {
      const result = await processCompanyBatches(companyId, companyBatches);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      companiesProcessed += 1;
    } catch (err) {
      console.warn(
        `[companySignalDistribution] failed for company ${companyId}:`,
        (err as Error)?.message
      );
    }
  }

  return { companiesProcessed, totalInserted, totalSkipped };
}
