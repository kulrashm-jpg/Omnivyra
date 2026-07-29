/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 7 — Execution Intelligence adoption seam.
 *
 * "Execution Intelligence" is mixed. The execution-planner CORE (executionPlannerService /
 * dailyPlanAiGenerator / planner-ops) is REFERENCE-ONLY (company_id is an FK; reads no company identity —
 * certified by a guard test). The campaign-AI / BOLT planning-prompt builders CONSUME company identity, but
 * the only PROJECTION-OWNED identity field among their reads is `category` (BOLT schedule governance
 * prompt). This seam routes that `category` acquisition through `resolveCompanyProjection`. It NEVER
 * repairs/reinterprets/overrides/reclassifies identity — it READS the projected value and overlays it onto
 * the profile the planner prompt reads. Pure & deterministic. Flag OFF (default) ⇒ same profile reference,
 * byte-identical (O(1) rollback).
 *
 * Scope: `industry` and the planner's strategy/audience fields (brand_positioning, growth_priorities,
 * key_messages, ICP, …) are NOT company identity on the projection surface and are unchanged here (strategy,
 * not identity). Execution planning may adapt strategy/sequencing/priorities on identity but never redefines it.
 */

import { readCompanyProfileIdentity, companyProfileRecordToInput, type CompanyProfileRecordLike } from './companyProfileConsumer';
import type { EvidenceSources } from '../../evidence';

/**
 * Overlay the projected company `category` onto a profile consumed by an execution/planning prompt. Flag
 * OFF ⇒ same reference (no-op); flag ON ⇒ projected category (evidence-derived when supplied, else
 * profile-derived echo). Pure & deterministic.
 */
export function adoptExecutionCompanyIdentity<T>(profile: T, companyId: string, asOf: string, evidence?: EvidenceSources): T {
  if (profile == null) return profile;
  const input = { ...companyProfileRecordToInput(profile as unknown as CompanyProfileRecordLike, companyId, asOf), evidence };
  const identity = readCompanyProfileIdentity(input);
  if (identity.projectionSource === 'legacy') return profile; // flag OFF / no canonical ⇒ untouched, same reference
  return { ...(profile as Record<string, unknown>), category: identity.category } as unknown as T;
}
