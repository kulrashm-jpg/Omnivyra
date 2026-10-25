/**
 * Creator intake — the decisions the user makes on the FIRST screen ("Tell us once").
 *
 * Owner decision (2026-10-24): every input belongs on the previous screen — what the
 * asset must say (main message), how it is laid out, whether text sits inside the image
 * or alongside it, whether the brand is applied and how strongly, and the logo. The
 * editor then opens as a "here's what we'll make" confirmation instead of a second form.
 *
 * The brief itself (free text, audience, tone, CTA, offer, main message) travels in the
 * existing `marketing-brief` session key. These choices travel in their OWN key so the
 * shared brief key (also written by the Marketing workspace) keeps its shape. Parsing is
 * total and forgiving: a missing or malformed value simply falls back to the editor's
 * own default, exactly as before this screen existed.
 */
import type { AttachmentMode } from '../content/writerCreatorAttachmentContracts';
import { DEFAULT_BRAND_SELECTIONS, type BrandContextSelections } from './creatorWorkflowModel';
import type { WorkflowConfig } from './creatorWorkflowConfig';
import { readIndependentPaletteChoice, type IndependentPaletteChoice } from './creatorPaletteMode';

export const CREATOR_INTAKE_SESSION_KEY = 'omnivyra.creator.intake.v1';

export type IntakeBrandMode = 'brand-aware' | 'independent';
export type IntakeBrandPresence = 'minimal' | 'balanced' | 'strong';

export interface CreatorIntakeChoices {
  /** Image only: text painted inside the image, or the image beside the post text. */
  attachmentMode: AttachmentMode | null;
  brandMode: IntakeBrandMode | null;
  brandPresence: IntakeBrandPresence | null;
  includeLogo: boolean | null;
  /** The value of the asset's layout field (image/carousel `layout`, infographic `structureMode`). */
  layout: string | null;
  /**
   * Independent mode only: "Use the look's own colours" ('look') or "Open to
   * experimentation" ('experimental'). Optional so intakes written before this
   * choice existed parse unchanged; absent → the editor's default ('look').
   */
  paletteMode?: IndependentPaletteChoice | null;
}

export const EMPTY_CREATOR_INTAKE: CreatorIntakeChoices = {
  attachmentMode: null, brandMode: null, brandPresence: null, includeLogo: null, layout: null,
};

/** The config field that carries the asset's layout / structure choice. */
export function intakeLayoutFieldId(config: Pick<WorkflowConfig, 'fields'> | null | undefined): string | null {
  const ids = new Set((config?.fields ?? []).map((f) => f.id));
  if (ids.has('layout')) return 'layout';
  if (ids.has('structureMode')) return 'structureMode';
  return null;
}

/** The layout options offered on the intake screen, straight from the asset's config. */
export function intakeLayoutOptions(config: Pick<WorkflowConfig, 'fields'> | null | undefined): Array<{ value: string; label: string; description?: string }> {
  const id = intakeLayoutFieldId(config);
  const field = (config?.fields ?? []).find((f) => f.id === id);
  return field && 'options' in field && Array.isArray(field.options)
    ? field.options.map((o) => ({ value: o.value, label: o.label, description: o.description }))
    : [];
}

export function serializeCreatorIntake(choices: CreatorIntakeChoices): string {
  return JSON.stringify(choices);
}

export function readCreatorIntake(raw: string | null | undefined): CreatorIntakeChoices | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);
  return {
    attachmentMode: oneOf(o.attachmentMode, ['embedded_copy', 'supporting_visual'] as const),
    brandMode: oneOf(o.brandMode, ['brand-aware', 'independent'] as const),
    brandPresence: oneOf(o.brandPresence, ['minimal', 'balanced', 'strong'] as const),
    includeLogo: typeof o.includeLogo === 'boolean' ? o.includeLogo : null,
    layout: typeof o.layout === 'string' && o.layout.trim() ? o.layout.trim().slice(0, 64) : null,
    ...(readIndependentPaletteChoice(o.paletteMode) ? { paletteMode: readIndependentPaletteChoice(o.paletteMode) } : {}),
  };
}

/**
 * The intake as the editor's `restored` draft shape — the same slot the editor already
 * honours for brand mode/presence/selections, attachment mode and answers. Only values
 * the user actually chose are set; everything else keeps the editor's default.
 */
export function intakeToEditorRestore(
  intake: CreatorIntakeChoices | null,
  config: Pick<WorkflowConfig, 'fields'> | null | undefined,
): Record<string, unknown> | null {
  if (!intake) return null;
  const out: Record<string, unknown> = {};
  const layoutId = intakeLayoutFieldId(config);
  const validLayout = intake.layout && intakeLayoutOptions(config).some((o) => o.value === intake.layout);
  if (layoutId && validLayout) out.answers = { [layoutId]: intake.layout as string };
  if (intake.attachmentMode) out.standaloneAttachmentMode = intake.attachmentMode;
  if (intake.brandMode) out.brandMode = intake.brandMode;
  if (intake.brandPresence) out.brandPresence = intake.brandPresence;
  // The colour choice only exists in independent mode.
  if (intake.brandMode === 'independent' && readIndependentPaletteChoice(intake.paletteMode)) out.paletteChoice = intake.paletteMode;
  if (intake.includeLogo !== null) {
    const selections: BrandContextSelections = { ...DEFAULT_BRAND_SELECTIONS, logo: intake.includeLogo };
    out.brandSelections = selections;
  }
  return Object.keys(out).length > 0 ? out : null;
}
