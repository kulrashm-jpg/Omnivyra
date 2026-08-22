/** Part 1/2 of templates.tsx — verbatim split (barrel preserved; importers unchanged). */
import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Check, Star, Search as SearchIcon, Layers, X } from 'lucide-react';
import { useCompanyContext } from '../../../../components/CompanyContext';
import PageLoader from '../../../../components/PageLoader';
import {
  familyForCreatorType,
  listCanonicalTemplatesForFamily,
  resolveCanonicalTemplateId,
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
import { Drawer, CompareView, TemplateBlueprintModal, ContentIngestionModal, ReadinessReviewModal, FilterSelect, CategoryTab, DetailRow, describeFields, PreviewStatusBadge, BlueprintStrip, TemplateDiagnosticSummary, MultiOutcomePreview, type ContinuityStyle, CONTINUITY_OPTIONS, TemplatePreview, linkBtn, useBtn, ghostBtn, detailLabel, tab, styleScore, RecRail, ctrl, chip } from './templatesWidgets';

interface CanonicalGalleryContext {
  industry: string | null;
  industries: string[];
  products: string[];
  audience: string | null;
  objective: string | null;
  businessObjectives: string[];
  messagingPillars: string[];
  positioning: string | null;
  maturity: 'early' | 'growth' | 'mature' | null;
  brandTone: string | null;
}

/**
 * Template Discovery & Recommendation experience.
 *
 * Read-only browsing only — no generation/rendering/template change. All
 * ordering comes from the deterministic discovery engine. Favorites + recently
 * used persist in localStorage (UI state). Selecting a template navigates to the
 * existing Creator page with ?template_id=…
 */

type Mode = 'recommended' | 'popular' | 'recent' | 'favorites' | 'all' | 'categories';
const FAV_KEY = 'creator-tpl-favorites';
const RECENT_KEY = 'creator-tpl-recent';
/** Per-asset-type selected template (sessionStorage) — survives navigation into
 *  the Creator and restores the highlight when the user returns to the gallery. */
const selKey = (type: string | null) => `creator-tpl-selected:${type ?? 'unknown'}`;
function readSel(type: string | null): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage.getItem(selKey(type)) || null; } catch { return null; }
}
function writeSel(type: string | null, id: string | null) {
  try { if (id) window.sessionStorage.setItem(selKey(type), id); else window.sessionStorage.removeItem(selKey(type)); } catch { /* ignore */ }
}

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try { const v = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function writeIds(key: string, ids: string[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids.slice(0, 50))); } catch { /* ignore */ }
}

const ASPECT_PLATFORMS: Record<string, string> = { landscape: 'LinkedIn · X · Facebook', portrait: 'Instagram · Pinterest', square: 'Instagram · LinkedIn' };

/** The deliverable noun for a template's family (asset-family-aware naming). */
function familyDeliverableNoun(t: CreatorTemplate): string {
  if (t.assetFamily === 'carousel') return 'Carousel';
  if (t.assetFamily === 'infographic') return 'Infographic';
  // image family — the banner lane reads as "Banner", everything else "Image".
  return (t.renderingContract.writerAssetType === 'banner' && t.category.toLowerCase() === 'banner') ? 'Banner' : 'Image';
}
/** Outcome-oriented card title — never exposes internal template terminology.
 *  e.g. "Statistics" → "Statistics Infographic", "Quote + Author" → "Quote + Author Image". */
export function outcomeTitle(t: CreatorTemplate): string {
  const noun = familyDeliverableNoun(t);
  const name = String(t.name || '').trim();
  return name.toLowerCase().includes(noun.toLowerCase()) ? name : `${name} ${noun}`;
}
/** Plain-English description of the finished deliverable (drawer "What this creates"). */
function whatThisCreates(t: CreatorTemplate): string {
  const fd = t.formDefinition;
  if (t.assetFamily === 'carousel') {
    const n = fd.slides?.defaultCount ?? (typeof t.renderingContract.frameCount === 'number' ? t.renderingContract.frameCount : 5);
    return `A ${n}-slide carousel — one headline (and optional body) per slide.`;
  }
  if (t.assetFamily === 'infographic') {
    const range = fd.sections ? `${fd.sections.min}–${fd.sections.max} ${fd.sections.sectionLabel.toLowerCase()} sections` : 'a structured layout';
    return `A ${t.renderingContract.infographicLayout ?? 'framework'} infographic with ${range}, plus a title.`;
  }
  const noun = familyDeliverableNoun(t).toLowerCase();
  const hasCta = fd.fields.some((f) => f.key === 'cta');
  return `A single ${noun} with your headline${hasCta ? ', supporting text, and a call-to-action' : ''}.`;
}

export default function CreatorTemplateGalleryPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId } = useCompanyContext();
  const type = typeof router.query.type === 'string' ? router.query.type : null;
  const family = familyForCreatorType(type);
  // CREATOR-045 — outcome-first gallery toggle (flag-gated; advanced browser stays available).
  const [advancedMode, setAdvancedMode] = React.useState(false);

  // Canonical company context (projection of the Context Assembly) + live
  // Creator-session controls. Changing any control re-runs the deterministic
  // engine in-place (no page reload).
  const [canonical, setCanonical] = React.useState<CanonicalGalleryContext | null>(null);
  const [sessPlatform, setSessPlatform] = React.useState('');
  const [sessObjective, setSessObjective] = React.useState('');
  const [sessAudience, setSessAudience] = React.useState('');

  const [mode, setMode] = React.useState<Mode>('all');
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState<SearchFilters>({});
  const [activeCategory, setActiveCategory] = React.useState<string>('all');
  const [detailsId, setDetailsId] = React.useState<string | null>(null);
  const [compareIds, setCompareIds] = React.useState<string[]>([]);
  const [showCompare, setShowCompare] = React.useState(false);
  // CREATOR-006 — Content Blueprint shown after choosing, before the editor.
  const [blueprintFor, setBlueprintFor] = React.useState<CreatorTemplate | null>(null);
  const [skipBlueprint, setSkipBlueprint] = React.useState(false);
  // CREATOR-007 — Content Ingestion step (Blueprint → Ingestion → editor).
  const [ingestFor, setIngestFor] = React.useState<CreatorTemplate | null>(null);
  // CREATOR-008 — Content Readiness Review (Ingestion → Review → editor).
  const [reviewFor, setReviewFor] = React.useState<{ template: CreatorTemplate; ingestion: IngestionResult } | null>(null);
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [groupByCat, setGroupByCat] = React.useState(false);
  const [userTemplates, setUserTemplates] = React.useState<CreatorTemplate[]>([]);
  const [ownerScope, setOwnerScope] = React.useState<'all' | 'system' | 'mine' | 'shared'>('all');
  // Carousel continuity showcase — 'auto' lets each template show its own style;
  // picking one overrides the showcase across the gallery.
  const [continuityOverride, setContinuityOverride] = React.useState<ContinuityStyle | 'auto'>('auto');
  const continuity = continuityOverride === 'auto' ? undefined : continuityOverride;
  // Strategy-first browse axis — filter the gallery by Story Blueprint.
  const [blueprintFilter, setBlueprintFilter] = React.useState<StoryBlueprintId | 'all'>('all');
  // CAMPAIGN-006 — selection source (recommended vs explicit user choice) +
  // re-evaluation guard (re-recommend only on a material planning-input change).
  const [selectionSource, setSelectionSource] = React.useState<'user' | 'recommended' | 'none'>('none');
  const selectionSourceRef = React.useRef<'user' | 'recommended' | 'none'>('none');
  const lastRecKeyRef = React.useRef<string | null>(null);
  const markSource = (s: 'user' | 'recommended') => { selectionSourceRef.current = s; setSelectionSource(s); };

  // CREATOR-030 — Campaign Design System management mode. A `collection_id` puts
  // the canonical gallery into multi-select campaign mode: cards toggle membership
  // of the campaign's pinned collection (the Design System) DIRECTLY — no member
  // editor, no temporary state, no second gallery. All browse/search/filter/preview
  // behavior is unchanged; only selection semantics differ in this mode.
  const collectionId = typeof router.query.collection_id === 'string' ? router.query.collection_id.trim() : '';
  const campaignMode = !!collectionId;
  const manageReturnTo = typeof router.query.return_to === 'string' ? router.query.return_to : '';
  const [memberIds, setMemberIds] = React.useState<Set<string>>(new Set());
  const [memberBusy, setMemberBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!campaignMode) return;
    let cancelled = false;
    fetch(`/api/creator-templates/collections/${encodeURIComponent(collectionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Array.isArray(d?.collection?.templateIds)) setMemberIds(new Set(d.collection.templateIds as string[])); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [campaignMode, collectionId]);

  const toggleMember = React.useCallback(async (t: CreatorTemplate) => {
    if (!campaignMode || memberBusy) return;
    const isMember = memberIds.has(t.id);
    setMemberBusy(t.id);
    try {
      const res = await fetch(`/api/creator-templates/collections/${encodeURIComponent(collectionId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: memberOp(isMember), template_id: t.id }),
      });
      if (res.ok) setMemberIds((prev) => toggleMemberSet(prev, t.id));
    } catch { /* best-effort */ } finally { setMemberBusy(null); }
  }, [campaignMode, collectionId, memberIds, memberBusy]);

  const switchFamilyHref = (fam: string) => {
    const q: Record<string, string> = { collection_id: collectionId };
    for (const k of ['campaign_id', 'return_to']) { const v = router.query[k]; if (typeof v === 'string' && v) q[k] = v; }
    return { pathname: `/command-center/creator-content/${fam}/templates`, query: q };
  };
  const doneManaging = () => { if (manageReturnTo) router.push(manageReturnTo); else router.back(); };

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) router.replace('/login');
  }, [authChecked, isLoading, user?.userId, router]);
  // CREATOR-068: honor ?advanced=1 to open the legacy browser (Advanced Mode).
  React.useEffect(() => { if (router.isReady && router.query.advanced === '1') setAdvancedMode(true); }, [router.isReady, router.query.advanced]);
  React.useEffect(() => { setFavorites(readIds(FAV_KEY)); setRecent(readIds(RECENT_KEY)); }, []);
  React.useEffect(() => { try { setSkipBlueprint(window.localStorage.getItem('creator:blueprint:skip') === '1'); } catch { /* ignore */ } }, []);

  // Fetch the user's own/shared templates and register them into the canonical
  // runtime registry so resolveTemplate()/the preview resolve their style — the
  // gallery shows system + user templates together (no second gallery).
  React.useEffect(() => {
    if (!selectedCompanyId || !family) return;
    let cancelled = false;
    fetch(`/api/creator-templates/user?company_id=${encodeURIComponent(selectedCompanyId)}&family=${encodeURIComponent(family)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.templates)) return;
        const ts = d.templates as CreatorTemplate[];
        registerUserTemplates(ts);
        setUserTemplates(ts);
      })
      .catch(() => { /* best-effort — gallery works with system templates alone */ });
    return () => { cancelled = true; };
  }, [selectedCompanyId, family]);

  // Live refresh — while any user template's preview is still in flight (queued /
  // rendering), re-poll the SAME endpoint so the gallery + details drawer update
  // automatically when the durable preview job completes (no manual refresh).
  React.useEffect(() => {
    if (!selectedCompanyId || !family) return;
    const inFlight = userTemplates.some((t) => { const s = previewStatusOf(t); return s === 'pending' || s === 'rendering'; });
    if (!inFlight) return;
    const h = setInterval(() => {
      fetch(`/api/creator-templates/user?company_id=${encodeURIComponent(selectedCompanyId)}&family=${encodeURIComponent(family)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d?.templates)) { registerUserTemplates(d.templates); setUserTemplates(d.templates as CreatorTemplate[]); } })
        .catch(() => { /* best-effort */ });
    }, 4000);
    return () => clearInterval(h);
  }, [selectedCompanyId, family, userTemplates]);

  // Fetch the canonical context projection once per company (cached server-side).
  React.useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    fetch(`/api/creator-templates/context?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.context) setCanonical(d.context as CanonicalGalleryContext); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  // Seed session controls from the URL (carried from the Creator flow) once.
  React.useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (typeof q.platform === 'string') setSessPlatform(q.platform);
    if (typeof q.objective === 'string') setSessObjective(q.objective);
    if (typeof q.audience === 'string') setSessAudience(q.audience);
    // Restore the active selection: a template_id carried back from the Creator
    // wins; otherwise the per-asset-type sessionStorage selection.
    const fromUrl = typeof q.template_id === 'string' && q.template_id.trim() ? q.template_id.trim() : null;
    // PHASE-1: a selection restored from the URL or a prior session may carry an
    // id that deduplication folded away. Map it onto its canonical id so the
    // gallery still highlights the right card (no-op for canonical ids).
    const restored = resolveCanonicalTemplateId(fromUrl ?? readSel(type)) || null;
    if (restored) { setSelectedId(restored); writeSel(type, restored); markSource('user'); }
  }, [router.isReady]);

  // Creator launched from a Campaign: auto-recommend the campaign's design-system
  // (Collection) template for this asset family. Manual override is preserved —
  // we only seed when nothing is already selected and no explicit template_id
  // was passed. The Collection stays attached to the campaign regardless.
  React.useEffect(() => {
    if (!router.isReady || !family) return;
    const campaignId = typeof router.query.campaign_id === 'string' ? router.query.campaign_id.trim() : '';
    if (!campaignId || (typeof router.query.template_id === 'string' && router.query.template_id.trim())) return;
    let cancelled = false;
    fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}?family=${encodeURIComponent(family)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.template?.id) return;
        // PHASE-1: a Collection may hold a pre-dedup id — highlight its canonical card.
        const seeded = resolveCanonicalTemplateId(d.template.id);
        setSelectedId((prev) => { if (prev) return prev; writeSel(type, seeded); markSource('user'); return seeded; });
      })
      .catch(() => { /* best-effort — no design system attached */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, family]);

  // CAMPAIGN-006 — deterministic recommendation context (planning inputs only).
  const recCtx: RecommendationContext = {
    assetFamily: family ?? null,
    contentType: type,
    objective: sessObjective || canonical?.objective || null,
    platform: sessPlatform || null,
    audience: sessAudience || canonical?.audience || null,
    industry: canonical?.industry || null,
  };
  const recKey = family ? recommendationInputKey(recCtx) : '';

  // Auto-select the highest-ranked template when the user has not chosen one.
  // Re-recommends ONLY on a material planning-input change (recKey), and never
  // overwrites an explicit user selection.
  React.useEffect(() => {
    if (!family) return;
    // PHASE-1: recommend from the SAME canonical pool the gallery displays.
    // (Previously the blueprint-only subset, so the engine could never
    //  recommend a template the default gallery actually showed.)
    const pool = [...listCanonicalTemplatesForFamily(family), ...userTemplates];
    const top = resolveAutoSelection({ templates: pool, context: recCtx }).result.recommended;
    if (!top) return;
    if (lastRecKeyRef.current === recKey) return;
    const materialChange = lastRecKeyRef.current !== null;
    lastRecKeyRef.current = recKey;
    setSelectedId((prev) => {
      if (!prev) { markSource('recommended'); return top.template.id; }            // first-time preselect
      if (materialChange && selectionSourceRef.current === 'recommended') { return top.template.id; } // refresh recommendation
      return prev;                                                                 // explicit user choice preserved
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey, family, userTemplates]);

  if (!authChecked || isLoading || !router.isReady) return <PageLoader />;
  if (!family) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32, color: '#0f172a' }}>
        <p>Templates aren’t available for “{String(type)}”. Choose Image, Carousel, or Infographic.</p>
        <button type="button" style={linkBtn} onClick={() => router.push('/command-center/creator-content/create')}>Back to Create</button>
      </div>
    );
  }

  // System + user templates merged into ONE list (same model, same gallery),
  // then scoped by the ownership filter (All / System / My Templates / Shared).
  // PHASE-1: System = the CANONICAL pool — the goal-named STRUCTURAL set unioned
  // with the curated STYLE pool and then deduplicated, so a logical template can
  // never appear twice (the audit's B4 defect: two "Comparison" / "Corporate" /
  // "Timeline" cards in one family). User templates are never deduplicated.
  const merged = [...listCanonicalTemplatesForFamily(family), ...userTemplates];
  const myId = user?.userId;
  const scoped = ownerScope === 'system' ? merged.filter((t) => t.ownership === 'system')
    : ownerScope === 'mine' ? merged.filter((t) => t.ownership === 'user' && (t.metadata as Record<string, unknown> | undefined)?.ownerUserId === myId)
    : ownerScope === 'shared' ? merged.filter((t) => t.ownership === 'user' && (t.metadata as Record<string, unknown> | undefined)?.scope === 'team')
    : merged;
  // Strategy-first browse: additional filter by Story Blueprint (narrative
  // structure). Additive — the existing outcome/ownership views are unchanged.
  const all = blueprintFilter === 'all' ? scoped : scoped.filter((t) => resolveStoryBlueprint(t).id === blueprintFilter);
  // Blueprints present in this family (with counts) — the strategy browse axis.
  const blueprintAxis = (() => {
    const counts = new Map<StoryBlueprintId, number>();
    for (const t of scoped) { const id = resolveStoryBlueprint(t).id; counts.set(id, (counts.get(id) ?? 0) + 1); }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  })();
  // Categories derived from the merged set so user-template categories appear too.
  const categories = Array.from(new Set(merged.map((t) => t.category))).map((key) => ({ key, label: key, family }));
  const styleVariants = listStyleVariants(all);
  const byId = (id: string) => all.find((t) => t.id === id) ?? null;

  // ── Deterministic discovery contexts (canonical + live session) ──
  const c = canonical;
  const fullCtx: DiscoveryContext = {
    industry: c?.industry ?? null,
    maturity: c?.maturity ?? null,
    objective: sessObjective || c?.objective || null,
    campaignGoal: sessObjective || null,
    audience: sessAudience || c?.audience || null,
    currentInputs: [sessPlatform, ...(c?.products ?? []), ...(c?.messagingPillars ?? []), c?.positioning ?? ''].filter(Boolean).join(' ') || null,
    recentlyUsedIds: recent,
    favoriteIds: favorites,
  };
  const recommendedScored: ScoredTemplate[] = recommendTemplates(all, fullCtx);

  // Recommendation groups (each a deterministic engine call with a context slice).
  const groupCompany = recommendTemplates(all, { industry: c?.industry ?? null, maturity: c?.maturity ?? null, objective: c?.objective ?? null, audience: c?.audience ?? null, currentInputs: [...(c?.products ?? []), ...(c?.messagingPillars ?? [])].join(' ') || null }).slice(0, 8).map((s) => s.template);
  const groupCampaign = (sessObjective || sessAudience || sessPlatform) ? recommendTemplates(all, { objective: sessObjective || null, audience: sessAudience || null, currentInputs: sessPlatform || null }).slice(0, 8).map((s) => s.template) : [];
  const groupIndustry = c?.industry ? recommendTemplates(all, { industry: c.industry, currentInputs: c.industry }).slice(0, 8).map((s) => s.template) : [];
  const styleAnchor = recent[0] ? byId(recent[0]) : (favorites[0] ? byId(favorites[0]) : null);
  const groupStyle = styleAnchor ? [...all].filter((t) => t.id !== styleAnchor.id).sort((a, b) => styleScore(b, styleAnchor) - styleScore(a, styleAnchor) || a.id.localeCompare(b.id)).slice(0, 8) : [];
  const groupSimilar = recent[0] && byId(recent[0]) ? relatedTemplates(byId(recent[0])!, all, 8) : [];

  // Resolve the displayed list deterministically from the active mode/search.
  let list: CreatorTemplate[];
  const searching = query.trim().length > 0 || Object.values(filters).some(Boolean);
  if (searching) {
    list = searchTemplates(all, query, filters);
  } else if (mode === 'recommended') {
    list = recommendedScored.map((s) => s.template);
  } else if (mode === 'popular') {
    list = popularTemplates(all);
  } else if (mode === 'recent') {
    list = recent.map(byId).filter(Boolean) as CreatorTemplate[];
  } else if (mode === 'favorites') {
    list = favorites.map(byId).filter(Boolean) as CreatorTemplate[];
  } else if (mode === 'categories') {
    list = (activeCategory === 'all' ? all : all.filter((t) => t.category === activeCategory)).sort((a, b) => templatePopularity(b) - templatePopularity(a));
  } else {
    list = popularTemplates(all);
  }

  // Canonical recommendation for this campaign context (drives the banner +
  // "Why this template?" panel + the recommended badge). Deterministic.
  const recResult = resolveAutoSelection({ templates: merged, context: recCtx }).result;
  const recommendedTemplateId = recResult.recommended?.template.id ?? null;
  const recommendationFor = (id: string) => recResult.all.find((r) => r.template.id === id) ?? null;

  // Select = highlight + persist (template_id) + mark as an explicit user choice.
  const selectTemplate = (t: CreatorTemplate) => {
    markSource('user');
    setSelectedId(t.id);
    writeSel(type, t.id);
  };
  // Carry the gallery's contextual query (campaign_id / layout / platform /
  // objective / audience) back into the workflow so no context is lost.
  const carryQuery = (extra: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    // Forward campaign context AND the writer-launch context (source / prefill /
    // asset_type / attachment_mode / transform / sourceType / return_to) so a
    // writer "Add Asset" launch keeps its handoff through template selection into
    // the canonical generation page — one pipeline, no writer-specific branch.
    for (const k of ['campaign_id', 'layout', 'platform', 'objective', 'audience', 'source', 'session', 'sourceType', 'asset_type', 'attachment_mode', 'source_text_transform', 'prefill', 'return_to', 'skip_blueprint', 'skip_ingestion']) {
      const v = router.query[k];
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return { ...out, ...extra };
  };
  const useTemplate = (t: CreatorTemplate, ingestToken?: string) => {
    selectTemplate(t);
    const next = [t.id, ...recent.filter((id) => id !== t.id)];
    writeIds(RECENT_KEY, next); setRecent(next);
    const query = carryQuery({ template_id: t.id });
    if (ingestToken) query.ingest = ingestToken;
    router.push({ pathname: `/command-center/creator-content/${type}`, query });
  };
  // Launch-flag SKIP REQUESTS (e.g. source=writer adds skip_blueprint / skip_ingestion
  // because the post content already exists). A request is honored ONLY when the
  // canonical capability contract says the stage is skippable for the chosen
  // template (`canSkipBlueprint` / `canSkipContentIngestion`). Routing asks the
  // helper and contains NO requirement logic — the flag is a request, never a bypass.
  const wantSkipBlueprint = () => router.query.skip_blueprint === '1';
  const wantSkipIngestion = () => router.query.skip_ingestion === '1';

  // CREATOR-006/007 — choosing routes through Blueprint → Content Ingestion →
  // editor. Blueprint may be skipped (preference OR launch request); ingestion is
  // optional (its own "start blank" path OR launch request).
  const chooseTemplate = (t: CreatorTemplate) => {
    selectTemplate(t);
    setShowCompare(false);
    setDetailsId(null);
    const skipBp = (skipBlueprint || wantSkipBlueprint()) && canSkipBlueprint(t);
    const skipIng = wantSkipIngestion() && canSkipContentIngestion(t);
    if (!skipBp) { setBlueprintFor(t); return; }   // Blueprint required/not-skipped → show it.
    if (!skipIng) { setIngestFor(t); return; }      // Blueprint skipped → Content Ingestion.
    useTemplate(t);                                 // Both optional stages skipped → Configuration.
  };
  const continueFromBlueprint = (t: CreatorTemplate) => {
    setBlueprintFor(null);
    if (wantSkipIngestion() && canSkipContentIngestion(t)) { useTemplate(t); return; }
    setIngestFor(t);
  };
  const skipBlueprintForever = (t: CreatorTemplate) => {
    try { window.localStorage.setItem('creator:blueprint:skip', '1'); } catch { /* ignore */ }
    setSkipBlueprint(true); setBlueprintFor(null); setIngestFor(t);
  };
  // Ingestion → Readiness Review → editor. Starting blank skips both.
  const continueFromIngestion = (t: CreatorTemplate, ingestion: IngestionResult) => { setIngestFor(null); setReviewFor({ template: t, ingestion }); };
  const startBlankEditor = (t: CreatorTemplate) => { setIngestFor(null); setReviewFor(null); useTemplate(t); };
  // Review outcomes: enter the editor with populated values, or revise ingestion.
  const continueFromReview = (t: CreatorTemplate) => { setReviewFor(null); useTemplate(t, t.id); };
  const backToIngestion = (t: CreatorTemplate) => { setReviewFor(null); setIngestFor(t); };
  // Explicit "no template" path — keeps the legacy brief-first workflow reachable
  // (the workflow's template-first redirect honors skip_templates=1).
  const continueWithoutTemplate = () => {
    router.push({ pathname: `/command-center/creator-content/${type}`, query: carryQuery({ skip_templates: '1' }) });
  };
  const toggleFav = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [id, ...favorites];
    writeIds(FAV_KEY, next); setFavorites(next);
  };
  const toggleCompare = (id: string) => {
    setCompareIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]);
  };

  const details = detailsId ? byId(detailsId) : null;

  const renderCard = (t: CreatorTemplate) => {
    const fav = favorites.includes(t.id);
    // In campaign mode "selected" = membership of the pinned Design System.
    const selected = campaignMode ? memberIds.has(t.id) : selectedId === t.id;
    const cardBusy = campaignMode && memberBusy === t.id;
    const rec = recommendationFor(t.id);                 // recommendation engine result (no logic change)
    const isRecommended = recommendedTemplateId === t.id;
    const matchPct = rec ? Math.round(rec.confidence * 100) : null;
    return (
      // OUTCOME-FIRST card: the preview (the finished deliverable) dominates (~80%);
      // the info band (~20%) carries ONLY the outcome title, a one-line description,
      // the recommendation badge + match score, and Quick Select. All technical
      // metadata (rendering contract / style variant / layout / template id /
      // category internals) lives in the Details drawer.
      <div key={t.id} style={{ border: `${selected ? 2 : 1}px solid ${selected ? '#22c55e' : '#e5e7eb'}`, borderRadius: 14, overflow: 'hidden', background: '#ffffff', display: 'flex', flexDirection: 'column', boxShadow: selected ? '0 0 0 3px rgba(34,197,94,0.18)' : '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => (campaignMode ? toggleMember(t) : selectTemplate(t))} title={campaignMode ? (selected ? 'Remove from Design System' : 'Add to Design System') : 'Select this outcome'}>
          <MultiOutcomePreview template={t} continuity={continuity} />
          {t.ownership === 'user' ? <PreviewStatusBadge template={t} /> : null}
          {isRecommended ? (
            <span style={{ position: 'absolute', top: 8, left: 8, background: '#16a34a', color: '#fff', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '3px 9px' }}>★ Recommended{matchPct != null ? ` · ${matchPct}%` : ''}</span>
          ) : matchPct != null ? (
            <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(255,255,255,0.92)', color: '#0f172a', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '2px 8px' }}>{matchPct}% match</span>
          ) : null}
          {selected ? (
            <span style={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#16a34a', color: '#fff', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '3px 8px' }}><Check size={12} /> {campaignMode ? 'In Design System' : 'Selected'}</span>
          ) : null}
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleFav(t.id); }} title="Favorite"
            style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(2,6,23,0.55)', border: 'none', borderRadius: 999, padding: 6, cursor: 'pointer' }}>
            <Star size={15} color={fav ? '#fbbf24' : '#e5e7eb'} fill={fav ? '#fbbf24' : 'none'} />
          </button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <strong style={{ color: '#0f172a', fontSize: 14.5, lineHeight: 1.2 }}>{outcomeTitle(t)}</strong>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.description}</div>
          <BlueprintStrip template={t} />
          <div style={{ display: 'flex', gap: 6, marginTop: 'auto', alignItems: 'center' }}>
            {campaignMode ? (
              <button type="button" style={selected ? linkBtn : useBtn} disabled={cardBusy} onClick={() => toggleMember(t)}>
                {cardBusy ? 'Saving…' : selected ? 'Remove' : 'Add to Design System'}
              </button>
            ) : (
              <button type="button" style={useBtn} onClick={() => chooseTemplate(t)}>{selected ? 'Use →' : 'Quick select'}</button>
            )}
            <button type="button" style={linkBtn} onClick={() => setDetailsId(t.id)}>Details</button>
          </div>
        </div>
      </div>
    );
  };

  // All Templates → optional category grouping.
  const grouped = mode === 'all' && groupByCat && !searching;

  // CREATOR-064 — Unified Creator Experience is now the DEFAULT for normal users.
  // The legacy Template Browser is reachable only via Advanced Mode (advancedMode)
  // or campaign Design-System management (campaignMode). Runtime/seam unchanged.
  if (!advancedMode && type && !campaignMode) {
    // CREATOR-106: ONE runtime path per asset type. The asset IS the primary experience;
    // each asset mounts its own independent root component (own hero, own goals, own
    // asset-only sample gallery, own generation). No shared workspace, no creatorflow
    // sub-flow, no parallel implementations.
    const AssetWorkspace = family === 'carousel' ? CarouselCreationWorkspace
      : family === 'infographic' ? InfographicCreationWorkspace
        : ImageCreationWorkspace;
    return (
      <AssetWorkspace
        onAdvanced={() => setAdvancedMode(true)}
        onNavigate={(url) => router.push(url)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 20px 96px', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <button type="button" style={linkBtn} onClick={() => router.push('/command-center/creator-content/create')}>
          <ArrowLeft size={14} /> Asset type
        </button>
        <button type="button" style={linkBtn} onClick={continueWithoutTemplate}>Continue without a template →</button>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '8px 0 4px', color: '#0f172a', textTransform: 'capitalize' }}>{family} templates</h1>
      {campaignMode ? (
        <div style={{ border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: 12, padding: '10px 14px', margin: '8px 0 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#3730a3', fontWeight: 700, fontSize: 13 }}>
            <Layers size={16} /> Editing campaign Design System
          </div>
          <span style={{ fontSize: 12, color: '#4338ca' }}>{memberIds.size} template{memberIds.size === 1 ? '' : 's'} selected · changes save instantly</span>
          {/* Family switcher — manage every family without leaving campaign mode */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
            {(['image', 'carousel', 'infographic'] as const).map((fam) => (
              <button key={fam} type="button" onClick={() => router.push(switchFamilyHref(fam))}
                style={{ ...tab(family === fam), textTransform: 'capitalize', padding: '5px 11px', fontSize: 12.5 }}>{fam}</button>
            ))}
            <button type="button" onClick={doneManaging} style={{ ...useBtn, padding: '6px 14px' }}>Done</button>
          </div>
        </div>
      ) : (
        <p style={{ color: '#64748b', marginBottom: 12 }}>Pick a template to control the visual design, then add your content — or continue without one.</p>
      )}

      {/* CREATOR-003 — no family tabs: the page is route-scoped to ONE family,
          so only this family's outcomes are ever visible. */}

      {/* Ownership scope — System + user templates share one gallery */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {([['all', 'All'], ['system', 'System'], ['mine', 'My Templates'], ['shared', 'Shared']] as Array<['all' | 'system' | 'mine' | 'shared', string]>).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setOwnerScope(k)} style={tab(ownerScope === k)}>
            {label}{k === 'mine' && userTemplates.length ? ` (${userTemplates.filter((t) => (t.metadata as Record<string, unknown> | undefined)?.ownerUserId === myId).length})` : ''}
          </button>
        ))}
      </div>

      {/* Strategy-first browse — by Story Blueprint (communication structure).
          Additive: the outcome/ownership views remain. */}
      {blueprintAxis.length > 1 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginRight: 2 }}>Story Blueprint</span>
          <button type="button" onClick={() => setBlueprintFilter('all')} style={tab(blueprintFilter === 'all')}>All structures</button>
          {blueprintAxis.map(([id, n]) => (
            <button key={id} type="button" onClick={() => setBlueprintFilter(id)} style={tab(blueprintFilter === id)} title={STORY_BLUEPRINTS[id].narrativeFlow.join(' → ')}>
              {STORY_BLUEPRINTS[id].label} ({n})
            </button>
          ))}
        </div>
      ) : null}

      {/* Carousel continuity showcase — how slides connect (varies per template by
          default; pick one to preview that style across the gallery). */}
      {family === 'carousel' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginRight: 2 }}>Continuity</span>
          <button type="button" onClick={() => setContinuityOverride('auto')} style={tab(continuityOverride === 'auto')} title="Each template shows its own continuity style">Auto · varied</button>
          {CONTINUITY_OPTIONS.map((o) => (
            <button key={o.id} type="button" onClick={() => setContinuityOverride(o.id)} style={tab(continuityOverride === o.id)} title={o.hint}>{o.label}</button>
          ))}
        </div>
      ) : null}

      {/* CREATOR-002 — recommendation-first: HERO + ALTERNATIVES (or empty state) */}
      {!searching && recResult.recommended ? (() => {
        const rec = recResult.recommended!;
        const rt = rec.template;
        const pct = Math.round(rec.confidence * 100);
        const isSel = selectedId === rt.id;
        return (
          <>
            <div style={{ ...detailLabel, marginBottom: 8 }}>Recommended Outcome</div>
            <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', border: `1px solid ${isSel ? '#22c55e' : '#e5e7eb'}`, borderRadius: 16, overflow: 'hidden', background: '#ffffff', boxShadow: '0 12px 34px rgba(15,23,42,0.08)', marginBottom: 18 }}>
              <div style={{ position: 'relative', borderRight: '1px solid #eef2f7' }}>
                <MultiOutcomePreview template={rt} large continuity={continuity} />
                <span style={{ position: 'absolute', top: 12, left: 12, background: '#16a34a', color: '#fff', fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: '4px 11px' }}>★ Recommended · {pct}%</span>
                {selectionSource === 'user' ? <span style={{ position: 'absolute', top: 12, right: 12, background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d', fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 9px' }}>you changed this</span> : null}
              </div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>{outcomeTitle(rt)}</div>
                  <div style={{ fontSize: 13.5, color: '#475569', marginTop: 6, lineHeight: 1.45 }}>{rt.description}</div>
                </div>
                <TemplateRecommendationPanel recommendation={rec} />
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                  <button type="button" style={useBtn} onClick={() => chooseTemplate(rt)}><Check size={15} /> Use template</button>
                  <button type="button" style={{ ...ghostBtn, color: compareIds.includes(rt.id) ? '#2563eb' : '#334155' }} onClick={() => toggleCompare(rt.id)}>{compareIds.includes(rt.id) ? '✓ Compare' : 'Compare'}</button>
                  <button type="button" style={ghostBtn} onClick={() => setDetailsId(rt.id)}>Details</button>
                  <button type="button" style={linkBtn} onClick={() => setMode('all')}>Change recommendation →</button>
                </div>
              </div>
            </section>

            {recResult.top.length > 1 ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ ...detailLabel, marginBottom: 8 }}>More options ranked for you</div>
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                  {recResult.top.slice(1, 5).map((r) => {
                    const a = r.template;
                    return (
                      <div key={a.id} style={{ flex: '0 0 220px', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                        <div style={{ position: 'relative' }}>
                          <TemplatePreview template={a} continuity={continuity} />
                          <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(255,255,255,0.92)', color: '#0f172a', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '2px 8px' }}>{Math.round(r.confidence * 100)}% match</span>
                        </div>
                        <div style={{ padding: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.25 }}>{outcomeTitle(a)}</div>
                          <div style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" style={useBtn} onClick={() => selectTemplate(a)}>Quick select</button>
                            <button type="button" style={ghostBtn} onClick={() => toggleCompare(a.id)}>Compare</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        );
      })() : !searching ? (
        <div style={{ border: '1px solid #e5e7eb', background: '#f8fafc', borderRadius: 12, padding: '16px 18px', marginBottom: 16, color: '#475569' }}>
          <strong style={{ color: '#0f172a' }}>No strong recommendation available.</strong> Browse all templates below.
        </div>
      ) : null}

      {!searching ? <div style={{ ...detailLabel, marginBottom: 8, marginTop: 4 }}>Explore all templates</div> : null}

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <SearchIcon size={15} style={{ position: 'absolute', left: 10, top: 10, color: '#64748b' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, keywords, use cases…"
            style={{ width: '100%', boxSizing: 'border-box', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 12px 9px 32px', color: '#111827', fontSize: 14 }} />
        </div>
        <FilterSelect label="Category" value={filters.category ?? ''} onChange={(v) => setFilters((f) => ({ ...f, category: v || null }))} options={categories.map((c) => c.key)} />
        <FilterSelect label="Style Variant" value={filters.variant ?? ''} onChange={(v) => setFilters((f) => ({ ...f, variant: v || null }))} options={styleVariants} format={variantLabel} />
        <FilterSelect label="Difficulty" value={filters.difficulty ?? ''} onChange={(v) => setFilters((f) => ({ ...f, difficulty: v || null }))} options={['easy', 'intermediate', 'advanced']} />
        <FilterSelect label="Aspect" value={filters.aspect ?? ''} onChange={(v) => setFilters((f) => ({ ...f, aspect: v || null }))} options={['square', 'portrait', 'landscape']} />
        <FilterSelect label="Density" value={filters.density ?? ''} onChange={(v) => setFilters((f) => ({ ...f, density: (v || null) as TextDensity | null }))} options={['minimal', 'balanced', 'heavy']} />
        {searching ? <button type="button" style={linkBtn} onClick={() => { setQuery(''); setFilters({}); }}>Clear</button> : null}
      </div>

      {/* Browsing modes */}
      {!searching ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {([['recommended', 'Recommended'], ['popular', 'Popular'], ['recent', 'Recently Used'], ['favorites', 'Favorites'], ['all', 'All Templates'], ['categories', 'Categories']] as Array<[Mode, string]>).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} style={tab(mode === m)}>
              {label}{m === 'favorites' && favorites.length ? ` (${favorites.length})` : ''}
            </button>
          ))}
        </div>
      ) : null}

      {/* Category chips (categories mode) */}
      {!searching && mode === 'categories' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <CategoryTab label="All" active={activeCategory === 'all'} onClick={() => setActiveCategory('all')} />
          {categories.map((c) => <CategoryTab key={c.key} label={c.label} active={activeCategory === c.key} onClick={() => setActiveCategory(c.key)} />)}
        </div>
      ) : null}

      {/* Context controls + recommendation groups (recommended mode, live) */}
      {!searching && mode === 'recommended' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc' }}>
            <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 700 }}>Tune recommendations:</span>
            <input value={sessPlatform} onChange={(e) => setSessPlatform(e.target.value)} placeholder="Platform (e.g. LinkedIn)" style={ctrl} />
            <input value={sessObjective} onChange={(e) => setSessObjective(e.target.value)} placeholder="Objective (e.g. Product Launch)" style={ctrl} />
            <input value={sessAudience} onChange={(e) => setSessAudience(e.target.value)} placeholder="Audience (e.g. RevOps leaders)" style={ctrl} />
            {canonical?.industry ? <span style={chip}>Industry: {canonical.industry}</span> : null}
            {canonical?.maturity ? <span style={chip}>Maturity: {canonical.maturity}</span> : null}
            {canonical?.brandTone ? <span style={chip}>Voice: {canonical.brandTone}</span> : null}
          </div>
          {groupCompany.length ? <RecRail title="Based on Your Company" items={groupCompany} onUse={chooseTemplate} onDetails={setDetailsId} continuity={continuity} /> : null}
          {groupCampaign.length ? <RecRail title="Based on This Campaign" items={groupCampaign} onUse={chooseTemplate} onDetails={setDetailsId} continuity={continuity} /> : null}
          {groupStyle.length ? <RecRail title="Continue Your Style" items={groupStyle} onUse={chooseTemplate} onDetails={setDetailsId} continuity={continuity} /> : null}
          {groupSimilar.length ? <RecRail title="Similar to Recently Used" items={groupSimilar} onUse={chooseTemplate} onDetails={setDetailsId} continuity={continuity} /> : null}
          {groupIndustry.length ? <RecRail title="Trending for Your Industry" items={groupIndustry} onUse={chooseTemplate} onDetails={setDetailsId} continuity={continuity} /> : null}
          <div style={{ ...detailLabel, marginBottom: 8 }}>Recommended for You</div>
        </>
      ) : null}

      {/* All Templates → group-by-category toggle */}
      {!searching && mode === 'all' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" onClick={() => setGroupByCat((v) => !v)} style={tab(groupByCat)}>
            {groupByCat ? '✓ Grouped by category' : 'Group by category'}
          </button>
        </div>
      ) : null}

      {/* Grid */}
      {list.length === 0 ? (
        <div style={{ padding: 28, color: '#94a3b8' }}>No templates match. Try clearing filters.</div>
      ) : grouped ? (
        categories.map((cat) => {
          const items = list.filter((t) => t.category === cat.key);
          if (!items.length) return null;
          return (
            <div key={cat.key} style={{ marginBottom: 22 }}>
              <div style={{ ...detailLabel, marginBottom: 8 }}>{cat.label} <span style={{ color: '#64748b' }}>({items.length})</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
                {items.map(renderCard)}
              </div>
            </div>
          );
        })
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
          {list.map(renderCard)}
        </div>
      )}

      {/* Compare bar */}
      {compareIds.length > 0 ? (
        <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#ffffff', border: '1px solid #2563eb', borderRadius: 999, padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'center', zIndex: 40 }}>
          <Layers size={15} color="#93c5fd" />
          <span style={{ fontSize: 13, color: '#475569' }}>{compareIds.length} selected (max 3)</span>
          <button type="button" style={useBtn} onClick={() => setShowCompare(true)}>Compare</button>
          <button type="button" style={linkBtn} onClick={() => setCompareIds([])}>Clear</button>
        </div>
      ) : null}

      {/* Compare modal */}
      {showCompare ? (
        <CompareView
          templates={compareIds.map(byId).filter(Boolean) as CreatorTemplate[]}
          recommendationFor={recommendationFor}
          recommendedId={recommendedTemplateId}
          onUse={chooseTemplate}
          onClose={() => setShowCompare(false)}
        />
      ) : null}

      {/* Details drawer */}
      {details ? (
        (() => {
          const dd = describeTemplatePlan(details);
          const dm = details.metadata as Record<string, unknown>;
          const sec: React.CSSProperties = { ...detailLabel, marginTop: 16, marginBottom: 6 };
          return (
          <Drawer onClose={() => setDetailsId(null)} title={outcomeTitle(details)}>
            {/* Overview */}
            <div style={{ ...detailLabel, marginBottom: 6 }}>Overview</div>
            <p style={{ color: '#475569', fontSize: 13, margin: 0 }}>{details.description || details.category}</p>
            {/* Story Blueprint — the communication structure (labels only) */}
            <div style={sec}>Story Blueprint</div>
            <BlueprintStrip template={details} large />
            <DetailRow k="Category" v={details.category} />
            <DetailRow k="Recommended scenarios" v={(dm.recommendedUseCases as string[] | undefined)?.join(', ') || details.category} />
            <DetailRow k="Supported platforms" v={Array.isArray(dm.aspectSupport) ? (dm.aspectSupport as string[]).map((a) => ASPECT_PLATFORMS[a] ?? a).join(' · ') : '—'} />

            {/* Preview — browse every example outcome */}
            <div style={sec}>Preview</div>
            <div style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', paddingBottom: 8 }}>
              <MultiOutcomePreview template={details} large continuity={continuity} />
              {details.ownership === 'user' ? <PreviewStatusBadge template={details} large /> : null}
            </div>
            <p style={{ color: '#64748b', fontSize: 12.5, marginTop: 8 }}>This template adapts to different content while preserving the same visual structure.</p>

            {/* Why Recommended */}
            <div style={sec}>Why recommended</div>
            {recommendationFor(details.id) ? (
              <TemplateRecommendationPanel recommendation={recommendationFor(details.id)!} />
            ) : (
              <p style={{ color: '#64748b', fontSize: 12.5, margin: 0 }}>Not in the current top recommendations for this campaign.</p>
            )}

            {/* What this creates */}
            <div style={sec}>What this creates</div>
            <p style={{ color: '#334155', fontSize: 13, margin: 0 }}>{whatThisCreates(details)}</p>

            {/* Rendering Details (technical) */}
            <div style={sec}>Rendering Details</div>
            <DetailRow k="Template" v={details.name} />
            <DetailRow k="Template id" v={details.id} />
            <DetailRow k="Internal category" v={details.category} />
            <DetailRow k="Asset family" v={dd.family} />
            {dd.layout ? <DetailRow k="Layout" v={dd.layout} /> : null}
            {dd.attachmentMode ? <DetailRow k="Attachment mode" v={dd.attachmentMode} /> : null}
            {dd.purposeKey ? <DetailRow k="Purpose" v={dd.purposeKey} /> : null}
            {dd.writerAssetType ? <DetailRow k="Renderer lane" v={dd.writerAssetType} /> : null}
            {dd.slideCountOptions ? <DetailRow k="Slide options" v={dd.slideCountOptions.join(' / ')} /> : null}
            {dd.sectionMin != null ? <DetailRow k="Sections" v={`${dd.sectionMin}–${dd.sectionMax}`} /> : null}
            <DetailRow k="CTA" v={dd.hasCTA ? 'Available' : 'None'} />

            {/* Template Fields */}
            <div style={sec}>Template fields</div>
            <DetailRow k="Fields" v={describeFields(details)} />

            {/* Style Variant */}
            <div style={sec}>Style variant</div>
            <DetailRow k="Variant" v={variantLabel(templateVariantKey(details))} />
            <DetailRow k="Visual language" v={`${details.visualLanguage.densityBias ?? '—'} · ${details.visualLanguage.typographyWeight ?? '—'} · ${details.visualLanguage.brandingIntensity ?? '—'}`} />

            {/* Version */}
            <div style={sec}>Version</div>
            <DetailRow k="Current version" v={`v${details.version}`} />
            {dm.updatedAt ? <DetailRow k="Updated" v={String(dm.updatedAt).slice(0, 10)} /> : null}

            {/* Operational Status */}
            <div style={sec}>Operational status</div>
            {details.ownership === 'user' ? (
              <>
                <DetailRow k="Status" v={String(dm.status ?? 'draft')} />
                <TemplateDiagnosticSummary template={details} />
              </>
            ) : (
              <DetailRow k="Status" v="System template · always active" />
            )}

            <div style={sec}>You may also like</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 2 }}>
              {relatedTemplates(details, all, 4).map((r) => (
                <button key={r.id} type="button" onClick={() => setDetailsId(r.id)} style={{ textAlign: 'left', cursor: 'pointer', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{r.category}</div>
                </button>
              ))}
            </div>
            <button type="button" style={{ ...useBtn, marginTop: 16, width: '100%', justifyContent: 'center' }} onClick={() => chooseTemplate(details)}>
              <Check size={16} /> Use this template
            </button>
          </Drawer>
          );
        })()
      ) : null}

      {/* CREATOR-006 — Content Blueprint (after choosing, before the editor) */}
      {blueprintFor ? (
        <TemplateBlueprintModal
          template={blueprintFor}
          onContinue={() => continueFromBlueprint(blueprintFor)}
          onSkip={() => skipBlueprintForever(blueprintFor)}
          onClose={() => setBlueprintFor(null)}
        />
      ) : null}

      {/* CREATOR-007 — Content Ingestion (Blueprint → Ingestion → Review) */}
      {ingestFor ? (
        <ContentIngestionModal
          template={ingestFor}
          onContinue={(res) => continueFromIngestion(ingestFor, res)}
          onSkip={() => startBlankEditor(ingestFor)}
          onClose={() => setIngestFor(null)}
        />
      ) : null}

      {/* CREATOR-008 — Content Readiness Review (Ingestion → Review → editor) */}
      {reviewFor ? (
        <ReadinessReviewModal
          template={reviewFor.template}
          ingestion={reviewFor.ingestion}
          onContinue={() => continueFromReview(reviewFor.template)}
          onBack={() => backToIngestion(reviewFor.template)}
          onClose={() => setReviewFor(null)}
        />
      ) : null}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

