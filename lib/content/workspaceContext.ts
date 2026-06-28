/**
 * Canonical WorkspaceContext (CREATOR-069, STEP 4).
 *
 * The ONE context every workspace lane (Writer / Creator / Campaign) consumes.
 * No lane builds its own context or re-asks Goal / Audience / Brand / CTA — they
 * all inherit from the Marketing Brief through this object. It REUSES the
 * canonical brief resolver (CREATOR-063); it does not duplicate mapping logic.
 * Pure + deterministic; additive (null brief → empty defaults).
 */

import type { MarketingBrief } from './unifiedCreationModel';
import { getCreationGoal } from './unifiedCreationModel';
import { resolveEditorContext, type EditorContext } from './marketingBriefResolver';

export interface WorkspaceContext {
  goalId: string | null;
  goalLabel: string;
  outcomeDescription: string;
  audience: string;
  brand: string;
  cta: string;
  tone: string;
  topic: string;
  objective: string;
  /** The full resolved editor context every lane panel pre-fills from. */
  editor: EditorContext;
}

/** Build the single canonical context from the Marketing Brief. */
export function buildWorkspaceContext(brief: MarketingBrief | null | undefined): WorkspaceContext {
  const editor = resolveEditorContext(brief);
  const goal = editor.goalId ? getCreationGoal(editor.goalId) : null;
  return {
    goalId: editor.goalId,
    goalLabel: editor.goalLabel,
    outcomeDescription: goal?.description ?? '',
    audience: editor.audience,
    brand: editor.brand,
    cta: editor.cta,
    tone: editor.tone,
    topic: editor.topic,
    objective: editor.objective,
    editor,
  };
}

/** One-line "inherited from brief" summary every lane panel shows (no re-asking). */
export function inheritedSummary(ctx: WorkspaceContext): string {
  const parts = [
    ctx.goalLabel ? `Goal: ${ctx.goalLabel}` : '',
    ctx.audience ? `Audience: ${ctx.audience}` : '',
    ctx.brand ? `Brand: ${ctx.brand}` : '',
    ctx.cta ? `CTA: ${ctx.cta}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
