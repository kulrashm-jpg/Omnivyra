import React from 'react';
import type { CreatorTemplate, TemplateFieldAssistAction } from '../../lib/creator-templates';
import type { TemplateFieldValues } from '../../lib/creator-templates/values';
import {
  copyEditorEntries, copyEntryValue, fieldEditKey, planCopyRewriteTargets, type CopyEditorEntry,
} from '../../lib/creator-content/creatorContentFill';
import type { TemplateAiAssistContext } from './TemplateFieldsPanel';

/**
 * "Your copy" — the words that will be rendered, editable on the confirmation
 * page before anything is generated (owner request 2026-10-25).
 *
 * NO state of its own: it is bound to the SAME template values + handlers as
 * the full template form (`handleEditorChange` marks user edits,
 * `handleTemplateAiAssist` runs field-assist), so the summary card and the
 * generation payload read exactly what is shown here.
 *
 *   Image      — headline, subheadline, button text (the template's copy fields;
 *                none in "Post + Image", where the copy travels with the post).
 *   Carousel   — every slide's title + body.
 *   Infographic — every section's title + body.
 */

/** Same busy-key shape as TemplateFieldsPanel, so the two never disagree. */
const busyKeyFor = (action: string, scope: string, key: string, index?: number) => `${action}:${scope}:${index ?? ''}:${key}`;
export const REWRITE_ALL_COPY_BUSY_KEY = 'batch:copy:rewrite-all';

const FRIENDLY_LABEL: Record<string, string> = {
  headline: 'Headline', subheadline: 'Subheadline', cta: 'Button text', quote: 'Quote', title: 'Title',
  body: 'Body', description: 'Description',
};

export interface CreatorCopyEditorProps {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  onChange: (next: TemplateFieldValues) => void;
  onAiAssist: (ctx: TemplateAiAssistContext) => void;
  aiBusyKey?: string | null;
  /** Field edit keys the user changed by hand (kept by "Rewrite all"). */
  editedKeys: ReadonlySet<string>;
  /** Whether on-image copy applies (false = "Post + Image"). */
  imageCopyActive: boolean;
}

export default function CreatorCopyEditor({
  template, values, onChange, onAiAssist, aiBusyKey, editedKeys, imageCopyActive,
}: CreatorCopyEditorProps) {
  const entries = copyEditorEntries(template, values, imageCopyActive);
  const family = template.assetFamily;

  const setValue = (e: CopyEditorEntry, v: string) => {
    if (e.scope === 'flat') { onChange({ ...values, fields: { ...values.fields, [e.field.key]: v } }); return; }
    const listKey = e.scope === 'slide' ? 'slides' : 'sections';
    const rows = (values[listKey] ?? []).map((row, i) => (i === e.index ? { ...row, [e.field.key]: v } : row));
    onChange({ ...values, [listKey]: rows });
  };

  const improve = (e: CopyEditorEntry) => {
    const current = copyEntryValue(values, e);
    const a = e.field.aiAssist;
    const action: TemplateFieldAssistAction = current.trim() && a.improve !== false && a.generate ? 'improve' : 'generate';
    onAiAssist({
      template, action,
      busyKey: busyKeyFor(action, e.scope, e.field.key, e.index),
      label: `${action === 'improve' ? 'Improve' : 'Write'} · ${e.field.label}`,
      targets: [{ scope: e.scope, fieldKey: e.field.key, index: e.index, currentValue: current }],
    });
  };

  const rewriteAll = (includeEdited: boolean) => {
    const targets = planCopyRewriteTargets({ template, values, edited: editedKeys, imageCopyActive, includeEdited });
    if (targets.length === 0) return;
    onAiAssist({ template, action: 'generate', busyKey: REWRITE_ALL_COPY_BUSY_KEY, label: 'Rewriting your copy…', targets });
  };

  if (family === 'image' && !imageCopyActive) {
    return (
      <section data-testid="creator-copy-editor" className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your copy</p>
        <p className="mt-1 text-sm text-slate-600">
          Post + Image: this image carries no words — the headline and call to action are written on the post.
        </p>
      </section>
    );
  }
  if (entries.length === 0) return null;

  const editedCount = entries.filter((e) => editedKeys.has(fieldEditKey(e.scope, e.field.key, e.index))).length;
  const anyBusy = Boolean(aiBusyKey);
  const groupLabel = (e: CopyEditorEntry) => (e.scope === 'slide' ? `Slide ${(e.index ?? 0) + 1}`
    : e.scope === 'section' ? `${template.formDefinition.sections?.sectionLabel ?? 'Section'} ${(e.index ?? 0) + 1}` : null);

  let lastGroup: string | null = null;
  return (
    <section data-testid="creator-copy-editor" className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your copy</p>
          <p className="mt-1 text-sm text-slate-600">
            The words that will appear on your {family === 'image' ? 'image' : family}. Edit them here, or let AI make them more persuasive.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="copy-rewrite-all"
            disabled={anyBusy}
            onClick={() => rewriteAll(false)}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {aiBusyKey === REWRITE_ALL_COPY_BUSY_KEY ? 'Rewriting…' : 'Rewrite all copy with AI'}
          </button>
          {editedCount > 0 ? (
            <button
              type="button"
              data-testid="copy-rewrite-all-including-edits"
              disabled={anyBusy}
              onClick={() => rewriteAll(true)}
              className="rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            >
              Also rewrite my edits
            </button>
          ) : null}
        </div>
      </div>
      {editedCount > 0 ? (
        <p className="mb-2 text-[11px] text-slate-500">Rewrite all keeps the {editedCount === 1 ? 'field' : `${editedCount} fields`} you edited.</p>
      ) : null}
      <div className="space-y-3">
        {entries.map((e) => {
          const group = groupLabel(e);
          const header = group && group !== lastGroup ? group : null;
          lastGroup = group;
          const value = copyEntryValue(values, e);
          const id = `copy-${e.scope}-${e.index ?? ''}-${e.field.key}`;
          const busy = aiBusyKey === busyKeyFor('improve', e.scope, e.field.key, e.index)
            || aiBusyKey === busyKeyFor('generate', e.scope, e.field.key, e.index);
          const label = FRIENDLY_LABEL[e.field.key] ?? e.field.label;
          const max = e.field.maxLength;
          const long = e.field.control === 'textarea' && e.field.key !== 'headline' && e.field.key !== 'subheadline';
          return (
            <div key={id}>
              {header ? <p className="mb-1 mt-2 text-xs font-semibold text-slate-700">{header}</p> : null}
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-xs font-semibold text-slate-600">{label}</label>
                <span className="text-[11px] text-slate-400">{max ? `${value.length} / ${max}` : `${value.length}`}</span>
              </div>
              <div className="mt-1 flex items-start gap-2">
                {long ? (
                  <textarea
                    id={id} data-testid={id} value={value} maxLength={max} rows={2}
                    onChange={(ev) => setValue(e, ev.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  />
                ) : (
                  <input
                    id={id} data-testid={id} value={value} maxLength={max}
                    onChange={(ev) => setValue(e, ev.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  />
                )}
                <button
                  type="button"
                  data-testid={`${id}-improve`}
                  disabled={busy}
                  onClick={() => improve(e)}
                  className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                >
                  {busy ? 'Working…' : value.trim() ? 'Improve' : 'Write with AI'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
