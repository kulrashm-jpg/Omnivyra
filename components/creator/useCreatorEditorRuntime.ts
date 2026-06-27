/**
 * useCreatorEditorRuntime — the canonical React binding for the deterministic
 * Creator editor. A component holds ONE piece of state (the editorRuntime
 * `EditorState`) and derives every editable value, the preview model, the render
 * payload, the summary and diagnostics from it. There is no duplicate React
 * state for business content (headline/body/CTA/…): those live only inside
 * editorRuntime. UI-only concerns (tabs, hover, scroll) stay in their own local
 * state in the consuming component.
 *
 * This is the binding layer for CREATOR-026 — it introduces no new model, no new
 * synchronization, and no new ownership: it merely exposes editorRuntime to
 * React. Preview and the renderer consume the SAME effective population shown in
 * the editor.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  createEditorState,
  editorFields,
  editField,
  resetField,
  regenerateContent,
  applyUpstreamPopulation,
  effectivePopulation,
  toPreviewModel,
  toRenderPayload,
  editorSummary,
  editorDiagnostics,
  type EditorState,
  type EditorField,
  type EditorSummary,
  type EditorDiagnostics,
} from '../../lib/creator-templates/editorRuntime';
import type { CreatorTemplatePopulation } from '../../lib/creator-templates/templatePopulation';
import type { AssetAssembly } from '../../lib/creator-templates/assetAssembly';

export interface CreatorEditorBinding {
  /** The single source of truth — the editorRuntime state (population + overrides). */
  state: EditorState;
  /** Every editable field with its EFFECTIVE value, owner, placeholder, provenance. */
  fields: EditorField[];
  /** Type into a field → AUTO becomes MANUAL; preview + render update immediately. */
  edit: (ref: string, value: string) => void;
  /** Reset a field → MANUAL→AUTO, restoring the canonical populated value. */
  reset: (ref: string) => void;
  /** Regenerate → drop all manual overrides, restoring full AUTO ownership. */
  regenerate: () => void;
  /** Live upstream sync — AUTO fields follow the new population, MANUAL persist. */
  applyUpstream: (population: CreatorTemplatePopulation, assembly?: AssetAssembly | null) => void;
  /** Read-only summary panel data. */
  summary: EditorSummary;
  /** Read-only diagnostics (completeness, parity, ownership counts, provenance). */
  diagnostics: EditorDiagnostics;
  /** The ONE object the preview consumes (== render payload source). */
  preview: CreatorTemplatePopulation;
  /** The ONE object the renderer consumes — identical values to the editor. */
  renderPayload: { fields: Record<string, string>; slides: Array<Record<string, string>>; sections: Array<Record<string, string>> };
}

export function useCreatorEditorRuntime(
  initialPopulation: CreatorTemplatePopulation,
  assembly: AssetAssembly | null = null,
): CreatorEditorBinding {
  const [state, setState] = useState<EditorState>(() => createEditorState(initialPopulation, assembly));

  const edit = useCallback((ref: string, value: string) => setState((s) => editField(s, ref, value)), []);
  const reset = useCallback((ref: string) => setState((s) => resetField(s, ref)), []);
  const regenerate = useCallback(() => setState((s) => regenerateContent(s)), []);
  const applyUpstream = useCallback(
    (population: CreatorTemplatePopulation, asm: AssetAssembly | null = null) => setState((s) => applyUpstreamPopulation(s, population, asm ?? s.assembly)),
    [],
  );

  // All derived from the single state — no duplicate business content.
  const fields = useMemo(() => editorFields(state), [state]);
  const summary = useMemo(() => editorSummary(state), [state]);
  const diagnostics = useMemo(() => editorDiagnostics(state), [state]);
  const preview = useMemo(() => toPreviewModel(state), [state]);
  const renderPayload = useMemo(() => toRenderPayload(state), [state]);

  return { state, fields, edit, reset, regenerate, applyUpstream, summary, diagnostics, preview, renderPayload };
}
