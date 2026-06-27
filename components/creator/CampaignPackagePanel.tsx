import React from 'react';
import { Check, RefreshCw, Download, Pencil, Copy, Package, Send, CalendarClock } from 'lucide-react';
import { buildPackageExportManifest, type CampaignPackage } from '../../lib/creator-templates';

/**
 * CAMPAIGN-005 — Campaign Package Assembler (read-only review + reference export).
 *
 * Presents already-generated assets as one campaign deliverable: the package tree,
 * reused metadata, a review (included / missing / warnings / ready flags), the
 * deterministic consistency check, a read-only timeline, and a reference-only export
 * (a JSON manifest of asset URLs + metadata + summary — no pixels, no re-render).
 * Actions reuse the page's handlers; nothing here regenerates or re-renders.
 */

interface Props {
  pkg: CampaignPackage;
  onOpenAsset?: () => void;
  onRegenerate?: () => void;
  onDuplicate?: () => void;
  onPublish?: () => void;
  onSchedule?: () => void;
  regenerateBusy?: boolean;
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' };
const secLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#334155' };
const btnPrimary: React.CSSProperties = { ...btn, border: 'none', background: '#2563eb', color: '#fff' };
const kvLabel: React.CSSProperties = { fontSize: 11, color: '#94a3b8' };
const kvVal: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#0f172a' };

const TIMELINE_COLOR: Record<string, string> = { generated: '#2563eb', edited: '#16a34a', regenerated: '#7c3aed', published: '#0891b2', scheduled: '#d97706' };

export default function CampaignPackagePanel({ pkg, onOpenAsset, onRegenerate, onDuplicate, onPublish, onSchedule, regenerateBusy }: Props) {
  const { metadata, slots, caption, cta, publishingNotes, summary, includedAssets, missingAssets, warnings, readyForPublishing, readyForScheduling, consistency, timeline } = pkg;

  const downloadPackage = () => {
    if (typeof document === 'undefined') return;
    let stamp: string | null = null;
    try { stamp = new Date().toISOString(); } catch { stamp = null; }
    const manifest = buildPackageExportManifest(pkg, stamp);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(metadata.name || 'campaign').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-package.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const slotRow = (label: string, value: string | null, ok: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: ok ? '#16a34a' : '#cbd5e1', fontWeight: 800, width: 12, textAlign: 'center' }}>{ok ? '✓' : '–'}</span>
      <span style={{ color: '#334155', fontWeight: 600, minWidth: 92 }}>{label}</span>
      <span style={{ color: '#64748b', fontSize: 12 }}>{value ?? 'not generated'}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <Package size={18} color="#2563eb" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{metadata.name}</div>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>{summary}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: metadata.status === 'complete' ? '#16a34a' : metadata.status === 'partial' ? '#d97706' : '#94a3b8', textTransform: 'uppercase' }}>{metadata.status}</span>
      </div>

      {/* Package tree */}
      <div style={card}>
        <div style={secLabel}>Campaign package</div>
        {slotRow('Hero image', slots.hero?.template ?? null, !!slots.hero)}
        {slotRow('Carousel', slots.carousel?.template ?? null, !!slots.carousel)}
        {slotRow('Infographic', slots.infographic?.template ?? null, !!slots.infographic)}
        {slotRow('Banner', slots.banner?.template ?? null, !!slots.banner)}
        {slotRow('Caption', caption ? `${caption.slice(0, 48)}${caption.length > 48 ? '…' : ''}` : null, !!caption)}
        {slotRow('CTA', cta, !!cta)}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 3 }}>Publishing notes</div>
          {publishingNotes.map((n, i) => <div key={i} style={{ fontSize: 12, color: '#64748b', padding: '1px 0' }}>• {n}</div>)}
        </div>
      </div>

      {/* Metadata */}
      <div style={card}>
        <div style={secLabel}>Package metadata</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
          <div><div style={kvVal}>{metadata.objective ?? '—'}</div><div style={kvLabel}>Objective</div></div>
          <div><div style={kvVal}>{metadata.audience ?? '—'}</div><div style={kvLabel}>Audience</div></div>
          <div><div style={kvVal}>{metadata.platforms.join(', ') || '—'}</div><div style={kvLabel}>Platform(s)</div></div>
          <div><div style={kvVal}>{metadata.generatedAt ? new Date(metadata.generatedAt).toLocaleString() : '—'}</div><div style={kvLabel}>Generated</div></div>
          <div><div style={kvVal}>{metadata.templates.join(', ') || '—'}</div><div style={kvLabel}>Template(s)</div></div>
          <div><div style={kvVal}>{metadata.variants.join(', ') || '—'}</div><div style={kvLabel}>Variants</div></div>
          <div><div style={kvVal}>{metadata.assetCount}</div><div style={kvLabel}>Asset count</div></div>
          <div><div style={kvVal}>{metadata.status}</div><div style={kvLabel}>Status</div></div>
        </div>
      </div>

      {/* Review */}
      <div style={card}>
        <div style={secLabel}>Package review</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: '#16a34a', fontWeight: 700 }}>{includedAssets.length} included</span>
          {missingAssets.length ? <span style={{ color: '#94a3b8' }}>{missingAssets.length} not generated ({missingAssets.join(', ')})</span> : null}
        </div>
        {warnings.length ? (
          <div style={{ marginTop: 8 }}>
            {warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: '#92400e', padding: '1px 0' }}>! {w}</div>)}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: readyForPublishing ? '#16a34a' : '#94a3b8' }}>{readyForPublishing ? '✓' : '–'} Ready for publishing</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: readyForScheduling ? '#16a34a' : '#94a3b8' }}>{readyForScheduling ? '✓' : '–'} Ready for scheduling</span>
        </div>
      </div>

      {/* Consistency */}
      <div style={card}>
        <div style={secLabel}>Consistency check</div>
        {consistency.map((c) => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
            <span style={{ color: c.ok ? '#16a34a' : '#d97706', fontWeight: 800, width: 12, textAlign: 'center' }}>{c.ok ? '✓' : '!'}</span>
            <span style={{ color: '#334155' }}>{c.label}</span>
            {c.detail ? <span style={{ color: '#94a3b8', fontSize: 11 }}>· {c.detail}</span> : null}
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div style={card}>
        <div style={secLabel}>Timeline</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {timeline.map((e, i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: TIMELINE_COLOR[e.kind] ?? '#94a3b8', flex: '0 0 auto' }} />
                <span style={{ color: '#0f172a', fontWeight: 600 }}>{e.label}</span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</span>
              </div>
              {i < timeline.length - 1 ? <div style={{ color: '#cbd5e1', fontSize: 12, paddingLeft: 3 }}>↓</div> : null}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={btnPrimary} onClick={downloadPackage}><Download size={14} /> Download package</button>
        {onPublish ? <button type="button" style={btn} disabled={!readyForPublishing} onClick={onPublish}><Send size={13} /> Publish campaign</button> : null}
        {onSchedule ? <button type="button" style={btn} disabled={!readyForScheduling} onClick={onSchedule}><CalendarClock size={13} /> Schedule campaign</button> : null}
        {onOpenAsset ? <button type="button" style={btn} onClick={onOpenAsset}><Pencil size={13} /> Open asset</button> : null}
        {onRegenerate ? <button type="button" style={btn} disabled={regenerateBusy} onClick={onRegenerate}><RefreshCw size={13} /> {regenerateBusy ? 'Regenerating…' : 'Regenerate asset'}</button> : null}
        {onDuplicate ? <button type="button" style={btn} onClick={onDuplicate}><Copy size={13} /> Duplicate asset</button> : null}
      </div>
    </div>
  );
}
