'use client';

/**
 * Marketing Creation Workspace (CREATOR-058) — ONE unified entry that replaces
 * separate Writer / Creator / Campaign starts. Writer/Creator/Campaign become
 * capabilities inside one flow:
 *
 *   Business Goal → Shared Brief → AI Creation Plan (Asset Planner) → open each
 *   asset in its EXISTING generator (orchestration only — no runtime change).
 *
 * Reuses the canonical 057 model (goals + routing + brief + plan). The "AI
 * proposes a plan" is the deterministic goal→content-type routing (no new AI,
 * per the phase's IMPORTANT note). Review/Publish stay in the existing per-asset
 * editors; this workspace orchestrates and tracks them.
 */

import React from 'react';
import { ArrowLeft, Check, Sparkles, Wand2, PenLine, ImageIcon, Megaphone } from 'lucide-react';
import { listOutcomesByCategory, getOutcome } from '../../lib/creator-outcomes/outcomeRegistry';
import {
  routeGoalToContentTypes, emptyMarketingBrief, mergeBrief, buildCreationPlan,
  type MarketingBrief, type CreationLane, type ContentType,
} from '../../lib/content/unifiedCreationModel';
import { buildWorkspaceState, statusCounts, ASSET_STATUS_LABELS, type AssetStatus } from '../../lib/content/creationGenerationState';
import { SampleGallery } from './SampleGallery';
import type { MarketingSample } from '../../lib/creator-outcomes/marketingSample';
import { MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief } from '../../lib/content/marketingBriefResolver';
import { buildWorkspaceContext, inheritedSummary, type WorkspaceContext } from '../../lib/content/workspaceContext';

type Step = 'goal' | 'samples' | 'brief' | 'plan';
const CUSTOM = 'brand-awareness';

// CREATOR-073: business language — no Writer/Creator/Campaign module terminology.
const LANE_META: Record<CreationLane, { label: string; icon: React.ReactNode; effort: string }> = {
  writer: { label: 'Writing', icon: <PenLine size={15} />, effort: '5–10 min' },
  creator: { label: 'Visuals', icon: <ImageIcon size={15} />, effort: '~1 min' },
  campaign: { label: 'Campaigns', icon: <Megaphone size={15} />, effort: 'multi-asset' },
};

const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '28px 20px 96px', color: '#0f172a' };
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.05)', textAlign: 'left' };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 };
const input: React.CSSProperties = { width: '100%', borderRadius: 10, border: '1px solid #d1d5db', padding: '10px 12px', fontSize: 14, color: '#0f172a' };

export function MarketingCreationWorkspace({ onNavigate, onAdvanced }: { onNavigate: (url: string) => void; onAdvanced?: () => void }) {
  const [step, setStep] = React.useState<Step>('goal');
  const [goalId, setGoalId] = React.useState<string | null>(null);
  const [customLabel, setCustomLabel] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState<MarketingBrief>(emptyMarketingBrief());
  const [disabled, setDisabled] = React.useState<Set<string>>(new Set());
  const [selectedSample, setSelectedSample] = React.useState<MarketingSample | null>(null);  // CREATOR-098
  const [expandedAsset, setExpandedAsset] = React.useState<string | null>(null);  // CREATOR-069 inline lane panel

  const setField = (k: keyof MarketingBrief, v: string) => setBrief((b) => mergeBrief(b, { [k]: v } as Partial<MarketingBrief>));
  const header = (title: string, sub?: string, back?: () => void) => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {back ? <button type="button" style={linkBtn} onClick={back}><ArrowLeft size={14} /> Back</button> : <span />}
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>Marketing Creation</span>
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 6px' }}>{title}</h1>
      {sub ? <p style={{ color: '#64748b', fontSize: 15, marginBottom: 22 }}>{sub}</p> : null}
    </>
  );

  // ── Step 1 — Business Goal ───────────────────────────────────────────────
  if (step === 'goal') {
    // CREATOR-098: Goal → Sample Gallery (not Brief). The sample is the primary choice.
    const pick = (id: string, lbl?: string) => { setGoalId(id); setCustomLabel(lbl ?? null); setBrief(emptyMarketingBrief(id)); setDisabled(new Set()); setSelectedSample(null); setStep('samples'); };
    return (
      <div style={wrap}>
        {header('What do you want to achieve?', 'One workspace for everything — articles, images, carousels, campaigns. We plan it for you.')}
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
          <Wand2 size={20} color="#7c3aed" /><div><div style={{ fontSize: 15.5, fontWeight: 800 }}>My own idea</div><div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3 }}>Describe anything — we plan the assets.</div></div>
        </button>
      </div>
    );
  }

  // ── Step 1b — Sample Gallery (CREATOR-098: immediately after Goal) ────────
  if (step === 'samples') {
    return (
      <SampleGallery
        goalId={goalId}
        goalLabel={customLabel ?? getOutcome(goalId ?? '')?.label ?? undefined}
        onUse={(s) => { setSelectedSample(s); setStep('brief'); }}
        onBack={() => setStep('goal')}
        onAdvanced={onAdvanced}
      />
    );
  }

  // ── Step 2 — Shared Brief ────────────────────────────────────────────────
  if (step === 'brief') {
    return (
      <div style={wrap}>
        {header('Tell us once', 'One brief feeds every asset — you’ll never be asked the same thing twice.', () => setStep('goal'))}
        <textarea value={brief.freeText ?? ''} onChange={(e) => setField('freeText', e.target.value)} rows={5}
          placeholder={`e.g. ${customLabel ?? ''} for our SaaS — audience busy founders, confident friendly tone, CTA "Start free".`} style={{ ...input, resize: 'vertical', marginBottom: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {([['audience', 'Audience'], ['tone', 'Tone'], ['cta', 'Call to action'], ['offer', 'Offer / product']] as [keyof MarketingBrief, string][]).map(([k, lbl]) => (
            <div key={k}><div style={{ ...label, marginBottom: 6 }}>{lbl}</div>
              <input type="text" value={(brief[k] as string) ?? ''} onChange={(e) => setField(k, e.target.value)} style={input} /></div>
          ))}
        </div>
        <button type="button" style={{ ...primaryBtn, marginTop: 22 }} onClick={() => setStep('plan')}><Sparkles size={16} /> Build my plan</button>
      </div>
    );
  }

  // ── Step 3 — AI Creation Plan / Asset Planner ────────────────────────────
  const routes = goalId ? routeGoalToContentTypes(goalId) : [];
  const byLane: Record<CreationLane, ContentType[]> = { writer: [], creator: [], campaign: [] };
  for (const r of routes) byLane[r.lane].push(r.contentType);
  const rationaleOf = (id: string) => routes.find((r) => r.contentType.id === id)?.rationale ?? '';
  const toggle = (id: string) => setDisabled((d) => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const enabled = routes.map((r) => r.contentType).filter((ct) => !disabled.has(ct.id));
  const openAsset = (ct: ContentType) => {
    try { sessionStorage.setItem(MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief({ ...brief, goalId })); } catch { /* noop */ }
    // CREATOR-098: the sample was already chosen up front (Goal → Sample Gallery);
    // pass it straight to the Creator editor as the blueprint — no creatorflow sub-flow.
    const extra = ct.lane === 'creator' && selectedSample ? `&blueprint=${encodeURIComponent(selectedSample.sampleId)}` : '';
    const sep = ct.entryRoute.includes('?') ? '&' : '?';
    onNavigate(`${ct.entryRoute}${sep}goal=${encodeURIComponent(goalId ?? '')}${extra}`);
  };

  // CREATOR-069 — embedded lane configuration panels. Each lane shows ONLY its own
  // controls; Goal/Audience/Brand/CTA are inherited from the WorkspaceContext and
  // never re-asked. "Open Advanced Editor" stays as the optional escape hatch.
  const ctx: WorkspaceContext = buildWorkspaceContext({ ...brief, goalId });
  const ro: React.CSSProperties = { fontSize: 13, color: '#0f172a', background: '#f1f5f9', borderRadius: 8, padding: '8px 10px' };
  const panelStyle: React.CSSProperties = { borderTop: '1px solid #e5e7eb', marginTop: 10, paddingTop: 10 };
  const fieldRow = (lbl: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 8 }}><div style={{ ...label, marginBottom: 4 }}>{lbl}</div>{node}</div>
  );
  const advancedEditorLink = (ct: ContentType) => (
    <button type="button" style={linkBtn} onClick={() => openAsset(ct)}>Open Advanced Editor →</button>
  );
  const lanePanel = (lane: CreationLane, ct: ContentType) => {
    const inh = <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>Inherits from brief — {inheritedSummary(ctx) || 'add brief details to enrich'}</div>;
    if (lane === 'writer') return (
      <div style={panelStyle}>{inh}
        {fieldRow('Content type', <div style={ro}>{ct.label}</div>)}
        {fieldRow('Tone', <input defaultValue={ctx.tone} placeholder="confident, helpful…" style={input} />)}
        {fieldRow('Length', <select defaultValue="medium" style={input}><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select>)}
        {fieldRow('Call to action', <input defaultValue={ctx.cta} style={input} />)}
        {advancedEditorLink(ct)}
      </div>
    );
    if (lane === 'creator') return (
      <div style={panelStyle}>{inh}
        {fieldRow('Format', <div style={ro}>{ct.label}</div>)}
        {fieldRow('Aspect ratio', <select defaultValue="square" style={input}><option value="square">Square</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>)}
        {fieldRow('Marketing example', <button type="button" style={{ ...primaryBtn, padding: '8px 14px', fontSize: 13 }} onClick={() => openAsset(ct)}>Choose an example →</button>)}
        {advancedEditorLink(ct)}
      </div>
    );
    return (
      <div style={panelStyle}>{inh}
        {fieldRow('Campaign type', <div style={ro}>{ct.label}</div>)}
        {fieldRow('Channels', <input placeholder="LinkedIn, X, Instagram…" style={input} />)}
        {fieldRow('Schedule', <input placeholder="Start date" style={input} />)}
        {fieldRow('Cadence', <select defaultValue="weekly" style={input}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option></select>)}
        {advancedEditorLink(ct)}
      </div>
    );
  };

  return (
    <div style={wrap}>
      {header('Your creation plan', 'Everything for this goal in one place. Configure each asset inline — Goal, Audience and Brand are inherited from your brief.', () => setStep('brief'))}
      {(['writer', 'creator', 'campaign'] as CreationLane[]).filter((l) => byLane[l].length > 0).map((lane) => (
        <div key={lane} style={{ marginBottom: 22 }}>
          <div style={{ ...label, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 7 }}>{LANE_META[lane].icon} {LANE_META[lane].label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {byLane[lane].map((ct) => {
              const off = disabled.has(ct.id);
              return (
                <div key={ct.id} style={{ ...card, padding: 14, opacity: off ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{ct.label}</div>
                    <button type="button" onClick={() => toggle(ct.id)} style={{ ...linkBtn, color: off ? '#16a34a' : '#94a3b8' }}>{off ? 'Enable' : 'Disable'}</button>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 5, lineHeight: 1.45 }}>{rationaleOf(ct.id)}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Effort · {LANE_META[lane].effort} · Planned</span>
                    {!off ? <button type="button" style={{ ...linkBtn }} onClick={() => setExpandedAsset((p) => (p === ct.id ? null : ct.id))}>{expandedAsset === ct.id ? 'Hide ▴' : 'Configure ▾'}</button> : null}
                  </div>
                  {!off && expandedAsset === ct.id ? lanePanel(lane, ct) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {(() => {
        const plan = goalId ? buildCreationPlan(goalId, brief, enabled.map((c) => c.id)) : null;
        const counts = plan ? statusCounts(buildWorkspaceState(plan)) : null;
        const order: AssetStatus[] = ['planned', 'generating', 'needs-review', 'approved', 'published'];
        return (
          <div style={{ ...card, padding: '14px 16px', marginTop: 8, background: '#f8fafc' }}>
            <div style={{ ...label, marginBottom: 8 }}>Publish center</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {counts ? order.map((s) => (<span key={s} style={{ fontSize: 12.5, color: '#475569' }}><strong>{counts[s]}</strong> {ASSET_STATUS_LABELS[s]}</span>)) : null}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Every asset reports into one shared status. Open each to generate, review and publish in its editor — your brief is shared across all of them.</div>
          </div>
        );
      })()}
      <button type="button" style={{ ...primaryBtn, marginTop: 18 }} disabled={enabled.length === 0}
        onClick={() => { const plan = goalId ? buildCreationPlan(goalId, brief, enabled.map((c) => c.id)) : null; const first = plan && (plan.lanes.creator[0] ?? plan.lanes.writer[0] ?? plan.lanes.campaign[0]); if (first) openAsset(first); }}>
        <Check size={16} /> Start creating
      </button>
    </div>
  );
}
