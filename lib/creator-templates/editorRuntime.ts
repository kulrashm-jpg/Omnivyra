/**
 * Editor Runtime — the canonical editing surface for Template Population. The
 * editor binds to ONE source of truth (the `CreatorTemplatePopulation`) plus a
 * thin per-field OVERRIDE layer; it never keeps a parallel editable copy. Every
 * editable field reads its canonical populated value; a placeholder shows ONLY
 * when the canonical value is genuinely empty. Per-field ownership (AUTO →
 * MANUAL → RESET) governs whether upstream re-population may overwrite a field.
 * Preview and the renderer consume the SAME effective population the editor
 * shows — no preview-specific formatter, no paraphrasing. Pure + deterministic.
 */

import type { CreatorTemplatePopulation, PopulationOwner, PopulationCoverage } from './templatePopulation';
import type { AssetAssembly } from './assetAssembly';

export type FieldOwner = 'AUTO' | 'MANUAL';
export type FieldLocation = 'field' | 'slide' | 'section';

export interface FieldProvenance {
  planner: PopulationOwner | 'derived';
  assemblyUnit: string | null;   // origin Asset Assembly unit id (slides/sections)
  mapping: string;               // origin Template Population mapping (field key → owner)
}

export interface EditorField {
  ref: string;                   // 'field:headline' | 'slide:0:title' | 'section:1:label'
  key: string;
  location: FieldLocation;
  index: number | null;
  value: string;                 // EFFECTIVE value (manual override or canonical)
  canonicalValue: string;        // the populated (AUTO) value
  placeholder: string;           // shown ONLY when value is empty
  owner: FieldOwner;
  populated: boolean;            // canonical value is non-empty
  provenance: FieldProvenance;
}

export interface EditorState {
  population: CreatorTemplatePopulation;
  assembly: AssetAssembly | null;
  overrides: Record<string, string>;   // ref → manual value (presence ⇒ MANUAL)
}

/* ── Placeholders (shown only when canonical is empty) ─────────────────── */

const PLACEHOLDERS: Array<[RegExp, string]> = [
  [/headline|title|heading/, 'Add headline…'],
  [/subheadline|subtitle|body|description|summary|caption|text/, 'Supporting text…'],
  [/cta|button|action/, 'Call to action'],
  [/quote|testimonial/, 'Quote'],
  [/stat|metric|value|number|percent|figure/, 'Statistic'],
  [/bullet|list|point|item/, 'Bullet'],
  [/label|step|year|milestone|stage/, 'Label'],
  [/author|attribution/, 'Attribution'],
];
function placeholderFor(key: string): string {
  const lc = key.toLowerCase();
  const hit = PLACEHOLDERS.find(([re]) => re.test(lc));
  return hit ? hit[1] : 'Value';
}

function ownerFromKey(key: string): PopulationOwner {
  const k = key.toLowerCase();
  if (/cta|button|action/.test(k)) return 'AssetAssembly:Conversion';
  if (/label|step|year|milestone|stage/.test(k)) return 'AssetAssembly:StoryBlueprint';
  return 'AssetAssembly:VisualMessaging';
}

/* ── Build / read the editor model ─────────────────────────────────────── */

export function createEditorState(population: CreatorTemplatePopulation, assembly: AssetAssembly | null = null): EditorState {
  return { population, assembly, overrides: {} };
}

function canonicalValueAt(pop: CreatorTemplatePopulation, location: FieldLocation, index: number | null, key: string): string {
  if (location === 'field') return pop.fields[key] ?? '';
  if (location === 'slide') { const row = index !== null ? pop.slides[index] : undefined; return row ? row[key] ?? '' : ''; }
  const row = index !== null ? pop.sections[index] : undefined;
  return row ? row[key] ?? '' : '';
}

function provenanceFor(state: EditorState, location: FieldLocation, index: number | null, key: string): FieldProvenance {
  const planner = state.population.ownership[key] ?? ownerFromKey(key);
  let assemblyUnit: string | null = null;
  if (state.assembly && index !== null) {
    const unit = state.assembly.assets[index];
    assemblyUnit = unit ? unit.id : null;
  } else if (state.assembly) {
    const hero = state.assembly.assets.find((u) => u.hierarchy === 'Hero') ?? state.assembly.assets[0];
    assemblyUnit = hero ? hero.id : null;
  }
  return { planner: state.population.ownership[key] ? planner : 'derived', assemblyUnit, mapping: `${key} → ${planner}` };
}

function buildField(state: EditorState, ref: string, location: FieldLocation, index: number | null, key: string): EditorField {
  const canonicalValue = canonicalValueAt(state.population, location, index, key);
  const overridden = Object.prototype.hasOwnProperty.call(state.overrides, ref);
  const value = overridden ? state.overrides[ref] : canonicalValue;
  return {
    ref, key, location, index, value, canonicalValue,
    placeholder: placeholderFor(key),
    owner: overridden ? 'MANUAL' : 'AUTO',
    populated: canonicalValue.trim().length > 0,
    provenance: provenanceFor(state, location, index, key),
  };
}

/** Derived editor view — every editable field with its EFFECTIVE value. */
export function editorFields(state: EditorState): EditorField[] {
  const out: EditorField[] = [];
  for (const key of Object.keys(state.population.fields)) out.push(buildField(state, `field:${key}`, 'field', null, key));
  state.population.slides.forEach((row, i) => { for (const key of Object.keys(row)) out.push(buildField(state, `slide:${i}:${key}`, 'slide', i, key)); });
  state.population.sections.forEach((row, i) => { for (const key of Object.keys(row)) out.push(buildField(state, `section:${i}:${key}`, 'section', i, key)); });
  return out;
}

/* ── Editing — AUTO → MANUAL → RESET ───────────────────────────────────── */

/** Edit a field → it becomes MANUAL and is shielded from upstream re-population. */
export function editField(state: EditorState, ref: string, value: string): EditorState {
  return { ...state, overrides: { ...state.overrides, [ref]: value } };
}

/** Reset a field → MANUAL→AUTO, restoring the canonical populated value. */
export function resetField(state: EditorState, ref: string): EditorState {
  if (!Object.prototype.hasOwnProperty.call(state.overrides, ref)) return state;
  const next = { ...state.overrides };
  delete next[ref];
  return { ...state, overrides: next };
}

/** Regenerate — drop ALL manual overrides, restoring full AUTO ownership. */
export function regenerateContent(state: EditorState): EditorState {
  return { ...state, overrides: {} };
}

/**
 * Live synchronization. Upstream (Message → Asset Assembly → Template
 * Population) produced a new population. AUTO fields pick up the new canonical
 * values; MANUAL fields are NEVER overwritten (their overrides persist).
 */
export function applyUpstreamPopulation(state: EditorState, population: CreatorTemplatePopulation, assembly: AssetAssembly | null = state.assembly): EditorState {
  // Drop overrides whose ref no longer exists in the new population shape.
  const validRefs = new Set(editorFields({ population, assembly, overrides: {} }).map((f) => f.ref));
  const overrides: Record<string, string> = {};
  for (const [ref, value] of Object.entries(state.overrides)) if (validRefs.has(ref)) overrides[ref] = value;
  return { population, assembly, overrides };
}

/* ── Effective population — the ONE object preview + renderer consume ───── */

/** The population with manual overrides applied: identical for editor, preview, renderer. */
export function effectivePopulation(state: EditorState): CreatorTemplatePopulation {
  const pop: CreatorTemplatePopulation = JSON.parse(JSON.stringify(state.population));
  for (const [ref, value] of Object.entries(state.overrides)) {
    const parts = ref.split(':');
    if (parts[0] === 'field') { if (Object.prototype.hasOwnProperty.call(pop.fields, parts[1])) pop.fields[parts[1]] = value; continue; }
    const i = Number(parts[1]);
    const key = parts.slice(2).join(':');
    if (parts[0] === 'slide' && pop.slides[i]) pop.slides[i][key] = value;
    if (parts[0] === 'section' && pop.sections[i]) pop.sections[i][key] = value;
  }
  return pop;
}

/** Preview input == renderer input == effective population. One transformation, no formatter. */
export function toPreviewModel(state: EditorState): CreatorTemplatePopulation { return effectivePopulation(state); }
export function toRenderPayload(state: EditorState): { fields: Record<string, string>; slides: Array<Record<string, string>>; sections: Array<Record<string, string>> } {
  const pop = effectivePopulation(state);
  return { fields: pop.fields, slides: pop.slides, sections: pop.sections };
}

/* ── Summary (read-only) ───────────────────────────────────────────────── */

export interface EditorSummary {
  contentSource: string;
  messageFoundation: string;
  communicationStrategy: string;
  audienceJourney: string;
  storyBlueprint: string;
  visualMessagingPlan: string;
  conversionGoal: string;
  template: string;
  templateFamily: string;
  assetAssemblyVersion: string;
  templatePopulationVersion: string;
  overrideCount: number;
  wordCount: number;
  blueprint: string;
  communicationIntent: string;
  audienceStage: string;
  contentArchitecture: string[];
}

export function editorSummary(state: EditorState): EditorSummary {
  const a = state.assembly;
  const fields = editorFields(state);
  const wordCount = fields.reduce((n, f) => n + (f.value.trim() ? f.value.trim().split(/\s+/).length : 0), 0);
  return {
    contentSource: a ? (a.metadata.strategy as string) ?? 'package' : 'population',
    messageFoundation: a ? a.message.mainMessage : '',
    communicationStrategy: a ? a.communication.strategy : '',
    audienceJourney: a ? a.journey.id : '',
    storyBlueprint: a ? a.storyBlueprint.id : '',
    visualMessagingPlan: a ? a.visualMessaging.overallVisualIntent : '',
    conversionGoal: a ? a.conversion.goal : '',
    template: state.population.templateId,
    templateFamily: state.population.assetFamily,
    assetAssemblyVersion: a ? a.assemblyId : 'n/a',
    templatePopulationVersion: `pop-${state.population.templateId}-${state.population.assetFamily}`,
    overrideCount: Object.keys(state.overrides).length,
    wordCount,
    blueprint: a ? a.storyBlueprint.id : '',
    communicationIntent: a ? a.communication.intent : '',
    audienceStage: a ? a.journey.awarenessStage : '',
    contentArchitecture: a ? a.architecture.contentSequence : [],
  };
}

/* ── Diagnostics ───────────────────────────────────────────────────────── */

export interface EditorDiagnostics {
  populationCompleteness: number;
  autoFields: number;
  manualFields: number;
  missingFields: string[];
  overriddenFields: string[];
  syncHealth: 'OK' | 'DRIFT';
  editorPreviewParity: boolean;
  previewRendererParity: boolean;
  templateCoverage: PopulationCoverage;
  provenanceComplete: boolean;
}

export function editorDiagnostics(state: EditorState): EditorDiagnostics {
  const fields = editorFields(state);
  const manual = fields.filter((f) => f.owner === 'MANUAL');
  const missing = fields.filter((f) => !f.value.trim());
  // Editor↔Preview parity: the preview model IS the effective population by
  // construction; verify field-for-field equality (no hidden transformation).
  const effective = effectivePopulation(state);
  const preview = toPreviewModel(state);
  const render = toRenderPayload(state);
  const editorPreviewParity = JSON.stringify({ f: effective.fields, s: effective.slides, x: effective.sections }) === JSON.stringify({ f: preview.fields, s: preview.slides, x: preview.sections });
  const previewRendererParity = JSON.stringify({ f: preview.fields, s: preview.slides, x: preview.sections }) === JSON.stringify({ f: render.fields, s: render.slides, x: render.sections });
  const provenanceComplete = fields.every((f) => !!f.provenance.mapping);
  return {
    populationCompleteness: Math.round((fields.filter((f) => f.value.trim()).length / Math.max(1, fields.length)) * 100) / 100,
    autoFields: fields.filter((f) => f.owner === 'AUTO').length,
    manualFields: manual.length,
    missingFields: missing.map((f) => f.ref),
    overriddenFields: manual.map((f) => f.ref),
    syncHealth: editorPreviewParity && previewRendererParity ? 'OK' : 'DRIFT',
    editorPreviewParity,
    previewRendererParity,
    templateCoverage: state.population.coverage,
    provenanceComplete,
  };
}
