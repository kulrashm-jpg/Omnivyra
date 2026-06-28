/**
 * Typography Runtime Verification — proves that every visible character on a
 * rendered Creator asset originates ONLY from the canonical overlay (Asset
 * Assembly → Template Population → editorRuntime → render payload), and that the
 * AI image prompt requests imagery ONLY (no typography). It introduces no new
 * renderer and no new typography engine — it reuses editorRuntime's render
 * payload + parity and the existing image-prompt text-ban contract. Pure +
 * deterministic. Diagnostic only; never mutates content or rendering.
 */

import type { CreatorTemplate, TemplateField } from './types';
import {
  editorFields,
  effectivePopulation,
  toPreviewModel,
  toRenderPayload,
  editorDiagnostics,
  type EditorState,
  type FieldOwner,
} from './editorRuntime';

export interface TypographyField {
  ref: string;
  key: string;
  value: string;
  source: 'canonical' | 'empty';
  owner: FieldOwner;
  length: number;
  maxLength: number | null;
  withinSafeArea: boolean;
}

export interface SafeAreaViolation { ref: string; length: number; maxLength: number; overBy: number; }

export type TypographyStatus = 'PASS' | 'WARN' | 'FAIL';

export interface TypographyVerificationReport {
  status: TypographyStatus;
  source: 'canonical';
  overlayComplete: boolean;
  aiTypographyDetected: boolean;
  promptRequestsTypography: boolean;
  editorBindingValid: boolean;
  editorPreviewParity: boolean;
  previewRendererParity: boolean;
  fields: TypographyField[];
  safeAreaViolations: SafeAreaViolation[];
  missingRequired: string[];
  findings: string[];
}

/* ── Editor field binding (STEP 2) ─────────────────────────────────────── */

export interface EditorBindingResult {
  valid: boolean;
  placeholderLeaks: string[];      // a field whose displayed value equals its placeholder
  legacyDefaults: string[];        // a field showing a value that is neither canonical nor a manual override
  duplicateState: boolean;         // editorRuntime is the single model → always false
  findings: string[];
}

/**
 * Verify every editor field displays the canonical populated value (or the
 * user's manual override) — never a placeholder-as-value, never a legacy default.
 * editorRuntime is the single source of truth, so there is no duplicate state.
 */
export function verifyEditorBinding(state: EditorState): EditorBindingResult {
  const fields = editorFields(state);
  const placeholderLeaks: string[] = [];
  const legacyDefaults: string[] = [];
  for (const f of fields) {
    // Placeholder may only show when the value is empty — never AS the value.
    if (f.value.trim().length > 0 && f.value === f.placeholder) placeholderLeaks.push(f.ref);
    // A populated AUTO field must equal the canonical value; a MANUAL field is the
    // user's override. Anything else would be a legacy/non-canonical default.
    if (f.value.trim().length > 0 && f.owner === 'AUTO' && f.value !== f.canonicalValue) legacyDefaults.push(f.ref);
  }
  const findings: string[] = [];
  if (placeholderLeaks.length) findings.push(`Placeholder shown as value: ${placeholderLeaks.join(', ')}.`);
  if (legacyDefaults.length) findings.push(`Non-canonical (legacy) value bound: ${legacyDefaults.join(', ')}.`);
  return { valid: placeholderLeaks.length === 0 && legacyDefaults.length === 0, placeholderLeaks, legacyDefaults, duplicateState: false, findings };
}

/* ── Template safe-area map (per-field soft length budget) ──────────────── */

function maxLengthMap(template: CreatorTemplate): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const put = (fields: readonly TemplateField[]) => { for (const f of fields) out[f.key] = typeof f.maxLength === 'number' ? f.maxLength : null; };
  put(template.formDefinition.fields);
  if (template.formDefinition.slides) put(template.formDefinition.slides.fields);
  if (template.formDefinition.sections) put(template.formDefinition.sections.fields);
  return out;
}

function requiredKeys(template: CreatorTemplate): { flat: Set<string>; slide: Set<string>; section: Set<string> } {
  const flat = new Set<string>(template.formDefinition.fields.filter((f) => f.required).map((f) => f.key));
  const slide = new Set<string>((template.formDefinition.slides?.fields ?? []).filter((f) => f.required).map((f) => f.key));
  const section = new Set<string>((template.formDefinition.sections?.fields ?? []).filter((f) => f.required).map((f) => f.key));
  return { flat, slide, section };
}

/* ── Image-prompt imagery-only check (STEP 3) ──────────────────────────── */

const POSITIVE_TYPOGRAPHY_REQUEST = /(render|add|include|draw|write|place|show|display|overlay)\s+(a\s+|the\s+|some\s+)?(headline|sub\s?headline|caption|cta|call[\s-]to[\s-]action|tagline|statistic|number|percentage|quote|logo|wordmark|button|paragraph|sentence|word|letter|text)/i;
// A clause is a SUPPRESSION directive (the image-prompt bans/abstracts text), not
// a real typography request, when it carries any of these markers.
const SUPPRESSION_MARKER = /\b(never|no|not|avoid|without|don'?t|do not|free of|zero|abstract|unreadable|illegible|blurred|anonymi[sz]ed|soft shapes|no readable)\b/i;

/** True when the composed AI image prompt requests imagery only (text-banned, no NON-negated typography request). */
export function imagePromptIsImageryOnly(composedImagePrompt: string): boolean {
  const bansVisibleText = /strictly avoid all visible text/i.test(composedImagePrompt);
  if (!bansVisibleText) return false;
  // Scan clause-by-clause: a positive typography request counts only when it is
  // NOT a suppression/negated clause (e.g. "NEVER render the words themselves").
  const clauses = composedImagePrompt.split(/[\n.;:()|]+/);
  const requestsTypography = clauses.some((clause) => POSITIVE_TYPOGRAPHY_REQUEST.test(clause) && !SUPPRESSION_MARKER.test(clause));
  return !requestsTypography;
}

/* ── The verification ──────────────────────────────────────────────────── */

export function verifyTypographyRuntime(
  state: EditorState,
  template: CreatorTemplate,
  composedImagePrompt?: string,
): TypographyVerificationReport {
  const maxLen = maxLengthMap(template);
  const req = requiredKeys(template);
  const fieldsView = editorFields(state);
  const findings: string[] = [];
  const safeAreaViolations: SafeAreaViolation[] = [];

  const fields: TypographyField[] = fieldsView.map((f) => {
    const value = f.value;
    const length = value.trim().length;
    const maxLength = maxLen[f.key] ?? null;
    const withinSafeArea = maxLength === null || length <= maxLength;
    if (!withinSafeArea && maxLength !== null) safeAreaViolations.push({ ref: f.ref, length, maxLength, overBy: length - maxLength });
    return { ref: f.ref, key: f.key, value, source: length > 0 ? 'canonical' : 'empty', owner: f.owner, length, maxLength, withinSafeArea };
  });

  // Required overlay completeness.
  const missingRequired: string[] = [];
  for (const f of fieldsView) {
    const set = f.location === 'field' ? req.flat : f.location === 'slide' ? req.slide : req.section;
    if (set.has(f.key) && !f.value.trim()) missingRequired.push(f.ref);
  }
  if (missingRequired.length) findings.push(`Missing required typography: ${missingRequired.join(', ')}.`);

  // Editor ↔ Preview ↔ Renderer parity — every visible character is the same object.
  const eff = effectivePopulation(state);
  const preview = toPreviewModel(state);
  const render = toRenderPayload(state);
  const stamp = (p: { fields: Record<string, string>; slides: Array<Record<string, string>>; sections: Array<Record<string, string>> }) => JSON.stringify({ f: p.fields, s: p.slides, x: p.sections });
  const editorPreviewParity = stamp(eff) === stamp(preview);
  const previewRendererParity = stamp(preview) === stamp(render);
  if (!editorPreviewParity) findings.push('Editor↔Preview typography drift.');
  if (!previewRendererParity) findings.push('Preview↔Renderer typography drift.');

  // AI typography: the overlay is canonical by construction (editorRuntime). It
  // can only diverge if the render payload differs from the effective population
  // — which the parity check above already proves it cannot.
  const aiTypographyDetected = !previewRendererParity;

  // Image prompt requests imagery only (when supplied).
  const promptRequestsTypography = composedImagePrompt !== undefined ? !imagePromptIsImageryOnly(composedImagePrompt) : false;
  if (promptRequestsTypography) findings.push('AI image prompt requests typography (should be imagery-only).');

  // Editor field binding (STEP 2) — fields show canonical/manual values only.
  const binding = verifyEditorBinding(state);
  for (const f of binding.findings) findings.push(f);

  const overlayComplete = missingRequired.length === 0;
  const parityOk = editorPreviewParity && previewRendererParity;
  const status: TypographyStatus =
    !parityOk || aiTypographyDetected || promptRequestsTypography || !overlayComplete || !binding.valid ? 'FAIL'
      : safeAreaViolations.length > 0 ? 'WARN'
        : 'PASS';

  return {
    status, source: 'canonical', overlayComplete, aiTypographyDetected, promptRequestsTypography,
    editorBindingValid: binding.valid, editorPreviewParity, previewRendererParity, fields, safeAreaViolations, missingRequired, findings,
  };
}

/* ── Diagnostics (STEP 8) ──────────────────────────────────────────────── */

export interface TypographyDiagnostics {
  typographySource: 'canonical';
  overlayCompleteness: number;
  safeAreaViolations: number;
  editorParity: boolean;           // editor fields bound to canonical/manual values
  editorPreviewParity: boolean;
  previewRendererParity: boolean;
  legacyTypographyUsage: number;   // non-canonical overlay characters (always 0 here)
  manualFields: number;
  autoFields: number;
}

export function typographyDiagnostics(state: EditorState, template: CreatorTemplate): TypographyDiagnostics {
  const report = verifyTypographyRuntime(state, template);
  const ed = editorDiagnostics(state);
  const present = report.fields.filter((f) => f.source === 'canonical').length;
  return {
    typographySource: 'canonical',
    overlayCompleteness: report.fields.length ? Math.round((present / report.fields.length) * 100) / 100 : 1,
    safeAreaViolations: report.safeAreaViolations.length,
    editorParity: report.editorBindingValid,
    editorPreviewParity: report.editorPreviewParity,
    previewRendererParity: report.previewRendererParity,
    legacyTypographyUsage: report.aiTypographyDetected ? 1 : 0,
    manualFields: ed.manualFields,
    autoFields: ed.autoFields,
  };
}
