/**
 * @jest-environment jsdom
 *
 * BETA-016 RULE 7 — the canonical "Open in Editor" action must never silently fail. These tests
 * fail if the button becomes a silent no-op (missing panel returns without a structured outcome)
 * or if the scroll path throws when scrollIntoView is unavailable.
 */
import { openCreatorEditor, CREATOR_EDITOR_ELEMENT_ID } from '../../../lib/content/openCreatorEditor';

function mountEditorPanel(): HTMLElement {
  const el = document.createElement('div');
  el.id = CREATOR_EDITOR_ELEMENT_ID;
  (el as any).scrollIntoView = jest.fn();
  document.body.appendChild(el);
  return el;
}

describe('BETA-016 — openCreatorEditor', () => {
  afterEach(() => { document.body.innerHTML = ''; jest.restoreAllMocks(); });

  it('opens: scrolls the editor panel into view and returns status "opened"', () => {
    const el = mountEditorPanel();
    const logs: Array<Record<string, unknown>> = [];
    const res = openCreatorEditor({ assetId: 'a1', attachmentMode: 'supporting_visual' }, (_m, f) => logs.push(f));
    expect(res.status).toBe('opened');
    expect((el as any).scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    // structured log carries the correlation fields (RULE 6)
    expect(logs[0]).toMatchObject({ status: 'opened', asset_id: 'a1', attachment_mode: 'supporting_visual', editor_element: CREATOR_EDITOR_ELEMENT_ID });
  });

  it('NEVER silently fails: missing panel returns editor_not_ready + errorId + a warn log', () => {
    const logs: Array<Record<string, unknown>> = [];
    const res = openCreatorEditor({ assetId: 'a2' }, (_m, f) => logs.push(f));
    expect(res.status).toBe('editor_not_ready');
    expect(res.errorId).toBe('editor_not_ready');
    expect(logs[0]).toMatchObject({ status: 'editor_not_ready', error_id: 'editor_not_ready', asset_id: 'a2' });
  });

  it('does not throw when scrollIntoView is unavailable (guarded nullable browser API)', () => {
    const el = document.createElement('div');
    el.id = CREATOR_EDITOR_ELEMENT_ID; // no scrollIntoView assigned
    document.body.appendChild(el);
    expect(() => openCreatorEditor({}, () => {})).not.toThrow();
    expect(openCreatorEditor({}, () => {}).status).toBe('opened');
  });

  it('is deterministic — identical inputs yield identical status', () => {
    mountEditorPanel();
    expect(openCreatorEditor({ assetId: 'x' }, () => {}).status).toBe(openCreatorEditor({ assetId: 'x' }, () => {}).status);
  });
});
