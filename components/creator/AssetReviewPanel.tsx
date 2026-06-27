import React from 'react';
import { Check, RefreshCw, Download, Pencil, Copy, Star, ChevronDown, ChevronRight, Pencil as PencilIcon } from 'lucide-react';
import type { CreatorTemplate, TemplateField } from '../../lib/creator-templates';
import {
  buildVisualChecklist,
  buildContentChecklist,
  buildVersionHistory,
  checklistScore,
  type ChecklistItem,
} from '../../lib/creator-templates';
import type { TemplateFieldValues } from '../../lib/creator-templates/values';

/**
 * CREATOR-011 — Asset Review & Quick Refine (review + lightweight refinement).
 *
 * Read-only review of a generated asset (preview + reused metadata), deterministic
 * visual + content checklists (no pixel inspection — both reuse existing systems),
 * a read-only version timeline, and a Quick Refine that edits ONLY the existing
 * editor values (TemplateFieldValues) in place. It never regenerates, never creates
 * fields, and never changes generation/rendering. Actions reuse the page's handlers.
 */

interface Props {
  template: CreatorTemplate;
  values: TemplateFieldValues;
  onChange: (v: TemplateFieldValues) => void;
  meta?: unknown;
  previewUrl: string | null;
  assetId: string | null;
  assetName: string;
  assetType: string | null;
  platform: string | null;
  variant: string | null;
  status: string;
  timestamp: string | null;
  templateVersion: number | null;
  originalValues?: TemplateFieldValues | null;
  edited: boolean;
  regenerations: number;
  onDownload?: () => void;
  onOpenEditor?: () => void;
  onRegenerate?: () => void;
  onDuplicate?: () => void;
  downloadBusy?: boolean;
  regenerateBusy?: boolean;
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' };
const secLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#334155' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#0f172a' };
const kvLabel: React.CSSProperties = { fontSize: 11, color: '#94a3b8' };
const kvVal: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#0f172a' };

function ChecklistRows({ items }: { items: ChecklistItem[] }) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
          <span style={{ color: it.ok ? '#16a34a' : '#d97706', fontWeight: 800, width: 12, textAlign: 'center' }}>{it.ok ? '✓' : '!'}</span>
          <span style={{ color: '#334155' }}>{it.label}</span>
          {it.detail ? <span style={{ color: '#94a3b8', fontSize: 11 }}>· {it.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function AssetReviewPanel(props: Props) {
  const { template, values, onChange, meta, previewUrl, assetId, assetName, assetType, platform, variant, status, timestamp, templateVersion, originalValues, edited, regenerations } = props;
  const [refineOpen, setRefineOpen] = React.useState(false);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [name, setName] = React.useState(assetName);
  const [renaming, setRenaming] = React.useState(false);
  const [favorite, setFavorite] = React.useState(false);

  React.useEffect(() => { setName(assetName); }, [assetName]);
  React.useEffect(() => {
    if (!assetId) return;
    try { setFavorite(window.localStorage.getItem(`creator:asset:fav:${assetId}`) === '1'); } catch { /* ignore */ }
  }, [assetId]);
  const toggleFavorite = () => {
    const next = !favorite; setFavorite(next);
    if (assetId) { try { window.localStorage.setItem(`creator:asset:fav:${assetId}`, next ? '1' : '0'); } catch { /* ignore */ } }
  };

  const visual = React.useMemo(() => buildVisualChecklist(template, values, meta), [template, values, meta]);
  const content = React.useMemo(() => buildContentChecklist(template, values), [template, values]);
  const vScore = checklistScore(visual);
  const cScore = checklistScore(content);
  const history = buildVersionHistory({ createdAt: timestamp, templateVersion, edited, regenerations });

  // Quick refine — edits ONLY existing values; never new fields, never regenerate.
  const setFlat = (key: string, v: string) => onChange({ ...values, fields: { ...values.fields, [key]: v } });
  const setSlide = (i: number, key: string, v: string) => onChange({ ...values, slides: (values.slides ?? []).map((r, idx) => (idx === i ? { ...r, [key]: v } : r)) });
  const setSection = (i: number, key: string, v: string) => onChange({ ...values, sections: (values.sections ?? []).map((r, idx) => (idx === i ? { ...r, [key]: v } : r)) });
  const RefineField = ({ f, value, onValue }: { f: TemplateField; value: string; onValue: (v: string) => void }) => (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 3 }}>{f.label}{f.required ? ' *' : ''}</label>
      {f.control === 'textarea'
        ? <textarea style={{ ...input, minHeight: 52, resize: 'vertical' }} value={value} maxLength={f.maxLength} onChange={(e) => onValue(e.target.value)} />
        : <input style={input} value={value} maxLength={f.maxLength} onChange={(e) => onValue(e.target.value)} />}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {/* Review surface */}
      <div style={card}>
        <div style={secLabel}>Asset review</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={name} style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', flex: '0 0 auto' }} />
          ) : (
            <div style={{ width: 160, height: 160, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc', flex: '0 0 auto' }} />
          )}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {renaming ? (
                <>
                  <input style={{ ...input, maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  <button type="button" style={btn} onClick={() => setRenaming(false)}><Check size={13} /> Done</button>
                </>
              ) : (
                <>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>{name || 'Untitled asset'}</strong>
                  <button type="button" style={{ ...btn, border: 'none', padding: 2 }} onClick={() => setRenaming(true)} title="Rename"><PencilIcon size={13} /></button>
                  <button type="button" style={{ ...btn, border: 'none', padding: 2, color: favorite ? '#f59e0b' : '#94a3b8' }} onClick={toggleFavorite} title="Favorite"><Star size={15} fill={favorite ? '#f59e0b' : 'none'} /></button>
                </>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
              <div><div style={kvVal}>{assetType ?? '—'}</div><div style={kvLabel}>Type</div></div>
              <div><div style={kvVal}>{template.name}</div><div style={kvLabel}>Template</div></div>
              {variant ? <div><div style={kvVal}>{variant}</div><div style={kvLabel}>Variant</div></div> : null}
              <div><div style={kvVal}>{platform ?? '—'}</div><div style={kvLabel}>Platform</div></div>
              <div><div style={{ ...kvVal, color: status === 'completed' ? '#16a34a' : '#2563eb' }}>{status}</div><div style={kvLabel}>Status</div></div>
              <div><div style={kvVal}>{timestamp ? new Date(timestamp).toLocaleString() : '—'}</div><div style={kvLabel}>Generated</div></div>
            </div>
          </div>
        </div>

        {/* Quick actions (reused handlers + lightweight local) */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {props.onOpenEditor ? <button type="button" style={btn} onClick={props.onOpenEditor}><Pencil size={13} /> Open editor</button> : null}
          {props.onRegenerate ? <button type="button" style={btn} disabled={props.regenerateBusy} onClick={props.onRegenerate}><RefreshCw size={13} /> {props.regenerateBusy ? 'Regenerating…' : 'Regenerate'}</button> : null}
          {props.onDownload ? <button type="button" style={btn} disabled={props.downloadBusy} onClick={props.onDownload}><Download size={13} /> {props.downloadBusy ? 'Preparing…' : 'Download'}</button> : null}
          {props.onDuplicate ? <button type="button" style={btn} onClick={props.onDuplicate}><Copy size={13} /> Duplicate</button> : null}
        </div>
      </div>

      {/* Checklists */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={secLabel}>Visual checklist</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: vScore.allOk ? '#16a34a' : '#d97706' }}>{vScore.passed}/{vScore.total}</span>
          </div>
          <ChecklistRows items={visual} />
        </div>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={secLabel}>Content checklist</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: cScore.allOk ? '#16a34a' : '#d97706' }}>{cScore.passed}/{cScore.total}</span>
          </div>
          <ChecklistRows items={content} />
        </div>
      </div>

      {/* Quick refine */}
      <div style={card}>
        <button type="button" onClick={() => setRefineOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, ...secLabel, marginBottom: refineOpen ? 10 : 0 }}>
          {refineOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Quick refine <span style={{ textTransform: 'none', fontWeight: 500, color: '#94a3b8' }}>· edit existing fields, no regeneration</span>
        </button>
        {refineOpen ? (
          <div>
            {template.formDefinition.fields.map((f) => <RefineField key={f.key} f={f} value={values.fields[f.key] ?? ''} onValue={(v) => setFlat(f.key, v)} />)}
            {template.formDefinition.slides && values.slides ? values.slides.map((row, i) => (
              <div key={`s-${i}`} style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Slide {i + 1}</div>
                {template.formDefinition.slides!.fields.map((f) => <RefineField key={f.key} f={f} value={row[f.key] ?? ''} onValue={(v) => setSlide(i, f.key, v)} />)}
              </div>
            )) : null}
            {template.formDefinition.sections && values.sections ? values.sections.map((row, i) => (
              <div key={`x-${i}`} style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{template.formDefinition.sections!.sectionLabel} {i + 1}</div>
                {template.formDefinition.sections!.fields.map((f) => <RefineField key={f.key} f={f} value={row[f.key] ?? ''} onValue={(v) => setSection(i, f.key, v)} />)}
              </div>
            )) : null}
            <div style={{ marginTop: 8 }}>
              <button type="button" style={btn} onClick={() => { setRefineOpen(false); props.onOpenEditor?.(); }}><Check size={13} /> Done — back to editor</button>
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 10 }}>Edits apply to the editor immediately. Regenerate to re-render.</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Version history */}
      <div style={card}>
        <button type="button" onClick={() => setHistoryOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, ...secLabel, marginBottom: historyOpen ? 10 : 0 }}>
          {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Version history
        </button>
        {historyOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {history.map((e, i) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: e.kind === 'original' ? '#2563eb' : e.kind === 'regenerated' ? '#7c3aed' : '#16a34a', flex: '0 0 auto' }} />
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>{e.label}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}{e.templateVersion != null ? ` · template v${e.templateVersion}` : ''}</span>
                </div>
                {i < history.length - 1 ? <div style={{ color: '#cbd5e1', fontSize: 12, paddingLeft: 3 }}>↓</div> : null}
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>

      {/* Compare original vs current */}
      <div style={card}>
        <button type="button" onClick={() => setCompareOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, ...secLabel, marginBottom: compareOpen ? 10 : 0 }}>
          {compareOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Compare {edited ? '· original vs current draft' : ''}
        </button>
        {compareOpen ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ border: '1px solid #eef2f7', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Original</div>
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="original" style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 8 }} />
              ) : null}
              <ChecklistRows items={originalValues ? buildContentChecklist(template, originalValues) : content} />
            </div>
            <div style={{ border: '1px solid #eef2f7', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Current draft {edited ? '(edited)' : '(unchanged)'}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>Re-render with Regenerate to preview current edits.</div>
              <ChecklistRows items={content} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
