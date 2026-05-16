/**
 * Model Pricing Registry — Phase C
 *
 * Thin, cached read-through over the canonical `llm_model_pricing` table.
 * The existing pricingService already resolves cost given (provider, model,
 * tokens); this registry adds a memoised lookup so hot paths don't hit the
 * DB on every call.
 *
 * Cache TTL: 5 minutes. Pricing edits via super-admin UI invalidate the
 * cache out-of-band by calling `invalidateModelPricingCache()`.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export interface ModelPricingRow {
  provider:           string;
  modelName:          string;
  kind:               'completion' | 'embedding';
  inputPer1kUsd:      number;
  outputPer1kUsd:     number;
  effectiveFrom:      string;
  isActive:           boolean;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { rows: ModelPricingRow[]; expiresAt: number } | null = null;

async function loadModelPricing(): Promise<ModelPricingRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.rows;

  const { data, error } = await supabase
    .from('llm_model_pricing')
    .select('provider, model_name, kind, input_per_1k_usd, output_per_1k_usd, effective_from, is_active')
    .eq('is_active', true)
    .order('effective_from', { ascending: false });

  if (error) {
    logger.warn('model_pricing_load_failed', { message: error.message });
    return cache?.rows ?? [];
  }

  const rows: ModelPricingRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    provider:        String(r.provider),
    modelName:       String(r.model_name),
    kind:            (r.kind as ModelPricingRow['kind']),
    inputPer1kUsd:   Number(r.input_per_1k_usd),
    outputPer1kUsd:  Number(r.output_per_1k_usd),
    effectiveFrom:   String(r.effective_from),
    isActive:        Boolean(r.is_active),
  }));

  cache = { rows, expiresAt: now + TTL_MS };
  return rows;
}

export async function findModelPricing(args: {
  provider: string;
  model:    string;
  kind?:    'completion' | 'embedding';
}): Promise<ModelPricingRow | null> {
  const rows = await loadModelPricing();
  // Latest effective row wins (rows are returned ordered desc by effective_from).
  return rows.find(r =>
    r.provider === args.provider &&
    r.modelName === args.model &&
    (args.kind ? r.kind === args.kind : true)
  ) ?? null;
}

export async function listKnownModels(): Promise<Array<{ provider: string; model: string }>> {
  const rows = await loadModelPricing();
  const seen = new Set<string>();
  const out: Array<{ provider: string; model: string }> = [];
  for (const r of rows) {
    const k = `${r.provider}:${r.modelName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ provider: r.provider, model: r.modelName });
  }
  return out;
}

export function invalidateModelPricingCache(): void {
  cache = null;
}
