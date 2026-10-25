/**
 * Content-driven filling of a Creator draft from the resolved CreatorBrief.
 *
 * Three rules, all owner decisions (2026-10-24):
 *
 *   1. MAIN MESSAGE IS THE KEY. On "Text Inside Image" the primary on-image
 *      text (template lead field / overlay headline) is the main message.
 *      Supporting fields support it.
 *   2. EVERYTHING ELSE IS FILLED FROM CONTENT. Every empty field — template
 *      flat fields, overlay roles, carousel slides, infographic sections — is a
 *      field-assist target grounded in the whole brief.
 *   3. A FIELD THE USER EDITED IS NEVER OVERWRITTEN. User edits are tracked per
 *      field key; every planner here skips an edited key, whatever its value.
 *
 * Pure planners only. The page applies the plans and performs the fetches.
 */

import type { CreatorTemplate, TemplateField } from '../creator-templates/types';
import { IMAGE_COPY_FIELD_KEYS } from '../creator-templates/types';
import type { TemplateFieldValues } from '../creator-templates/values';
import type { WriterOverlayText } from '../content/writerCreatorAssetLaunch';
import { type CreatorBrief, clipWords, fitMainMessage, hasCreatorBriefContent } from './creatorBrief';
import { isFittingCta, isInstructionLikeCopy } from './creatorCopyPurpose';

/* ── Edit identity ─────────────────────────────────────────────────────── */

export type FillScope = 'flat' | 'slide' | 'section' | 'overlay';

/** One key per editable field: `flat::headline`, `slide:2:title`, `overlay::cta`. */
export function fieldEditKey(scope: FillScope, key: string, index?: number): string {
  return `${scope}:${typeof index === 'number' ? index : ''}:${key}`;
}

/** The field keys whose value differs between two editor states (a USER change). */
export function diffTemplateEdits(prev: TemplateFieldValues, next: TemplateFieldValues): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(prev.fields ?? {}), ...Object.keys(next.fields ?? {})]);
  for (const k of keys) {
    if (String(prev.fields?.[k] ?? '') !== String(next.fields?.[k] ?? '')) out.push(fieldEditKey('flat', k));
  }
  const rows = (scope: 'slide' | 'section', a?: Array<Record<string, string>>, b?: Array<Record<string, string>>) => {
    const n = Math.max(a?.length ?? 0, b?.length ?? 0);
    for (let i = 0; i < n; i += 1) {
      const ra = a?.[i] ?? {};
      const rb = b?.[i] ?? {};
      // A row that exists on only one side is a structural change (count
      // change, add/remove), not the user typing — it marks nothing.
      if (!a?.[i] || !b?.[i]) continue;
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (String(ra[k] ?? '') !== String(rb[k] ?? '')) out.push(fieldEditKey(scope, k, i));
      }
    }
  };
  rows('slide', prev.slides, next.slides);
  rows('section', prev.sections, next.sections);
  return out;
}

/* ── Template lead (the field the main message lands in) ────────────────── */

export function templateLeadField(template: CreatorTemplate): TemplateField | null {
  const fields = template.formDefinition.fields ?? [];
  return fields.find((f) => ['headline', 'title', 'quote'].includes(f.key)) ?? null;
}

const COPY_KEYS: ReadonlySet<string> = new Set(IMAGE_COPY_FIELD_KEYS);

/**
 * Seed the template from the brief. On an IMAGE template with on-image copy:
 *   lead (headline/title/quote) ← main message (fitted to the field),
 *   cta                         ← the viewer action.
 * A user-edited field is left alone. `condenseLead` is true when the message
 * had to be cut to fit — the caller then asks field-assist to condense it.
 *
 * Persuasive copy (owner 2026-10-25): a main message that is an INSTRUCTION
 * ("Create an engaging promotion for our …") is the brief, not copy — the lead
 * is NOT seeded from it (it stays empty for the content fill, which writes a
 * real headline about the subject). The viewer action is seeded only when it
 * fits the button WHOLE; a cut ("Discover your marketing clar") is never
 * seeded — the content fill writes a goal-specific button instead.
 */
export function seedTemplateFromBrief(input: {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  brief: CreatorBrief | null;
  edited: ReadonlySet<string>;
  imageCopyActive: boolean;
}): { values: TemplateFieldValues; changed: boolean; condenseLead: boolean; leadKey: string | null } {
  const { template, values, brief, edited, imageCopyActive } = input;
  const none = { values, changed: false, condenseLead: false, leadKey: null };
  if (!hasCreatorBriefContent(brief) || template.assetFamily !== 'image' || !imageCopyActive) return none;
  const fields = { ...(values.fields ?? {}) };
  let changed = false;
  let condenseLead = false;
  const lead = templateLeadField(template);
  if (lead && !edited.has(fieldEditKey('flat', lead.key)) && brief.mainMessage && !isInstructionLikeCopy(brief.mainMessage)) {
    const fit = fitMainMessage(brief.mainMessage, lead.maxLength);
    if (fit.value && fields[lead.key] !== fit.value) { fields[lead.key] = fit.value; changed = true; }
    condenseLead = !fit.exact;
  }
  const ctaField = (template.formDefinition.fields ?? []).find((f) => f.key === 'cta');
  if (ctaField && isFittingCta(brief.cta, ctaField.maxLength) && !edited.has(fieldEditKey('flat', 'cta')) && !String(fields.cta ?? '').trim()) {
    fields.cta = brief.cta.trim();
    changed = true;
  }
  return changed ? { values: { ...values, fields }, changed, condenseLead, leadKey: lead?.key ?? null }
    : { values, changed: false, condenseLead, leadKey: lead?.key ?? null };
}

export interface FillTarget {
  scope: 'flat' | 'slide' | 'section';
  fieldKey: string;
  index?: number;
  currentValue: string;
}

/**
 * Every template field that should be written from content: empty, AI-capable
 * and not user-edited — flat fields, every slide field, every section field.
 * A supporting flat field that merely duplicates the lead is rewritten too (a
 * subheadline must add to the headline, not repeat it). In "Post + Image" the
 * image-copy fields are not part of the composition and are skipped. The lead
 * is included only when `includeLead` (its main-message fit was inexact). A
 * field holding an INSTRUCTION ("Create a post for …", e.g. restored from an
 * older draft) is rewritten too — an instruction is never shipped as copy.
 */
export function planTemplateFillTargets(input: {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  edited: ReadonlySet<string>;
  imageCopyActive: boolean;
  includeLead?: boolean;
}): FillTarget[] {
  const { template, values, edited, imageCopyActive } = input;
  const fd = template.formDefinition;
  const targets: FillTarget[] = [];
  const lead = templateLeadField(template);
  const leadVal = lead ? String(values.fields?.[lead.key] ?? '').trim() : '';
  for (const f of fd.fields ?? []) {
    if (!f.aiAssist?.generate) continue;
    if (template.assetFamily === 'image' && !imageCopyActive && COPY_KEYS.has(f.key)) continue;
    if (edited.has(fieldEditKey('flat', f.key))) continue;
    const val = String(values.fields?.[f.key] ?? '').trim();
    const isLead = lead?.key === f.key;
    if (isLead) {
      if (!val || input.includeLead || isInstructionLikeCopy(val)) targets.push({ scope: 'flat', fieldKey: f.key, currentValue: val });
      continue;
    }
    const duplicatesLead = !!leadVal && val.toLowerCase() === leadVal.toLowerCase();
    if (!val || duplicatesLead || isInstructionLikeCopy(val)) targets.push({ scope: 'flat', fieldKey: f.key, currentValue: val });
  }
  const repeat = (scope: 'slide' | 'section', fields: readonly TemplateField[] | undefined, rows: Array<Record<string, string>> | undefined) => {
    if (!fields || !rows) return;
    rows.forEach((row, index) => {
      for (const f of fields) {
        if (!f.aiAssist?.generate) continue;
        if (edited.has(fieldEditKey(scope, f.key, index))) continue;
        if (String(row?.[f.key] ?? '').trim()) continue;
        targets.push({ scope, fieldKey: f.key, index, currentValue: '' });
      }
    });
  };
  repeat('slide', fd.slides?.fields, values.slides);
  repeat('section', fd.sections?.fields, values.sections);
  return targets;
}

/* ── Overlay (the copy painted on the creative) ─────────────────────────── */

export const OVERLAY_LIMITS: Record<keyof WriterOverlayText, number> = {
  hook: 76, headline: 84, keyInsight: 132, cta: 42, supportingText: 96,
};

/**
 * Overlay roles filled from content. A single IMAGE is a hero: hook + key
 * insight on top of headline + supporting exceeds the image text-density
 * profile (the render fails closed), so an image carries headline (the main
 * message), one supporting line and the CTA. Carousels / infographics render
 * per slide and carry the fuller set.
 */
export function overlayFillRoles(family: string | null | undefined): Array<keyof WriterOverlayText> {
  return family === 'image'
    ? ['headline', 'supportingText']
    : ['hook', 'headline', 'supportingText', 'keyInsight'];
}

/**
 * Deterministic overlay seed: headline ← main message, cta ← viewer action.
 * Skips user-edited roles; the CTA is only seeded into an empty slot.
 */
export function seedOverlayFromBrief(input: {
  overlay: WriterOverlayText;
  brief: CreatorBrief | null;
  edited: ReadonlySet<string>;
}): WriterOverlayText {
  const { overlay, brief, edited } = input;
  if (!hasCreatorBriefContent(brief)) return overlay;
  let next = overlay;
  if (brief.mainMessage && !isInstructionLikeCopy(brief.mainMessage) && !edited.has(fieldEditKey('overlay', 'headline'))) {
    const v = fitMainMessage(brief.mainMessage, OVERLAY_LIMITS.headline).value;
    if (v && v !== overlay.headline) next = { ...next, headline: v };
  }
  if (isFittingCta(brief.cta, OVERLAY_LIMITS.cta) && !edited.has(fieldEditKey('overlay', 'cta')) && !String(overlay.cta || '').trim()) {
    next = { ...next, cta: brief.cta.trim() };
  }
  return next;
}

/** Overlay roles to AI-fill: content-fill roles that are empty and not user-edited. */
export function planOverlayFillTargets(input: {
  overlay: WriterOverlayText;
  edited: ReadonlySet<string>;
  family: string | null | undefined;
}): Array<keyof WriterOverlayText> {
  return overlayFillRoles(input.family).filter((k) =>
    !input.edited.has(fieldEditKey('overlay', k)) && !String(input.overlay[k] || '').trim());
}

/* ── Chips (alternatives grounded in the content) ───────────────────────── */

export type OverlayChips = { hook: string[]; headline: string[]; supportingText: string[]; keyInsight: string[] };

/** Comparison key: whitespace-collapsed, lower-cased, trailing punctuation ignored. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/, '');

function sentencesOf(text: string): string[] {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.replace(/^[\-*\d.)\s]+/u, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 12 && /[A-Za-z]/.test(s));
}

function wordsOf(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}

/**
 * Overlay chips when content exists: AI alternatives first (when the fill
 * pass returned them), then variants derived from the brief itself — the main
 * message and its first clause for the headline, the body's own sentences
 * (ranked by overlap with the main message) for the rest. NO starter phrases:
 * every chip is a line from, or condensed from, the user's content.
 */
export function buildBriefOverlayChips(
  brief: CreatorBrief,
  aiAlternatives: Partial<Record<keyof WriterOverlayText, string[]>> = {},
): OverlayChips {
  const seen = new Set<string>();
  const take = (candidates: string[], max: number, limit = 3): string[] => {
    const out: string[] = [];
    for (const raw of candidates) {
      const c = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!c || c.length > max) continue;
      const k = norm(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  };
  const anchor = wordsOf(brief.mainMessage);
  const overlap = (s: string) => { let n = 0; for (const w of wordsOf(s)) if (anchor.has(w)) n += 1; return n; };
  const body = sentencesOf(brief.body).filter((s) => norm(s) !== norm(brief.mainMessage) && !isInstructionLikeCopy(s));
  const byRelevance = [...body].sort((a, b) => overlap(b) - overlap(a));
  // An instruction main message is the brief, not copy — it offers no chips.
  const messageIsCopy = !isInstructionLikeCopy(brief.mainMessage);
  const fitHeadline = messageIsCopy ? fitMainMessage(brief.mainMessage, OVERLAY_LIMITS.headline).value : '';
  const clause = messageIsCopy ? fitMainMessage(brief.mainMessage, 48).value : '';
  const PROOF = /\b(\d|proof|result|customers?|teams?|data|because|built|saves?|faster|less|more)\b/i;

  // Headline chips are variants OF the main message; a body line is only
  // offered when there are not yet two of those.
  const headline = take([
    ...(aiAlternatives.headline ?? []),
    fitHeadline,
    clause,
    brief.offer && brief.mainMessage ? `${brief.offer}: ${clause}` : '',
  ], OVERLAY_LIMITS.headline);
  if (headline.length < 2) headline.push(...take(byRelevance, OVERLAY_LIMITS.headline, 2 - headline.length));
  // Chips are unique ACROSS fields (one line is offered in one place). The
  // supporting line claims first — it is rendered on an image; the hook is not.
  const supportingText = take([
    ...(aiAlternatives.supportingText ?? []),
    ...body.filter((s) => PROOF.test(s)),
    ...byRelevance,
    brief.offer,
  ], OVERLAY_LIMITS.supportingText);
  const hook = take([
    ...(aiAlternatives.hook ?? []),
    ...[...byRelevance].sort((a, b) => a.length - b.length),
    brief.audience && clause ? `${brief.audience}: ${clause}` : '',
  ], OVERLAY_LIMITS.hook);
  const keyInsight = take([
    ...(aiAlternatives.keyInsight ?? []),
    ...[...byRelevance].sort((a, b) => b.length - a.length),
    messageIsCopy ? brief.mainMessage : '',
  ], OVERLAY_LIMITS.keyInsight);
  return { hook, headline, supportingText, keyInsight };
}

/* ── Copy editor (confirmation page: "Your copy") ───────────────────────── */

/** Flat keys that steer the visual, not the words — never shown as copy. */
const NON_COPY_KEY = /visual|direction|style|platform|branding|objective|template|colou?r|logo/i;

export interface CopyEditorEntry {
  scope: 'flat' | 'slide' | 'section';
  field: TemplateField;
  index?: number;
}

/**
 * The copy fields that will be RENDERED, in display order: the flat copy fields
 * (image headline / subheadline / button; a carousel or infographic title),
 * then every slide's fields, then every section's fields. `template` is the
 * template as the form presents it — in "Post + Image" the image-copy fields
 * are not on the image, so an image then has no on-image copy to show.
 */
export function copyEditorEntries(template: CreatorTemplate, values: TemplateFieldValues, imageCopyActive: boolean): CopyEditorEntry[] {
  const fd = template.formDefinition;
  const out: CopyEditorEntry[] = [];
  if (!(template.assetFamily === 'image' && !imageCopyActive)) {
    for (const f of fd.fields ?? []) {
      if (!f.aiAssist?.generate || NON_COPY_KEY.test(f.key)) continue;
      out.push({ scope: 'flat', field: f });
    }
  }
  (values.slides ?? []).forEach((_row, index) => {
    for (const f of fd.slides?.fields ?? []) if (f.aiAssist?.generate) out.push({ scope: 'slide', field: f, index });
  });
  (values.sections ?? []).forEach((_row, index) => {
    for (const f of fd.sections?.fields ?? []) if (f.aiAssist?.generate) out.push({ scope: 'section', field: f, index });
  });
  return out;
}

/** The current value of one copy-editor entry. */
export function copyEntryValue(values: TemplateFieldValues, e: { scope: 'flat' | 'slide' | 'section'; field: TemplateField; index?: number }): string {
  if (e.scope === 'flat') return String(values.fields?.[e.field.key] ?? '');
  const rows = e.scope === 'slide' ? values.slides : values.sections;
  return String(rows?.[e.index ?? -1]?.[e.field.key] ?? '');
}

/**
 * "Rewrite all copy with AI": every copy field, EXCEPT the ones the user edited
 * unless `includeEdited` (the user explicitly asked to rewrite those too).
 */
export function planCopyRewriteTargets(input: {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  edited: ReadonlySet<string>;
  imageCopyActive: boolean;
  includeEdited?: boolean;
}): FillTarget[] {
  return copyEditorEntries(input.template, input.values, input.imageCopyActive)
    .filter((e) => input.includeEdited || !input.edited.has(fieldEditKey(e.scope, e.field.key, e.index)))
    .map((e) => ({ scope: e.scope, fieldKey: e.field.key, index: e.index, currentValue: copyEntryValue(input.values, e) }));
}

/** Word-safe clip for AI copy landing on a length-capped slot (never mid-word). */
export const clipCopy = (value: string, max: number): string => clipWords(value, max);
