'use client';

/**
 * SampleGallery (CREATOR-098) — the ONE Marketing Sample gallery, extracted so it is
 * the primary creation journey owned by the Marketing Workspace (Goal → Sample →
 * Brief). Finished marketing examples picked by sight; real preview or a muted image
 * affordance (never synthetic artwork). No implementation terminology — those live in
 * Advanced Mode. Selecting a sample hands the full definition back via onUse.
 */

import React from 'react';
import { Check, Sparkles, Image as ImageIcon, Layers, BarChart3, Lock, Wand2, X, ArrowLeft } from 'lucide-react';
import { listSamplesForGoal, type MarketingSample } from '../../lib/creator-outcomes/marketingSample';
import type { TemplateAssetFamily } from '../../lib/creator-templates/types';

const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '28px 20px 96px', color: '#0f172a' };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 };

const ASSET_ICON: Record<string, React.ReactNode> = {
  image: <ImageIcon size={13} />, carousel: <Layers size={13} />, infographic: <BarChart3 size={13} />,
};

function SampleCard({ sample, recommended, reason, onUse, onDetails }: {
  sample: MarketingSample; recommended?: boolean; reason?: string; onUse: () => void; onDetails: () => void;
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 16, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button type="button" onClick={onDetails} title="See what will be preserved and changed"
        style={{ aspectRatio: '4 / 3', background: '#f8fafc', borderBottom: '1px solid #eef2f7', border: 'none', padding: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', width: '100%' }}>
        {sample.previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sample.previewImage} alt={sample.title} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <ImageIcon size={24} color="#cbd5e1" aria-label="Preview image" />
        )}
        {recommended ? (
          <span style={{ position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#16a34a', color: '#fff', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '3px 9px' }}><Sparkles size={11} /> Recommended</span>
        ) : null}
      </button>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{sample.title}</div>
          <div style={{ display: 'inline-flex', gap: 5, color: '#94a3b8' }} title="Works as">{sample.supportedAssetTypes.map((t) => <span key={t}>{ASSET_ICON[t]}</span>)}</div>
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.45, flex: 1 }}>{sample.description}</div>
        {recommended && reason ? <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600 }}>Recommended because {reason}</div> : null}
        <button type="button" style={{ ...primaryBtn, padding: '10px 16px', fontSize: 14, justifyContent: 'center' }} onClick={onUse}><Check size={15} /> Use this example</button>
      </div>
    </div>
  );
}

function SampleDetails({ sample, onUse, onClose }: { sample: MarketingSample; onUse: () => void; onClose: () => void }) {
  const a = sample.generationDNA.adaptation;
  const col = (title: string, icon: React.ReactNode, items: string[], color: string) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13, color }}>{icon} {title}</div>
      <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => <li key={it} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#334155', textTransform: 'capitalize' }}><Check size={13} color={color} /> {it}</li>)}
      </ul>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, maxWidth: 640, width: '100%', padding: 24, boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{sample.title}</div><div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{sample.description}</div></div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 20 }}>
          {col('What will be preserved', <Lock size={14} />, a.immutable, '#2563eb')}
          {col('What will change to fit you', <Wand2 size={14} />, a.adaptable, '#16a34a')}
        </div>
        <button type="button" style={{ ...primaryBtn, marginTop: 24, width: '100%', justifyContent: 'center' }} onClick={onUse}><Check size={16} /> Use this example</button>
      </div>
    </div>
  );
}

export function SampleGallery({ goalId, goalLabel, family, onUse, onBack, onAdvanced }: {
  goalId: string | null;
  goalLabel?: string;
  family?: TemplateAssetFamily;
  onUse: (sample: MarketingSample) => void;
  onBack?: () => void;
  onAdvanced?: () => void;
}) {
  const [lookQuery, setLookQuery] = React.useState('');
  const [detailsSample, setDetailsSample] = React.useState<MarketingSample | null>(null);
  const q = lookQuery.trim().toLowerCase();
  const samples = listSamplesForGoal(goalId, family).filter((s) => !q || `${s.title} ${s.description}`.toLowerCase().includes(q));
  const gl = goalLabel ?? 'your goal';
  const use = (s: MarketingSample) => { setDetailsSample(null); onUse(s); };
  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {onBack ? <button type="button" style={linkBtn} onClick={onBack}><ArrowLeft size={14} /> Back</button> : <span />}
        {onAdvanced ? <button type="button" style={linkBtn} onClick={onAdvanced}>Advanced template browser →</button> : <span />}
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 6px' }}>Pick an example you like</h1>
      <p style={{ color: '#64748b', fontSize: 15, marginBottom: 18 }}>{gl} — choose a finished marketing example. We&apos;ll match its look using your own content.</p>
      <input value={lookQuery} onChange={(e) => setLookQuery(e.target.value)} placeholder="Search examples…"
        style={{ width: '100%', maxWidth: 360, borderRadius: 10, border: '1px solid #d1d5db', padding: '10px 12px', fontSize: 14, marginBottom: 18 }} />
      {samples.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>No examples match “{lookQuery}”.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {samples.map((s, i) => (
            <SampleCard key={s.sampleId} sample={s}
              recommended={!q && i < 3}
              reason={`it fits ${gl.toLowerCase()}${s.industryTags[0] ? ` for ${s.industryTags[0]}` : ''}`}
              onUse={() => use(s)}
              onDetails={() => setDetailsSample(s)} />
          ))}
        </div>
      )}
      {detailsSample ? <SampleDetails sample={detailsSample} onUse={() => use(detailsSample)} onClose={() => setDetailsSample(null)} /> : null}
    </div>
  );
}
