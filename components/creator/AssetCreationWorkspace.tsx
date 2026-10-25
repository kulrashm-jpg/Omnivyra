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
import { creatorCompositionKey, mintCreatorCompositionId } from '../../lib/content/creatorCompositionAsset';
import { useCompanyContext } from '../CompanyContext';
import ChatVoiceButton from '../ChatVoiceButton';
import CreateWithAIChat from './CreateWithAIChat';
import CreatorImageAssetPanel from './CreatorImageAssetPanel';
import { color, radius, shadow, space, fontSize, fontWeight } from '../../lib/platform/ui';
import { WORKFLOW_CONFIG } from '../../lib/creator-content/creatorWorkflowConfig';
import { deriveMainMessage } from '../../lib/creator-content/creatorBrief';
import {
  CREATOR_INTAKE_SESSION_KEY, intakeLayoutOptions, serializeCreatorIntake,
  type IntakeBrandMark, type IntakeBrandMode, type IntakeBrandPresence,
} from '../../lib/creator-content/creatorIntake';
import {
  BRAND_ASSET_SIZE_PRESETS, DEFAULT_BRAND_ASSET_SIZE, type BrandAssetSize,
} from '../../lib/creator-content/creatorWorkflowModel';
import {
  DEFAULT_INDEPENDENT_PALETTE, INDEPENDENT_PALETTE_OPTIONS, type IndependentPaletteChoice,
} from '../../lib/creator-content/creatorPaletteMode';
import type { AttachmentMode } from '../../lib/content/writerCreatorAttachmentContracts';

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
    briefCta: 'Review what we’ll make', family: 'image', editorRoute: '/command-center/creator-content/image',
  },
  carousel: {
    rootName: 'CarouselCreationWorkspace', label: 'carousel',
    heroTitle: 'What should your carousel achieve?',
    heroSub: 'Pick a goal, choose a carousel example you like, and we build a multi-slide carousel from your brief.',
    goalKicker: 'New carousel', briefSub: 'A few details, then you review everything before we generate.',
    briefCta: 'Review what we’ll make', family: 'carousel', editorRoute: '/command-center/creator-content/carousel',
  },
  infographic: {
    rootName: 'InfographicCreationWorkspace', label: 'infographic',
    heroTitle: 'What should your infographic achieve?',
    heroSub: 'Pick a goal, choose an infographic example you like, and we generate a clear infographic from your brief.',
    goalKicker: 'New infographic', briefSub: 'A few details, then you review everything before we generate.',
    briefCta: 'Review what we’ll make', family: 'infographic', editorRoute: '/command-center/creator-content/infographic',
  },
};

// CREATOR-142 — Platform v1.0 tokens only (no raw hex/shadow; one brand blue).
const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: `${space['2xl']}px ${space.xl}px ${space['4xl']}px`, color: color.text };
const card: React.CSSProperties = { border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, boxShadow: shadow.sm, textAlign: 'left' };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.xs, background: 'transparent', border: 'none', color: color.primary[600], cursor: 'pointer', fontSize: fontSize.sm, padding: 0, fontWeight: fontWeight.semibold };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.sm, background: color.primary[600], color: color.onPrimary, border: 'none', borderRadius: radius.md, padding: `${space.md}px ${space.xl}px`, cursor: 'pointer', fontWeight: fontWeight.bold, fontSize: fontSize.sm };
const label: React.CSSProperties = { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: color.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 };
const input: React.CSSProperties = { width: '100%', borderRadius: radius.md, border: `1px solid ${color.border}`, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm, color: color.text };
const chip = (selected: boolean): React.CSSProperties => ({
  borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, fontSize: fontSize.sm, cursor: 'pointer',
  border: `1px solid ${selected ? color.primary[600] : color.border}`,
  background: selected ? color.primary[600] : color.surface,
  color: selected ? color.onPrimary : color.text, fontWeight: fontWeight.semibold,
});
const choiceCard = (selected: boolean): React.CSSProperties => ({
  ...card, padding: `${space.md}px`, cursor: 'pointer',
  border: `${selected ? 2 : 1}px solid ${selected ? color.primary[600] : color.border}`,
});

const contextPill: React.CSSProperties = {
  display: 'inline-block', borderRadius: radius.full, background: color.surface2, border: `1px solid ${color.border}`,
  padding: `2px ${space.md}px`, fontSize: 12, color: color.text,
};
const stickyBar: React.CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
  background: color.surface, borderTop: `1px solid ${color.border}`, boxShadow: shadow.md,
};

const INTAKE_STEPS = ['Goal', 'Design', 'Look', 'Details', 'Review'] as const;

/** Where the user is in the flow; earlier steps are clickable to go back. */
function IntakeSteps({ current, onPick }: { current: number; onPick: (index: number) => void }) {
  return (
    <ol aria-label="Progress" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, listStyle: 'none', padding: 0, margin: `0 0 ${space.lg}px` }}>
      {INTAKE_STEPS.map((name, i) => {
        const done = i < current;
        const active = i === current;
        const dot: React.CSSProperties = {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: radius.full,
          fontSize: 11, fontWeight: fontWeight.bold,
          background: active || done ? color.primary[600] : color.surface,
          color: active || done ? color.onPrimary : color.textSubtle,
          border: `1px solid ${active || done ? color.primary[600] : color.border}`,
        };
        const body = (
          <>
            <span style={dot}>{done ? <Check size={12} /> : i + 1}</span>
            <span style={{ fontSize: fontSize.sm, fontWeight: active ? fontWeight.bold : fontWeight.semibold, color: active ? color.text : color.textMuted }}>{name}</span>
          </>
        );
        return (
          <li key={name} aria-current={active ? 'step' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
            {done
              ? <button type="button" onClick={() => onPick(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>{body}</button>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{body}</span>}
            {i < INTAKE_STEPS.length - 1 ? <span aria-hidden style={{ width: 18, height: 1, background: color.border }} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** One numbered group of intake questions. */
function IntakeCard({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, padding: `${space.lg}px ${space.xl}px`, marginBottom: space.lg }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: hint ? 2 : space.md }}>
        <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: color.primary[600] }}>{n}</span>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h2>
      </div>
      {hint ? <p style={{ fontSize: 12.5, color: color.textMuted, margin: `0 0 ${space.md}px` }}>{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * The main message is the asset's key. When AI drafts the brief and the user has not
 * written a main message yet, propose the brief's first sentence — never overwrite one
 * the user typed.
 */
function withMainMessage(brief: MarketingBrief): MarketingBrief {
  if ((brief.mainMessage ?? '').trim()) return brief;
  const derived = deriveMainMessage(String(brief.freeText ?? ''));
  return derived ? { ...brief, mainMessage: derived } : brief;
}

interface WorkspaceProps {
  onNavigate: (url: string) => void;
  onAdvanced?: () => void;
  /**
   * Context the page was launched with (campaign, or a Writer "Add asset" launch:
   * source=writer&session=…). It is carried through to the editor unchanged — a
   * writer launch previously lost its session here and never imported the post.
   */
  launchQuery?: Record<string, string>;
}

function AssetCreationWorkspace({ asset, onNavigate, onAdvanced, launchQuery }: WorkspaceProps & { asset: Asset }) {
  const cfg = ASSET_CONFIG[asset];
  // The ACTIVE company, so "Suggest with AI" is grounded in the company the
  // user is working in (field-assist resolves its canonical context server-
  // side) rather than whatever the account's default company happens to be.
  const { selectedCompanyId } = useCompanyContext();
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
  /* Owner decision (2026-10-24): every input lives on THIS screen; the editor opens as a
   * "here's what we'll make" confirmation. These are the choices beyond the brief. */
  const [attachmentMode, setAttachmentMode] = React.useState<AttachmentMode | null>(null);
  const [brandMode, setBrandMode] = React.useState<IntakeBrandMode>(selectedCompanyId ? 'brand-aware' : 'independent');
  const [brandPresence, setBrandPresence] = React.useState<IntakeBrandPresence>('balanced');
  // Which brand mark is drawn (logo, site icon, or none) and how big — 'auto' fits the design.
  const [brandMark, setBrandMark] = React.useState<IntakeBrandMark>('logo');
  const [brandMarkSize, setBrandMarkSize] = React.useState<BrandAssetSize>(DEFAULT_BRAND_ASSET_SIZE);
  // Independent mode: the look's own colours (default) or an AI-chosen fresh palette.
  const [paletteMode, setPaletteMode] = React.useState<IndependentPaletteChoice>(DEFAULT_INDEPENDENT_PALETTE);
  const [layout, setLayout] = React.useState<string | null>(null);
  const [compositionId, setCompositionId] = React.useState('');
  const layoutOptions = React.useMemo(() => intakeLayoutOptions(WORKFLOW_CONFIG[asset] ?? null), [asset]);
  /* A Writer "Add asset" launch already carries the content AND the text-inside vs
   * alongside decision, so it goes from the look straight to the editor. */
  const writerMode = launchQuery?.source === 'writer' && Boolean(launchQuery?.session);

  // The chosen design's own text treatment is the default answer to "where does the text go".
  React.useEffect(() => {
    setAttachmentMode(asset === 'image' ? (selectedSample?.renderingContract?.attachmentMode ?? null) : null);
  }, [asset, selectedSample]);

  // The draft identity exists BEFORE the brief step renders, so an image the user attaches
  // here belongs to the same draft the editor opens (the image panel is server-backed by it).
  React.useEffect(() => {
    if (step !== 'brief' || compositionId || writerMode) return;
    try {
      const key = creatorCompositionKey(asset);
      let id = (sessionStorage.getItem(key) || '').trim();
      if (!id) {
        id = mintCreatorCompositionId(asset, Date.now(), Math.random().toString(36).slice(2, 8));
        sessionStorage.setItem(key, id);
      }
      setCompositionId(id);
    } catch { /* storage unavailable — the editor mints its own */ }
  }, [step, compositionId, writerMode, asset]);

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
          company_id: selectedCompanyId || undefined,
          asset_family: cfg.family,
          template_id: selectedSample.id,
          action: 'generate',
          targets: (['freeText', 'audience', 'tone', 'cta', 'offer'] as const).map((k) => ({
            scope: 'brief', field_key: k, current_value: String((brief[k as keyof MarketingBrief] as string) ?? ''),
          })),
          // Whatever the user already typed grounds the suggestion too, so the
          // AI completes THEIR brief instead of drafting an unrelated one.
          context: {
            topic: goalLabel,
            objective: goalLabel,
            audience: String(brief.audience ?? ''),
            tone: String(brief.tone ?? ''),
            cta: String(brief.cta ?? ''),
            offer: String(brief.offer ?? ''),
            source_content: String(brief.freeText ?? ''),
          },
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
      if (Object.keys(patch).length) setBrief((b) => withMainMessage(mergeBrief(b, patch as Partial<MarketingBrief>)));
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

  // ── Continue to the editor ────────────────────────────────────────────────
  /** Launch context (campaign, or a Writer session) carried to the editor unchanged. */
  const launchParams = (): string => Object.entries(launchQuery ?? {})
    .filter(([k, v]) => typeof v === 'string' && v.trim() && !['goal', 'template_id', 'blueprint', 'composition', 'from', 'skip_templates'].includes(k))
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('');
  const continueToEditor = () => {
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
    // A Writer launch: the post is the brief and its session token is the draft identity,
    // so carry the session through instead of starting a workspace draft that drops it.
    if (writerMode) {
      onNavigate(`${cfg.editorRoute}?goal=${encodeURIComponent(goalId ?? '')}${tid}${bp}${launchParams()}&skip_templates=1`);
      return;
    }
    try { sessionStorage.setItem(MARKETING_BRIEF_SESSION_KEY, serializeMarketingBrief({ ...withMainMessage(brief), goalId })); } catch { /* noop */ }
    // The first-screen choices beyond the brief (owner decision 2026-10-24).
    try {
      sessionStorage.setItem(CREATOR_INTAKE_SESSION_KEY, serializeCreatorIntake({
        attachmentMode: asset === 'image' ? attachmentMode : null,
        brandMode,
        brandPresence: brandMode === 'brand-aware' ? brandPresence : null,
        includeLogo: brandMode === 'brand-aware' ? brandMark !== 'none' : null,
        brandMark: brandMode === 'brand-aware' ? brandMark : null,
        brandMarkSize: brandMode === 'brand-aware' && brandMark !== 'none' ? brandMarkSize : null,
        layout,
        paletteMode: brandMode === 'independent' ? paletteMode : null,
      }));
    } catch { /* noop */ }
    /* The draft identity travels in the URL (not just this tab's storage), so a
     * reload OR a new tab reaches the same draft — and the editor restores the
     * brief it persisted server-side under this id. Reuses the id minted when the
     * brief step opened (an image attached there already belongs to it). */
    let draftId = compositionId;
    if (!draftId) {
      try {
        const key = creatorCompositionKey(asset);
        draftId = (sessionStorage.getItem(key) || '').trim();
        if (!draftId) {
          draftId = mintCreatorCompositionId(asset, Date.now(), Math.random().toString(36).slice(2, 8));
          sessionStorage.setItem(key, draftId);
        }
      } catch { draftId = ''; }
    }
    const comp = draftId ? `&composition=${encodeURIComponent(draftId)}` : '';
    // CREATOR-106: the sample IS the chosen template, so skip the editor's own template
    // gallery (skip_templates=1) — otherwise [type].tsx bounces back to /templates.
    onNavigate(`${cfg.editorRoute}?goal=${encodeURIComponent(goalId ?? '')}${tid}${bp}${comp}${launchParams()}&from=workspace&skip_templates=1`);
  };

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
          onContinue={() => (writerMode ? continueToEditor() : setStep('brief'))}
        />
        <SubjectStep value={subject} onChange={setSubject} />
      </div>
    );
  }

  const goalLabel = customLabel ?? getOutcome(goalId ?? '')?.label ?? null;
  const mainMessagePreview = String(brief.mainMessage || deriveMainMessage(String(brief.freeText ?? '')) || '').trim();
  const layoutLabel = layoutOptions.find((o) => o.value === layout)?.label ?? null;
  const summaryItems: [string, string][] = [
    ['Message', mainMessagePreview || 'Not written yet'],
    ...(asset === 'image' ? [['Text', attachmentMode === 'supporting_visual' ? 'With the post' : attachmentMode === 'embedded_copy' ? 'In the image' : 'Design decides'] as [string, string]] : []),
    ...(layoutOptions.length > 0 ? [['Layout', layoutLabel ?? 'Design decides'] as [string, string]] : []),
    ['Brand', brandMode === 'brand-aware' ? `My brand · ${brandPresence === 'minimal' ? 'subtle' : brandPresence} · ${brandMark === 'none' ? 'no mark' : brandMark === 'favicon' ? 'site icon' : 'logo'}` : (INDEPENDENT_PALETTE_OPTIONS.find((o) => o.id === paletteMode)?.label ?? 'Independent')],
  ];
  let cardNo = 0;

  return (
    <div style={{ ...wrap, paddingBottom: space['4xl'] + 72 }}>
      <IntakeSteps
        current={3}
        onPick={(i) => setStep((['goal', 'samples', 'look'] as const)[i])}
      />
      {header('Tell us once', cfg.briefSub, () => setStep('look'))}
      {goalLabel || selectedSample ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginTop: -10, marginBottom: space.lg }}>
          {goalLabel ? <span style={contextPill}>Goal: {goalLabel}</span> : null}
          {selectedSample ? <span style={contextPill}>Design: {selectedSample.name}</span> : null}
        </div>
      ) : null}

      <IntakeCard n={++cardNo} title="What’s it about?" hint="Write it, speak it, or let AI draft it. The main message is what the headline will say.">
        <div style={{ position: 'relative', marginBottom: space.sm }}>
          <textarea value={brief.freeText ?? ''} onChange={(e) => { voiceBaseRef.current = e.target.value; setField('freeText', e.target.value); }} rows={5}
            placeholder={`Type or speak — e.g. ${customLabel ?? cfg.label} for our SaaS — audience busy founders, confident friendly tone, CTA "Start free".`}
            style={{ ...input, resize: 'vertical', paddingRight: 56, lineHeight: 1.5 }} />
          <div style={{ position: 'absolute', right: 10, bottom: 12 }}>
            <ChatVoiceButton
              onTranscription={(t) => setField('freeText', `${voiceBaseRef.current.trim() ? `${voiceBaseRef.current.trim()} ` : ''}${t}`)}
              title="Speak your brief"
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginBottom: space.lg }}>
          <button type="button" onClick={suggestBrief} disabled={aiBusy || !selectedSample}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.surface, color: color.primary[600], border: `1px solid ${color.primary[600]}`, borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, cursor: aiBusy ? 'default' : 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm, opacity: aiBusy ? 0.6 : 1 }}>
            <Sparkles size={14} /> {aiBusy ? 'Drafting your brief…' : 'Suggest with AI'}
          </button>
          <button type="button" onClick={() => setChatOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.primary[600], color: color.onPrimary, border: `1px solid ${color.primary[600]}`, borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, cursor: 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm }}>
            <Wand2 size={14} /> Create with AI
          </button>
          <span style={{ fontSize: 12, color: color.textSubtle }}>You can edit everything on the next screen too.</span>
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
              if (Object.keys(patch).length) setBrief((prev) => withMainMessage(mergeBrief(prev, patch as Partial<MarketingBrief>)));
              setChatOpen(false);
            }}
            onClose={() => setChatOpen(false)}
          />
        ) : null}
        {aiError ? <div style={{ fontSize: 12, color: color.danger, marginBottom: 12 }}>{aiError}</div> : null}
        {/* The main message is the asset's key: the headline expresses it, everything else supports it. */}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Main message — the one thing your {cfg.label} must say</div>
          <input
            type="text"
            data-testid="intake-main-message"
            value={brief.mainMessage ?? ''}
            onChange={(e) => setField('mainMessage', e.target.value)}
            placeholder={deriveMainMessage(String(brief.freeText ?? '')) || 'e.g. Plan a month of on-brand posts in under an hour'}
            style={{ ...input, fontSize: fontSize.base, fontWeight: fontWeight.semibold, padding: `${space.md}px ${space.md}px` }}
          />
        </div>
      </IntakeCard>

      <IntakeCard n={++cardNo} title="Who it’s for" hint="Optional — blanks are filled from your goal and company profile.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {([
            ['audience', 'Audience', 'e.g. Busy founders'],
            ['tone', 'Tone', 'e.g. Confident, friendly'],
            ['cta', 'Call to action', 'e.g. Start free'],
            ['offer', 'Offer / product', 'e.g. 14-day free trial'],
          ] as [keyof MarketingBrief, string, string][]).map(([k, lbl, ph]) => (
            <div key={k}><div style={{ ...label, marginBottom: 6 }}>{lbl}</div>
              <input type="text" value={(brief[k] as string) ?? ''} placeholder={ph} onChange={(e) => setField(k, e.target.value)} style={input} /></div>
          ))}
        </div>
      </IntakeCard>

      {asset === 'image' || layoutOptions.length > 0 ? (
        <IntakeCard n={++cardNo} title={asset === 'image' ? 'Text & layout' : 'Layout'}>
          {asset === 'image' ? (
            <div style={{ marginBottom: layoutOptions.length > 0 ? space.lg : 0 }}>
              <div style={{ ...label, marginBottom: 8 }}>Where should the text go?</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                {([
                  ['embedded_copy', 'Text inside the image', 'Your headline, supporting line and button are designed into the image.'],
                  ['supporting_visual', 'Post + image', 'A clean image with no words; your text goes with the post.'],
                ] as [AttachmentMode, string, string][]).map(([mode, title, desc]) => (
                  <button key={mode} type="button" data-testid={`intake-attachment-${mode}`} onClick={() => setAttachmentMode(mode)}
                    style={choiceCard(attachmentMode === mode)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeight.bold, fontSize: fontSize.sm }}>{attachmentMode === mode ? <Check size={14} color={color.primary[600]} /> : null}{title}</div>
                    <div style={{ fontSize: 12, color: color.textMuted, marginTop: 4, lineHeight: 1.45 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {layoutOptions.length > 0 ? (
            <div>
              <div style={{ ...label, marginBottom: 8 }}>{asset === 'infographic' ? 'How should it be organised?' : 'Layout'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {layoutOptions.map((o) => (
                  <button key={o.value} type="button" data-testid={`intake-layout-${o.value}`} title={o.description}
                    onClick={() => setLayout(layout === o.value ? null : o.value)} style={chip(layout === o.value)}>
                    {o.label}
                  </button>
                ))}
                {!layout ? <span style={{ fontSize: 12, color: color.textSubtle, alignSelf: 'center' }}>Not chosen — the design decides.</span> : null}
              </div>
            </div>
          ) : null}
        </IntakeCard>
      ) : null}

      <IntakeCard n={++cardNo} title="Brand & colours">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <button type="button" data-testid="intake-brand-aware" disabled={!selectedCompanyId} onClick={() => setBrandMode('brand-aware')}
            style={{ ...choiceCard(brandMode === 'brand-aware'), opacity: selectedCompanyId ? 1 : 0.55, cursor: selectedCompanyId ? 'pointer' : 'not-allowed' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeight.bold, fontSize: fontSize.sm }}>{brandMode === 'brand-aware' ? <Check size={14} color={color.primary[600]} /> : null}Use my brand</div>
            <div style={{ fontSize: 12, color: color.textMuted, marginTop: 4, lineHeight: 1.45 }}>Your colours, fonts and logo from the company profile.</div>
          </button>
          <button type="button" data-testid="intake-brand-independent" onClick={() => setBrandMode('independent')} style={choiceCard(brandMode === 'independent')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeight.bold, fontSize: fontSize.sm }}>{brandMode === 'independent' ? <Check size={14} color={color.primary[600]} /> : null}Don&apos;t apply my brand</div>
            <div style={{ fontSize: 12, color: color.textMuted, marginTop: 4, lineHeight: 1.45 }}>An independent creative, free of your brand styling.</div>
          </button>
        </div>
        {brandMode === 'brand-aware' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: space.md }}>
            <span style={{ fontSize: 12, color: color.textMuted }}>How visible:</span>
            {([['minimal', 'Subtle'], ['balanced', 'Balanced'], ['strong', 'Strong']] as [IntakeBrandPresence, string][]).map(([v, l]) => (
              <button key={v} type="button" data-testid={`intake-presence-${v}`} onClick={() => setBrandPresence(v)} style={chip(brandPresence === v)}>{l}</button>
            ))}
          </div>
        ) : null}
        {brandMode === 'brand-aware' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: space.sm }}>
            <span style={{ fontSize: 12, color: color.textMuted }}>Brand mark:</span>
            {([['logo', 'Logo'], ['favicon', 'Site icon (favicon)'], ['none', 'No mark']] as [IntakeBrandMark, string][]).map(([v, l]) => (
              <button key={v} type="button" data-testid={`intake-mark-${v}`} onClick={() => setBrandMark(v)} style={chip(brandMark === v)}>{l}</button>
            ))}
          </div>
        ) : null}
        {brandMode === 'brand-aware' && brandMark !== 'none' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: space.sm }}>
            <span style={{ fontSize: 12, color: color.textMuted }}>Mark size:</span>
            {BRAND_ASSET_SIZE_PRESETS.map((o) => (
              <button key={o.value} type="button" data-testid={`intake-mark-size-${o.value}`} onClick={() => setBrandMarkSize(o.value)} style={chip(brandMarkSize === o.value)}
                title={o.value === 'auto' ? 'Sized to fit the design' : `${o.scale}× the design's size`}>
                {o.value === 'auto' ? 'Auto (fits the design)' : o.label}
              </button>
            ))}
          </div>
        ) : null}
        {brandMode !== 'brand-aware' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: space.md }}>
            <span style={{ fontSize: 12, color: color.textMuted }}>Colours:</span>
            {INDEPENDENT_PALETTE_OPTIONS.map((o) => (
              <button key={o.id} type="button" data-testid={`intake-palette-${o.id}`} title={o.body} onClick={() => setPaletteMode(o.id)} style={chip(paletteMode === o.id)}>{o.label}</button>
            ))}
          </div>
        ) : null}
        {!selectedCompanyId ? <div style={{ fontSize: 12, color: color.textSubtle, marginTop: 6 }}>Select a company to apply its brand.</div> : null}
      </IntakeCard>

      {selectedCompanyId && compositionId ? (
        <IntakeCard n={++cardNo} title="Your own image" hint="Optional — a product shot, photo or logo to feature.">
          <CreatorImageAssetPanel
            companyId={selectedCompanyId}
            compositionId={compositionId}
            creatorTypeLabel={cfg.label}
            templateSlots={selectedSample?.assetSlots ?? null}
            templateName={selectedSample?.name ?? null}
            templateCategory={selectedSample?.category ?? null}
            assetFamily={cfg.family}
            templatePurposeKey={selectedSample?.renderingContract?.purposeKey ?? null}
            guidedChoices={{ visualDirectionId, subject, visualInstruction: null }}
            brief={String(brief.mainMessage || brief.freeText || '')}
          />
        </IntakeCard>
      ) : null}

      {/* Sticky summary: what the review screen will show, and the one way forward. */}
      <div style={stickyBar}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.md, padding: `${space.sm}px ${space.xl}px` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, flex: '1 1 320px', minWidth: 0 }}>
            {summaryItems.map(([k, v]) => (
              <span key={k} style={{ ...contextPill, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>
                <strong style={{ color: color.textSubtle, fontWeight: fontWeight.bold }}>{k}:</strong> {v}
              </span>
            ))}
          </div>
          <button type="button" style={primaryBtn} onClick={continueToEditor}><ArrowRight size={16} /> {cfg.briefCta}</button>
        </div>
      </div>
    </div>
  );
}

export function ImageCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="image" {...props} />; }
export function CarouselCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="carousel" {...props} />; }
export function InfographicCreationWorkspace(props: WorkspaceProps) { return <AssetCreationWorkspace asset="infographic" {...props} />; }
