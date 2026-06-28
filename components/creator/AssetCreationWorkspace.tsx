'use client';

/**
 * CREATOR-103 — asset-specific creation workspaces. The generic "one workspace for
 * everything" entry is replaced by three independent, asset-owned experiences. Each
 * owns its hero, goals, asset-only sample gallery, brief and generation hand-off.
 * No shared planner screen, no "articles/campaigns/everything" framing, no creatorflow.
 *
 *   Image       → ImageCreationWorkspace
 *   Carousel    → CarouselCreationWorkspace
 *   Infographic → InfographicCreationWorkspace
 *
 * The three are distinct mounted root components (templates.tsx branches BEFORE any
 * shared workspace). They delegate rendering to one asset-scoped flow, but each is
 * its own component with its own hero, sample family and generation route.
 */

import React from 'react';
import { ArrowLeft, Check, Sparkles, Wand2 } from 'lucide-react';
import { listOutcomesByCategory, getOutcome } from '../../lib/creator-outcomes/outcomeRegistry';
import { emptyMarketingBrief, mergeBrief, type MarketingBrief } from '../../lib/content/unifiedCreationModel';
import { SampleGallery } from './SampleGallery';
import type { MarketingSample } from '../../lib/creator-outcomes/marketingSample';
import type { TemplateAssetFamily } from '../../lib/creator-templates/types';
import { MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief } from '../../lib/content/marketingBriefResolver';

type Asset = 'image' | 'carousel' | 'infographic';
const CUSTOM = 'brand-awareness';

interface AssetConfig {
  rootName: string; label: string; heroTitle: string; heroSub: string;
  goalKicker: string; briefSub: string; briefCta: string;
  family: TemplateAssetFamily; editorRoute: string;
}
const ASSET_CONFIG: Record<Asset, AssetConfig> = {
  image: {
    rootName: 'ImageCreationWorkspace', label: 'image',
    heroTitle: 'What should your image achieve?',
    heroSub: 'Pick a goal, choose an image example you like, and we generate a finished image from your brief.',
    goalKicker: 'New image', briefSub: 'A few details and we generate your image — you only tell us once.',
    briefCta: 'Generate my image', family: 'image', editorRoute: '/command-center/creator-content/image',
  },
  carousel: {
    rootName: 'CarouselCreationWorkspace', label: 'carousel',
    heroTitle: 'What should your carousel achieve?',
    heroSub: 'Pick a goal, choose a carousel example you like, and we build a multi-slide carousel from your brief.',
    goalKicker: 'New carousel', briefSub: 'A few details and we build your carousel — you only tell us once.',
    briefCta: 'Generate my carousel', family: 'carousel', editorRoute: '/command-center/creator-content/carousel',
  },
  infographic: {
    rootName: 'InfographicCreationWorkspace', label: 'infographic',
    heroTitle: 'What should your infographic achieve?',
    heroSub: 'Pick a goal, choose an infographic example you like, and we generate a clear infographic from your brief.',
    goalKicker: 'New infographic', briefSub: 'A few details and we generate your infographic — you only tell us once.',
    briefCta: 'Generate my infographic', family: 'infographic', editorRoute: '/command-center/creator-content/infographic',
  },
};

const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '28px 20px 96px', color: '#0f172a' };
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.05)', textAlign: 'left' };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 };
const input: React.CSSProperties = { width: '100%', borderRadius: 10, border: '1px solid #d1d5db', padding: '10px 12px', fontSize: 14, color: '#0f172a' };

interface WorkspaceProps { onNavigate: (url: string) => void; onAdvanced?: () => void }

function AssetCreationWorkspace({ asset, onNavigate, onAdvanced }: WorkspaceProps & { asset: Asset }) {
  const cfg = ASSET_CONFIG[asset];
  const [step, setStep] = React.useState<'goal' | 'samples' | 'brief'>('goal');
  const [goalId, setGoalId] = React.useState<string | null>(null);
  const [customLabel, setCustomLabel] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState<MarketingBrief>(emptyMarketingBrief());
  const [selectedSample, setSelectedSample] = React.useState<MarketingSample | null>(null);

  const setField = (k: keyof MarketingBrief, v: string) => setBrief((b) => mergeBrief(b, { [k]: v } as Partial<MarketingBrief>));
  const header = (title: string, sub?: string, back?: () => void) => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {back ? <button type="button" style={linkBtn} onClick={back}><ArrowLeft size={14} /> Back</button> : <span />}
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, textTransform: 'capitalize' }}>{cfg.goalKicker}</span>
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 6px' }}>{title}</h1>
      {sub ? <p style={{ color: '#64748b', fontSize: 15, marginBottom: 22 }}>{sub}</p> : null}
    </>
  );

  // ── Goal ─────────────────────────────────────────────────────────────────
  if (step === 'goal') {
    const pick = (id: string, lbl?: string) => { setGoalId(id); setCustomLabel(lbl ?? null); setBrief(emptyMarketingBrief(id)); setSelectedSample(null); setStep('samples'); };
    return (
      <div style={wrap}>
        {header(cfg.heroTitle, cfg.heroSub)}
        {onAdvanced ? (
          <div style={{ marginBottom: 14 }}>
            <button type="button" style={linkBtn} onClick={onAdvanced}>Advanced template browser →</button>
          </div>
        ) : null}
        {listOutcomesByCategory().map((c) => (
          <div key={c.category} style={{ marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 10 }}>{c.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {c.outcomes.map((o) => (
                <button key={o.id} type="button" style={{ ...card, padding: '16px', cursor: 'pointer' }} onClick={() => pick(o.id)}>
                  <div style={{ fontSize: 15.5, fontWeight: 800 }}>{o.label}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 5, lineHeight: 1.45 }}>{o.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button type="button" style={{ ...card, padding: '16px', display: 'flex', alignItems: 'center', gap: 12, width: '100%', cursor: 'pointer' }} onClick={() => pick(CUSTOM, 'My own idea')}>
          <Wand2 size={20} color="#7c3aed" /><div><div style={{ fontSize: 15.5, fontWeight: 800 }}>My own idea</div><div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3 }}>Describe anything — we create the {cfg.label}.</div></div>
        </button>
      </div>
    );
  }

  // ── Sample Gallery (asset-only) ──────────────────────────────────────────
  if (step === 'samples') {
    return (
      <SampleGallery
        goalId={goalId}
        goalLabel={customLabel ?? getOutcome(goalId ?? '')?.label ?? undefined}
        family={cfg.family}
        onUse={(s) => { setSelectedSample(s); setStep('brief'); }}
        onBack={() => setStep('goal')}
        onAdvanced={onAdvanced}
      />
    );
  }

  // ── Brief → Generate ─────────────────────────────────────────────────────
  const generate = () => {
    try { sessionStorage.setItem(MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief({ ...brief, goalId })); } catch { /* noop */ }
    const bp = selectedSample ? `&blueprint=${encodeURIComponent(selectedSample.sampleId)}` : '';
    // CREATOR-106: the sample IS the chosen template, so skip the editor's own template
    // gallery (skip_templates=1) — otherwise [type].tsx bounces back to /templates.
    onNavigate(`${cfg.editorRoute}?goal=${encodeURIComponent(goalId ?? '')}${bp}&from=workspace&skip_templates=1`);
  };
  return (
    <div style={wrap}>
      {header('Tell us once', cfg.briefSub, () => setStep('samples'))}
      <textarea value={brief.freeText ?? ''} onChange={(e) => setField('freeText', e.target.value)} rows={5}
        placeholder={`e.g. ${customLabel ?? cfg.label} for our SaaS — audience busy founders, confident friendly tone, CTA "Start free".`} style={{ ...input, resize: 'vertical', marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {([['audience', 'Audience'], ['tone', 'Tone'], ['cta', 'Call to action'], ['offer', 'Offer / product']] as [keyof MarketingBrief, string][]).map(([k, lbl]) => (
          <div key={k}><div style={{ ...label, marginBottom: 6 }}>{lbl}</div>
            <input type="text" value={(brief[k] as string) ?? ''} onChange={(e) => setField(k, e.target.value)} style={input} /></div>
        ))}
      </div>
      <button type="button" style={{ ...primaryBtn, marginTop: 22 }} onClick={generate}><Sparkles size={16} /> {cfg.briefCta}</button>
    </div>
  );
}

export function ImageCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="image" {...props} />; }
export function CarouselCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="carousel" {...props} />; }
export function InfographicCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="infographic" {...props} />; }
