/**
 * Intake → Editor Synchronization (CREATOR-027B completion, on editorRuntime).
 *
 * One-way, deterministic synchronization: the brief / AI intake / Writer intake
 * is the SOURCE; editorRuntime is the single destination and sole owner of
 * editable content. When the intake changes, the deterministic population is
 * re-derived and applied as an UPSTREAM update — AUTO fields adopt the new
 * canonical values, MANUAL fields (user edits) are NEVER overwritten. There is
 * no competing ownership and no editor→intake writeback. Pure, no AI here, no
 * generation, no loops (one update → one propagation).
 */

import type { CreatorTemplate } from './types';
import { applyUpstreamPopulation, type EditorState } from './editorRuntime';
import { liveContentToEditorState } from './creatorRuntimeBridge';

/* ── Canonical intake → assembly field registry (ONE registry) ─────────── */

/**
 * The brief's META fields feed the deterministic ASSEMBLY (audience/platform/
 * tone/etc. shape Communication Strategy / Audience Journey / Conversion), NOT
 * the editor overlay directly. The editor's overlay fields (headline/body/CTA)
 * are derived canonically from the intake CONTENT through the pipeline. This
 * registry documents the single mapping; there is no per-component duplication.
 */
export const INTAKE_FIELD_REGISTRY = {
  // brief field → role in the deterministic pipeline (assembly input vs content)
  description: 'content',
  title: 'content',
  audience: 'assembly:audience',
  platform: 'assembly:platform',
  objective: 'assembly:conversion',
  campaign: 'assembly:conversion',
  tone: 'assembly:tone',
  industry: 'assembly:industry',
  brandVoice: 'assembly:tone',
  cta: 'assembly:conversion',
} as const;

export interface IntakeSyncInput {
  template: CreatorTemplate;
  /** The combined intake content (brief description / transcript / writer body). */
  sourceText: string;
  packageId?: string;
}

/**
 * Re-derive the canonical population from the new intake content and apply it
 * upstream. AUTO fields follow the new content; MANUAL overrides persist. Calling
 * this with the same content is idempotent (one update → one propagation).
 */
export function syncIntakeToEditor(state: EditorState, input: IntakeSyncInput): EditorState {
  const fresh = liveContentToEditorState({ template: input.template, sourceText: input.sourceText, packageId: input.packageId });
  return applyUpstreamPopulation(state, fresh.population, fresh.assembly);
}

/**
 * Build the FIRST editor state from an intake (writer-first or AI-first). The
 * user's already-typed values (if any) are seeded as MANUAL; deterministic
 * content fills the rest as AUTO.
 */
export function initEditorFromIntake(input: IntakeSyncInput & { existingValues?: Parameters<typeof liveContentToEditorState>[0]['existingValues'] }): EditorState {
  return liveContentToEditorState({ template: input.template, sourceText: input.sourceText, existingValues: input.existingValues, packageId: input.packageId });
}
