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
import { ArrowLeft, ArrowRight, Check, Sparkles, Wand2 } from 'lucide-react';
import { listOutcomesByCategory, getOutcome } from '../../lib/creator-outcomes/outcomeRegistry';
import { emptyMarketingBrief, mergeBrief, type MarketingBrief } from '../../lib/content/unifiedCreationModel';
import { SampleGallery } from './SampleGallery';
import { VisualDirectionStep, SubjectStep } from './GuidedCreativeSteps';
import {
  GUIDED_CHOICES_SESSION_KEY, serializeGuidedChoices,
  type SubjectChoice,
} from '../../lib/content/guidedCreativeSession';
import type { CreatorTemplate } from '../../lib/creator-templates/types';
import type { TemplateAssetFamily } from '../../lib/creator-templates/types';
import { MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief } from '../../lib/content/marketingBriefResolver';
import ChatVoiceButton from '../ChatVoiceButton';
import CreateWithAIChat from './CreateWithAIChat';
import { color, radius, shadow, space, fontSize, fontWeight } from '../../lib/platform/ui';

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
    goalKicker: 'New image', briefSub: 'A few details, then you review everything before we generate.',
    briefCta: 'Continue to customize', family: 'image', editorRoute: '/command-center/creator-content/image',
  },
  carousel: {
    rootName: 'CarouselCreationWorkspace', label: 'carousel',
    heroTitle: 'What should your carousel achieve?',
    heroSub: 'Pick a goal, choose a carousel example you like, and we build a multi-slide carousel from your brief.',
    goalKicker: 'New carousel', briefSub: 'A few details, then you review everything before we generate.',
    briefCta: 'Continue to customize', family: 'carousel', editorRoute: '/command-center/creator-content/carousel',
  },
  infographic: {
    rootName: 'InfographicCreationWorkspace', label: 'infographic',
    heroTitle: 'What should your infographic achieve?',
    heroSub: 'Pick a goal, choose an infographic example you like, and we generate a clear infographic from your brief.',
    goalKicker: 'New infographic', briefSub: 'A few details, then you review everything before we generate.',
    briefCta: 'Continue to customize', family: 'infographic', editorRoute: '/command-center/creator-content/infographic',
  },
};

// CREATOR-142 — Platform v1.0 tokens only (no raw hex/shadow; one brand blue).
const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: `${space['2xl']}px ${space.xl}px ${space['4xl']}px`, color: color.text };
const card: React.CSSProperties = { border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, boxShadow: shadow.sm, textAlign: 'left' };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.xs, background: 'transparent', border: 'none', color: color.primary[600], cursor: 'pointer', fontSize: fontSize.sm, padding: 0, fontWeight: fontWeight.semibold };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.sm, background: color.primary[600], color: color.onPrimary, border: 'none', borderRadius: radius.md, padding: `${space.md}px ${space.xl}px`, cursor: 'pointer', fontWeight: fontWeight.bold, fontSize: fontSize.sm };
const label: React.CSSProperties = { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: color.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 };
const input: React.CSSProperties = { width: '100%', borderRadius: radius.md, border: `1px solid ${color.border}`, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm, color: color.text };

interface WorkspaceProps { onNavigate: (url: string) => void; onAdvanced?: () => void }

function AssetCreationWorkspace({ asset, onNavigate, onAdvanced }: WorkspaceProps & { asset: Asset }) {
  const cfg = ASSET_CONFIG[asset];
  const [step, setStep] = React.useState<'goal' | 'samples' | 'look' | 'brief'>('goal');
  const [goalId, setGoalId] = React.useState<string | null>(null);
  const [customLabel, setCustomLabel] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState<MarketingBrief>(emptyMarketingBrief());
  const [selectedSample, setSelectedSample] = React.useState<CreatorTemplate | null>(null);
  /* The user's own creative answers. Null on both means "AI decides", which is
   * the default and is shown as such rather than left blank. */
  const [visualDirectionId, setVisualDirectionId] = React.useState<string | null>(null);
  const [subject, setSubject] = React.useState<SubjectChoice | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);
  // CREATOR-106: typed-text base preserved so spoken brief APPENDS to (not replaces) it.
  const voiceBaseRef = React.useRef('');

  // "Suggest with AI" — draft the whole brief (free text + audience / tone / CTA / offer) from the
  // chosen goal + the company's canonical context, so the operator reviews-and-goes instead of
  // typing from scratch. Reuses field-assist over synthetic 'brief' fields; the resulting brief is
  // what "Generate my <asset>" already carries to the editor on the next page.
  const suggestBrief = async () => {
    if (!selectedSample || aiBusy) return;
    setAiBusy(true); setAiError(null);
    try {
      const goalLabel = customLabel ?? getOutcome(goalId ?? '')?.label ?? cfg.label;
      const resp = await fetch('/api/creator-templates/field-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_family: cfg.family,
          template_id: selectedSample.id,
          action: 'generate',
          targets: (['freeText', 'audience', 'tone', 'cta', 'offer'] as const).map((k) => ({
            scope: 'brief', field_key: k, current_value: String((brief[k as keyof MarketingBrief] as string) ?? ''),
          })),
          context: { topic: goalLabel, objective: goalLabel },
        }),
      });
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d?.error || `Suggestion failed (${resp.status})`); }
      const data = await resp.json();
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      const allowed = new Set(['freeText', 'audience', 'tone', 'cta', 'offer']);
      const patch: Record<string, string> = {};
      for (const u of updates) {
        const key = String(u?.field_key ?? u?.fieldKey ?? '');
        const value = typeof u?.value === 'string' ? u.value : '';
        if (allowed.has(key) && value.trim()) patch[key] = value;
      }
      if (patch.freeText) voiceBaseRef.current = patch.freeText;
      if (Object.keys(patch).length) setBrief((b) => mergeBrief(b, patch as Partial<MarketingBrief>));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Suggestion failed');
    } finally {
      setAiBusy(false);
    }
  };

  const setField = (k: keyof MarketingBrief, v: string) => setBrief((b) => mergeBrief(b, { [k]: v } as Partial<MarketingBrief>));
  const header = (title: string, sub?: string, back?: () => void) => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {back ? <button type="button" style={linkBtn} onClick={back}><ArrowLeft size={14} /> Back</button> : <span />}
        <span style={{ fontSize: 12, color: color.textSubtle, fontWeight: 700, textTransform: 'capitalize' }}>{cfg.goalKicker}</span>
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 6px' }}>{title}</h1>
      {sub ? <p style={{ color: color.textMuted, fontSize: 15, marginBottom: 22 }}>{sub}</p> : null}
    </>
  );

  // ── Goal ─────────────────────────────────────────────────────────────────
  if (step === 'goal') {
    const pick = (id: string, lbl?: string) => { setGoalId(id); setCustomLabel(lbl ?? null); setBrief(emptyMarketingBrief(id)); setSelectedSample(null); setVisualDirectionId(null); setSubject(null); setStep('samples'); };
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
                  <div style={{ fontSize: 12.5, color: color.textMuted, marginTop: 5, lineHeight: 1.45 }}>{o.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button type="button" style={{ ...card, padding: '16px', display: 'flex', alignItems: 'center', gap: 12, width: '100%', cursor: 'pointer' }} onClick={() => pick(CUSTOM, 'My own idea')}>
          <Wand2 size={20} color={color.primary[600]} /><div><div style={{ fontSize: 15.5, fontWeight: 800 }}>My own idea</div><div style={{ fontSize: 12.5, color: color.textMuted, marginTop: 3 }}>Describe anything — we create the {cfg.label}.</div></div>
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
        onUse={(s) => { setSelectedSample(s); setStep('look'); }}
        onBack={() => setStep('goal')}
        onAdvanced={onAdvanced}
      />
    );
  }

  // ── How should it look? + What's featured? ───────────────────────────────
  if (step === 'look') {
    return (
      <div style={wrap}>
        <VisualDirectionStep
          family={cfg.family}
          outcomeId={goalId}
          value={visualDirectionId}
          onChange={setVisualDirectionId}
          onBack={() => setStep('samples')}
          onContinue={() => setStep('brief')}
        />
        <SubjectStep value={subject} onChange={setSubject} />
      </div>
    );
  }

  // ── Brief → continue to the editor ───────────────────────────────────────
  const continueToEditor = () => {
    try { sessionStorage.setItem(MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief({ ...brief, goalId })); } catch { /* noop */ }
    /* The creative answers travel the same way the brief does — session storage
     * keyed to this draft — so the editor can restore them without a second
     * transport and without putting a style id in the URL. */
    try {
      sessionStorage.setItem(
        GUIDED_CHOICES_SESSION_KEY,
        serializeGuidedChoices({ visualDirectionId, subject, visualInstruction: null }),
      );
    } catch { /* noop */ }
    // CREATOR-125: the gallery now selects a SYSTEM CreatorTemplate — store its
    // template_id as the canonical selection identity. The downstream editor +
    // generate runtime still consume blueprint_id, so we project the template's
    // provenance (metadata.sourceBlueprintId) back to &blueprint= HERE, at the
    // gallery boundary ONLY (the single temporary compatibility projection — RULE
    // 9). No deeper runtime changes.
    const tid = selectedSample ? `&template_id=${encodeURIComponent(selectedSample.id)}` : '';
    const sourceBlueprintId = selectedSample ? String(selectedSample.metadata?.sourceBlueprintId ?? '') : '';
    const bp = sourceBlueprintId ? `&blueprint=${encodeURIComponent(sourceBlueprintId)}` : '';
    // CREATOR-106: the sample IS the chosen template, so skip the editor's own template
    // gallery (skip_templates=1) — otherwise [type].tsx bounces back to /templates.
    onNavigate(`${cfg.editorRoute}?goal=${encodeURIComponent(goalId ?? '')}${tid}${bp}&from=workspace&skip_templates=1`);
  };
  return (
    <div style={wrap}>
      {header('Tell us once', cfg.briefSub, () => setStep('look'))}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <textarea value={brief.freeText ?? ''} onChange={(e) => { voiceBaseRef.current = e.target.value; setField('freeText', e.target.value); }} rows={5}
          placeholder={`Type or speak — e.g. ${customLabel ?? cfg.label} for our SaaS — audience busy founders, confident friendly tone, CTA "Start free".`}
          style={{ ...input, resize: 'vertical', paddingRight: 56 }} />
        <div style={{ position: 'absolute', right: 10, bottom: 12 }}>
          <ChatVoiceButton
            onTranscription={(t) => setField('freeText', `${voiceBaseRef.current.trim() ? `${voiceBaseRef.current.trim()} ` : ''}${t}`)}
            title="Speak your brief"
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button type="button" onClick={suggestBrief} disabled={aiBusy || !selectedSample}
          style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.surface, color: color.primary[600], border: `1px solid ${color.primary[600]}`, borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, cursor: aiBusy ? 'default' : 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm, opacity: aiBusy ? 0.6 : 1 }}>
          <Sparkles size={14} /> {aiBusy ? 'Drafting your brief…' : 'Suggest with AI'}
        </button>
        <button type="button" onClick={() => setChatOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.primary[600], color: color.onPrimary, border: `1px solid ${color.primary[600]}`, borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, cursor: 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm }}>
          <Wand2 size={14} /> Create with AI
        </button>
        <span style={{ fontSize: 12, color: color.textSubtle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Let AI draft the brief from your goal, chat it out with “Create with AI”, or tap the mic. You can edit everything before generating.
        </span>
      </div>
      {chatOpen ? (
        <CreateWithAIChat
          assetFamily={cfg.family}
          assetLabel={cfg.label}
          goal={customLabel ?? getOutcome(goalId ?? '')?.label ?? cfg.label}
          initialBrief={{
            freeText: String(brief.freeText ?? ''),
            audience: String((brief.audience as string) ?? ''),
            tone: String((brief.tone as string) ?? ''),
            cta: String((brief.cta as string) ?? ''),
            offer: String((brief.offer as string) ?? ''),
          }}
          onApply={(b) => {
            const patch: Record<string, string> = {};
            (['freeText', 'audience', 'tone', 'cta', 'offer'] as const).forEach((k) => {
              if (b[k] && b[k].trim()) patch[k] = b[k];
            });
            if (patch.freeText) voiceBaseRef.current = patch.freeText;
            if (Object.keys(patch).length) setBrief((prev) => mergeBrief(prev, patch as Partial<MarketingBrief>));
            setChatOpen(false);
          }}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
      {aiError ? <div style={{ fontSize: 12, color: color.danger, marginBottom: 12 }}>{aiError}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {([['audience', 'Audience'], ['tone', 'Tone'], ['cta', 'Call to action'], ['offer', 'Offer / product']] as [keyof MarketingBrief, string][]).map(([k, lbl]) => (
          <div key={k}><div style={{ ...label, marginBottom: 6 }}>{lbl}</div>
            <input type="text" value={(brief[k] as string) ?? ''} onChange={(e) => setField(k, e.target.value)} style={input} /></div>
        ))}
      </div>
      <button type="button" style={{ ...primaryBtn, marginTop: 22 }} onClick={continueToEditor}><ArrowRight size={16} /> {cfg.briefCta}</button>
    </div>
  );
}

export function ImageCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="image" {...props} />; }
export function CarouselCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="carousel" {...props} />; }
export function InfographicCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="infographic" {...props} />; }
