/**
 * Template Governance — pure, deterministic integrity + hardening logic.
 *
 * Reuses the canonical CreatorTemplate model. NO DB, NO renderer, NO generation,
 * NO AI. Every function is deterministic: identical inputs → identical output.
 * The service layer supplies reference counts (from campaign/calendar/asset
 * tables) and persists audit rows; ALL governance DECISIONS live here so there
 * is one governance layer and one set of validators.
 *
 *   Part A — reference integrity   (assertTemplateMutable)
 *   Part C — compatibility validation (validateTemplateForSave)
 *   Part D — change impact          (computeChangeImpact)
 *   Part E — audit trail            (buildAuditEntry)
 *
 * Part B (immutable versions) is enforced by the existing pure version helpers
 * in ./userTemplate (bumpVersion / snapshotVersion / restoreVersion — every save
 * is a new version; historical snapshots are never mutated) + version-aware
 * runtime registration in the service; this module adds its validation surface.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import { isTemplateAssetFamily } from './types';
import { INFOGRAPHIC_LAYOUTS } from './infographicStyle';
import { variantKeyForTemplate } from './styleVariants';

/* ── Reference integrity (Part A) ────────────────────────────────────── */

/** Counts of live references to a template, by surface. Supplied by the service. */
export interface TemplateReferenceCounts {
  drafts: number;
  scheduled: number;
  published: number;
  calendar: number;
  history: number;
}
export const ZERO_REFERENCES: TemplateReferenceCounts = Object.freeze({
  drafts: 0, scheduled: 0, published: 0, calendar: 0, history: 0,
});

export type GovernanceAction = 'modify' | 'archive' | 'delete';

export interface GovernanceResult {
  ok: boolean;
  errors: string[];
}

function totalReferences(r: TemplateReferenceCounts): number {
  return r.drafts + r.scheduled + r.published + r.calendar + r.history;
}

/**
 * Decide whether a governance action is permitted given live references.
 *   - delete : blocked while ANY surface references the template (would orphan
 *              assets that must resolve their version). Explicit per-surface errors.
 *   - modify : always permitted — edits create a NEW version (Part B); the
 *              referenced historical versions are never mutated.
 *   - archive: permitted — archiving hides the template from the gallery without
 *              breaking historical resolution.
 */
export function assertTemplateMutable(action: GovernanceAction, refs: TemplateReferenceCounts): GovernanceResult {
  if (action === 'modify' || action === 'archive') return { ok: true, errors: [] };
  // delete
  const errors: string[] = [];
  if (refs.drafts > 0) errors.push(`Referenced by ${refs.drafts} draft campaign(s).`);
  if (refs.scheduled > 0) errors.push(`Referenced by ${refs.scheduled} scheduled campaign(s).`);
  if (refs.published > 0) errors.push(`Referenced by ${refs.published} published asset(s).`);
  if (refs.calendar > 0) errors.push(`Referenced by ${refs.calendar} calendar item(s).`);
  if (refs.history > 0) errors.push(`Referenced by ${refs.history} asset history record(s).`);
  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors: [`Cannot delete a referenced template (${totalReferences(refs)} reference(s)).`, ...errors] };
}

/** Convenience: deletion is permitted only with zero references. */
export function assertTemplateDeletable(refs: TemplateReferenceCounts): GovernanceResult {
  return assertTemplateMutable('delete', refs);
}

/* ── Compatibility validation (Part C) ───────────────────────────────── */

function styleKeyFor(family: TemplateAssetFamily): 'infographicStyle' | 'imageStyle' | 'carouselStyle' {
  return family === 'image' ? 'imageStyle' : family === 'carousel' ? 'carouselStyle' : 'infographicStyle';
}

/**
 * Deterministic structural validation run BEFORE persisting a template. Returns
 * explicit errors; the caller rejects when `ok === false`. Validates:
 *   ✓ asset family            ✓ rendering contract (per family)
 *   ✓ style schema            ✓ required fields
 *   ✓ variant compatibility   (only the matching-family style may be set)
 */
export function validateTemplateForSave(template: CreatorTemplate): GovernanceResult {
  const errors: string[] = [];
  const t = template;

  // Asset family
  if (!isTemplateAssetFamily(t.assetFamily)) {
    errors.push(`Invalid asset family "${String(t.assetFamily)}".`);
    return { ok: false, errors }; // family gates the rest
  }
  if (!t.id || typeof t.id !== 'string') errors.push('Template id is required.');
  if (!t.name || typeof t.name !== 'string') errors.push('Template name is required.');

  // Rendering contract (must match the family + carry family-required inputs)
  const c = t.renderingContract;
  if (!c || typeof c !== 'object') {
    errors.push('Rendering contract is missing.');
  } else {
    if (c.family !== t.assetFamily) errors.push(`Rendering contract family "${c.family}" does not match asset family "${t.assetFamily}".`);
    if (c.renderingContractVersion === undefined || c.renderingContractVersion === null || c.renderingContractVersion === '') errors.push('Rendering contract version is missing.');
    if (t.assetFamily === 'infographic') {
      if (!c.infographicLayout || !(INFOGRAPHIC_LAYOUTS as readonly string[]).includes(c.infographicLayout)) {
        errors.push(`Infographic layout "${String(c.infographicLayout)}" is not a valid renderer layout.`);
      }
    } else if (t.assetFamily === 'carousel') {
      if (typeof c.frameCount !== 'number' || c.frameCount <= 0) errors.push('Carousel rendering contract requires a positive frameCount.');
    } else if (t.assetFamily === 'image') {
      if (!c.writerAssetType) errors.push('Image rendering contract requires a writerAssetType.');
      if (!c.attachmentMode) errors.push('Image rendering contract requires an attachmentMode.');
    }
  }

  // Style schema + variant/family compatibility — ONLY the matching-family style
  // field may be set (a user template must not carry a foreign-family style).
  const myKey = styleKeyFor(t.assetFamily);
  for (const key of ['infographicStyle', 'imageStyle', 'carouselStyle'] as const) {
    const present = (t as unknown as Record<string, unknown>)[key] != null;
    if (present && key !== myKey) errors.push(`A ${t.assetFamily} template must not carry ${key}.`);
  }
  const style = (t as unknown as Record<string, unknown>)[myKey];
  if (style != null) {
    if (t.assetFamily === 'infographic') {
      const s = style as Record<string, unknown>;
      if (!s.color_scheme || !s.card_style || !s.typography) errors.push('Infographic style is missing color_scheme / card_style / typography.');
    } else if (t.assetFamily === 'image') {
      const s = style as Record<string, unknown>;
      if (!s.colorScheme || !s.panel || !s.typography) errors.push('Image style is missing colorScheme / panel / typography.');
    } else {
      const s = style as Record<string, unknown>;
      if (!s.canvas || !s.frame || !s.panel) errors.push('Carousel style is missing canvas / frame / panel.');
    }
  }
  // Variant key must be resolvable (a known variant or 'default' for custom).
  if (typeof variantKeyForTemplate(t.id, t.assetFamily) !== 'string') errors.push('Style variant is not resolvable.');

  // Required fields — form definition must declare valid fields.
  const fd = t.formDefinition;
  if (!fd || typeof fd !== 'object' || !Array.isArray(fd.fields)) {
    errors.push('Form definition is missing or malformed.');
  } else {
    const allFields = [
      ...fd.fields,
      ...(fd.slides?.fields ?? []),
      ...(fd.sections?.fields ?? []),
    ];
    if (allFields.length === 0) errors.push('Template defines no editable fields.');
    for (const f of allFields) {
      if (!f || !f.key || !f.label) { errors.push('Every field requires a key and a label.'); break; }
    }
    if (t.assetFamily === 'carousel' && !fd.slides) errors.push('Carousel template requires a slides group.');
  }

  return { ok: errors.length === 0, errors };
}

/* ── Change impact (Part D) ──────────────────────────────────────────── */

export interface ChangeImpact {
  draftsAffected: number;
  scheduledAffected: number;
  /** Renders that will re-run with the NEW version (drafts + scheduled + calendar). */
  futureRendersAffected: number;
  /** Published assets + asset history are pinned to their original version. */
  historicalUnaffected: true;
  historicalCount: number;
  summary: string;
}

/**
 * Deterministic impact of editing an existing template. Editing creates a new
 * version, so future renders (drafts/scheduled/calendar) adopt it while
 * published/historical assets keep the version they were created with. No AI.
 */
export function computeChangeImpact(refs: TemplateReferenceCounts): ChangeImpact {
  const futureRendersAffected = refs.drafts + refs.scheduled + refs.calendar;
  const historicalCount = refs.published + refs.history;
  return {
    draftsAffected: refs.drafts,
    scheduledAffected: refs.scheduled,
    futureRendersAffected,
    historicalUnaffected: true,
    historicalCount,
    summary: `${futureRendersAffected} future render(s) will use the new version; ${historicalCount} historical asset(s) keep their original version.`,
  };
}

/* ── Audit trail (Part E) ────────────────────────────────────────────── */

export type TemplateAuditAction =
  | 'created' | 'edited' | 'published' | 'archived' | 'deleted' | 'restored'
  // Operational lifecycle events (CAMPAIGN-007) — same audit store/model.
  | 'updated' | 'version_created' | 'selected'
  | 'generation_started' | 'generation_succeeded' | 'generation_failed'
  | 'validation_failed' | 'render_succeeded' | 'render_failed' | 'deprecated';

export interface TemplateAuditEntry {
  action: TemplateAuditAction;
  templateId: string;
  templateVersion: number;
  actorUserId: string | null;
  at: string;
  detail?: string;
}

/** Build a deterministic audit entry. The service persists it (append-only). */
export function buildAuditEntry(action: TemplateAuditAction, ctx: {
  templateId: string; templateVersion: number; actorUserId?: string | null; at: string; detail?: string;
}): TemplateAuditEntry {
  return {
    action,
    templateId: ctx.templateId,
    templateVersion: ctx.templateVersion,
    actorUserId: ctx.actorUserId ?? null,
    at: ctx.at,
    detail: ctx.detail,
  };
}
