/**
 * canonicalProfileOverlay.ts — CONTENT-INTELLIGENCE-003 (pure overlay).
 *
 * Split out from canonicalProfileAdapter so the compatibility logic is testable
 * WITHOUT pulling in the heavy getProfile/aiGateway import chain. Pure + no I/O.
 *
 * Backfills EMPTY profile fields from canonical facts; NEVER overwrites a value
 * the profile already has (business rules preserved). When the profile already
 * contains a field, output is identical to the legacy profile.
 */
import type { CanonicalContext, Fact } from './canonicalContextTypes';

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function factValue<T>(f: Fact<T> | null): T | null {
  return f ? f.value : null;
}

export function overlayCanonicalOntoProfile<T extends Record<string, unknown>>(
  profile: T,
  ctx: CanonicalContext,
): T {
  const out: Record<string, unknown> = { ...profile };

  const setIfEmpty = (key: string, value: unknown) => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return;
    if (isEmpty(out[key])) out[key] = value;
  };
  const setPair = (scalarKey: string, listKey: string, list: string[] | null) => {
    if (!list || list.length === 0) return;
    if (isEmpty(out[scalarKey])) out[scalarKey] = list.join(', ');
    if (isEmpty(out[listKey])) out[listKey] = list;
  };

  setPair('products_services', 'products_services_list', factValue(ctx.offerings));
  const diffs = factValue(ctx.differentiators);
  if (diffs && diffs.length) {
    setIfEmpty('unique_value', diffs[0]);
    if (isEmpty(out.competitive_advantages)) out.competitive_advantages = diffs;
  }
  setIfEmpty('ideal_customer_profile', factValue(ctx.icp));
  setIfEmpty('target_audience', factValue(ctx.icp));
  const personas = factValue(ctx.personas);
  if (personas && personas.length && isEmpty(out.target_audience_list)) out.target_audience_list = personas;
  const pains = factValue(ctx.painPoints);
  if (pains && pains.length && isEmpty(out.pain_symptoms)) out.pain_symptoms = pains;
  setIfEmpty('industry', factValue(ctx.industry));
  setIfEmpty('brand_positioning', factValue(ctx.brandPositioning));
  setIfEmpty('brand_voice', factValue(ctx.brandPositioning));
  setPair('content_themes', 'content_themes_list', factValue(ctx.strategicDirection));
  const inits = factValue(ctx.currentInitiatives);
  if (inits && inits.length && isEmpty(out.growth_priorities)) out.growth_priorities = inits;

  return out as T;
}
