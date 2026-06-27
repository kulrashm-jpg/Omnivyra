import React from 'react';
import { Check, RefreshCw, Download, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import {
  stageGlyph,
  type GenerationReviewModel,
  type StageStatus,
  type AssetReviewStatus,
} from '../../lib/creator-templates';

/**
 * CREATOR-010 — Generation Review & Traceability (read-only, presentation).
 *
 * Renders the deterministic GenerationReviewModel: the execution pipeline,
 * per-asset status, humanised failures (no stack traces), a generation summary,
 * a quality summary (reusing existing validation), and an expandable execution
 * trace. Actions are REUSED from the page (regenerate / download / open editor).
 * Nothing here changes generation, rendering, or validation.
 */

interface Props {
  model: GenerationReviewModel;
  onRegenerate?: () => void;
  onDownload?: () => void;
  onOpenInEditor?: () => void;
  downloadBusy?: boolean;
  regenerateBusy?: boolean;
}

const STAGE_COLOR: Record<StageStatus, string> = { done: '#16a34a', active: '#2563eb', failed: '#dc2626', skipped: '#94a3b8', pending: '#cbd5e1' };
const ASSET_STATUS_LABEL: Record<AssetReviewStatus, string> = { completed: 'Completed', generating: 'Generating…', rendering: 'Rendering…', queued: 'Queued…', failed: 'Failed' };
const ASSET_STATUS_COLOR: Record<AssetReviewStatus, string> = { completed: '#16a34a', generating: '#2563eb', rendering: '#2563eb', queued: '#d97706', failed: '#dc2626' };
const OVERALL_LABEL: Record<string, string> = { success: 'Generation complete', partial: 'Completed with some failures', failed: 'Generation failed', in_progress: 'Generating…' };
const OVERALL_COLOR: Record<string, string> = { success: '#16a34a', partial: '#d97706', failed: '#dc2626', in_progress: '#2563eb' };

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' };
const secLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
const kvLabel: React.CSSProperties = { fontSize: 11, color: '#94a3b8' };
const kvVal: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#0f172a' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#334155' };
const btnPrimary: React.CSSProperties = { ...btn, border: 'none', background: '#2563eb', color: '#fff' };

function fmtTime(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function GenerationReviewPanel({ model, onRegenerate, onDownload, onOpenInEditor, downloadBusy, regenerateBusy }: Props) {
  const [traceOpen, setTraceOpen] = React.useState(false);
  const { overall, stages, assets, failures, summary, quality } = model;
  const multi = assets.length > 1;

  const QualityRow = ({ label, value }: { label: string; value: boolean | null }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: value === true ? '#16a34a' : value === false ? '#dc2626' : '#94a3b8', fontWeight: 800 }}>{value === true ? '✓' : value === false ? '✕' : '–'}</span>
      <span style={{ color: '#334155' }}>{label}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {/* Overall */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: OVERALL_COLOR[overall] }}>{stageGlyph(overall === 'success' ? 'done' : overall === 'failed' ? 'failed' : overall === 'in_progress' ? 'active' : 'done')}</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: OVERALL_COLOR[overall] }}>{OVERALL_LABEL[overall] ?? overall}</div>
      </div>

      {/* Pipeline stages */}
      <div style={card}>
        <div style={secLabel}>Generation pipeline</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {stages.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0', opacity: s.status === 'pending' || s.status === 'skipped' ? 0.6 : 1 }}>
              <span style={{ color: STAGE_COLOR[s.status], fontWeight: 800, width: 14, textAlign: 'center' }}>{stageGlyph(s.status)}</span>
              <span style={{ color: s.status === 'failed' ? '#dc2626' : '#334155', fontWeight: s.status === 'active' ? 700 : 500 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-asset status */}
      <div style={card}>
        <div style={secLabel}>{multi ? `Assets (${assets.length})` : 'Asset'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {assets.map((a, i) => (
            <div key={a.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: i > 0 ? 10 : 0 }}>
              {a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt={a.label} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', flex: '0 0 auto' }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, border: '1px solid #e5e7eb', background: '#f8fafc', flex: '0 0 auto' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{a.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: ASSET_STATUS_COLOR[a.status] }}>{ASSET_STATUS_LABEL[a.status]}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {[a.assetType, a.template, a.layout, a.platform].filter(Boolean).join(' · ') || '—'}
                </div>
                {a.failure ? <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4 }}>{a.failure.stage}: {a.failure.reason}</div> : null}
                {a.status === 'completed' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {onOpenInEditor ? <button type="button" style={btn} onClick={onOpenInEditor}><Pencil size={13} /> Open in editor</button> : null}
                    {onRegenerate ? <button type="button" style={btn} disabled={regenerateBusy} onClick={onRegenerate}><RefreshCw size={13} /> {regenerateBusy ? 'Regenerating…' : 'Regenerate'}</button> : null}
                    {onDownload ? <button type="button" style={btn} disabled={downloadBusy} onClick={onDownload}><Download size={13} /> {downloadBusy ? 'Preparing…' : 'Download'}</button> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Failures */}
      {failures.length > 0 ? (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2' }}>
          <div style={{ ...secLabel, color: '#b91c1c' }}>Issues</div>
          {failures.map((f, i) => (
            <div key={i} style={{ fontSize: 12.5, color: '#7f1d1d', padding: '3px 0' }}>
              <strong>{f.stage}{f.asset ? ` · ${f.asset}` : ''}:</strong> {f.reason}
            </div>
          ))}
          {failures.some((f) => f.retryable) && onRegenerate ? (
            <button type="button" style={{ ...btnPrimary, marginTop: 8, background: '#dc2626' }} disabled={regenerateBusy} onClick={onRegenerate}><RefreshCw size={14} /> {regenerateBusy ? 'Retrying…' : 'Retry'}</button>
          ) : null}
        </div>
      ) : null}

      {/* Summary */}
      <div style={card}>
        <div style={secLabel}>Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10 }}>
          <div><div style={kvVal}>{summary.assetsGenerated}</div><div style={kvLabel}>Assets</div></div>
          <div><div style={{ ...kvVal, color: '#16a34a' }}>{summary.successful}</div><div style={kvLabel}>Successful</div></div>
          <div><div style={{ ...kvVal, color: summary.failed ? '#dc2626' : '#0f172a' }}>{summary.failed}</div><div style={kvLabel}>Failed</div></div>
          <div><div style={{ ...kvVal, color: summary.warnings ? '#d97706' : '#0f172a' }}>{summary.warnings}</div><div style={kvLabel}>Warnings</div></div>
          <div><div style={kvVal}>{fmtTime(summary.timeTakenMs)}</div><div style={kvLabel}>Time taken</div></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 12 }}>
          {summary.templateUsed ? <span style={{ color: '#475569' }}>Template: <strong style={{ color: '#0f172a' }}>{summary.templateUsed}</strong></span> : null}
          {summary.variantUsed ? <span style={{ color: '#475569' }}>Variant: <strong style={{ color: '#0f172a' }}>{summary.variantUsed}</strong></span> : null}
          {summary.layoutUsed ? <span style={{ color: '#475569' }}>Layout: <strong style={{ color: '#0f172a' }}>{summary.layoutUsed}</strong></span> : null}
        </div>
      </div>

      {/* Quality summary (reuses existing validation) */}
      <div style={card}>
        <div style={secLabel}>Quality</div>
        <QualityRow label="Readiness passed" value={quality.readinessPassed} />
        <QualityRow label="Template validation passed" value={quality.templateValidationPassed} />
        <QualityRow label="Rendering completed" value={quality.renderingCompleted} />
        {quality.warnings.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', marginBottom: 2 }}>Warnings</div>
            {quality.warnings.slice(0, 6).map((w, i) => <div key={i} style={{ fontSize: 12, color: '#92400e', padding: '1px 0' }}>• {w}</div>)}
          </div>
        ) : null}
      </div>

      {/* Traceability (read-only) */}
      <div style={card}>
        <button type="button" onClick={() => setTraceOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, ...secLabel, marginBottom: traceOpen ? 8 : 0 }}>
          {traceOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Execution details
        </button>
        {traceOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {stages.map((s, i) => (
              <React.Fragment key={s.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ color: STAGE_COLOR[s.status], fontWeight: 800, width: 14, textAlign: 'center' }}>{stageGlyph(s.status)}</span>
                  <span style={{ color: '#334155' }}>{s.label}</span>
                </div>
                {i < stages.length - 1 ? <div style={{ color: '#cbd5e1', fontSize: 12, paddingLeft: 5 }}>↓</div> : null}
              </React.Fragment>
            ))}
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Read-only execution trace · prompts and internal details are never shown.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
