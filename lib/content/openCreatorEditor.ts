/**
 * openCreatorEditor — the ONE canonical "Open in Editor" action (BETA-016 RULE 1/2/6/8).
 *
 * The Creator editor is an in-page panel rendered as `<div id="creator-template-editor">`
 * (components/creator/TemplateFieldsPanel.tsx). "Open in Editor" scrolls the panel into view.
 * Previously three call sites inlined `getElementById(...)?.scrollIntoView(...)`, which SILENTLY
 * did nothing when the panel was not mounted (no asset/template loaded yet) — the reported
 * "Open in Editor does nothing" defect.
 *
 * This helper makes the action deterministic: it returns a typed result, emits a structured log
 * for every outcome, and NEVER silently succeeds. Callers can surface `editor_not_ready` to the
 * user instead of a dead button. Guards the nullable `scrollIntoView` (absent in some
 * environments / jsdom) so it can never throw.
 */
export const CREATOR_EDITOR_ELEMENT_ID = 'creator-template-editor';

export type OpenCreatorEditorStatus = 'opened' | 'editor_not_ready' | 'no_document';

export interface OpenCreatorEditorResult {
  status: OpenCreatorEditorStatus;
  /** Stable code for log correlation / recovery UI (RULE 5). */
  errorId?: string;
}

export interface OpenCreatorEditorContext {
  assetId?: string | null;
  templateId?: string | null;
  attachmentMode?: string | null;
  requestId?: string | null;
}

type Logger = (message: string, fields: Record<string, unknown>) => void;

const defaultLog: Logger = (message, fields) => {
  // Client-side structured log (RULE 6). Uses console so it is visible in the browser console
  // and captured by any console-forwarding transport; deterministic + dependency-free.
  const line = `[creator.editor.open] ${message}`;
  if (fields.status === 'opened') console.info(line, fields);
  else console.warn(line, fields);
};

/**
 * Scroll the in-page Creator editor into view. Deterministic + logged; never silent.
 * `log` is injectable for tests.
 */
export function openCreatorEditor(
  context: OpenCreatorEditorContext = {},
  log: Logger = defaultLog,
): OpenCreatorEditorResult {
  const fields = {
    editor_element: CREATOR_EDITOR_ELEMENT_ID,
    asset_id: context.assetId ?? null,
    template_id: context.templateId ?? null,
    attachment_mode: context.attachmentMode ?? null,
    request_id: context.requestId ?? null,
  };

  if (typeof document === 'undefined') {
    log('no_document', { ...fields, status: 'no_document', error_id: 'no_document' });
    return { status: 'no_document', errorId: 'no_document' };
  }

  const el = document.getElementById(CREATOR_EDITOR_ELEMENT_ID);
  if (!el) {
    log('editor_not_ready', { ...fields, status: 'editor_not_ready', error_id: 'editor_not_ready' });
    return { status: 'editor_not_ready', errorId: 'editor_not_ready' };
  }

  if (typeof (el as HTMLElement).scrollIntoView === 'function') {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  log('opened', { ...fields, status: 'opened' });
  return { status: 'opened' };
}
