import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Thrown when a company's decision generation is THROTTLED (min_refresh_interval or
 * max_generations_per_hour). It is not a failure: a per-company loop treats it as "skip this
 * company this run". Its message is unchanged from the plain Error it replaces. Any other error from
 * enforceDecisionGenerationThrottle (an unreadable or unwritable controls row) is a real failure.
 */
export class DecisionGenerationThrottledError extends Error {
  constructor(message: string, public readonly companyId: string, public readonly source: string) {
    super(message);
    this.name = 'DecisionGenerationThrottledError';
  }
}

type GenerationControlRow = {
  company_id: string;
  min_refresh_interval_minutes: number;
  max_generations_per_hour: number;
  last_generation_at: string | null;
  generation_window_started_at: string | null;
  generation_count_in_window: number;
};

export async function enforceDecisionGenerationThrottle(companyId: string, source: string): Promise<void> {
  const { data, error } = await ownedDbTable('decision_generation_controls')
    .select('company_id, min_refresh_interval_minutes, max_generations_per_hour, last_generation_at, generation_window_started_at, generation_count_in_window')
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load decision generation controls for ${companyId}: ${error.message}`);
  }

  const now = new Date();
  const row = (data ?? {
    company_id: companyId,
    min_refresh_interval_minutes: 60,
    max_generations_per_hour: 12,
    last_generation_at: null,
    generation_window_started_at: null,
    generation_count_in_window: 0,
  }) as GenerationControlRow;

  const lastGenerationAt = row.last_generation_at ? new Date(row.last_generation_at) : null;
  if (lastGenerationAt) {
    const minRefreshMs = row.min_refresh_interval_minutes * 60 * 1000;
    if ((now.getTime() - lastGenerationAt.getTime()) < minRefreshMs) {
      throw new DecisionGenerationThrottledError(`${source} blocked by min_refresh_interval for company ${companyId}.`, companyId, source);
    }
  }

  const windowStartedAt = row.generation_window_started_at ? new Date(row.generation_window_started_at) : null;
  const sameHourWindow =
    windowStartedAt != null &&
    (now.getTime() - windowStartedAt.getTime()) < HOUR_MS;

  const generationCount = sameHourWindow ? row.generation_count_in_window : 0;
  if (generationCount >= row.max_generations_per_hour) {
    throw new DecisionGenerationThrottledError(`${source} blocked by max_generations_per_hour for company ${companyId}.`, companyId, source);
  }

  const { error: upsertError } = await ownedDbTable('decision_generation_controls')
    .upsert({
      company_id: companyId,
      min_refresh_interval_minutes: row.min_refresh_interval_minutes,
      max_generations_per_hour: row.max_generations_per_hour,
      last_generation_at: now.toISOString(),
      generation_window_started_at: sameHourWindow ? row.generation_window_started_at : now.toISOString(),
      generation_count_in_window: generationCount + 1,
    }, { onConflict: 'company_id' });

  if (upsertError) {
    throw new Error(`Failed to update decision generation controls for ${companyId}: ${upsertError.message}`);
  }
}
