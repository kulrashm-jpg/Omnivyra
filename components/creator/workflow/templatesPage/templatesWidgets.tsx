/** Part 2/2 of templates.tsx — verbatim split (barrel preserved; importers unchanged). */
import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Check, Star, Search as SearchIcon, Layers, X } from 'lucide-react';
import { useCompanyContext } from '../../../../components/CompanyContext';
import PageLoader from '../../../../components/PageLoader';
import {
  familyForCreatorType,
  listTemplatesForFamily,
  listAllTemplatesForFamily,
  resolveTemplate,
  registerUserTemplates,
  resolveAutoSelection,
  recommendationInputKey,
  describeTemplatePlan,
  buildPreviewExamples,
  unionExampleLabels,
  pickSyncedExample,
  buildTemplateBlueprint,
  computeReadiness,
  canSkipBlueprint,
  canSkipContentIngestion,
  ingestAndPopulate,
  creatorIngestPrefillKey,
  validateTemplateValues,
  buildReadinessReport,
  readinessStatusGlyph,
  type BlueprintField,
  type IngestionResult,
  type UnusedContentItem,
  type ReadinessReport,
  type SectionStatus,
  type CreatorTemplate,
  type RecommendationContext,
  type TemplateRecommendation,
  type PreviewSampleContent,
} from '../../../../lib/creator-templates';
import { toggleMemberSet, memberOp } from '../../../../lib/creator-templates/designSystemManage';
import TemplateRecommendationPanel from '../../../../components/creator/TemplateRecommendationPanel';
import { ImageCreationWorkspace, CarouselCreationWorkspace, InfographicCreationWorkspace } from '../../../../components/creator/AssetCreationWorkspace';
import {
  recommendTemplates,
  popularTemplates,
  searchTemplates,
  relatedTemplates,
  estimateTextDensity,
  templatePopularity,
  listStyleVariants,
  templateVariantKey,
  variantLabel,
  type SearchFilters,
  type TextDensity,
  type DiscoveryContext,
  type ScoredTemplate,
} from '../../../../lib/creator-templates/discovery';
import {
  resolveTemplatePreview,
  previewStatusOf,
  previewStatusLabel,
  type PreviewStatus,
} from '../../../../lib/creator-templates/userTemplatePreview';
import {
  resolveStoryBlueprint,
  STORY_BLUEPRINTS,
  type StoryBlueprintId,
} from '../../../../lib/creator-templates/storyBlueprint';
import {
  fromExistingContent, fromAiContent, fromWriterDocument,
  intakeToArchitectureBody,
  type ContentSource, type ContentIntakeDocument, type AiBrief, type WriterDocument,
} from '../../../../lib/creator-templates/contentIntake';

/** Canonical context projected by /api/creator-templates/context. */
import { outcomeTitle } from './templatesSupport';

export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 50 }} onClick={onClose}>
      <div style={{ maxWidth: wide ? 1040 : 720, width: '100%', maxHeight: '88vh', overflowY: 'auto', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>{title}</h2>
          <button type="button" style={linkBtn} onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * CREATOR-005 — side-by-side outcome comparison. Replaces the details drawer
 * while comparing (up to 3). Synchronizes the example shown across all columns
 * (Part D), shows ONLY differing properties (Part C), highlights the recommended
 * outcome, and offers one-click choose. Reuses TemplatePreview + buildPreviewExamples
 * + describeTemplatePlan + the recommendation engine — no logic changes.
 */
export function CompareView({ templates, recommendationFor, recommendedId, onUse, onClose }: {
  templates: CreatorTemplate[];
  recommendationFor: (id: string) => TemplateRecommendation | null;
  recommendedId: string | null;
  onUse: (t: CreatorTemplate) => void;
  onClose: () => void;
}) {
  const perTemplate = React.useMemo(() => templates.map((t) => ({ t, examples: buildPreviewExamples(t) })), [templates]);
  const union = React.useMemo(() => unionExampleLabels(perTemplate.map((p) => p.examples)), [perTemplate]);
  const [selIdx, setSelIdx] = React.useState(0);

  if (templates.length < 2) {
    return <Drawer onClose={onClose} title="Compare outcomes"><p style={{ color: '#475569', fontSize: 13 }}>Select at least two outcomes to compare side by side.</p></Drawer>;
  }

  const activeLabel = union[Math.min(selIdx, Math.max(0, union.length - 1))] ?? null;
  // Part D — same example across all; closest deterministic example when missing.
  const exampleFor = (examples: ReturnType<typeof buildPreviewExamples>) => pickSyncedExample(examples, activeLabel, selIdx);

  const factsFor = (t: CreatorTemplate): Record<string, string> => {
    const d = describeTemplatePlan(t);
    const m = t.metadata as Record<string, unknown>;
    const useCase = Array.isArray(m.recommendedUseCases) && (m.recommendedUseCases as string[])[0] ? String((m.recommendedUseCases as string[])[0]) : t.category;
    return {
      'Visual layout': d.layout ?? (t.assetFamily === 'carousel' ? 'slides' : 'single visual'),
      'Best use case': useCase,
      'Slide count': d.defaultSlideCount != null ? String(d.defaultSlideCount) : (d.slideCountOptions ? d.slideCountOptions.join('/') : '—'),
      'Section count': d.sectionMin != null ? `${d.sectionMin}–${d.sectionMax}` : '—',
      'CTA support': d.hasCTA ? 'Yes' : 'No',
      'Content density': estimateTextDensity(t),
      'Editing effort': String(m.difficulty ?? 'intermediate'),
      'Style variant': variantLabel(d.variantKey),
      'Recommended reasons': (recommendationFor(t.id)?.reasons ?? []).slice(0, 2).join('; ') || '—',
    };
  };
  const facts = templates.map((t) => ({ t, f: factsFor(t) }));
  const DIMENSIONS = ['Visual layout', 'Best use case', 'Slide count', 'Section count', 'CTA support', 'Content density', 'Editing effort', 'Style variant', 'Recommended reasons'];
  const differing = DIMENSIONS.filter((dim) => new Set(facts.map((x) => x.f[dim])).size > 1);
  const recommendedInSet = templates.find((t) => t.id === recommendedId) ?? null;

  return (
    <Drawer wide onClose={onClose} title="Compare outcomes">
      {union.length > 1 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 2 }}>Same example across all:</span>
          {union.map((label, i) => (
            <button key={label} type="button" onClick={() => setSelIdx(i)}
              style={{ fontSize: 11.5, fontWeight: 600, cursor: 'pointer', borderRadius: 999, padding: '3px 10px', border: `1px solid ${i === selIdx ? '#2563eb' : '#e5e7eb'}`, background: i === selIdx ? '#eff6ff' : '#ffffff', color: i === selIdx ? '#2563eb' : '#475569' }}>{label}</button>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        {perTemplate.map(({ t, examples }) => {
          const ex = exampleFor(examples);
          const rec = recommendationFor(t.id);
          const isRec = t.id === recommendedId;
          return (
            <div key={t.id} style={{ border: `${isRec ? 2 : 1}px solid ${isRec ? '#22c55e' : '#e5e7eb'}`, borderRadius: 12, overflow: 'hidden', background: '#ffffff', boxShadow: isRec ? '0 0 0 3px rgba(34,197,94,0.15)' : '0 1px 2px rgba(15,23,42,0.04)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative' }}>
                <TemplatePreview template={t} large sample={ex.sample} />
                {union.length > 1 ? <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(2,6,23,0.62)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px' }}>{ex.label}</span> : null}
                {isRec ? <span style={{ position: 'absolute', top: 8, left: 8, background: '#16a34a', color: '#fff', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '3px 9px' }}>★ Recommended{rec ? ` · ${Math.round(rec.confidence * 100)}%` : ''}</span> : null}
              </div>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <strong style={{ fontSize: 14, color: '#0f172a', lineHeight: 1.2 }}>{outcomeTitle(t)}</strong>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.description}</div>
                <div style={{ fontSize: 12, color: rec ? '#16a34a' : '#94a3b8', fontWeight: 700 }}>{rec ? `${Math.round(rec.confidence * 100)}% match` : 'Not ranked'}</div>
                <button type="button" style={{ ...(isRec ? useBtn : ghostBtn), marginTop: 'auto', justifyContent: 'center' }} onClick={() => onUse(t)}>
                  {isRec ? '★ Choose Recommended' : 'Choose this'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ ...detailLabel, marginBottom: 6 }}>What’s different</div>
      <div style={{ display: 'grid', gridTemplateColumns: `150px repeat(${templates.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'start' }}>
        <div />
        {facts.map(({ t }) => <div key={t.id} style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', paddingBottom: 4, borderBottom: '2px solid #e5e7eb' }}>{outcomeTitle(t)}</div>)}
        {differing.map((dim) => (
          <React.Fragment key={dim}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', padding: '6px 0' }}>{dim}</div>
            {facts.map(({ t, f }) => <div key={t.id} style={{ fontSize: 12.5, color: '#0f172a', padding: '6px 8px', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 6 }}>{f[dim]}</div>)}
          </React.Fragment>
        ))}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>
        {differing.length === 0 ? 'These outcomes are identical on the compared dimensions.' : 'Identical properties are hidden — only differences are shown.'}
      </p>

      {recommendedInSet ? (
        <button type="button" style={{ ...useBtn, marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={() => onUse(recommendedInSet)}>
          <Check size={16} /> Choose recommended — {outcomeTitle(recommendedInSet)}
        </button>
      ) : null}
    </Drawer>
  );
}

/**
 * CREATOR-006 — Content Blueprint. Deterministic pre-editor summary derived
 * entirely from the canonical formDefinition + renderingContract (via
 * buildTemplateBlueprint/computeReadiness). Answers what it creates, what
 * content is needed, and how much work is involved. Continue → editor; Skip →
 * editor + remember the preference. No AI, no generation/rendering change.
 */
export function TemplateBlueprintModal({ template, onContinue, onSkip, onClose }: {
  template: CreatorTemplate;
  onContinue: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const b = buildTemplateBlueprint(template);
  const readiness = computeReadiness(template); // pre-editor (no values yet)
  const readyColor = readiness === 'Ready' ? '#16a34a' : readiness === 'Almost Ready' ? '#d97706' : '#64748b';
  const secLabel: React.CSSProperties = { ...detailLabel, marginBottom: 8 };
  const stepKindColor = (k: string): string =>
    k === 'cover' || k === 'title' || k === 'headline' ? '#2563eb' : k === 'cta' ? '#16a34a' : k === 'closing' ? '#7c3aed' : '#475569';
  const chipS: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#0f172a', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '5px 12px' };

  const FieldRow = ({ f, required }: { f: BlueprintField; required?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, color: '#0f172a' }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: required ? '#2563eb' : '#cbd5e1', flex: '0 0 auto' }} />
      <span>{f.label}</span>
      {f.scope !== 'flat' ? <span style={{ fontSize: 10.5, color: '#94a3b8' }}>(per {f.scope})</span> : null}
    </div>
  );

  return (
    <Drawer wide onClose={onClose} title={`Blueprint — ${b.deliverable}`}>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 14 }}>Here’s what you’ll build and what you’ll need before you start editing.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <span style={chipS}>{b.unitCount != null ? `${b.unitCount} ${b.unitLabel}${b.unitRange ? ` (of ${b.unitRange})` : ''}` : 'Single visual'}</span>
        <span style={chipS}>{b.editingEffort} editing effort</span>
        <span style={chipS}>~{b.estimatedMinutes} min</span>
        <span style={chipS}>{b.hasCTA ? 'CTA supported' : 'No CTA'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
        {/* Visual structure (Part B) */}
        <div>
          <div style={secLabel}>Visual structure</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {b.structure.map((s, i) => (
              <React.Fragment key={`${s.label}-${i}`}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: stepKindColor(s.kind), borderRadius: 8, padding: '6px 14px', minWidth: 120, textAlign: 'center' }}>{s.label}</div>
                {i < b.structure.length - 1 ? <div style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.1, paddingLeft: 52 }}>↓</div> : null}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* What you'll need (Part A) */}
        <div>
          <div style={secLabel}>What you’ll need</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', margin: '2px 0 2px' }}>Required content</div>
          {b.requiredFields.length ? b.requiredFields.map((f, i) => <FieldRow key={`r-${i}`} f={f} required />) : <div style={{ fontSize: 12.5, color: '#94a3b8' }}>None — ready to generate.</div>}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', margin: '14px 0 2px' }}>Optional content</div>
          {b.optionalFields.length ? b.optionalFields.map((f, i) => <FieldRow key={`o-${i}`} f={f} />) : <div style={{ fontSize: 12.5, color: '#94a3b8' }}>None.</div>}
        </div>
      </div>

      {/* Readiness (Part C) */}
      <div style={{ marginTop: 18, padding: 12, borderRadius: 10, background: '#f8fafc', border: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: readyColor, flex: '0 0 auto' }} />
        <strong style={{ fontSize: 13, color: readyColor }}>{readiness}</strong>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>
          {readiness === 'Ready'
            ? 'No required content — you can generate right away.'
            : `You’ll provide ${b.requiredFields.length} required item${b.requiredFields.length === 1 ? '' : 's'} in the editor.`}
        </span>
      </div>

      {/* Entry (Part D) */}
      <div style={{ display: 'flex', gap: 14, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ ...useBtn, justifyContent: 'center' }} onClick={onContinue}><Check size={16} /> Continue editing</button>
        <button type="button" style={linkBtn} onClick={onSkip}>Skip — don’t show blueprints</button>
      </div>
    </Drawer>
  );
}

/**
 * CREATOR-007 — Content Ingestion. The user provides content ONCE (paste text);
 * `ingestAndPopulate` deterministically fills the canonical TemplateFieldValues
 * via formDefinition. Shows an import → mapped summary, the unused-content panel
 * (nothing discarded), and `validateTemplateValues` highlights (no auto-correct),
 * then hands the populated values to the editor via sessionStorage + ?ingest.
 * No new editor / field model / payload model — the existing editor stays the
 * single source of truth.
 */
export function ContentIngestionModal({ template, onContinue, onSkip, onClose }: {
  template: CreatorTemplate;
  onContinue: (result: IngestionResult) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { selectedCompanyId } = useCompanyContext();
  const [raw, setRaw] = React.useState('');
  const [result, setResult] = React.useState<IngestionResult | null>(null);
  const [copied, setCopied] = React.useState<number | null>(null);
  // CREATOR-008 — unified intake: pick a source, all converge to the canonical
  // ContentIntakeDocument → Content Architecture (ingestAndPopulate). No bypass.
  const [source, setSource] = React.useState<ContentSource | null>(null);
  const [intakeDoc, setIntakeDoc] = React.useState<ContentIntakeDocument | null>(null);
  const [writerDocs, setWriterDocs] = React.useState<WriterDocument[]>([]);
  const [writerBusy, setWriterBusy] = React.useState(false);
  const [brief, setBrief] = React.useState<AiBrief>({ description: '' });
  const [aiBusy, setAiBusy] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  // CREATOR-027A — Voice is an input method INSIDE "Create with AI", not a source.
  const [aiInputMethod, setAiInputMethod] = React.useState<'type' | 'voice'>('type');
  const validation = result ? validateTemplateValues(template, result.values) : null;
  const imp = result?.imported;
  const rowLine: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#0f172a', padding: '3px 0' };
  const secLabel: React.CSSProperties = { ...detailLabel, marginBottom: 8 };

  // THE convergence point — every source funnels through here into the existing
  // Content Architecture Engine. Identical content → identical processing.
  const populateFromDoc = (doc: ContentIntakeDocument) => { setIntakeDoc(doc); setResult(ingestAndPopulate(template, intakeToArchitectureBody(doc))); };
  const populate = () => populateFromDoc(fromExistingContent(raw));
  const proceed = () => {
    if (!result) return;
    // Persist for the editor handoff (?ingest=<id>) incl. the intake source/provenance.
    try { window.sessionStorage.setItem(creatorIngestPrefillKey(template.id), JSON.stringify({ templateId: template.id, values: result.values, intakeSource: intakeDoc?.source ?? 'existing', writerDocumentId: intakeDoc?.writerDocumentId ?? null })); } catch { /* ignore */ }
    onContinue(result);
  };
  const copy = (text: string, i: number) => { try { void navigator.clipboard?.writeText(text); setCopied(i); } catch { /* ignore */ } };

  // Writer Library — browse existing Omnivyra Writer content (reuses /api/blogs).
  const loadWriter = () => {
    if (!selectedCompanyId) return;
    setWriterBusy(true);
    fetch(`/api/blogs?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const list = Array.isArray(d) ? d : (d?.blogs ?? d?.items ?? d?.data ?? []); setWriterDocs(Array.isArray(list) ? list : []); })
      .catch(() => { /* best-effort */ })
      .finally(() => setWriterBusy(false));
  };
  // AI — reuse the Writer AI to produce STRUCTURED text (not rendered output).
  const generateAi = async () => {
    if (!brief.description.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch('/api/command-center/creator-content/intake-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: selectedCompanyId, brief, asset_family: template.assetFamily }),
      });
      const d = res.ok ? await res.json() : null;
      const text = typeof d?.content === 'string' && d.content.trim() ? d.content : brief.description;
      populateFromDoc(fromAiContent(text, brief));
    } catch { populateFromDoc(fromAiContent(brief.description, brief)); }
    finally { setAiBusy(false); }
  };
  // Voice — browser speech-to-text (Web Speech API) → canonical transcript.
  const startRecording = () => {
    const SR = (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
    if (!SR) { setRecording(false); return; }
    const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    // Voice fills the SAME AI brief the user can type into — speech always
    // becomes editable text first, then runs the identical AI generation.
    rec.onresult = (e: any) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setBrief((b) => ({ ...b, description: t })); };
    rec.onend = () => setRecording(false);
    try { rec.start(); setRecording(true); (window as any).__creatorRec = rec; } catch { setRecording(false); }
  };
  const stopRecording = () => { try { (window as any).__creatorRec?.stop(); } catch { /* ignore */ } setRecording(false); };

  return (
    <Drawer wide onClose={onClose} title={`Add your content — ${template.name}`}>
      {!result ? (
        !source ? (
          /* ── Content Source Selector — replaces "Paste your content" ── */
          <>
            <p style={{ fontSize: 13.5, color: '#0f172a', fontWeight: 600, marginTop: 0 }}>Choose how you’d like to start</p>
            <p style={{ fontSize: 12.5, color: '#64748b', marginTop: -6 }}>Every path maps into the same content pipeline — you’ll review before anything is generated.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
              {([
                ['existing', '📄', 'Existing Content', 'Bring your own article, notes, blog, landing page, product copy, email or proposal.', 'Continue'],
                ['ai', '✨', 'Create with AI', 'Type or speak a brief. AI creates structured content for this template.', 'Generate with AI'],
                ['writer', '📚', 'Writer Library', 'Use content already created inside Omnivyra Writer — drafts, blogs, campaigns, articles.', 'Browse Content'],
              ] as Array<[ContentSource, string, string, string, string]>).map(([id, icon, title, desc, btn]) => (
                <button key={id} type="button" onClick={() => { setSource(id); if (id === 'writer') loadWriter(); }}
                  style={{ textAlign: 'left', cursor: 'pointer', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                  <span style={{ fontSize: 22 }}>{icon}</span>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>{title}</strong>
                  <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4, flex: 1 }}>{desc}</span>
                  <span style={{ ...useBtn, justifyContent: 'center', marginTop: 6 }}>{btn}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 14 }}><button type="button" style={linkBtn} onClick={onSkip}>Skip — start from a blank editor</button></div>
          </>
        ) : (
          <>
            <button type="button" style={{ ...linkBtn, marginBottom: 8 }} onClick={() => setSource(null)}>← Change source</button>

            {source === 'existing' ? (
              <>
                <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>Paste your content — an article, product copy, case study, notes, sales copy, proposal, email, transcript or research. We’ll map it into this template’s fields.</p>
                <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={12}
                  placeholder={'Paste content here…\n\nHeadings, paragraphs, bullet points, statistics (e.g. “92% faster”), and quotes are detected automatically.'}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13, lineHeight: 1.5, padding: 12, borderRadius: 10, border: '1px solid #d1d5db', color: '#0f172a', fontFamily: 'inherit' }} />
                <div style={{ marginTop: 14 }}>
                  <button type="button" disabled={!raw.trim()} onClick={populate} style={{ ...useBtn, justifyContent: 'center', opacity: raw.trim() ? 1 : 0.5, cursor: raw.trim() ? 'pointer' : 'not-allowed' }}>Populate Template →</button>
                </div>
              </>
            ) : null}

            {source === 'ai' ? (
              <>
                <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>Describe what you want to communicate. AI produces structured content (not a rendered asset) that flows through the same pipeline.</p>
                {/* Input method — Type or Voice. Both fill the same brief and run the IDENTICAL AI request. */}
                <div role="tablist" aria-label="Input method" style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, marginBottom: 10 }}>
                  {([['type', '⌨️ Type'], ['voice', '🎤 Voice']] as Array<['type' | 'voice', string]>).map(([m, label]) => (
                    <button key={m} type="button" role="tab" aria-selected={aiInputMethod === m} onClick={() => setAiInputMethod(m)}
                      style={{ cursor: 'pointer', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, background: aiInputMethod === m ? '#ffffff' : 'transparent', color: aiInputMethod === m ? '#0f172a' : '#64748b', boxShadow: aiInputMethod === m ? '0 1px 2px rgba(15,23,42,0.08)' : 'none' }}>{label}</button>
                  ))}
                </div>
                {aiInputMethod === 'voice' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    {!recording
                      ? <button type="button" style={useBtn} onClick={startRecording}>🎤 Record</button>
                      : <button type="button" style={{ ...useBtn, background: '#dc2626' }} onClick={stopRecording}>■ Stop</button>}
                    <span style={{ fontSize: 12, color: '#64748b' }}>Speak naturally — your words fill the brief below. Edit before generating.</span>
                  </div>
                ) : null}
                <textarea value={brief.description} onChange={(e) => setBrief({ ...brief, description: e.target.value })} rows={aiInputMethod === 'voice' ? 6 : 4}
                  placeholder={aiInputMethod === 'voice' ? 'Your transcript appears here as you speak — edit it, then Generate…' : 'What should this communicate? e.g. Announce our new API and its 92% faster onboarding.'}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13, padding: 12, borderRadius: 10, border: '1px solid #d1d5db', color: '#0f172a', fontFamily: 'inherit' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
                  {([['audience', 'Audience'], ['platform', 'Platform'], ['industry', 'Industry'], ['tone', 'Tone'], ['campaignObjective', 'Campaign objective'], ['callToAction', 'Call-to-action']] as Array<[keyof AiBrief, string]>).map(([k, ph]) => (
                    <input key={k} value={(brief[k] as string) || ''} onChange={(e) => setBrief({ ...brief, [k]: e.target.value })} placeholder={ph}
                      style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', color: '#0f172a', fontSize: 12.5 }} />
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <button type="button" disabled={!brief.description.trim() || aiBusy} onClick={generateAi} style={{ ...useBtn, justifyContent: 'center', opacity: brief.description.trim() && !aiBusy ? 1 : 0.5 }}>{aiBusy ? 'Generating…' : 'Generate with AI →'}</button>
                </div>
              </>
            ) : null}

            {source === 'writer' ? (
              <>
                <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>Pick a document from Omnivyra Writer. Its title, summary, keywords and metadata flow into the pipeline.</p>
                {writerBusy ? <div style={{ fontSize: 13, color: '#64748b' }}>Loading your Writer content…</div>
                  : writerDocs.length ? (
                    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 10 }}>
                      {writerDocs.map((d, i) => (
                        <button key={String(d.id ?? i)} type="button" onClick={() => populateFromDoc(fromWriterDocument(d))}
                          style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', background: '#fff', border: 'none', borderBottom: '1px solid #f1f5f9', padding: '10px 12px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{String(d.title || '(untitled)')}</div>
                          <div style={{ fontSize: 11.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(d.summary || d.meta_description || '')}</div>
                        </button>
                      ))}
                    </div>
                  ) : <div style={{ fontSize: 13, color: '#94a3b8' }}>No Writer content found for this company.</div>}
              </>
            ) : null}
          </>
        )
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
            <div>
              <div style={secLabel}>Imported</div>
              {imp ? (([['headings', imp.headings], ['paragraphs', imp.paragraphs], ['statistics', imp.statistics], ['quotes', imp.quotes], ['bullet points', imp.bullets]] as Array<[string, number]>)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => <div key={k} style={rowLine}><Check size={13} color="#16a34a" /> {n} {k}</div>)) : null}
              {imp && (imp.headings + imp.paragraphs + imp.statistics + imp.quotes + imp.bullets === 0) ? <div style={{ fontSize: 12.5, color: '#94a3b8' }}>No structured content detected.</div> : null}
            </div>
            <div>
              <div style={secLabel}>Mapped to</div>
              {result.mappedTo.length ? result.mappedTo.map((m, i) => <div key={i} style={rowLine}><Check size={13} color="#2563eb" /> {m.target}</div>) : <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Nothing mapped — try adding a headline or sentences.</div>}
            </div>
          </div>

          {validation && !validation.ok ? (
            <div style={{ marginTop: 18, padding: 12, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>Still needs your attention (you’ll fix this in the editor)</div>
              {validation.messages.slice(0, 8).map((m, i) => <div key={i} style={{ fontSize: 12.5, color: '#92400e', padding: '2px 0' }}>• {m}</div>)}
            </div>
          ) : (
            <div style={{ marginTop: 18, padding: 12, borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12.5, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}><Check size={14} /> All required fields are populated.</div>
          )}

          {result.unused.length ? (
            <div style={{ marginTop: 18 }}>
              <div style={secLabel}>Unused content ({result.unused.length}) — nothing is discarded</div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 10 }}>
                {result.unused.map((u: UnusedContentItem, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderBottom: i < result.unused.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', flex: '0 0 auto', marginTop: 2, width: 64 }}>{u.kind}</span>
                    <span style={{ fontSize: 12.5, color: '#334155', flex: 1 }}>{u.text}</span>
                    <button type="button" style={{ ...linkBtn, fontSize: 11.5, flex: '0 0 auto' }} onClick={() => copy(u.text, i)}>{copied === i ? 'Copied' : 'Copy'}</button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>Copy any item to paste it manually in the editor, or leave it.</p>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 14, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={{ ...useBtn, justifyContent: 'center' }} onClick={proceed}><Check size={16} /> Review readiness</button>
            <button type="button" style={ghostBtn} onClick={() => setResult(null)}>Re-paste</button>
            <button type="button" style={linkBtn} onClick={onSkip}>Discard &amp; start blank</button>
          </div>
        </>
      )}
    </Drawer>
  );
}

/**
 * CREATOR-008 — Content Readiness Review. Read-only, deterministic. Composes
 * buildReadinessReport (completeness / structure / quality / distribution /
 * generation-readiness / guidance) into a status-tagged screen between Ingestion
 * and the editor. Never rewrites content or generates suggestions.
 */
export function ReadinessReviewModal({ template, ingestion, onContinue, onBack, onClose }: {
  template: CreatorTemplate;
  ingestion: IngestionResult;
  onContinue: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const report: ReadinessReport = buildReadinessReport(template, ingestion.values, ingestion);
  const STATUS_COLOR: Record<SectionStatus, string> = { good: '#16a34a', attention: '#d97706', blocking: '#dc2626' };
  const STATUS_BG: Record<SectionStatus, string> = { good: '#f0fdf4', attention: '#fffbeb', blocking: '#fef2f2' };
  const STATUS_BORDER: Record<SectionStatus, string> = { good: '#bbf7d0', attention: '#fde68a', blocking: '#fecaca' };
  const READY_LABEL: Record<string, string> = { READY: 'Ready to generate', 'ALMOST READY': 'Almost ready', 'NOT READY': 'Not ready yet' };
  const secLabel: React.CSSProperties = { ...detailLabel, marginBottom: 8 };

  const StatusChip = ({ s }: { s: SectionStatus }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: STATUS_COLOR[s], background: STATUS_BG[s], border: `1px solid ${STATUS_BORDER[s]}`, borderRadius: 999, padding: '2px 9px' }}>
      {readinessStatusGlyph(s)} {s === 'good' ? 'Good' : s === 'attention' ? 'Needs attention' : 'Blocking'}
    </span>
  );
  const Section = ({ title, status, children }: { title: string; status: SectionStatus; children: React.ReactNode }) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{title}</span>
        <StatusChip s={status} />
      </div>
      {children}
    </div>
  );
  const line: React.CSSProperties = { fontSize: 12.5, color: '#334155', padding: '2px 0' };

  const c = report.completeness;
  const d = report.distribution;

  return (
    <Drawer wide onClose={onClose} title={`Readiness review — ${template.name}`}>
      {/* Overall status, prominent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, marginBottom: 16, background: STATUS_BG[report.overallStatus], border: `1px solid ${STATUS_BORDER[report.overallStatus]}` }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: STATUS_COLOR[report.overallStatus] }}>{readinessStatusGlyph(report.overallStatus)}</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: STATUS_COLOR[report.overallStatus] }}>{READY_LABEL[report.overall] ?? report.overall}</div>
          <div style={{ fontSize: 12.5, color: '#475569' }}>The editor stays fully editable — this is a read-only check.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {/* Completeness */}
        <Section title="Completeness" status={c.status}>
          <div style={line}>Required: {c.requiredFilled}/{c.requiredTotal} filled{c.requiredMissing.length ? ` · ${c.requiredMissing.length} missing` : ''}</div>
          <div style={line}>Optional: {c.optionalFilled}/{c.optionalTotal} filled</div>
          {c.requiredMissing.slice(0, 6).map((m, i) => <div key={i} style={{ ...line, color: '#b45309' }}>• {m}</div>)}
        </Section>

        {/* Structure */}
        <Section title="Structure" status={report.structure.status}>
          {report.structure.checks.map((ck, i) => (
            <div key={i} style={{ ...line, color: ck.ok ? '#166534' : '#b45309' }}>{ck.ok ? '✓' : '!'} {ck.label}</div>
          ))}
          {report.structure.issues.map((m, i) => <div key={`i-${i}`} style={{ ...line, color: '#b45309' }}>• {m}</div>)}
        </Section>

        {/* Quality */}
        <Section title="Content quality" status={report.quality.status}>
          {report.quality.issues.length ? report.quality.issues.slice(0, 8).map((m, i) => <div key={i} style={{ ...line, color: '#b45309' }}>• {m}</div>) : <div style={{ ...line, color: '#166534' }}>No quality issues detected.</div>}
        </Section>

        {/* Distribution */}
        <Section title="Distribution" status={d.status}>
          <div style={line}>Mapped: {d.mappedCount} · Unused: {d.unusedCount} · Remaining capacity: {d.remainingCapacity}</div>
          {d.notes.map((m, i) => <div key={i} style={line}>• {m}</div>)}
        </Section>
      </div>

      {/* Guidance */}
      {report.guidance.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={secLabel}>What to do next</div>
          <div style={{ border: '1px solid #eef2f7', borderRadius: 10, padding: 12 }}>
            {report.guidance.slice(0, 10).map((g, i) => <div key={i} style={{ fontSize: 12.5, color: '#334155', padding: '3px 0' }}>→ {g}</div>)}
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 14, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ ...useBtn, justifyContent: 'center' }} onClick={onContinue}><Check size={16} /> Continue to editor</button>
        <button type="button" style={ghostBtn} onClick={onBack}>Back to ingestion</button>
      </div>
    </Drawer>
  );
}

export function FilterSelect({ label, value, onChange, options, format }: { label: string; value: string; onChange: (v: string) => void; options: string[]; format?: (o: string) => string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      style={{ background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', color: value ? '#0f172a' : '#64748b', fontSize: 13 }}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
    </select>
  );
}

export function CategoryTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: '6px 14px', borderRadius: 999, border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`, background: active ? '#2563eb' : '#ffffff', color: active ? '#fff' : '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{label}</button>;
}

export function DetailRow({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><span style={{ color: '#64748b', flexShrink: 0 }}>{k}</span><span style={{ color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>{v}</span></div>;
}
export function describeFields(t: CreatorTemplate): string {
  const parts: string[] = [];
  for (const f of t.formDefinition.fields) parts.push(f.label + (f.required ? '*' : ''));
  if (t.formDefinition.slides) parts.push(`${t.formDefinition.slides.defaultCount} slides (title + body)`);
  if (t.formDefinition.sections) parts.push(`${t.formDefinition.sections.sectionLabel} rows`);
  return parts.join(' · ') || 'No text — visual only';
}

/**
 * Canonical, style-driven preview. Every visual property is resolved from the
 * SAME source the renderer consumes — resolveTemplate() → style variant +
 * rendering contract — so the gallery preview reflects the actual rendered
 * output (colors, card structure, frame radius, wave, CTA, layout, pagination)
 * and each style variant is visibly represented. There is NO second preview
 * system and NO hand-maintained per-template visual.
 */
const PREVIEW_STATUS_STYLE: Record<PreviewStatus, { bg: string; fg: string }> = {
  pending: { bg: '#92400e', fg: '#fde68a' },
  rendering: { bg: '#1e3a8a', fg: '#bfdbfe' },
  ready: { bg: '#14532d', fg: '#bbf7d0' },
  failed: { bg: '#7f1d1d', fg: '#fecaca' },
};

/** Deterministic preview-state chip for a user template (system templates show none). */
export function PreviewStatusBadge({ template, large }: { template: CreatorTemplate; large?: boolean }) {
  const status = previewStatusOf(template);
  const c = PREVIEW_STATUS_STYLE[status];
  return (
    <span style={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: c.bg, color: c.fg, fontSize: large ? 11 : 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', boxShadow: '0 1px 4px rgba(0,0,0,0.35)' }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg, opacity: status === 'rendering' || status === 'pending' ? 0.9 : 1 }} />
      {previewStatusLabel(status)}
    </span>
  );
}

/**
 * Story Blueprint strip — the deterministic communication-flow labels for a
 * template (narrative structure, NOT rendering). Labels only; never regenerates
 * a preview.
 */
export function BlueprintStrip({ template, large }: { template: CreatorTemplate; large?: boolean }) {
  const bp = resolveStoryBlueprint(template);
  return (
    <div style={{ marginTop: large ? 12 : 7 }}>
      <div style={{ fontSize: large ? 11 : 10, fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.4 }}>{bp.label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center' }}>
        {bp.narrativeFlow.map((step, i) => (
          <React.Fragment key={i}>
            <span style={{ fontSize: large ? 11 : 9.5, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>{step}</span>
            {i < bp.narrativeFlow.length - 1 ? <span style={{ color: '#a78bfa', fontSize: large ? 12 : 10 }}>→</span> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Quality Inspector summary — renders the diagnostic report PRODUCED by the
 * durable preview pipeline (metadata.creator_diagnostic_report). Read-only; it
 * never regenerates the diagnostic. Shown only when a report exists.
 */
export function TemplateDiagnosticSummary({ template }: { template: CreatorTemplate }) {
  const report = (template.metadata as Record<string, unknown> | undefined)?.creator_diagnostic_report as
    | { reportVersion?: string; visualValidation?: { passed?: boolean }; scores?: { overallReadiness?: { value?: number; reason?: string } } }
    | undefined;
  if (!report || !report.reportVersion) return null;
  const readiness = Number(report.scores?.overallReadiness?.value ?? 0);
  const visualPassed = report.visualValidation?.passed === true;
  return (
    <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.4 }}>Quality Inspector</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: readiness >= 70 ? '#86efac' : '#fca5a5' }}>{readiness}/100 readiness</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: visualPassed ? '#bbf7d0' : '#fecaca', border: `1px solid ${visualPassed ? '#14532d' : '#7f1d1d'}`, borderRadius: 999, padding: '2px 8px' }}>
          Visual validation: {visualPassed ? 'Passed' : 'Failed'}
        </span>
      </div>
      {report.scores?.overallReadiness?.reason ? (
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>{report.scores.overallReadiness.reason}</div>
      ) : null}
    </div>
  );
}

/**
 * Multi-outcome preview — demonstrates that the user is choosing a visual
 * STRUCTURE, not one piece of content. Renders ONLY the active example through
 * the existing TemplatePreview (same layout/style); a label strip switches the
 * sample content. Switching changes ONLY the previewed sample — never the
 * selection, recommendation, style, or rendering contract. Recommended/selected
 * templates open on the first example.
 */
export function MultiOutcomePreview({ template, large, continuity }: { template: CreatorTemplate; large?: boolean; continuity?: ContinuityStyle }) {
  const examples = React.useMemo(() => buildPreviewExamples(template), [template.id, template.ownership, template.preview]);
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => { setIdx(0); }, [template.id]);
  const active = examples[Math.min(idx, examples.length - 1)] ?? examples[0];
  const multi = examples.length > 1;
  return (
    <div>
      <div style={{ position: 'relative' }}>
        {/* Only the ACTIVE example renders; the rest are lazy (never mounted). */}
        <TemplatePreview template={template} large={large} sample={active.sample} continuity={continuity} />
        {multi ? <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(2,6,23,0.62)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px' }}>{active.label}</span> : null}
      </div>
      {multi ? (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px 0', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: '#94a3b8', marginRight: 2 }}>Outcomes:</span>
          {examples.map((ex, i) => (
            <button key={i} type="button" onClick={() => setIdx(i)} title={`${ex.label} example`}
              style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 999, padding: '2px 9px', border: `1px solid ${i === idx ? '#2563eb' : '#e5e7eb'}`, background: i === idx ? '#eff6ff' : '#ffffff', color: i === idx ? '#2563eb' : '#475569' }}>
              {ex.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How a carousel conveys continuity across its slides (preview showcase). */
export type ContinuityStyle = 'wave' | 'panorama' | 'connectors' | 'progress' | 'numbered' | 'standalone';
export const CONTINUITY_OPTIONS: { id: ContinuityStyle; label: string; hint: string }[] = [
  { id: 'panorama', label: 'Panorama', hint: 'One image, cut into slides' },
  { id: 'wave', label: 'Flowing', hint: 'A line threading across' },
  { id: 'connectors', label: 'Sequential', hint: 'Arrows link slide → slide' },
  { id: 'progress', label: 'Stepper', hint: 'Numbered progress track' },
  { id: 'numbered', label: 'Counted', hint: 'Big slide numbers' },
  { id: 'standalone', label: 'Standalone', hint: 'Independent slides' },
];
// Out of the box, templates vary (deterministic from id) so the gallery isn't
// one waveform across everything; the selector can override the showcase.
const CONTINUITY_CYCLE: ContinuityStyle[] = ['panorama', 'wave', 'connectors', 'progress', 'numbered'];
function defaultContinuity(template: CreatorTemplate): ContinuityStyle {
  let h = 0; for (let i = 0; i < template.id.length; i++) h = (h * 31 + template.id.charCodeAt(i)) >>> 0;
  return CONTINUITY_CYCLE[h % CONTINUITY_CYCLE.length]!;
}

export function TemplatePreview({ template, large, sample, continuity }: { template: CreatorTemplate; large?: boolean; sample?: PreviewSampleContent; continuity?: ContinuityStyle }) {
  const rt = resolveTemplate(template.id, { family: template.assetFamily });
  const vl = template.visualLanguage;
  const height = large ? 300 : 200;
  // Render a given example's content (multi-outcome) with the SAME layout/style;
  // defaults to the template's own canonical sample.
  const s = sample ?? template.preview.sample;
  const pad = large ? 22 : 16;

  // REAL rendered preview (durable pipeline) — shown whenever a preview image
  // exists; the live sample composition below is the fallback. Same resolution
  // logic for gallery cards AND the details drawer (both render TemplatePreview).
  const resolved = resolveTemplatePreview(template);
  if (resolved.kind === 'rendered' && resolved.url) {
    const pending = resolved.status === 'rendering' || resolved.status === 'pending';
    return (
      <div style={{ height, position: 'relative', overflow: 'hidden', borderBottom: '1px solid #1f2937', background: '#0b1220' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolved.url}
          alt={`${template.name} preview`}
          // PERF (OPT-001): gallery renders up to 71 cards, each a full-size
          // showcase asset (up to 351 KB). Eager-loading the whole grid competed
          // with the critical path. The parent div already fixes `height`, so
          // deferring costs no layout stability. `decoding="async"` keeps the
          // decode off the main thread.
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          // Never a broken-image icon: hide the img on load error → the dark
          // frame shows (the deterministic status badge still conveys state).
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
        />
        {pending ? (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: large ? 13 : 11 }}>Updating…</div>
        ) : null}
      </div>
    );
  }

  // ── IMAGE / BANNER — fallback gradient + overlay text colors + CTA prominence
  if (template.assetFamily === 'image') {
    const im = rt.imageStyle!;
    const [g0, g1, g2] = im.background.fallbackGradient;
    const title = im.colorScheme.title;
    const body = im.colorScheme.body;
    const support = im.colorScheme.support;
    const ctaProm = im.cta.prominence;
    const ctaAccent = vl.accent || '#2563eb';
    const frame: React.CSSProperties = { height, background: `linear-gradient(135deg, ${g0}, ${g1} ${im.background.cornerRadius}%, ${g2})`, borderBottom: '1px solid #1f2937', padding: pad, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', overflow: 'hidden' };
    const ctaStyle: React.CSSProperties = ctaProm === 'strong'
      ? { background: ctaAccent, color: '#fff', border: 'none' }
      : ctaProm === 'subtle'
        ? { background: 'transparent', color: title, border: `1px solid ${title}66` }
        : { background: `${ctaAccent}cc`, color: '#fff', border: 'none' };
    return (
      <div style={frame}>
        {s.quote ? (<><div style={{ color: title, fontWeight: 700, fontSize: large ? 22 : 15, lineHeight: 1.25 }}>{s.quote}</div>{s.author ? <div style={{ color: support, fontSize: large ? 13 : 11, marginTop: 8 }}>{s.author}</div> : null}</>)
          : s.headline ? (<><div style={{ color: title, fontWeight: 800, fontSize: large ? 24 : 17, lineHeight: 1.2 }}>{s.headline}</div>{s.subheadline ? <div style={{ color: body, fontSize: large ? 14 : 12, marginTop: 7 }}>{s.subheadline}</div> : null}{s.cta ? <div style={{ marginTop: 12 }}><span style={{ ...ctaStyle, fontSize: large ? 12 : 10.5, fontWeight: 700, padding: '5px 11px', borderRadius: 8 }}>{s.cta}</span></div> : null}</>)
          : (<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: large ? 40 : 30, height: large ? 40 : 30, borderRadius: 8, background: ctaAccent, opacity: 0.9 }} /><div style={{ color: support, fontSize: large ? 13 : 11 }}>Clean branded visual · no text</div></div>)}
      </div>
    );
  }

  // ── CAROUSEL — selectable CONTINUITY treatment across slides ──────────────
  if (template.assetFamily === 'carousel') {
    const cs = rt.carouselStyle!;
    const accent = vl.accent || '#2563eb';
    const surface = vl.surface || '#0b1220';
    const slides = s.slides ?? [];
    const radius = Math.min(large ? 22 : 14, cs.frame.cornerRadius); // canonical slide corner radius
    const scrim = cs.panel.opacity;
    const count = template.renderingContract.frameCount ?? slides.length;
    const cont = continuity ?? defaultContinuity(template);
    const shown = slides.slice(0, large ? 6 : 4);
    const slideW = large ? 84 : 58, slideH = large ? 150 : 84;
    const frame: React.CSSProperties = { height, background: `radial-gradient(120% 120% at 80% 0%, ${accent}22, ${surface})`, borderBottom: '1px solid #1f2937', padding: pad, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', overflow: 'hidden' };

    // PANORAMA — one continuous image spanning every slide; each slide is a
    // "window" cut from it (its slice via background-position). The user's
    // "one big image, cut into slides".
    if (cont === 'panorama') {
      const pano = `linear-gradient(115deg, ${accent}, ${surface} 42%, ${accent}aa 78%, ${surface})`;
      return (
        <div style={frame}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 3, overflow: 'hidden', zIndex: 1 }}>
            {shown.map((label, i) => (
              <div key={i} style={{ flex: '0 0 auto', width: slideW, height: slideH, borderRadius: radius, position: 'relative', overflow: 'hidden', border: `1px solid ${accent}55` }}>
                <div style={{ position: 'absolute', inset: 0, background: pano, backgroundSize: `${shown.length * 100}% 100%`, backgroundPosition: `${(i / Math.max(1, shown.length - 1)) * 100}% 0`, opacity: 0.6 }} />
                <div style={{ position: 'absolute', inset: 0, background: `rgba(2,6,23,${0.22 + scrim * 0.4})` }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f8fafc', fontSize: large ? 11 : 9.5, textAlign: 'center', padding: 6, zIndex: 1 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', bottom: 8, left: pad, right: pad, height: 2, background: `${accent}33`, borderRadius: 2 }}><div style={{ width: '32%', height: '100%', background: accent, borderRadius: 2 }} /></div>
        </div>
      );
    }

    // Shared slide cards for the non-panorama styles (numbered draws a ghost index).
    const slideEls = shown.map((label, i) => (
      <div key={i} style={{ flex: '0 0 auto', width: slideW, height: slideH, borderRadius: radius, background: `rgba(2,6,23,${0.4 + scrim * 0.6})`, border: `1px solid ${accent}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', fontSize: large ? 11 : 9.5, textAlign: 'center', padding: 6, position: 'relative', overflow: 'hidden', boxShadow: cont === 'standalone' ? '0 6px 16px rgba(2,6,23,0.55)' : 'none' }}>
        {cont === 'numbered' ? <span style={{ position: 'absolute', top: -8, left: 4, fontSize: large ? 46 : 30, fontWeight: 800, color: `${accent}33`, lineHeight: 1 }}>{i + 1}</span> : null}
        <span style={{ zIndex: 1 }}>{label}</span>
      </div>
    ));
    const overflowChip = slides.length > shown.length ? <div style={{ color: '#64748b', fontSize: 12, alignSelf: 'center' }}>+{slides.length - shown.length}</div> : null;
    const row = cont === 'connectors'
      ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden', zIndex: 1 }}>{slideEls.flatMap((el, i) => i < slideEls.length - 1 ? [el, <span key={`c${i}`} style={{ color: `${accent}cc`, fontSize: large ? 18 : 14, flex: '0 0 auto', fontWeight: 700 }}>›</span>] : [el])}{overflowChip}</div>
      : <div style={{ display: 'flex', flexDirection: 'row', gap: 8, overflow: 'hidden', zIndex: 1 }}>{slideEls}{overflowChip}</div>;

    return (
      <div style={frame}>
        {cont === 'wave' ? (
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
            <path d="M0 18 C 25 8, 55 30, 100 14" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : null}
        {row}
        {cont === 'progress' ? (
          <div style={{ position: 'absolute', bottom: 7, left: pad, right: pad, display: 'flex', gap: 4, alignItems: 'center' }}>
            {Array.from({ length: Math.min(6, count) }).map((_, i) => (
              <React.Fragment key={i}>
                <span style={{ width: 14, height: 14, borderRadius: 999, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', color: i === 0 ? '#fff' : accent, background: i === 0 ? accent : `${accent}22`, border: `1px solid ${accent}77` }}>{i + 1}</span>
                {i < Math.min(6, count) - 1 ? <span style={{ flex: 1, height: 2, background: `${accent}44`, borderRadius: 2 }} /> : null}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center' }}>
            {Array.from({ length: Math.min(10, count) }).map((_, i) => (
              <span key={i} style={{ width: 5, height: 5, borderRadius: 999, background: i === 0 ? accent : `${accent}66` }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── INFOGRAPHIC — canonical palette / card style / stripe / wave / layout
  const ig = rt.infographicStyle!;
  const cscheme = ig.color_scheme;
  const cardRadius = Math.min(large ? 18 : 14, ig.card_style.cornerRadius);
  const stripeW = Math.min(8, ig.card_style.accentStripeWidth);
  const layout = template.renderingContract.infographicLayout ?? 'framework';
  const sections = (s.sections ?? []).slice(0, 3);
  const isRow = layout === 'process' || layout === 'timeline';
  const isCompare = layout === 'comparison';
  const cols = isCompare ? 2 : Math.min(3, sections.length || 1);
  const frame: React.CSSProperties = { height, background: `radial-gradient(120% 120% at 80% 0%, ${cscheme.accent}22, ${cscheme.backgroundBase})`, borderBottom: '1px solid #1f2937', padding: pad, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', overflow: 'hidden' };
  const card = (sec: { label: string; value: string }, i: number) => (
    <div key={i} style={{ position: 'relative', background: cscheme.panel, opacity: ig.card_style.fillOpacity, borderRadius: cardRadius, padding: large ? 11 : 8, overflow: 'hidden' }}>
      {stripeW > 0 ? <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: stripeW, background: cscheme.accent }} /> : null}
      <div style={{ color: cscheme.primaryText, fontWeight: 800, fontSize: large ? 20 : 15, paddingLeft: stripeW ? stripeW + 4 : 0 }}>{sec.label}</div>
      <div style={{ color: cscheme.bodyText, fontSize: large ? 11.5 : 10, marginTop: 4, paddingLeft: stripeW ? stripeW + 4 : 0 }}>{sec.value}</div>
    </div>
  );
  return (
    <div style={frame}>
      {ig.decoration_style.wave.enabled ? (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4 }}>
          <path d="M0 12 C 30 4, 60 26, 100 10" fill="none" stroke={cscheme.accent} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : null}
      <div style={{ display: isRow ? 'flex' : 'grid', gridTemplateColumns: isRow ? undefined : `repeat(${cols}, 1fr)`, gap: 10, alignItems: 'center', zIndex: 1 }}>
        {sections.map((sec, i) => (
          <React.Fragment key={i}>
            {card(sec, i)}
            {isRow && i < sections.length - 1 ? <span style={{ color: cscheme.accent, fontWeight: 800, fontSize: large ? 18 : 14 }}>→</span> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 };
export const useBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 13px', cursor: 'pointer', fontWeight: 700, fontSize: 12.5 };
export const ghostBtn: React.CSSProperties = { background: '#ffffff', color: '#334155', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 };
export const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 };
export function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 14px', borderRadius: 999, border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`, background: active ? '#2563eb' : '#ffffff', color: active ? '#fff' : '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
}

/** Deterministic style similarity to an anchor template (Continue Your Style). */
export function styleScore(t: CreatorTemplate, anchor: CreatorTemplate): number {
  let s = 0;
  if (t.visualLanguage.densityBias === anchor.visualLanguage.densityBias) s += 2;
  if (t.visualLanguage.typographyWeight === anchor.visualLanguage.typographyWeight) s += 1;
  if (t.visualLanguage.brandingIntensity === anchor.visualLanguage.brandingIntensity) s += 1;
  if (t.category === anchor.category) s += 1;
  return s;
}

export function RecRail({ title, items, onUse, onDetails, continuity }: { title: string; items: CreatorTemplate[]; onUse: (t: CreatorTemplate) => void; onDetails: (id: string) => void; continuity?: ContinuityStyle }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...detailLabel, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
        {items.map((t) => (
          <div key={t.id} style={{ flex: '0 0 200px', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <TemplatePreview template={t} continuity={continuity} />
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{outcomeTitle(t)}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={useBtn} onClick={() => onUse(t)}>Use</button>
                <button type="button" style={ghostBtn} onClick={() => onDetails(t.id)}>Details</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ctrl: React.CSSProperties = { background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', color: '#111827', fontSize: 12.5, minWidth: 170 };
export const chip: React.CSSProperties = { fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '3px 9px' };


