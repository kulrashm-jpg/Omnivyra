import React from 'react';
import { Sparkles, RefreshCw, Plus, Trash2, Maximize2, Minimize2, Wand2, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import type { CreatorTemplate, TemplateField, TemplateFieldAssistAction } from '../../lib/creator-templates';
import {
  buildReadinessReport,
  computeEditorProgress,
  buildFieldNav,
  assessField,
  countContent,
  fieldAnchorId,
  readinessStatusGlyph,
  type FieldStatus,
  type SectionStatus,
} from '../../lib/creator-templates';
import {
  type TemplateFieldValues,
  setSlideCount,
  addSection,
  removeSection,
  validateTemplateValues,
} from '../../lib/creator-templates/values';

/**
 * Schema-driven template form panel with field-level AI assist.
 *
 * Renders a template's FormDefinition generically (no per-template UI). Each
 * editable field exposes the AI actions the template declares: Generate /
 * Rewrite / Expand / Shorten / Improve. AI is user-invoked and field-scoped —
 * it never auto-runs and never touches fields the user didn't target.
 *
 * Batch helpers (Generate empty / all slides + sections) operate ONLY on the
 * empty entries by default, so manually written content is never overwritten.
 */

export type AiAssistMode = TemplateFieldAssistAction;

export interface TemplateAiAssistTarget {
  scope: 'flat' | 'slide' | 'section';
  fieldKey: string;
  index?: number;
  currentValue: string;
}

export interface TemplateAiAssistContext {
  template: CreatorTemplate;
  action: AiAssistMode;
  targets: TemplateAiAssistTarget[];
  /** Stable key the parent stores in `aiBusyKey` while the call is in flight. */
  busyKey: string;
  label: string;
}

interface Props {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  onChange: (next: TemplateFieldValues) => void;
  /** Invoked on an explicit user action; receives the exact target(s) to update. */
  onAiAssist?: (ctx: TemplateAiAssistContext) => void;
  /** The busyKey currently in flight (parent-controlled); disables that control. */
  aiBusyKey?: string | null;
  /** Live validity callback — the parent disables save while invalid. */
  onValidityChange?: (ok: boolean) => void;
}

const S = {
  panel: { border: '1px solid #1f2937', borderRadius: 12, padding: 16, background: '#0b1220', marginBottom: 16 } as React.CSSProperties,
  groupTitle: { fontSize: 13, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 } as React.CSSProperties,
  label: { display: 'block', fontSize: 14, fontWeight: 600, color: '#e5e7eb', marginBottom: 4 } as React.CSSProperties,
  required: { color: '#f87171', marginLeft: 4 } as React.CSSProperties,
  helper: { fontSize: 12, color: '#9ca3af', marginBottom: 6 } as React.CSSProperties,
  fieldError: { fontSize: 12, color: '#f87171', marginTop: 4 } as React.CSSProperties,
  validBanner: (ok: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, color: ok ? '#86efac' : '#fca5a5', border: `1px solid ${ok ? '#166534' : '#7f1d1d'}`, background: ok ? '#052e16' : '#450a0a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }),
  input: { width: '100%', boxSizing: 'border-box', background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#f8fafc', fontSize: 14 } as React.CSSProperties,
  fieldWrap: { marginBottom: 14 } as React.CSSProperties,
  aiRow: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } as React.CSSProperties,
  aiBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#a5b4fc', background: 'transparent', border: '1px solid #312e81', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' } as React.CSSProperties,
  slideCard: { border: '1px solid #1f2937', borderRadius: 10, padding: 12, marginBottom: 10, background: '#020617' } as React.CSSProperties,
  slideHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } as React.CSSProperties,
  countRow: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' } as React.CSSProperties,
  countBtn: (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, border: `1px solid ${active ? '#2563eb' : '#334155'}`, background: active ? '#1e3a8a' : '#020617', color: active ? '#fff' : '#cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: 14 }),
  addBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#86efac', background: 'transparent', border: '1px dashed #166534', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' } as React.CSSProperties,
  ghostIcon: { background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 } as React.CSSProperties,
  batchRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } as React.CSSProperties,
  batchBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#c4b5fd', background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } as React.CSSProperties,
  metaRow: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 5, fontSize: 11.5, alignItems: 'center' } as React.CSSProperties,
  metaDim: { color: '#64748b' } as React.CSSProperties,
  assistBox: { border: '1px solid #1f2937', borderRadius: 10, padding: 14, background: '#020617', marginBottom: 14 } as React.CSSProperties,
  barTrack: { height: 6, borderRadius: 999, background: '#1f2937', overflow: 'hidden', margin: '10px 0' } as React.CSSProperties,
  barFill: { height: '100%', background: '#2563eb', borderRadius: 999 } as React.CSSProperties,
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 8 } as React.CSSProperties,
  metric: { border: '1px solid #1f2937', borderRadius: 8, padding: '6px 8px', background: '#0b1220' } as React.CSSProperties,
  metricVal: { fontSize: 14, fontWeight: 800, color: '#e5e7eb' } as React.CSSProperties,
  metricLabel: { fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 } as React.CSSProperties,
  navRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } as React.CSSProperties,
  navBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#cbd5e1', background: '#0b1220', border: '1px solid #334155', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontWeight: 600 } as React.CSSProperties,
  collapseBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 0 } as React.CSSProperties,
};

const ACTION_META: Record<AiAssistMode, { label: string; icon: React.ReactNode }> = {
  generate: { label: 'AI generate', icon: <Sparkles size={13} /> },
  rewrite: { label: 'Rewrite', icon: <RefreshCw size={13} /> },
  expand: { label: 'Expand', icon: <Maximize2 size={13} /> },
  shorten: { label: 'Shorten', icon: <Minimize2 size={13} /> },
  improve: { label: 'Improve', icon: <Wand2 size={13} /> },
};

function busyKeyFor(action: AiAssistMode, scope: string, fieldKey: string, index?: number): string {
  return `${action}:${scope}:${index ?? ''}:${fieldKey}`;
}

const STATUS_COLOR: Record<FieldStatus, string> = { complete: '#86efac', attention: '#fbbf24', required: '#f87171', empty: '#94a3b8' };
const STATUS_TEXT: Record<FieldStatus, string> = { complete: 'Complete', attention: 'Too long', required: 'Required', empty: 'Optional' };
const SEC_COLOR: Record<SectionStatus, string> = { good: '#86efac', attention: '#fbbf24', blocking: '#f87171' };

export default function TemplateFieldsPanel({ template, values, onChange, onAiAssist, aiBusyKey, onValidityChange }: Props) {
  const { fields, slides, sections } = template.formDefinition;

  // Live, deterministic validation against the selected template contract.
  const validation = React.useMemo(() => validateTemplateValues(template, values), [template, values]);
  React.useEffect(() => { onValidityChange?.(validation.ok); }, [validation.ok, onValidityChange]);

  // CREATOR-009 — deterministic editor assist (live readiness recomputes on edit).
  const progress = React.useMemo(() => computeEditorProgress(template, values), [template, values]);
  const nav = React.useMemo(() => buildFieldNav(template, values), [template, values]);
  const readiness = React.useMemo(() => buildReadinessReport(template, values), [template, values]);
  const [navCursor, setNavCursor] = React.useState(-1);

  const scrollToAnchor = (anchorId: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(anchorId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el.querySelector('input, textarea') as HTMLElement | null)?.focus();
  };
  const gotoIncomplete = (dir: 1 | -1) => {
    const idxs = nav.map((n, i) => (n.status !== 'complete' ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return;
    let target: number;
    if (dir === 1) target = idxs.find((i) => i > navCursor) ?? idxs[0];
    else { const before = idxs.filter((i) => i < (navCursor < 0 ? nav.length : navCursor)); target = before.length ? before[before.length - 1] : idxs[idxs.length - 1]; }
    setNavCursor(target); scrollToAnchor(nav[target].anchorId);
  };
  const gotoSeverity = (sev: 'error' | 'warning') => {
    const idxs = nav.map((n, i) => (n.severity === sev ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return;
    const target = idxs.find((i) => i > navCursor) ?? idxs[0];
    setNavCursor(target); scrollToAnchor(nav[target].anchorId);
  };

  // Collapsible slide/section groups, remembered per template.
  const collapseKey = `creator:editor:collapse:${template.id}`;
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try { const raw = window.localStorage.getItem(collapseKey); setCollapsed(raw ? JSON.parse(raw) : {}); } catch { setCollapsed({}); }
  }, [collapseKey]);
  const toggleCollapse = (k: string) => setCollapsed((prev) => {
    const next = { ...prev, [k]: !prev[k] };
    try { window.localStorage.setItem(collapseKey, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const errorFor = (scope: 'flat' | 'slide' | 'section', key: string, index?: number): string | null =>
    validation.errors.find((e) => e.scope === scope && e.key === key && e.index === index)?.message ?? null;
  const countError = validation.errors.find((e) => e.scope === 'count')?.message ?? null;

  const setFlat = (key: string, value: string) => onChange({ ...values, fields: { ...values.fields, [key]: value } });
  const setSlideField = (i: number, key: string, value: string) =>
    onChange({ ...values, slides: (values.slides ?? []).map((row, idx) => (idx === i ? { ...row, [key]: value } : row)) });
  const setSectionField = (i: number, key: string, value: string) =>
    onChange({ ...values, sections: (values.sections ?? []).map((row, idx) => (idx === i ? { ...row, [key]: value } : row)) });

  const enabledActions = (field: TemplateField, hasValue: boolean): AiAssistMode[] => {
    const a = field.aiAssist;
    const out: AiAssistMode[] = [];
    if (a.generate) out.push('generate');
    if (hasValue && a.rewrite) out.push('rewrite');
    if (hasValue && a.improve !== false && a.generate) out.push('improve');
    if (hasValue && a.expand !== false && a.generate) out.push('expand');
    if (hasValue && a.shorten !== false && a.generate) out.push('shorten');
    return out;
  };

  const fireSingle = (action: AiAssistMode, scope: 'flat' | 'slide' | 'section', field: TemplateField, value: string, index?: number) => {
    if (!onAiAssist) return;
    onAiAssist({
      template,
      action,
      busyKey: busyKeyFor(action, scope, field.key, index),
      label: `${ACTION_META[action].label} · ${field.label}`,
      targets: [{ scope, fieldKey: field.key, index, currentValue: value }],
    });
  };

  const renderField = (
    f: TemplateField,
    value: string,
    onValue: (v: string) => void,
    scope: 'flat' | 'slide' | 'section',
    index?: number,
  ) => {
    const hasValue = value.trim().length > 0;
    const actions = onAiAssist ? enabledActions(f, hasValue) : [];
    const a = assessField(f, value);
    const cc = countContent(value);
    return (
      <div style={S.fieldWrap} id={fieldAnchorId(scope, f.key, index)} key={`${scope}-${index ?? 0}-${f.key}`}>
        <label style={S.label}>
          {f.label}
          {f.required ? <span style={S.required}>*</span> : null}
        </label>
        {f.helperText ? <div style={S.helper}>{f.helperText}</div> : null}
        {f.control === 'textarea' ? (
          <textarea style={{ ...S.input, minHeight: 64, resize: 'vertical' }} value={value} maxLength={f.maxLength} placeholder={f.placeholder} onChange={(e) => onValue(e.target.value)} />
        ) : (
          <input style={S.input} value={value} maxLength={f.maxLength} placeholder={f.placeholder} onChange={(e) => onValue(e.target.value)} />
        )}
        {/* CREATOR-009 — deterministic per-field status + counters (no AI). */}
        <div style={S.metaRow}>
          <span style={{ color: STATUS_COLOR[a.status], fontWeight: 700 }}>{a.status === 'complete' ? '✓' : a.status === 'attention' ? '!' : a.status === 'required' ? '✕' : '○'} {STATUS_TEXT[a.status]}</span>
          <span style={{ color: a.over ? '#fca5a5' : '#64748b' }}>{a.maxLength ? `${cc.characters} / ${a.maxLength} chars` : `${cc.characters} chars`}</span>
          {f.control === 'textarea' && cc.paragraphs > 1 ? <span style={S.metaDim}>{cc.paragraphs} paragraphs</span> : null}
          {cc.bullets > 0 ? <span style={S.metaDim}>{cc.bullets} bullet{cc.bullets === 1 ? '' : 's'}</span> : null}
          {cc.statistics > 0 ? <span style={S.metaDim}>{cc.statistics} stat{cc.statistics === 1 ? '' : 's'}</span> : null}
          {cc.quotes > 0 ? <span style={S.metaDim}>{cc.quotes} quote{cc.quotes === 1 ? '' : 's'}</span> : null}
        </div>
        {(() => { const m = errorFor(scope, f.key, index); return m ? <div style={S.fieldError}>{m}</div> : null; })()}
        {actions.length > 0 ? (
          <div style={S.aiRow}>
            {actions.map((action) => {
              const key = busyKeyFor(action, scope, f.key, index);
              const busy = aiBusyKey === key;
              return (
                <button key={action} type="button" style={S.aiBtn} disabled={busy} onClick={() => fireSingle(action, scope, f, value, index)}>
                  {ACTION_META[action].icon} {busy ? 'Working…' : ACTION_META[action].label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  // Batch: targets for the EMPTY entries of a repeated group (never overwrites
  // authored content). `mode: 'all'` includes every entry.
  const batchTargets = (
    scope: 'slide' | 'section',
    rows: Array<Record<string, string>>,
    groupFields: TemplateField[],
    mode: 'empty' | 'all',
  ): TemplateAiAssistTarget[] => {
    const out: TemplateAiAssistTarget[] = [];
    rows.forEach((row, index) => {
      const rowEmpty = groupFields.every((f) => !String(row[f.key] || '').trim());
      if (mode === 'empty' && !rowEmpty) return;
      for (const f of groupFields) {
        if (!f.aiAssist.generate) continue;
        if (mode === 'empty' && String(row[f.key] || '').trim()) continue;
        out.push({ scope, fieldKey: f.key, index, currentValue: String(row[f.key] || '') });
      }
    });
    return out;
  };

  const fireBatch = (scope: 'slide' | 'section', targets: TemplateAiAssistTarget[], label: string) => {
    if (!onAiAssist || targets.length === 0) return;
    onAiAssist({ template, action: 'generate', busyKey: `batch:${scope}:${label}`, label, targets });
  };

  return (
    <div style={S.panel} id="creator-template-editor">
      <div style={S.groupTitle}>Template content · {template.name}</div>
      <div style={{ ...S.helper, marginBottom: 12 }}>
        These fields are defined by your template and control what appears in the asset. Use AI per field, or type manually — your text is never overwritten unless you ask.
      </div>

      {/* CREATOR-009 — always-visible editor summary + progress + live readiness +
          smart navigation. Deterministic; updates only after edits. */}
      <div style={S.assistBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#e5e7eb' }}>{template.name}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{progress.completionPct}% complete</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 800, color: SEC_COLOR[readiness.overallStatus], border: `1px solid ${SEC_COLOR[readiness.overallStatus]}`, borderRadius: 999, padding: '3px 10px' }}>
            {readinessStatusGlyph(readiness.overallStatus)} {readiness.overall}
          </span>
        </div>

        <div style={S.barTrack}><div style={{ ...S.barFill, width: `${progress.completionPct}%` }} /></div>

        <div style={S.metricsGrid}>
          <div style={S.metric}><div style={S.metricVal}>{progress.requiredCompleted}/{progress.requiredTotal}</div><div style={S.metricLabel}>Required</div></div>
          <div style={S.metric}><div style={S.metricVal}>{progress.optionalCompleted}/{progress.optionalTotal}</div><div style={S.metricLabel}>Optional</div></div>
          {progress.slidesTotal > 0 ? <div style={S.metric}><div style={S.metricVal}>{progress.slidesCompleted}/{progress.slidesTotal}</div><div style={S.metricLabel}>Slides</div></div> : null}
          {progress.sectionsTotal > 0 ? <div style={S.metric}><div style={S.metricVal}>{progress.sectionsCompleted}/{progress.sectionsTotal}</div><div style={S.metricLabel}>Sections</div></div> : null}
          {progress.hasCta ? <div style={S.metric}><div style={{ ...S.metricVal, color: progress.ctaFilled ? '#86efac' : '#f87171' }}>{progress.ctaFilled ? '✓' : '—'}</div><div style={S.metricLabel}>CTA</div></div> : null}
          {progress.sectionsTotal > 0 ? <div style={S.metric}><div style={S.metricVal}>{progress.statistics}</div><div style={S.metricLabel}>Statistics</div></div> : null}
          <div style={S.metric}><div style={S.metricVal}>{progress.quotes}</div><div style={S.metricLabel}>Quotes</div></div>
        </div>

        {progress.remaining.length > 0 ? (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            Remaining: {progress.remaining.slice(0, 4).join(', ')}{progress.remaining.length > 4 ? ` +${progress.remaining.length - 4} more` : ''}
          </div>
        ) : null}

        <div style={S.navRow}>
          <button type="button" style={S.navBtn} onClick={() => gotoIncomplete(-1)}><ArrowUp size={12} /> Prev incomplete</button>
          <button type="button" style={S.navBtn} onClick={() => gotoIncomplete(1)}><ArrowDown size={12} /> Next incomplete</button>
          <button type="button" style={S.navBtn} onClick={() => gotoSeverity('error')}>✕ First error</button>
          <button type="button" style={S.navBtn} onClick={() => gotoSeverity('warning')}>! Next warning</button>
        </div>
      </div>

      {/* Live validation banner (deterministic, contract-driven) */}
      <div style={S.validBanner(validation.ok)}>
        {validation.ok ? '✓ Content matches the template contract.' : `${validation.messages.length} issue(s) to resolve before saving:`}
        {!validation.ok ? (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {validation.messages.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        ) : null}
      </div>

      {/* Flat fields */}
      {fields.map((f) => renderField(f, values.fields[f.key] ?? '', (v) => setFlat(f.key, v), 'flat'))}

      {/* Carousel slides */}
      {slides ? (
        <div>
          <div style={S.label}>Number of slides</div>
          <div style={S.countRow}>
            {slides.countOptions.map((n) => (
              <button key={n} type="button" style={S.countBtn(values.slideCount === n)} onClick={() => onChange(setSlideCount(template, values, n))}>
                {n} slides
              </button>
            ))}
          </div>
          {countError ? <div style={S.fieldError}>{countError}</div> : null}
          {onAiAssist ? (
            <div style={S.batchRow}>
              <button type="button" style={S.batchBtn} disabled={aiBusyKey === 'batch:slide:Generate empty slides'} onClick={() => fireBatch('slide', batchTargets('slide', values.slides ?? [], slides.fields, 'empty'), 'Generate empty slides')}>
                <Sparkles size={13} /> {aiBusyKey === 'batch:slide:Generate empty slides' ? 'Working…' : 'Generate empty slides'}
              </button>
              <button type="button" style={S.batchBtn} disabled={aiBusyKey === 'batch:slide:Generate all slides'} onClick={() => fireBatch('slide', batchTargets('slide', values.slides ?? [], slides.fields, 'all'), 'Generate all slides')}>
                <Wand2 size={13} /> Generate all slides
              </button>
            </div>
          ) : null}
          {(values.slides ?? []).map((row, i) => {
            const ck = `slide-${i}`;
            const isCollapsed = !!collapsed[ck];
            const filledCount = slides.fields.filter((f) => String(row[f.key] || '').trim()).length;
            return (
              <div style={S.slideCard} key={`slide-${i}`}>
                <div style={S.slideHead}>
                  <button type="button" style={S.collapseBtn} onClick={() => toggleCollapse(ck)}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Slide {i + 1}
                    <span style={{ fontSize: 11, color: filledCount === slides.fields.length ? '#86efac' : '#94a3b8', fontWeight: 600, marginLeft: 6 }}>{filledCount}/{slides.fields.length}</span>
                  </button>
                  {onAiAssist ? (
                    <button type="button" style={S.aiBtn} disabled={aiBusyKey === `batch:slide:Generate slide ${i + 1}`} onClick={() => fireBatch('slide', batchTargets('slide', [row], slides.fields, 'all').map((t) => ({ ...t, index: i })), `Generate slide ${i + 1}`)}>
                      <Sparkles size={13} /> Generate slide
                    </button>
                  ) : null}
                </div>
                {!isCollapsed ? slides.fields.map((f) => renderField(f, row[f.key] ?? '', (v) => setSlideField(i, f.key, v), 'slide', i)) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Infographic sections */}
      {sections ? (
        <div>
          <div style={S.label}>{sections.sectionLabel} entries</div>
          {countError ? <div style={S.fieldError}>{countError}</div> : null}
          {onAiAssist ? (
            <div style={S.batchRow}>
              <button type="button" style={S.batchBtn} disabled={aiBusyKey === 'batch:section:Generate empty sections'} onClick={() => fireBatch('section', batchTargets('section', values.sections ?? [], sections.fields, 'empty'), 'Generate empty sections')}>
                <Sparkles size={13} /> {aiBusyKey === 'batch:section:Generate empty sections' ? 'Working…' : 'Generate empty sections'}
              </button>
              <button type="button" style={S.batchBtn} disabled={aiBusyKey === 'batch:section:Generate all sections'} onClick={() => fireBatch('section', batchTargets('section', values.sections ?? [], sections.fields, 'all'), 'Generate all sections')}>
                <Wand2 size={13} /> Generate all sections
              </button>
            </div>
          ) : null}
          {(values.sections ?? []).map((row, i) => {
            const ck = `section-${i}`;
            const isCollapsed = !!collapsed[ck];
            const filledCount = sections.fields.filter((f) => String(row[f.key] || '').trim()).length;
            return (
              <div style={S.slideCard} key={`section-${i}`}>
                <div style={S.slideHead}>
                  <button type="button" style={S.collapseBtn} onClick={() => toggleCollapse(ck)}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} {sections.sectionLabel} {i + 1}
                    <span style={{ fontSize: 11, color: filledCount === sections.fields.length ? '#86efac' : '#94a3b8', fontWeight: 600, marginLeft: 6 }}>{filledCount}/{sections.fields.length}</span>
                  </button>
                  {(values.sections?.length ?? 0) > sections.min ? (
                    <button type="button" style={S.ghostIcon} onClick={() => onChange(removeSection(template, values, i))}>
                      <Trash2 size={13} /> Remove
                    </button>
                  ) : null}
                </div>
                {!isCollapsed ? sections.fields.map((f) => renderField(f, row[f.key] ?? '', (v) => setSectionField(i, f.key, v), 'section', i)) : null}
              </div>
            );
          })}
          {(values.sections?.length ?? 0) < sections.max ? (
            <button type="button" style={S.addBtn} onClick={() => onChange(addSection(template, values))}>
              <Plus size={14} /> Add {sections.sectionLabel.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
