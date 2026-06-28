import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Check, Star, Search as SearchIcon, Layers, X } from 'lucide-react';
import { useCompanyContext } from '../../../../components/CompanyContext';
import PageLoader from '../../../../components/PageLoader';
import {
  familyForCreatorType,
  listTemplatesForFamily,
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
function outcomeTitle(t: CreatorTemplate): string {
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
    const restored = fromUrl ?? readSel(type);
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
        setSelectedId((prev) => { if (prev) return prev; writeSel(type, d.template.id); markSource('user'); return d.template.id; });
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
    const pool = [...listTemplatesForFamily(family), ...userTemplates];
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
  const merged = [...listTemplatesForFamily(family), ...userTemplates];
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

function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
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
function CompareView({ templates, recommendationFor, recommendedId, onUse, onClose }: {
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
function TemplateBlueprintModal({ template, onContinue, onSkip, onClose }: {
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
function ContentIngestionModal({ template, onContinue, onSkip, onClose }: {
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
function ReadinessReviewModal({ template, ingestion, onContinue, onBack, onClose }: {
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

function FilterSelect({ label, value, onChange, options, format }: { label: string; value: string; onChange: (v: string) => void; options: string[]; format?: (o: string) => string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      style={{ background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', color: value ? '#0f172a' : '#64748b', fontSize: 13 }}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
    </select>
  );
}

function CategoryTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: '6px 14px', borderRadius: 999, border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`, background: active ? '#2563eb' : '#ffffff', color: active ? '#fff' : '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{label}</button>;
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><span style={{ color: '#64748b', flexShrink: 0 }}>{k}</span><span style={{ color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>{v}</span></div>;
}
function describeFields(t: CreatorTemplate): string {
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
function PreviewStatusBadge({ template, large }: { template: CreatorTemplate; large?: boolean }) {
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
function BlueprintStrip({ template, large }: { template: CreatorTemplate; large?: boolean }) {
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
function TemplateDiagnosticSummary({ template }: { template: CreatorTemplate }) {
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
function MultiOutcomePreview({ template, large, continuity }: { template: CreatorTemplate; large?: boolean; continuity?: ContinuityStyle }) {
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
type ContinuityStyle = 'wave' | 'panorama' | 'connectors' | 'progress' | 'numbered' | 'standalone';
const CONTINUITY_OPTIONS: { id: ContinuityStyle; label: string; hint: string }[] = [
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

function TemplatePreview({ template, large, sample, continuity }: { template: CreatorTemplate; large?: boolean; sample?: PreviewSampleContent; continuity?: ContinuityStyle }) {
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

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 };
const useBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 13px', cursor: 'pointer', fontWeight: 700, fontSize: 12.5 };
const ghostBtn: React.CSSProperties = { background: '#ffffff', color: '#334155', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 11px', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 };
const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 };
function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 14px', borderRadius: 999, border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`, background: active ? '#2563eb' : '#ffffff', color: active ? '#fff' : '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
}

/** Deterministic style similarity to an anchor template (Continue Your Style). */
function styleScore(t: CreatorTemplate, anchor: CreatorTemplate): number {
  let s = 0;
  if (t.visualLanguage.densityBias === anchor.visualLanguage.densityBias) s += 2;
  if (t.visualLanguage.typographyWeight === anchor.visualLanguage.typographyWeight) s += 1;
  if (t.visualLanguage.brandingIntensity === anchor.visualLanguage.brandingIntensity) s += 1;
  if (t.category === anchor.category) s += 1;
  return s;
}

function RecRail({ title, items, onUse, onDetails, continuity }: { title: string; items: CreatorTemplate[]; onUse: (t: CreatorTemplate) => void; onDetails: (id: string) => void; continuity?: ContinuityStyle }) {
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

const ctrl: React.CSSProperties = { background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', color: '#111827', fontSize: 12.5, minWidth: 170 };
const chip: React.CSSProperties = { fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '3px 9px' };

