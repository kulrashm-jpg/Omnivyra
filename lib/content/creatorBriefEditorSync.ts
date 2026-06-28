/**
 * Canonical Brief ⇄ Editor synchronization service.
 *
 * The brief's `topic` and the editor's "lead" field (first slide title, else the
 * flat headline/title/quote) mirror each other EMPTY-ONLY: content is copied only
 * into a blank destination, never overwriting authored content.
 *
 * Each synchronized endpoint carries one sync state:
 *   - never_synced       — untouched; auto-sync allowed
 *   - auto_synced        — last written by the engine; auto-sync still allowed
 *   - manually_modified  — the user explicitly edited/cleared it; auto-sync is
 *                          permanently disabled for it until the state is reset
 *                          (new template / new asset / different draft).
 *
 * This module is the ONE place that owns the derivation + planning. The page owns
 * only React state + raw setters and applies the plan this service returns; it
 * marks `manually_modified` from user-input handlers (never from engine/prefill).
 */

import type { CreatorTemplate, TemplateField } from '../creator-templates';
import type { TemplateFieldValues } from '../creator-templates/values';

export type SyncFieldState = 'never_synced' | 'auto_synced' | 'manually_modified';
export type SyncEndpoint = 'topic' | 'lead';
export interface BriefEditorSyncState {
  topic: SyncFieldState;
  lead: SyncFieldState;
}

export function freshSyncState(): BriefEditorSyncState {
  return { topic: 'never_synced', lead: 'never_synced' };
}

/** Mark an endpoint as user-modified. Idempotent. */
export function markManual(state: BriefEditorSyncState, endpoint: SyncEndpoint): BriefEditorSyncState {
  return state[endpoint] === 'manually_modified' ? state : { ...state, [endpoint]: 'manually_modified' };
}

/* ── Field-key resolution ──────────────────────────────────────────────── */

function slideTitleKey(t: CreatorTemplate): string | null { return t.formDefinition.slides?.fields?.[0]?.key ?? null; }
function slideBodyKey(t: CreatorTemplate): string | null { return t.formDefinition.slides?.fields?.[1]?.key ?? null; }
function sectionTitleKey(t: CreatorTemplate): string | null { return t.formDefinition.sections?.fields?.[0]?.key ?? null; }
function flatLeadKey(t: CreatorTemplate): string | null {
  const fields: TemplateField[] = t.formDefinition.fields ?? [];
  return fields.find((f) => ['headline', 'title', 'quote'].includes(f.key))?.key ?? fields[0]?.key ?? null;
}

function firstNonEmpty(rows: Array<Record<string, string>> | undefined, key: string | null): string {
  if (!rows || !key) return '';
  for (const r of rows) { const v = String(r?.[key] ?? '').trim(); if (v) return v; }
  return '';
}

/** The editor's lead value (what mirrors the brief topic) — for change detection. */
export function editorLeadValue(template: CreatorTemplate, values: TemplateFieldValues): string {
  const sKey = slideTitleKey(template);
  if (sKey && (values.slides?.length ?? 0) > 0) return String(values.slides![0]?.[sKey] ?? '').trim();
  const fKey = flatLeadKey(template);
  return fKey ? String(values.fields?.[fKey] ?? '').trim() : '';
}

/** Derive a topic from the editor's lead content (empty-only source scan). */
export function deriveTopicFromEditor(template: CreatorTemplate, values: TemplateFieldValues): string {
  return (
    firstNonEmpty(values.slides, slideTitleKey(template))
    || firstNonEmpty(values.slides, slideBodyKey(template))
    || firstNonEmpty(values.sections, sectionTitleKey(template))
    || (flatLeadKey(template) ? String(values.fields?.[flatLeadKey(template)!] ?? '').trim() : '')
  ).slice(0, 120);
}

/** Write a topic into the editor's empty lead field (caller guards emptiness/state). */
export function seedEditorLead(template: CreatorTemplate, values: TemplateFieldValues, topic: string): TemplateFieldValues {
  const sKey = slideTitleKey(template);
  if (sKey && (values.slides?.length ?? 0) > 0) {
    return { ...values, slides: values.slides!.map((row, i) => (i === 0 ? { ...row, [sKey]: topic } : row)) };
  }
  const fKey = flatLeadKey(template);
  if (fKey) return { ...values, fields: { ...values.fields, [fKey]: topic } };
  return values;
}

export interface SyncPlan {
  /** When set, write this into `answers.topic`. */
  topicWrite?: string;
  /** When set, replace `templateValues` with this. */
  editorWrite?: TemplateFieldValues;
  /** The sync state after applying the plan (unchanged when no write). */
  nextState: BriefEditorSyncState;
}

/**
 * Pure planner: at most ONE empty-only write per call, and only into an endpoint
 * that is NOT `manually_modified`. Returns `nextState === state` when no write.
 */
export function planBriefEditorSync(input: {
  template: CreatorTemplate;
  topic: string;
  values: TemplateFieldValues;
  state: BriefEditorSyncState;
  hasTopicField: boolean;
}): SyncPlan {
  const { template, values, state, hasTopicField } = input;
  if (!hasTopicField) return { nextState: state };
  const topic = String(input.topic ?? '').trim();

  // Editor → Brief: fill an empty topic, unless the user cleared/edited it.
  if (!topic) {
    if (state.topic === 'manually_modified') return { nextState: state };
    const derived = deriveTopicFromEditor(template, values);
    if (derived) return { topicWrite: derived, nextState: { ...state, topic: 'auto_synced' } };
    return { nextState: state };
  }

  // Brief → Editor: seed an empty lead field, unless the user cleared/edited it.
  if (state.lead !== 'manually_modified' && !editorLeadValue(template, values)) {
    return { editorWrite: seedEditorLead(template, values, topic), nextState: { ...state, lead: 'auto_synced' } };
  }
  return { nextState: state };
}
