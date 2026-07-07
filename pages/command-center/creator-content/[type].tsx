import React from 'react';
import { useRouter } from 'next/router';
import { Calendar, Send } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import { launchSocialPostingFromContent } from '../../../lib/content/socialPosting';
import { buildCreatorContentBlocks, launchBlogFromCreator } from '../../../lib/content/creatorContentBridge';
import { buildCreatorFlowContext, serializeCreatorFlowContext, type CreatorFlowContext } from '../../../lib/content/creatorFlowContext';
import { appendCreatorVisualReviewCandidate } from '../../../lib/content/creatorVisualReview';
import { openCreatorEditor } from '../../../lib/content/openCreatorEditor';
import {
  type CreatorAssetLaunchType,
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../../../lib/content/writerCreatorAssetLaunch';
import {
  loadAttachmentSession,
  attachAssetToSession,
  resolveReturnDestination,
} from '../../../lib/content/creatorAttachmentSession';
import { generateCreatorAssetId } from '../../../lib/content/creatorAssetIdFactory';
import { readMarketingBrief, MARKETING_BRIEF_SESSION_KEY } from '../../../lib/content/marketingBriefResolver';
import type { MarketingBrief } from '../../../lib/content/unifiedCreationModel';
import {
  buildAssetCompositionIntent,
  normalizeAttachmentMode,
  normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType,
  validateAttachmentPayload,
  type AssetCompositionIntent,
  type AttachmentMode,
  type WriterCreatorAssetType,
} from '../../../lib/content/writerCreatorAttachmentContracts';
// Variant Experience Embedding — drop-in CTA + winner display + fan-out runner.
// All additions are gated on the resolved strategy id being non-null
// (i.e. the operator has selected a known subtype). Legacy single-
// variant generation flows continue working byte-identically when no
// variant is pinned (the planner default is V1 baseline).
import { VariantExperienceEntryCard } from '../../../components/variant-experience/VariantExperienceEntryCard';
import { VariantWinnerCard } from '../../../components/variant-experience/VariantWinnerCard';
import { VariantPreviewGrid } from '../../../components/variant-experience/VariantPreviewGrid';
import { useSharedStrategyAnalytics } from '../../../components/variant-experience/VariantContexts';
import type { VariantExecutionResult, VariantFamily } from '../../../components/variant-experience/useVariantApi';
import {
  decodeVariantQuery,
  resolveCreatorStrategyId,
  type CreatorTypeForVariant,
} from '../../../lib/variants/creatorStrategyMapping';
import { runVariantFanOut } from '../../../lib/variants/fanOutRunner';
import { resolvePurposeStrategy } from '../../../backend/services/creator/purposeStrategyRegistry';
// Creator Template Foundation — template-driven form + generation inputs.
// All additions are gated on an active template resolved from
// ?template_id=…; with no template_id the page behaves byte-identically.
import TemplateFieldsPanel, { type TemplateAiAssistContext } from '../../../components/creator/TemplateFieldsPanel';
import {
  freshSyncState,
  markManual,
  editorLeadValue,
  planBriefEditorSync,
  type BriefEditorSyncState,
} from '../../../lib/content/creatorBriefEditorSync';
// Quality Inspector — read-only display of the attached creator_diagnostic_report.
import CreatorQualityInspector from '../../../components/creator/CreatorQualityInspector';
import type { CreatorDiagnosticReport } from '../../../backend/services/creator/creatorDiagnosticReport';
import {
  getTemplateById,
  familyForCreatorType,
  resolveTemplateCreatorCardPatch,
  creatorIngestPrefillKey,
  buildGenerationReview,
  buildCreatorCampaignPackage,
  type CreatorTemplate,
} from '../../../lib/creator-templates';
import GenerationReviewPanel from '../../../components/creator/GenerationReviewPanel';
import AssetReviewPanel from '../../../components/creator/AssetReviewPanel';
import CampaignPackagePanel from '../../../components/creator/CampaignPackagePanel';
import {
  type TemplateFieldValues,
  initTemplateValues,
  applyTemplateFieldUpdates,
  projectImageOverlayText,
  projectCarouselSlides,
  projectInfographicSections,
} from '../../../lib/creator-templates/values';
// CREATOR-PROD-005 — flag-gated deterministic runtime (ON drives the payload;
// OFF, the default, keeps the legacy projectors untouched → instant rollback).
import { creatorRuntimeV2Live } from '../../../lib/creator-templates/creatorRuntimeFlag';
import { runCreatorRuntimeV2 } from '../../../lib/creator-templates/creatorRuntimeV2';

type CreatorTypeId =
  | 'carousel'
  | 'image'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider'
  | 'post'
  | 'thread'
  | 'video'
  | 'reel'
  | 'short'
  | 'podcast'
  | 'story';

const GUIDANCE_ONLY_TYPES: CreatorTypeId[] = ['video', 'reel', 'short', 'podcast'];

function isGuidanceOnlyType(type: CreatorTypeId | null): boolean {
  return Boolean(type && GUIDANCE_ONLY_TYPES.includes(type));
}

type ChoiceOption = {
  value: string;
  label: string;
  description: string;
};

type WorkflowField =
  | { id: string; label: string; placeholder: string; rows?: number; kind: 'text' | 'textarea'; presets?: ReadonlyArray<string> }
  | { id: string; label: string; kind: 'single-select'; options: ChoiceOption[] };

const DEFAULT_CTA_PRESETS: ReadonlyArray<string> = [
  'Learn more',
  'Book a demo',
  'Sign up',
  'Get started',
  'Try it free',
  'Subscribe',
  'Contact us',
  'Shop now',
];

/**
 * Operator feedback: every field should offer a starter chip the
 * operator can click to begin. Sentence-derived suggestions only fire
 * when a writer source / typed body exists; this static fallback
 * guarantees chips appear from the very first render on a blank page.
 *
 * Keyed by content type → field id → 4–6 example chips. Field IDs
 * cover both the overlay text panel (hook / headline / supportingText
 * / keyInsight) and the free-form question rows below (topic /
 * audience / keyMessage / dataPoints / refinement / objective).
 *
 * Generic enough to be a non-presumptuous starting point yet specific
 * enough that the operator can pick one and refine. When the operator
 * later types content, the live sentence-derived chips re-rank
 * everything; the starters drop down the list naturally.
 */
const STARTER_CHIPS_BY_CONTENT_TYPE: Record<string, Record<string, ReadonlyArray<string>>> = {
  infographic: {
    hook: [
      'Stop scrolling',
      'Here is the truth',
      'The one thing about this',
      'What most teams miss',
      'Read this in 30 seconds',
    ],
    headline: [
      'The complete breakdown',
      'A clearer way to think about this',
      'Five steps that change everything',
      'What the data actually says',
      'Why this matters now',
    ],
    supportingText: [
      'Backed by real customer data',
      'Used by leading teams',
      'Built for clarity, not noise',
      'A practical view for operators',
    ],
    keyInsight: [
      'The pattern that ties it all together',
      'One insight that reframes the question',
      'The non-obvious answer to a familiar problem',
    ],
    topic: [
      'Customer acquisition funnel breakdown',
      'Decision framework for X',
      'Process map of [workflow]',
      'ROI of [investment] in 5 stats',
      'Comparison of [option A] vs [option B]',
    ],
    audience: [
      'Operations leaders',
      'Founders and early-stage CEOs',
      'Marketing teams driving growth',
      'Mid-market buyers evaluating tools',
    ],
    keyMessage: [
      'The clearest path from problem to outcome',
      'A simple framework that compresses complexity',
      'What changes when you adopt this approach',
    ],
    dataPoints: [
      '3 stats + 2 process steps + 1 takeaway',
      'Stat → context → action (per section)',
      'Before vs after comparison rows',
      'Phase 1 → 2 → 3 milestones with owners',
    ],
    refinement: [
      'Keep it minimal — no decorative noise',
      'High contrast, dense data tables ok',
      'Brand-first palette; no rainbow gradients',
      'One concept per section, generous spacing',
    ],
  },
  carousel: {
    hook: [
      'Stop scrolling — this matters',
      'A different take on a tired topic',
      'The first slide nobody tells you',
      'If you only swipe one slide today',
    ],
    headline: [
      'Five lessons in five slides',
      'The framework, broken down',
      'What we learned the hard way',
      'A clearer way to think about this',
    ],
    supportingText: [
      'From real teams, real outcomes',
      'Built from customer interviews',
      'A practical 5-step view',
    ],
    keyInsight: [
      'The pattern across every success story',
      'One insight that changes everything',
      'What experts skip but matters most',
    ],
    topic: [
      'Lessons from a recent customer story',
      '5-step framework for [outcome]',
      'Before/after of [transformation]',
      'Common myth + the real answer',
    ],
    audience: [
      'B2B buyers evaluating tools',
      'Marketing leaders driving pipeline',
      'Operators looking for clarity',
    ],
    keyMessage: [
      'The shift in thinking that unlocks results',
      'One reframe, five concrete next steps',
    ],
  },
  image: {
    hook: [
      'Stop the scroll',
      'A single thought that lands',
      'The one image they will remember',
    ],
    headline: [
      'A bold statement worth saving',
      'The thesis in one line',
    ],
    supportingText: [
      'Backed by [proof point]',
      'Built for [audience]',
    ],
    keyInsight: [
      'The reframe that matters',
      'A single takeaway worth holding',
    ],
    topic: [
      'A bold claim about [topic]',
      'A counter-intuitive truth',
      'A clear statement of position',
    ],
    audience: [
      'Decision-makers evaluating options',
      'Practitioners deep in execution',
    ],
    keyMessage: [
      'The single sentence that captures the idea',
    ],
  },
  banner: {
    headline: [
      'A bold offer headline',
      'The clearest value statement',
      'What this campaign promises',
    ],
    supportingText: [
      'Built for high-intent traffic',
      'A short proof line that lands',
    ],
  },
  brand_card: {
    headline: [
      'Who we are, in one line',
      'What we stand for',
    ],
    supportingText: [
      'A founder note that builds trust',
    ],
  },
};

/**
 * Returns starter chips for a given content type + field id.
 * Returns an empty array when no starters are defined for that
 * combination — callers can safely concatenate without null-guarding.
 */
function getStarterChips(contentType: string | undefined, fieldId: string): readonly string[] {
  const ct = String(contentType || '').toLowerCase();
  return STARTER_CHIPS_BY_CONTENT_TYPE[ct]?.[fieldId] ?? [];
}

type WorkflowConfig = {
  title: string;
  contentType: string;
  intro: string;
  subtypeLabel: string;
  subtypeOptions: ChoiceOption[];
  fields: WorkflowField[];
  primaryPlatforms: string[];
};

const SOCIAL_CREATIVE_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'reddit'];

const EMPTY_OVERLAY_TEXT: WriterOverlayText = {
  hook: '',
  headline: '',
  keyInsight: '',
  cta: '',
  supportingText: '',
};

/**
 * Auto-fill the overlay-text panel (hook / headline / supportingText / keyInsight)
 * from imported source content — a campaign post or Writer document — so a
 * campaign-generated image opens ALREADY POPULATED from the campaign theme rather
 * than blank. Mirrors the ranking + one-sentence-per-field allocation used by the
 * live suggestion chips (`overlayFieldSuggestions`), but returns a single best value
 * per field. Real content only (no generic starter chips): a field the body can't
 * fill stays empty, except hook/headline which fall back to the source title. The
 * operator can still edit or swap any field via the chips. overlayText feeds the
 * generation payload directly, so this changes the rendered image, not just the UI.
 */
function deriveOverlayFromContent(title: string, body: string): WriterOverlayText {
  const limits = { hook: 76, headline: 84, keyInsight: 132, supportingText: 96 } as const;
  const compact = (raw: string, max: number): string => {
    const single = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!single) return '';
    return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  };
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanTitle = String(title || '').trim();

  const sentences = String(body || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.replace(/^[\-*\d.)\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 18 && /[A-Za-z]/.test(s));

  const PROOF_KEYWORDS = /\b(proof|trust|built|backed|teams|customers|data|result|outcome|measur|evidence|clarity|insight|because|reason)\b/i;
  const hookCandidates = sentences.filter((s) => s.length <= 110).sort((a, b) => a.length - b.length);
  const supportingCandidates = sentences
    .map((s) => ({ s, score: (PROOF_KEYWORDS.test(s) ? 1 : 0) + (s.length >= 40 && s.length <= 120 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.s);
  const insightCandidates = sentences.filter((s) => s.length >= 40).sort((a, b) => Math.min(b.length, 132) - Math.min(a.length, 132));

  // Each sentence is claimed by at most one field, priority hook → supporting → keyInsight,
  // so the three body-derived fields never restate the same sentence (headline uses the title).
  const claimed = new Set<string>();
  const take = (candidates: string[], max: number): string => {
    for (const s of candidates) {
      const k = normalize(s);
      if (!k || claimed.has(k)) continue;
      const v = compact(s, max);
      if (!v) continue;
      claimed.add(k);
      return v;
    }
    return '';
  };

  const hook = take(hookCandidates, limits.hook) || compact(cleanTitle, limits.hook);
  const headline = compact(cleanTitle, limits.headline) || take(sentences, limits.headline);
  const supportingText = take(supportingCandidates, limits.supportingText);
  const keyInsight = take(insightCandidates, limits.keyInsight);

  return { hook, headline, keyInsight, cta: '', supportingText };
}

function isSocialCreativeType(type: CreatorTypeId | null): boolean {
  return type === 'image' || type === 'banner' || type === 'infographic';
}

function isDeterministicStructuredType(type: CreatorTypeId | null): boolean {
  return type === 'carousel' || type === 'pdf' || type === 'slider';
}

// Note: `banner` and `slider` are intentionally absent from this map
// after the taxonomy consolidation. They remain in CreatorTypeId only
// so the URL-alias redirect effect at the top of CreatorTypeWorkflowPage
// can detect them and redirect to image/carousel with the appropriate
// layout pre-selected. Their old generation behavior is preserved via
// the layout selector + content_type override in handleGenerate.
const WORKFLOW_CONFIG: Partial<Record<CreatorTypeId, WorkflowConfig>> = {
  carousel: {
    title: 'Carousel',
    contentType: 'carousel',
    intro: 'Pick the carousel style first, set the core direction, and let AI turn that into a structured creator asset.',
    // Taxonomy consolidation: Slider is now a Carousel layout
    // (widescreen-presentation) rather than a separate creator type.
    // Style is the primary intent selector; Layout below controls
    // aspect ratio + presentation typography. See PHASE 5.
    subtypeLabel: 'What style of carousel do you want to create?',
    subtypeOptions: [
      { value: 'educational-carousel', label: 'Educational', description: 'Teach a concept through a clear slide-by-slide sequence.' },
      { value: 'framework-carousel', label: 'Framework', description: 'Present a model, process, or repeatable structure.' },
      { value: 'story-carousel', label: 'Story', description: 'Narrative arc across slides — hook, journey, resolution.' },
      { value: 'product-showcase-carousel', label: 'Product Showcase', description: 'Walk through product features, scenes, or benefits slide-by-slide.' },
      { value: 'presentation-carousel', label: 'Presentation', description: 'Pitch / deck format — best paired with the Widescreen layout below.' },
    ],
    primaryPlatforms: ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'reddit', 'pinterest'],
    fields: [
      { id: 'topic', label: 'What is the carousel about?', placeholder: 'Main topic, offer, framework, or idea', kind: 'text' },
      {
        // Layout selector. `widescreen-presentation` maps to the
        // existing slider render preset (1600x900, larger body font,
        // deck-style typography) — wired in handleGenerate where
        // content_type is overridden to 'slider'. No new renderer.
        id: 'layout',
        label: 'What layout do you want?',
        kind: 'single-select',
        options: [
          { value: 'standard', label: 'Standard Carousel', description: 'Square slide canvas optimized for feeds — Instagram, LinkedIn, Facebook.' },
          { value: 'widescreen-presentation', label: 'Widescreen Presentation', description: 'Deck-style 16:9 slides with larger presentation typography — pitches, talks, summaries.' },
        ],
      },
      {
        id: 'objective',
        label: 'What should this asset achieve?',
        kind: 'single-select',
        options: [
          { value: 'awareness', label: 'Awareness', description: 'Create visibility and top-of-funnel interest.' },
          { value: 'education', label: 'Education', description: 'Help the audience understand something clearly.' },
          { value: 'conversion', label: 'Conversion', description: 'Guide the audience toward a CTA or next step.' },
        ],
      },
      {
        id: 'continuity',
        label: 'How should continuity feel across slides?',
        kind: 'single-select',
        options: [
          { value: 'narrative-flow', label: 'Narrative Flow', description: 'Each slide should lead naturally into the next.' },
          { value: 'modular-consistent', label: 'Modular + Consistent', description: 'Each slide stands alone but still feels unified.' },
          { value: 'progressive-build', label: 'Progressive Build', description: 'The structure should grow in intensity or depth.' },
        ],
      },
      {
        id: 'visualSystem',
        label: 'What should create visual continuity?',
        kind: 'single-select',
        options: [
          { value: 'color-system', label: 'Color System', description: 'Continuity should come mainly through color progression.' },
          { value: 'layout-system', label: 'Layout System', description: 'Continuity should come through repeated structure and layout.' },
          { value: 'shape-motif', label: 'Shape Motif', description: 'Continuity should come through recurring visual forms or texture.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment or buyer profile', kind: 'text' },
      { id: 'keyMessage', label: 'What is the key message?', placeholder: 'What should the audience remember most?', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should the audience take?', placeholder: 'Desired CTA', kind: 'text' },
      { id: 'refinement', label: 'Anything specific you want AI to keep in mind?', placeholder: 'Optional constraints, ideas, or creative notes', rows: 3, kind: 'textarea' },
    ],
  },
  image: {
    title: 'Image',
    contentType: 'image',
    intro: 'Choose the image purpose first, then guide AI with a few structured inputs so it can propose the right visual direction.',
    // Taxonomy consolidation: Banner is now an Image layout (wide-banner)
    // rather than a separate creator type. Purpose is the primary intent
    // selector (was "subtype" in the prior shape); Layout below controls
    // aspect ratio + render preset. See PHASE 2 of the consolidation report.
    subtypeLabel: 'What is the purpose of this image?',
    subtypeOptions: [
      { value: 'promotional-image', label: 'Promotional', description: 'Highlight an offer, announcement, or launch message.' },
      { value: 'educational-image', label: 'Educational', description: 'Present one clear concept in a static visual format.' },
      { value: 'quote-image', label: 'Quote Image', description: 'Turn one memorable line into a strong static visual.' },
      { value: 'product-showcase-image', label: 'Product Showcase', description: 'Highlight a product feature, hero, or detail with focused framing.' },
      { value: 'brand-focus-image', label: 'Brand Focus', description: 'Polished brand statement, manifesto, or authority frame.' },
    ],
    primaryPlatforms: SOCIAL_CREATIVE_PLATFORMS,
    fields: [
      { id: 'topic', label: 'What is the image about?', placeholder: 'Topic, offer, message, or announcement', kind: 'text' },
      {
        // Layout selector. `wide-banner` maps to the existing banner
        // render preset (1600x900, larger headline + logo, tighter
        // LinkedIn panel) — wired in handleGenerate where content_type
        // is overridden to 'banner'. No new renderer is created.
        id: 'layout',
        label: 'What layout do you want?',
        kind: 'single-select',
        options: [
          { value: 'square', label: 'Square', description: 'Balanced 1:1 canvas — Instagram, Facebook, multi-platform.' },
          { value: 'portrait', label: 'Portrait', description: 'Tall 4:5 canvas — Instagram, Pinterest, vertical mobile.' },
          { value: 'landscape', label: 'Landscape', description: 'Wide 16:9 canvas — LinkedIn, X, Reddit feeds.' },
          { value: 'wide-banner', label: 'Wide Banner', description: 'Promotional 16:9 hero with elevated typography + larger brand mark.' },
        ],
      },
      {
        id: 'objective',
        label: 'What should the image achieve?',
        kind: 'single-select',
        options: [
          { value: 'attention', label: 'Grab Attention', description: 'Stop the scroll quickly with a sharp visual hook.' },
          { value: 'clarity', label: 'Create Clarity', description: 'Help the audience understand one message immediately.' },
          { value: 'conversion', label: 'Drive Action', description: 'Push the audience toward a next step or CTA.' },
        ],
      },
      {
        id: 'density',
        label: 'How should the design feel?',
        kind: 'single-select',
        options: [
          { value: 'minimal', label: 'Minimal', description: 'Clean, spacious, and highly focused.' },
          { value: 'balanced', label: 'Balanced', description: 'A moderate amount of content with clear hierarchy.' },
          { value: 'dense', label: 'Dense', description: 'More explanatory and information-forward.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'What visual personality fits best?',
        kind: 'single-select',
        options: [
          { value: 'premium', label: 'Premium', description: 'Polished, elevated, and brand-led.' },
          { value: 'bold', label: 'Bold', description: 'High-contrast, assertive, and attention-seeking.' },
          { value: 'editorial', label: 'Editorial', description: 'Structured, thoughtful, and content-led.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the main message?', placeholder: 'Single message or takeaway', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should the viewer take?', placeholder: 'Desired CTA', kind: 'text', presets: DEFAULT_CTA_PRESETS },
    ],
  },
  // banner entry removed — see consolidation note above WORKFLOW_CONFIG.
  // Authoring URL /command-center/creator-content/banner is redirected
  // to /command-center/creator-content/image?layout=wide-banner.
  infographic: {
    title: 'Infographic',
    contentType: 'infographic',
    intro: 'Choose the infographic pattern first, then let AI shape the structure, clarity, and information hierarchy around it.',
    subtypeLabel: 'What kind of infographic do you want to create?',
    subtypeOptions: [
      { value: 'process-infographic', label: 'Process', description: 'Explain a step-by-step process or workflow.' },
      { value: 'stats-infographic', label: 'Stats', description: 'Turn data points or metrics into visual understanding.' },
      { value: 'framework-infographic', label: 'Framework', description: 'Present a model, system, or structured concept.' },
    ],
    primaryPlatforms: [...SOCIAL_CREATIVE_PLATFORMS, 'pinterest'],
    fields: [
      { id: 'topic', label: 'What is the infographic about?', placeholder: 'Topic, process, data, or framework', kind: 'text' },
      {
        id: 'objective',
        label: 'What should it help the audience do?',
        kind: 'single-select',
        options: [
          { value: 'understand-fast', label: 'Understand Fast', description: 'Compress complexity into a quick visual explanation.' },
          { value: 'remember-better', label: 'Remember Better', description: 'Improve recall through visual structure and hierarchy.' },
          { value: 'share-insight', label: 'Share Insight', description: 'Make the content easy to repurpose and distribute.' },
        ],
      },
      {
        id: 'structureMode',
        label: 'How should the information be organized?',
        kind: 'single-select',
        options: [
          { value: 'stats', label: 'Statistics', description: 'Metric-led sections with compact proof points.' },
          { value: 'process', label: 'Process', description: 'Linear, sequential explanation.' },
          { value: 'timeline', label: 'Timeline', description: 'Chronological sequence with clear stages.' },
          { value: 'comparison', label: 'Comparison', description: 'Side-by-side understanding or contrast.' },
          { value: 'framework', label: 'Framework', description: 'Grouped modules with clear separation.' },
          { value: 'roadmap', label: 'Roadmap', description: 'Milestone-anchored plan or phased outlook — internally generated as a timeline with phase labels.' },
        ],
      },
      { id: 'audience', label: 'Who is it for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What core message should it communicate?', placeholder: 'Main explanation or takeaway', rows: 3, kind: 'textarea' },
      { id: 'dataPoints', label: 'What points, stats, or sections should it include?', placeholder: 'List the sections or information blocks', rows: 4, kind: 'textarea' },
      { id: 'refinement', label: 'Any design constraints or preferences?', placeholder: 'Optional notes on hierarchy, density, or style', rows: 3, kind: 'textarea' },
    ],
  },
  pdf: {
    title: 'PDF',
    contentType: 'pdf',
    intro: 'Select the kind of PDF asset first, then let AI turn that into a clear section structure, creative direction, and packaging.',
    subtypeLabel: 'What kind of PDF do you want to create?',
    subtypeOptions: [
      { value: 'lead-magnet-pdf', label: 'Lead Magnet', description: 'A downloadable resource designed for value and capture.' },
      { value: 'authority-pdf', label: 'Authority Asset', description: 'A polished document that builds trust and expertise.' },
      { value: 'explanatory-pdf', label: 'Explainer', description: 'A structured document that clarifies one idea or offer.' },
    ],
    primaryPlatforms: ['linkedin'],
    fields: [
      { id: 'topic', label: 'What is the PDF about?', placeholder: 'Theme, topic, offer, or thesis', kind: 'text' },
      {
        id: 'objective',
        label: 'What should this PDF achieve?',
        kind: 'single-select',
        options: [
          { value: 'education', label: 'Education', description: 'Teach or explain something in a structured way.' },
          { value: 'authority', label: 'Authority', description: 'Build trust, depth, and perceived expertise.' },
          { value: 'lead-generation', label: 'Lead Generation', description: 'Support capture or conversion around a valuable asset.' },
        ],
      },
      {
        id: 'structureMode',
        label: 'How should the document feel?',
        kind: 'single-select',
        options: [
          { value: 'modular-sections', label: 'Modular Sections', description: 'Separate sections with strong clarity and scanning.' },
          { value: 'narrative-document', label: 'Narrative Document', description: 'A more progressive, story-like flow.' },
          { value: 'executive-brief', label: 'Executive Brief', description: 'A concise, high-signal, decision-maker format.' },
        ],
      },
      { id: 'audience', label: 'Who is it for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What should the PDF communicate?', placeholder: 'Central thesis or takeaway', rows: 3, kind: 'textarea' },
      { id: 'sectionDirection', label: 'What sections should it contain?', placeholder: 'Suggested section flow or outline', rows: 4, kind: 'textarea' },
      { id: 'cta', label: 'What CTA should it end with?', placeholder: 'Desired CTA', kind: 'text' },
    ],
  },
  // slider entry removed — see consolidation note above WORKFLOW_CONFIG.
  // Authoring URL /command-center/creator-content/slider is redirected to
  // /command-center/creator-content/carousel?layout=widescreen-presentation.
  post: {
    title: 'Post',
    contentType: 'post',
    intro: 'Create platform-ready post copy with structured direction, optional brand context, and optional reusable asset support.',
    subtypeLabel: 'What kind of post do you want to create?',
    subtypeOptions: [
      { value: 'authority-post', label: 'Authority', description: 'Share a strong point of view or expert insight.' },
      { value: 'educational-post', label: 'Educational', description: 'Teach one clear idea with practical value.' },
      { value: 'conversion-post', label: 'Conversion', description: 'Move the audience toward a CTA or next step.' },
    ],
    primaryPlatforms: ['linkedin', 'x', 'facebook', 'threads', 'reddit', 'instagram'],
    fields: [
      { id: 'topic', label: 'What is the post about?', placeholder: 'Topic, offer, announcement, or message', kind: 'text' },
      {
        id: 'assetSubtype',
        label: 'Optional: what asset should support the post?',
        kind: 'single-select',
        options: [
          { value: 'none', label: 'No Asset', description: 'Create copy without asset-specific direction.' },
          { value: 'image', label: 'Image', description: 'Single visual support.' },
          { value: 'carousel', label: 'Carousel', description: 'Multi-slide support.' },
          { value: 'banner', label: 'Banner', description: 'Promotional visual support.' },
          { value: 'infographic', label: 'Infographic', description: 'Visual explainer support.' },
          { value: 'pdf', label: 'PDF', description: 'Document-style support.' },
          { value: 'slider', label: 'Slider', description: 'Presentation-style support.' },
        ],
      },
      {
        id: 'objective',
        label: 'What should this post achieve?',
        kind: 'single-select',
        options: [
          { value: 'awareness', label: 'Awareness', description: 'Make the idea visible and memorable.' },
          { value: 'education', label: 'Education', description: 'Teach the audience one useful idea.' },
          { value: 'conversion', label: 'Conversion', description: 'Move the audience toward a next step.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'What visual personality fits best?',
        kind: 'single-select',
        options: [
          { value: 'premium', label: 'Premium', description: 'Polished, elevated, and brand-led.' },
          { value: 'bold', label: 'Bold', description: 'High-contrast, assertive, and attention-seeking.' },
          { value: 'editorial', label: 'Editorial', description: 'Structured, thoughtful, and content-led.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the main post message?', placeholder: 'Main idea, claim, or angle', rows: 3, kind: 'textarea' },
      { id: 'assetDirection', label: 'Optional asset direction', placeholder: 'Visual idea, proof points, media direction, or leave blank', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should the audience take?', placeholder: 'Desired CTA', kind: 'text' },
    ],
  },
  thread: {
    title: 'Thread',
    contentType: 'thread',
    intro: 'Create a connected thread narrative with structured pacing, optional brand context, and optional reusable asset support.',
    subtypeLabel: 'What kind of thread do you want to create?',
    subtypeOptions: [
      { value: 'authority-thread', label: 'Authority', description: 'Build credibility through a connected point of view.' },
      { value: 'educational-thread', label: 'Educational', description: 'Teach a topic through a clear sequence.' },
      { value: 'launch-thread', label: 'Launch', description: 'Tell a launch, offer, or campaign story.' },
    ],
    primaryPlatforms: ['linkedin', 'x'],
    fields: [
      { id: 'topic', label: 'What is the thread about?', placeholder: 'Topic, thesis, launch, or narrative', kind: 'text' },
      {
        id: 'assetSubtype',
        label: 'Optional: what asset should support the thread?',
        kind: 'single-select',
        options: [
          { value: 'none', label: 'No Asset', description: 'Create the sequence without asset-specific direction.' },
          { value: 'image', label: 'Image', description: 'Single support visual.' },
          { value: 'carousel', label: 'Carousel', description: 'Multi-slide support.' },
          { value: 'banner', label: 'Banner', description: 'Promotional support.' },
          { value: 'infographic', label: 'Infographic', description: 'Visual explainer support.' },
          { value: 'pdf', label: 'PDF', description: 'Document-style support.' },
          { value: 'slider', label: 'Slider', description: 'Presentation-style support.' },
        ],
      },
      {
        id: 'objective',
        label: 'What should this thread achieve?',
        kind: 'single-select',
        options: [
          { value: 'authority', label: 'Authority', description: 'Build credibility and perspective.' },
          { value: 'education', label: 'Education', description: 'Teach through a connected sequence.' },
          { value: 'conversion', label: 'Conversion', description: 'Guide readers toward a clear next step.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'What visual personality fits best?',
        kind: 'single-select',
        options: [
          { value: 'insight-led', label: 'Insight-Led', description: 'Thoughtful, useful, and expertise-forward.' },
          { value: 'story-led', label: 'Story-Led', description: 'Narrative-first with a clear payoff.' },
          { value: 'direct', label: 'Direct', description: 'Crisp, assertive, and action-oriented.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the thread thesis?', placeholder: 'Core argument or story arc', rows: 3, kind: 'textarea' },
      { id: 'assetDirection', label: 'Optional asset direction', placeholder: 'Visual idea, slide flow, proof points, or leave blank', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should readers take?', placeholder: 'Desired CTA', kind: 'text' },
    ],
  },
  video: {
    title: 'Video',
    contentType: 'video',
    intro: 'AI cannot film the video for you, but it can produce a complete theme treatment — hook scene, scene-by-scene direction, audio cues, and CTA — so your team has clear direction to shoot.',
    subtypeLabel: 'What kind of video are you producing?',
    subtypeOptions: [
      { value: 'long-form-narrative', label: 'Long-form narrative', description: 'Multi-minute story, interview, or deep-dive.' },
      { value: 'educational-explainer', label: 'Educational explainer', description: 'Walk-through, tutorial, or concept breakdown.' },
      { value: 'brand-anthem', label: 'Brand anthem', description: 'High-emotion brand spot or manifesto.' },
    ],
    primaryPlatforms: ['youtube', 'linkedin', 'facebook'],
    fields: [
      { id: 'topic', label: 'What is the video about?', placeholder: 'Core narrative, story, or topic', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the video achieve?',
        kind: 'single-select',
        options: [
          { value: 'awareness', label: 'Awareness', description: 'Brand visibility and recall.' },
          { value: 'education', label: 'Education', description: 'Help the viewer understand something deeply.' },
          { value: 'conversion', label: 'Conversion', description: 'Drive a specific action or signup.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'What visual style fits best?',
        kind: 'single-select',
        options: [
          { value: 'cinematic', label: 'Cinematic', description: 'Atmospheric, composed, moody.' },
          { value: 'documentary', label: 'Documentary', description: 'Real, observational, talking-heads.' },
          { value: 'kinetic', label: 'Kinetic', description: 'Fast cuts, energetic motion graphics.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the key takeaway?', placeholder: 'What should viewers remember?', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should viewers take?', placeholder: 'Subscribe, book, learn more, etc.', kind: 'text' },
    ],
  },
  reel: {
    title: 'Reel',
    contentType: 'reel',
    intro: 'AI produces a complete 15–90s reel treatment — pattern-interrupt hook, scene beats with audio cues, CTA — so your team can shoot and edit directly from the brief.',
    subtypeLabel: 'What kind of reel are you producing?',
    subtypeOptions: [
      { value: 'pov-hook', label: 'POV hook', description: 'First-person framing with a contrarian or curiosity hook.' },
      { value: 'tutorial-snippet', label: 'Tutorial snippet', description: 'Tight 3-step how-to with on-screen captions.' },
      { value: 'trend-remix', label: 'Trend remix', description: 'Plug your message into a trending audio or format.' },
    ],
    primaryPlatforms: ['instagram', 'facebook', 'youtube'],
    fields: [
      { id: 'topic', label: 'What is the reel about?', placeholder: 'Hook idea, story, or topic', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the reel achieve?',
        kind: 'single-select',
        options: [
          { value: 'reach', label: 'Reach', description: 'Maximum scroll-stop and shares.' },
          { value: 'education', label: 'Education', description: 'Quick value-driven takeaway.' },
          { value: 'conversion', label: 'Conversion', description: 'Drive a click, follow, or signup.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the one-line idea?', placeholder: 'The single point this reel makes', rows: 2, kind: 'textarea' },
      { id: 'cta', label: 'What action should viewers take?', placeholder: 'Save, follow, link in bio, etc.', kind: 'text' },
    ],
  },
  short: {
    title: 'Short',
    contentType: 'short',
    intro: 'AI produces a YouTube Short / TikTok treatment — 60s scene-by-scene direction with pacing, audio, and on-screen text — ready for your team to shoot.',
    subtypeLabel: 'What kind of short are you producing?',
    subtypeOptions: [
      { value: 'tip-stack', label: 'Tip stack', description: 'Rapid sequence of 3–5 punchy tips.' },
      { value: 'myth-buster', label: 'Myth buster', description: 'Common belief vs. real answer.' },
      { value: 'before-after', label: 'Before / After', description: 'Visible transformation with payoff reveal.' },
    ],
    primaryPlatforms: ['youtube', 'instagram', 'tiktok'],
    fields: [
      { id: 'topic', label: 'What is the short about?', placeholder: 'Hook idea or topic', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the short achieve?',
        kind: 'single-select',
        options: [
          { value: 'reach', label: 'Reach', description: 'Algorithmic scroll-stop and shares.' },
          { value: 'authority', label: 'Authority', description: 'Quickly demonstrate expertise.' },
          { value: 'conversion', label: 'Conversion', description: 'Drive a follow or click-through.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the core takeaway?', placeholder: 'The one thing viewers should leave with', rows: 2, kind: 'textarea' },
      { id: 'cta', label: 'What action should viewers take?', placeholder: 'Subscribe, link in bio, etc.', kind: 'text' },
    ],
  },
  podcast: {
    title: 'Podcast',
    contentType: 'podcast',
    intro: 'AI produces an audio-first episode treatment — hook beat, chapter-by-chapter direction, sonic palette, and CTA — ready for recording.',
    subtypeLabel: 'What kind of episode are you producing?',
    subtypeOptions: [
      { value: 'solo-monologue', label: 'Solo monologue', description: 'Single-host POV episode.' },
      { value: 'interview', label: 'Interview', description: 'Conversation with a guest.' },
      { value: 'narrative', label: 'Narrative', description: 'Story-driven episode with mixed sources.' },
    ],
    primaryPlatforms: ['youtube', 'linkedin'],
    fields: [
      { id: 'topic', label: 'What is the episode about?', placeholder: 'Theme, thesis, or guest angle', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the episode achieve?',
        kind: 'single-select',
        options: [
          { value: 'authority', label: 'Authority', description: 'Establish a clear point of view.' },
          { value: 'education', label: 'Education', description: 'Teach the listener something concrete.' },
          { value: 'community', label: 'Community', description: 'Build listener loyalty and recurrence.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Listener segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the episode thesis?', placeholder: 'The core argument or story', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What action should listeners take?', placeholder: 'Subscribe, share, etc.', kind: 'text' },
    ],
  },
  story: {
    title: 'Story',
    contentType: 'story',
    intro: 'Generate a 9:16 ephemeral story frame — single visual + overlay text — ready to post to Instagram, Facebook, or LinkedIn stories.',
    subtypeLabel: 'What kind of story are you posting?',
    subtypeOptions: [
      { value: 'announcement-story', label: 'Announcement', description: 'Launch, drop, or news flash.' },
      { value: 'behind-scenes', label: 'Behind the scenes', description: 'Process, team, or in-the-moment glimpse.' },
      { value: 'quick-tip', label: 'Quick tip', description: 'One useful insight in a single frame.' },
    ],
    primaryPlatforms: ['instagram', 'facebook', 'linkedin'],
    fields: [
      { id: 'topic', label: 'What is the story about?', placeholder: 'Topic, announcement, or moment', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the story achieve?',
        kind: 'single-select',
        options: [
          { value: 'awareness', label: 'Awareness', description: 'Top-of-feed visibility for 24h.' },
          { value: 'engagement', label: 'Engagement', description: 'Drive replies, polls, taps.' },
          { value: 'conversion', label: 'Conversion', description: 'Drive a swipe-up / link tap.' },
        ],
      },
      { id: 'audience', label: 'Who is this for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the headline message?', placeholder: 'Punchy one-line for the overlay', rows: 2, kind: 'textarea' },
      { id: 'cta', label: 'What action should viewers take?', placeholder: 'Tap link, DM, vote, etc.', kind: 'text' },
    ],
  },
};

type CreatorResult = {
  success: boolean;
  primary_platform: string;
  output: {
    asset_type: string;
    asset_instruction: {
      template_id?: string | null;
      structure?: Record<string, unknown>;
    };
    asset_payload: {
      media_bundle?: {
        url?: string;
        files?: string[];
        metadata?: {
          preview_kind?: string;
          provider_model?: string;
          provider_rendered?: boolean;
          fallback_reason?: string;
          document_url?: string;
          document_fallback_reason?: string;
          /** Part 3 — PDF graceful degradation block. */
          pdf_document_status?: 'available' | 'preview_only';
          pdf_document_fallback_category?: 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error';
          pdf_document_user_message?: string;
          pdf_preview_pages_available?: number;
          width?: number;
          height?: number;
          overlay_quality?: {
            score?: number;
            flags?: string[];
            preset?: string;
          };
          creator_quality_score?: {
            cleanliness?: number;
            readability?: number;
            clutterRisk?: number;
            warnings?: string[];
          };
          visual_governance_warnings?: string[];
        };
      };
      slides?: Array<Record<string, unknown>>;
      caption_blueprint?: { hook?: string; body?: string; cta?: string };
      visual_descriptor?: { headline?: string; visual_description?: string };
    };
    packaging: {
      caption: string;
      hashtags: string[];
      cta: string;
      meta_description: string;
    };
  };
};

type SuggestionOption = {
  id: string;
  label: string;
  summary: string;
  rationale: string;
  badges: string[];
};

type SavedBlockReference = {
  id: string;
  reference: string;
  name: string;
};

/**
 * Canonical resolution of a saved creator asset's image URL(s). Different write
 * paths populate different fields — the `url` column, the `files` column,
 * top-level `metadata.files`, or (legacy Creator flow)
 * `metadata.creator_continuity.files`. The UI reconciles them here in a fixed
 * deterministic priority so historical AND newly generated assets render.
 * Read-only: no write path, storage, or schema is changed.
 */
function resolveSavedAssetMedia(row: Record<string, unknown>): string[] {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
    ? row.metadata as Record<string, unknown>
    : {};
  const continuity = (meta.creator_continuity && typeof meta.creator_continuity === 'object' && !Array.isArray(meta.creator_continuity))
    ? meta.creator_continuity as Record<string, unknown>
    : {};
  const continuityFiles = arr(continuity.files);  // 1. legacy Creator-flow reader path
  if (continuityFiles.length > 0) return continuityFiles;
  const metaFiles = arr(meta.files);               // 2. top-level metadata.files
  if (metaFiles.length > 0) return metaFiles;
  const columnFiles = arr(row.files);              // 3. files column
  if (columnFiles.length > 0) return columnFiles;
  return typeof row.url === 'string' && row.url.trim() ? [row.url.trim()] : [];  // 4. url column
}

type SavedCreatorAsset = {
  id: string;
  name: string;
  description: string | null;
  format_type?: string | null;
  tags: string[];
  usage_count: number;
  created_at?: string;
  /**
   * Canonical resolved image URL(s) for the saved asset. The render/persistence
   * pipeline writes the URL to different places depending on path (the `url`
   * column, the `files` column, or `metadata.files`), while older Creator-flow
   * assets used `metadata.creator_continuity.files`. This field reconciles all
   * of them at read time via a deterministic priority order (see
   * resolveSavedAssetMedia) so every asset — historical or new — renders.
   */
  media_files?: string[];
  /**
   * Continuity metadata surfaced by the saved-templates API. Populated
   * when the saved template was created by the Creator flow; null for
   * legacy / non-Creator templates. Mirrors the
   * `CreatorContinuityMetadata` shape in backend/services/blockTemplateService.
   */
  creator_metadata?: {
    asset_type?:             string | null;
    attachment_mode?:        AttachmentMode | null;
    asset_composition_intent?: Record<string, unknown> | null;
    copy_policy?: Record<string, unknown> | null;
    source_text_transform?: string | null;
    overlay_text?: {
      hook?:           string;
      headline?:       string;
      keyInsight?:     string;
      cta?:            string;
      supportingText?: string;
    } | null;
    subtype?:        string | null;
    brand_mode?:     'brand-aware' | 'independent' | null;
    brand_presence?: 'minimal' | 'balanced' | 'strong' | null;
    platform?:       string | null;
    files?:          string[] | null;
    preview_kind?:   string | null;
    platformContext?: string | null;
    renderIdentityHash?: string | null;
    renderer_metadata?: Record<string, unknown> | null;
    schema_version?: number;
  } | null;
};

type CreatorBrandMode = 'brand-aware' | 'independent';
type BrandPresence = 'minimal' | 'balanced' | 'strong';

type BrandContextSelections = {
  companyContext: boolean;
  logo: boolean;
  favicon: boolean;
  tagline: boolean;
  brandTone: boolean;
  brandColors: boolean;
  audience: boolean;
  campaign: boolean;
};

type CreatorBrandProfile = {
  companyName?: string;
  industry?: string;
  audience?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  tagline?: string;
  brandTone?: string;
  brandColors?: string[];
  campaignAssociation?: string;
  uniqueValue?: string;
  positioning?: string;
};

type RepurposePath = {
  id: 'blog' | 'linkedin-post' | 'thread' | 'blog-section' | 'long-form-outline';
  label: string;
  description: string;
};

const DEFAULT_BRAND_SELECTIONS: BrandContextSelections = {
  companyContext: true,
  logo: true,
  favicon: false,
  tagline: true,
  brandTone: true,
  brandColors: true,
  audience: true,
  campaign: false,
};

type BrandAssetSize = 'small' | 'medium' | 'large';

// Each step up is 80% bigger than the previous: small = 1.0x (current size on
// the rendered asset), medium = 1.8x, large = ~3.24x. The numeric factor is
// surfaced in the brief so the renderer can scale logo / favicon proportionally.
const BRAND_ASSET_SIZE_PRESETS: ReadonlyArray<{ value: BrandAssetSize; label: string; scale: number }> = [
  { value: 'small',  label: 'Small',  scale: 1.0  },
  { value: 'medium', label: 'Medium', scale: 1.8  },
  { value: 'large',  label: 'Large',  scale: 3.24 },
];

const DEFAULT_BRAND_ASSET_SIZE: BrandAssetSize = 'small';

// "Small" is the current rendered baseline per asset class. Medium / large
// derive from this base via the scale factor in BRAND_ASSET_SIZE_PRESETS.
const BRAND_ASSET_BASE_PX: Readonly<Record<'logo' | 'favicon', number>> = {
  logo:    96,
  favicon: 32,
};

function normalizeBrandAssetSize(value: unknown): BrandAssetSize {
  return BRAND_ASSET_SIZE_PRESETS.some((p) => p.value === value)
    ? (value as BrandAssetSize)
    : DEFAULT_BRAND_ASSET_SIZE;
}

function brandAssetSizePx(asset: 'logo' | 'favicon', size: BrandAssetSize): number {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return Math.round(BRAND_ASSET_BASE_PX[asset] * preset.scale);
}

function describeBrandAssetSize(asset: 'logo' | 'favicon', size: BrandAssetSize): string {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return `${preset.label.toLowerCase()} (~${brandAssetSizePx(asset, size)}px on the asset)`;
}

function buildDefaultAnswers(config: WorkflowConfig): Record<string, string> {
  const defaults: Record<string, string> = {
    subtype: config.subtypeOptions[0]?.value || '',
  };
  config.fields.forEach((field) => {
    if (field.kind === 'single-select') {
      defaults[field.id] = field.options[0]?.value || '';
    }
  });
  return defaults;
}

function getCreatorDraftStorageKey(type: CreatorTypeId): string {
  return `creator_flow_draft_${type}`;
}

/**
 * CREATOR-106: seed the editor's text fields from the Marketing Workspace brief so the
 * user doesn't re-enter what they already gave (Who is it for / core message / topic /
 * constraints). Only fields that exist in this asset's config are set, and all stay
 * editable. Lossy by design — the workspace brief is freeform, so structured fields
 * (e.g. dataPoints) seed from the same description and the user refines.
 */
function mapBriefToEditorAnswers(brief: MarketingBrief, config: WorkflowConfig): Record<string, string> {
  const ids = new Set<string>(config.fields.map((f) => f.id));
  const out: Record<string, string> = {};
  const set = (id: string, v: string | null | undefined) => { const t = (v ?? '').trim(); if (t && ids.has(id)) out[id] = t; };
  const message = (brief.freeText ?? '').trim();
  const firstSentence = message ? message.split(/[.!?\n]/)[0].slice(0, 90).trim() : '';

  set('audience', brief.audience);
  set('topic', (brief.offer ?? '').trim() || firstSentence);
  // Core-message style fields across asset types.
  for (const id of ['keyMessage', 'message', 'coreMessage', 'mainMessage', 'headline']) set(id, message);
  set('cta', brief.cta);
  set('offer', brief.offer);
  // NOTE: do NOT seed dataPoints/stats from the freeform brief — the infographic
  // renderer extracts metrics from that field and mangles freeform text (e.g. the
  // year "2026" rendered as a giant "2026B" numeral). Leave it for the user / AI.
  if (brief.tone && ids.has('refinement')) out.refinement = `Tone: ${brief.tone}`;
  set('tone', brief.tone);
  return out;
}

const CREATOR_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const CREATOR_GENERATION_TIMEOUT_MS = 1000 * 90;

function hasUsableCreatorOutput(result: CreatorResult | null): result is CreatorResult {
  return Boolean(
    result?.output &&
    result.output.asset_payload &&
    result.output.packaging &&
    (
      String(result.output.packaging.caption || '').trim() ||
      String(result.output.packaging.meta_description || '').trim() ||
      Array.isArray(result.output.asset_payload.slides)
    ),
  );
}

function summarizeMediaUrls(result: CreatorResult | null): string[] {
  if (!result) return [];
  const mediaBundle = result.output.asset_payload.media_bundle || {};
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : [];
  const url = typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : [];
  return Array.from(new Set([...url, ...files]));
}

function getMediaPreviewMetadata(result: CreatorResult | null) {
  const mediaBundle = result?.output.asset_payload.media_bundle || {};
  return mediaBundle.metadata || {};
}

/** Read-only: extract the deterministic diagnostic report from asset metadata. */
function getDiagnosticReport(result: CreatorResult | null): CreatorDiagnosticReport | null {
  const meta = getMediaPreviewMetadata(result) as Record<string, unknown>;
  const r = meta.creator_diagnostic_report;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as CreatorDiagnosticReport) : null;
}

function pickOptionValue(field: WorkflowField | undefined, candidates: string[]): string | null {
  if (!field || field.kind !== 'single-select') return null;
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
  const match = field.options.find((option) => {
    const haystack = `${option.value} ${option.label} ${option.description}`.toLowerCase();
    return normalizedCandidates.some((candidate) => candidate && haystack.includes(candidate));
  });
  return match?.value || null;
}

function setIfFieldExists(
  config: WorkflowConfig,
  answers: Record<string, string>,
  id: string,
  value?: string | null,
): void {
  if (!value || !config.fields.some((field) => field.id === id)) return;
  answers[id] = value;
}

function splitWriterSourcePoints(source: WriterCreatorSourcePayload): string[] {
  const bodyPoints = String(source.body || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\n{2,}|\n(?=[-*\d])|(?<=[.!?])\s+/)
    .map((segment) => segment.replace(/^[-*\d.)\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length >= 18)
    .slice(0, 5);
  return bodyPoints.slice(0, 7);
}

function buildWriterStructureGuidance(
  source: WriterCreatorSourcePayload,
  creatorType: CreatorTypeId,
): string {
  const points = splitWriterSourcePoints(source);
  const transform = source.compositionIntent.copyPolicy?.sourceTextTransform ?? 'none';
  const isDeck = creatorType === 'carousel' || creatorType === 'slider';
  const opener = source.sourceType === 'thread'
    ? `Transform the imported thread with the ${transform} policy before creating visual structure; do not map raw thread posts directly to slides.`
    : `Transform the imported post with the ${transform} policy before creating visual structure; keep source text outside provider image generation.`;
  const labels = isDeck
    ? ['Hook slide', 'Insight slide', 'Proof slide', 'Action slide', 'Closing slide']
    : ['Title section', 'Context section', 'Insight section', 'Proof section', 'Footer'];
  return [
    opener,
    ...points.map((point, index) => `${labels[index] || `Section ${index + 1}`}: ${point}`),
    creatorType === 'pdf'
      ? 'Render as a downloadable branded insight document, not a raw text dump.'
      : creatorType === 'slider'
        ? 'Render as a lightweight presentation deck with a title slide, section slides, and CTA ending.'
        : 'Render with consistent visual language and transformed source continuity.',
  ].join('\n');
}

function buildCreatorAnswersFromWriterSource(
  config: WorkflowConfig,
  creatorType: CreatorTypeId,
  source: WriterCreatorSourcePayload,
): Record<string, string> {
  const answers: Record<string, string> = {};
  const fieldById = new Map(config.fields.map((field) => [field.id, field]));
  const sourceLabel = source.sourceType === 'thread' ? 'Thread' : 'Post';
  const attachmentMode = source.compositionIntent.attachmentMode;
  const transform = source.compositionIntent.copyPolicy?.sourceTextTransform ?? 'none';
  const snippet = isSocialCreativeType(creatorType)
    ? source.body.slice(0, 360)
    : source.body.slice(0, 700);
  const platform = source.platform || config.primaryPlatforms[0] || 'linkedin';
  const visualPersonality = source.tone || (source.sourceType === 'thread' ? 'editorial' : 'premium');
  const structureGuidance = buildWriterStructureGuidance(source, creatorType);

  setIfFieldExists(config, answers, 'topic', source.title);
  setIfFieldExists(config, answers, 'audience', source.audience || 'Audience from the source content');
  setIfFieldExists(config, answers, 'keyMessage', snippet);
  setIfFieldExists(config, answers, 'headline', source.title);
  setIfFieldExists(config, answers, 'dataPoints', transform === 'none' ? '' : snippet);
  setIfFieldExists(config, answers, 'slideDirection', structureGuidance);
  setIfFieldExists(config, answers, 'sectionDirection', structureGuidance);
  setIfFieldExists(config, answers, 'refinement', [
    `Imported from ${sourceLabel}.`,
    `Platform-aware direction: optimize for ${platform}.`,
    `Attachment mode: ${attachmentMode}.`,
    `Source transform: ${transform}.`,
    attachmentMode === 'supporting_visual'
      ? 'Visual must complement the source without visible text, CTA, paragraph overlays, or thread restatement.'
      : 'Creator layer owns deterministic typography and any embedded copy.',
    structureGuidance,
    source.hashtags?.length ? `Hashtag context: ${source.hashtags.join(' ')}` : '',
  ].filter(Boolean).join('\n'));

  const objective = pickOptionValue(fieldById.get('objective'), [
    source.sourceType === 'thread' ? 'education' : 'attention',
    'clarity',
  ]);
  if (objective) answers.objective = objective;

  const styleDirection = pickOptionValue(fieldById.get('styleDirection'), [
    visualPersonality,
    visualPersonality.toLowerCase().includes('premium') ? 'premium' : '',
    source.sourceType === 'thread' ? 'editorial' : 'bold',
  ]);
  if (styleDirection) answers.styleDirection = styleDirection;

  const hierarchy = pickOptionValue(fieldById.get('hierarchy'), [
    'headline',
  ]);
  if (hierarchy) answers.hierarchy = hierarchy;

  const continuity = pickOptionValue(fieldById.get('continuity'), [
    source.sourceType === 'thread' ? 'narrative' : 'modular',
    'progressive',
  ]);
  if (continuity) answers.continuity = continuity;

  const density = pickOptionValue(fieldById.get('density'), [
    source.sourceType === 'thread' ? 'balanced' : 'minimal',
  ]);
  if (density) answers.density = density;

  const subtype = pickOptionValue({ ...config.subtypeOptions[0], id: 'subtype', label: config.subtypeLabel, kind: 'single-select', options: config.subtypeOptions } as WorkflowField, [
    creatorType === 'carousel' ? 'authority' : '',
    creatorType === 'banner' ? 'promo' : '',
    creatorType === 'infographic' ? 'framework' : '',
    creatorType === 'image' ? 'educational' : '',
  ]);
  if (subtype) answers.subtype = subtype;

  return answers;
}

function humanizeValue(value: string | undefined): string {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function buildBlockReference(templateId: string): string {
  const compact = String(templateId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();
  return compact ? `BLK-${compact}` : 'BLK-PENDING';
}

function getSavedAssetCreatorType(asset: SavedCreatorAsset): string {
  const sourceTag = asset.tags.find((tag) => tag.startsWith('source:'));
  if (sourceTag) return humanizeValue(sourceTag.replace(/^source:/, ''));
  return humanizeValue(asset.format_type || 'creator asset');
}

function getSavedAssetAttachmentLabel(asset: SavedCreatorAsset): string | null {
  const metadata = asset.creator_metadata;
  if (!metadata || metadata.asset_type !== 'image') return null;
  if (metadata.attachment_mode === 'embedded_copy') return 'Text Inside Image';
  if (metadata.attachment_mode === 'supporting_visual') return 'Post + Image';
  return null;
}

function getRepurposePaths(type: CreatorTypeId, assetSubtype?: string): RepurposePath[] {
  if (type === 'carousel') {
    return [
      { id: 'blog', label: 'Carousel -> Blog', description: 'Open this as a long-form blog draft.' },
      { id: 'linkedin-post', label: 'Carousel -> LinkedIn Post', description: 'Use the caption and slide logic as a post.' },
    ];
  }
  if (type === 'infographic') {
    return [
      { id: 'blog-section', label: 'Infographic -> Blog Section', description: 'Turn the visual logic into a reusable article section.' },
      { id: 'linkedin-post', label: 'Infographic -> LinkedIn Post', description: 'Use the insight as a social post.' },
    ];
  }
  if (type === 'post') {
    return [
      { id: 'blog', label: 'Post -> Blog', description: 'Expand the post direction into a blog draft.' },
      { id: 'thread', label: 'Post -> Thread', description: 'Turn the post into a connected sequence.' },
    ];
  }
  if (type === 'thread') {
    return [
      { id: 'blog', label: 'Thread -> Blog', description: 'Expand the thread narrative into a blog draft.' },
      { id: 'linkedin-post', label: 'Thread -> LinkedIn Post', description: 'Condense the sequence into one post.' },
    ];
  }
  if (assetSubtype === 'video' || assetSubtype === 'short' || assetSubtype === 'reel') {
    return [
      { id: 'thread', label: 'Reel Concept -> Thread', description: 'Turn the media concept into a written sequence.' },
      { id: 'long-form-outline', label: 'Video Script -> Long-Form Outline', description: 'Use the production brief as a long-form outline.' },
    ];
  }
  return [
    { id: 'blog-section', label: `${humanizeValue(type)} -> Blog Section`, description: 'Attach this asset as a long-form supporting section.' },
    { id: 'linkedin-post', label: `${humanizeValue(type)} -> LinkedIn Post`, description: 'Use the asset packaging as social copy.' },
  ];
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

function mapCreatorBrandProfile(profile: Record<string, unknown> | null | undefined): CreatorBrandProfile {
  const safeProfile = profile || {};
  const reportSettings = safeProfile.report_settings && typeof safeProfile.report_settings === 'object'
    ? (safeProfile.report_settings as Record<string, unknown>)
    : {};
  const brandColors = [
    ...splitList(safeProfile.brand_colors),
    ...splitList(safeProfile.color_palette),
    ...splitList(reportSettings.brand_colors),
  ];
  return {
    companyName: pickFirstString(safeProfile.name, safeProfile.company_name),
    industry: pickFirstString(safeProfile.industry, safeProfile.category),
    audience: pickFirstString(safeProfile.target_audience, safeProfile.target_customer_segment, safeProfile.ideal_customer_profile),
    logoUrl: pickFirstString(safeProfile.logo_url, safeProfile.brand_logo_url, safeProfile.company_logo_url) || null,
    faviconUrl: pickFirstString(safeProfile.favicon_url, safeProfile.brand_favicon_url) || null,
    tagline: pickFirstString(safeProfile.tagline, safeProfile.homepage_headline, safeProfile.unique_value, safeProfile.brand_positioning),
    brandTone: pickFirstString(safeProfile.brand_voice, safeProfile.brand_tone),
    brandColors: Array.from(new Set(brandColors)).slice(0, 8),
    campaignAssociation: pickFirstString(safeProfile.campaign_focus, safeProfile.campaign_name),
    uniqueValue: pickFirstString(safeProfile.unique_value),
    positioning: pickFirstString(safeProfile.brand_positioning, safeProfile.content_strategy),
  };
}

function buildBrandContextLines(input: {
  mode: CreatorBrandMode;
  presence: BrandPresence;
  selections: BrandContextSelections;
  profile: CreatorBrandProfile | null;
  overrides: Record<string, string>;
}): string[] {
  if (input.mode !== 'brand-aware') {
    return [
      'Generation mode: Independent Creative Generation',
      'Do not use company identity, logo, favicon, tagline, brand colors, brand tone, audience profile, or campaign context.',
      'Keep the output portable, category-native, and concept-led rather than company-led.',
    ];
  }

  const profile = input.profile || {};
  const lines = [
    'Generation mode: Brand-Aware Generation',
    `Brand presence: ${input.presence}`,
    input.presence === 'minimal'
      ? 'Use brand as a subtle quality filter: tone and audience fit matter more than visible branding.'
      : input.presence === 'strong'
        ? 'Make brand identity visibly influence language, visual hierarchy, CTA framing, and supporting references.'
        : 'Balance brand consistency with platform-native creative quality.',
  ];
  if (input.selections.companyContext) {
    const companyLine = [
      input.overrides.companyName || profile.companyName,
      profile.industry ? `Industry: ${profile.industry}` : '',
      profile.uniqueValue ? `Value: ${profile.uniqueValue}` : '',
      profile.positioning ? `Positioning: ${profile.positioning}` : '',
    ].filter(Boolean).join(' | ');
    if (companyLine) lines.push(`Company context: ${companyLine}`);
  }
  if (input.selections.logo) {
    const logo = input.overrides.logoUrl || profile.logoUrl;
    if (logo) {
      const size = normalizeBrandAssetSize(input.overrides.logoSize);
      lines.push(`Company logo reference: ${logo} (render size: ${describeBrandAssetSize('logo', size)}, aligned to the asset)`);
    }
  }
  if (input.selections.favicon) {
    const favicon = input.overrides.faviconUrl || profile.faviconUrl;
    if (favicon) {
      const size = normalizeBrandAssetSize(input.overrides.faviconSize);
      lines.push(`Company favicon reference: ${favicon} (render size: ${describeBrandAssetSize('favicon', size)}, aligned to the asset)`);
    }
  }
  if (input.selections.tagline) {
    const tagline = input.overrides.tagline || profile.tagline;
    if (tagline) lines.push(`Tagline: ${tagline}`);
  }
  if (input.selections.brandTone) {
    const tone = input.overrides.brandTone || profile.brandTone;
    if (tone) lines.push(`Brand tone: ${tone}`);
  }
  if (input.selections.brandColors) {
    const colors = splitList(input.overrides.brandColors).length > 0
      ? splitList(input.overrides.brandColors)
      : profile.brandColors || [];
    if (colors.length > 0) lines.push(`Brand colors: ${colors.join(', ')}`);
  }
  if (input.selections.audience) {
    const audience = input.overrides.audience || profile.audience;
    if (audience) lines.push(`Audience context: ${audience}`);
  }
  if (input.selections.campaign) {
    const campaign = input.overrides.campaign || profile.campaignAssociation;
    if (campaign) lines.push(`Campaign association: ${campaign}`);
  }
  return lines;
}

function getOptionLabel(config: WorkflowConfig, fieldId: string, value: string | undefined): string {
  const field = config.fields.find(
    (entry): entry is Extract<WorkflowField, { kind: 'single-select' }> =>
      entry.id === fieldId && entry.kind === 'single-select',
  );
  if (!field || !value) return humanizeValue(value);
  return field.options.find((option) => option.value === value)?.label || humanizeValue(value);
}

function buildSuggestionOptions(
  config: WorkflowConfig,
  answers: Record<string, string>,
  context: {
    brandMode: CreatorBrandMode;
    brandPresence: BrandPresence;
    brandProfile: CreatorBrandProfile | null;
    /** Resolved target platform when a writer source supplied one; null on
     *  the direct creator route (no inherent platform — keep copy generic). */
    targetPlatform: string | null;
  },
): SuggestionOption[] {
  const subtypeLabel = config.subtypeOptions.find((option) => option.value === answers.subtype)?.label || config.title;
  const objective = getOptionLabel(config, 'objective', answers.objective) || 'engagement';
  const style = getOptionLabel(config, 'styleDirection', answers.styleDirection) || 'brand-led';
  const continuity =
    getOptionLabel(config, 'continuity', answers.continuity) ||
    getOptionLabel(config, 'visualSystem', answers.visualSystem) ||
    getOptionLabel(config, 'structureMode', answers.structureMode) ||
    getOptionLabel(config, 'hierarchy', answers.hierarchy) ||
    'clear visual continuity';
  const audience = String(answers.audience || 'your target audience').trim();
  const message = String(answers.keyMessage || answers.headline || answers.topic || config.title).trim();
  // Platform-aware copy ONLY when a real target platform is supplied (writer
  // route). Direct creator route → platform-agnostic so the asset can be
  // reused anywhere without LinkedIn (or any single platform) bias.
  const platformLabel = context.targetPlatform
    ? (context.targetPlatform.toLowerCase() === 'linkedin' ? 'LinkedIn' : humanizeValue(context.targetPlatform))
    : null;
  const platformPrefix = platformLabel ? `${platformLabel}-friendly ` : '';
  const platformSuffix = platformLabel ? ` for ${platformLabel}` : ' across your distribution channels';
  // Brand-aware → weave the company into every suggestion so all three
  // directions align with the selected company context. Independent → keep
  // copy generic.
  const brandAware = context.brandMode === 'brand-aware';
  const companyName = brandAware ? (context.brandProfile?.companyName || '').trim() : '';
  const brandClause = companyName ? `for ${companyName} ` : '';
  const companySignal = brandAware
    ? (companyName
        ? `${companyName}'s ${context.brandPresence} brand presence`
        : `${context.brandPresence} brand presence`)
    : 'independent creative territory';
  const industrySignal = context.brandProfile?.industry ? `${context.brandProfile.industry} positioning` : 'category positioning';
  const assetSignal = answers.assetSubtype && answers.assetSubtype !== 'none'
    ? ` with ${humanizeValue(answers.assetSubtype)} support`
    : '';
  const objectiveSignal = objective.toLowerCase().includes('conversion')
    ? 'CTA emphasis and decision momentum'
    : objective.toLowerCase().includes('education') || objective.toLowerCase().includes('authority')
      ? 'retention, clarity, and trust'
      : 'reach, recall, and scroll-stopping clarity';

  // Ensure every suggestion summary opens with a capital letter regardless
  // of whether the leading token is a platform/brand label or a workflow
  // word like "promotional".
  const capFirst = (sentence: string): string =>
    sentence.length === 0 ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1);

  return [
    {
      id: 'safe-fit',
      label: 'Authority Direction',
      summary: capFirst(
        `${platformPrefix}${subtypeLabel.toLowerCase()} ${config.title.toLowerCase()} ${brandClause}for ${objective.toLowerCase()} that frames "${message}" through ${companySignal}, ${industrySignal}, and ${objectiveSignal}${assetSignal}.`,
      ),
      rationale: `Use this when ${audience} needs a polished, credible direction with strong retention and low execution risk.`,
      badges: platformLabel
        ? ['Brand Safe', `${platformLabel} Friendly`, 'Educational']
        : ['Brand Safe', 'Multi-Platform', 'Educational'],
    },
    {
      id: 'standout',
      label: 'Standout Direction',
      summary: capFirst(
        `high-attention ${config.title.toLowerCase()} ${brandClause}that leads with a sharper hook around "${message}", uses ${style.toLowerCase()} personality, and makes the first-screen payoff unmistakable${platformSuffix}.`,
      ),
      rationale: `Best when the priority is stopping attention quickly without turning the output into generic hype.`,
      badges: ['High Attention', style.toLowerCase().includes('premium') ? 'Premium' : 'Bold', 'High CTR'],
    },
    {
      id: 'educator',
      label: 'Conversion Direction',
      summary: capFirst(
        `structured ${config.title.toLowerCase()} ${brandClause}that turns "${message}" into a clear sequence, keeps ${continuity.toLowerCase()}, and gives the CTA a specific next-step role instead of generic closing copy.`,
      ),
      rationale: `Best when clarity, downstream reuse, and action are more important than novelty alone.`,
      badges: ['Conversion Focused', 'Educational', objective.toLowerCase().includes('conversion') ? 'High CTR' : 'Reusable'],
    },
  ];
}

export default function CreatorTypeWorkflowPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const type = typeof router.query.type === 'string' ? (router.query.type as CreatorTypeId) : null;

  // Taxonomy consolidation — legacy URL aliasing. Users (or external
  // bookmarks / writer attachments) hitting /creator-content/banner or
  // /creator-content/slider are redirected to the consolidated
  // image/carousel workflow with the corresponding layout pre-selected.
  // Historical creator_assets rows stored under creatorType='banner' or
  // 'slider' continue to render normally — only the AUTHORING URL is
  // redirected, never the saved-asset surfaces.
  React.useEffect(() => {
    if (!router.isReady) return;
    if (type === 'banner') {
      void router.replace({
        pathname: '/command-center/creator-content/image',
        query: { ...router.query, type: 'image', layout: 'wide-banner' },
      }, undefined, { shallow: false });
    } else if (type === 'slider') {
      void router.replace({
        pathname: '/command-center/creator-content/carousel',
        query: { ...router.query, type: 'carousel', layout: 'widescreen-presentation' },
      }, undefined, { shallow: false });
    }
  }, [router, type]);

  // Template-first: a template-capable asset opened FRESH (no template selected)
  // is sent to the template gallery to choose one (recommendation auto-selects
  // the best). This is the canonical safety net — it enforces template selection
  // regardless of which entry point (nav / landing / bookmark / stale link)
  // reached the workflow. It NEVER fires when:
  //   - a template is already chosen (?template_id=…),
  //   - the user explicitly skipped (?skip_templates=1),
  //   - the workflow was opened with authoring context (writer prefill /
  //     attachment / text-transform / edit), which is template-less by design.
  // No loop: the gallery lives at /<type>/templates; picking a template returns
  // here with ?template_id=… and the redirect no longer fires.
  React.useEffect(() => {
    if (!router.isReady) return;
    if (type !== 'image' && type !== 'carousel' && type !== 'infographic') return;
    const q = router.query;
    const has = (k: string) => typeof q[k] === 'string' && (q[k] as string).trim().length > 0;
    if (has('template_id') || q.skip_templates === '1' || has('prefill') || has('session') || has('source') || has('source_text_transform') || has('asset_type')) return;
    void router.replace(
      { pathname: `/command-center/creator-content/${type}/templates`, query: { ...q, type: undefined } },
      undefined,
      { shallow: false },
    );
  }, [router, type]);

  const config = type ? WORKFLOW_CONFIG[type] : null;

  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = React.useState(false);
  // Progress tracker state. `generationStage` advances through 4 stages
  // while a generation is in flight; `showProgress` is gated behind a
  // 2-second delay so quick runs (cache hits, small payloads) don't
  // flash a tracker the operator never gets to read.
  const [generationStage, setGenerationStage] = React.useState(0);
  const [showProgress, setShowProgress] = React.useState(false);
  const [isSavingBlock, setIsSavingBlock] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savedBlock, setSavedBlock] = React.useState<SavedBlockReference | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = React.useState('safe-fit');
  const [refinePrompt, setRefinePrompt] = React.useState('');
  const [refinedSuggestion, setRefinedSuggestion] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatorResult | null>(null);
  // ── Variant Experience Embedding state ──────────────────────────
  // `variantPin` carries the family the operator chose for a single
  // generation; consumed by the existing handleGenerate path so the
  // server sees `variant_id` / `variant_family` on the creator_card
  // payload. `variantPlan` carries the most recent planner result
  // for top-3 / experiment fan-out (rendered as preview + Generate
  // Variants button below the main Generate button).
  const [variantPin, setVariantPin] = React.useState<VariantFamily | null>(null);
  const [variantPlan, setVariantPlan] = React.useState<VariantExecutionResult | null>(null);
  const [variantFanOutInFlight, setVariantFanOutInFlight] = React.useState(false);
  const [variantFanOutSummary, setVariantFanOutSummary] = React.useState<string | null>(null);
  // Note: `lastGeneratePayloadRef` was removed in the final readiness
  // pass. Variant fan-out now builds its payload directly from form
  // state via `buildGenerationBody(null)`, so the ref had no readers.
  const [savedAssets, setSavedAssets] = React.useState<SavedCreatorAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = React.useState(false);
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);
  // PHASE 14F: bump to force a savedAssets refetch after a generate; the ref
  // asks the loader to select the newest asset once that refetch lands, so a
  // newly generated render appears and is selected without a page reload.
  const [assetReloadNonce, setAssetReloadNonce] = React.useState(0);
  const selectNewestAssetRef = React.useRef(false);
  const [brandMode, setBrandMode] = React.useState<CreatorBrandMode>('independent');
  const [brandPanelOpen, setBrandPanelOpen] = React.useState(false);
  const [brandPresence, setBrandPresence] = React.useState<BrandPresence>('balanced');
  const [brandSelections, setBrandSelections] = React.useState<BrandContextSelections>(DEFAULT_BRAND_SELECTIONS);
  const [brandProfile, setBrandProfile] = React.useState<CreatorBrandProfile | null>(null);
  const [brandOverrides, setBrandOverrides] = React.useState<Record<string, string>>({});
  const [isLoadingBrandProfile, setIsLoadingBrandProfile] = React.useState(false);
  const [actionInProgress, setActionInProgress] = React.useState<string | null>(null);
  const [writerSource, setWriterSource] = React.useState<WriterCreatorSourcePayload | null>(null);
  const [standaloneAttachmentMode, setStandaloneAttachmentMode] = React.useState<AttachmentMode>('supporting_visual');
  const [recommendedAttachmentMode, setRecommendedAttachmentMode] = React.useState<AttachmentMode | null>(null);
  // Creator Template Foundation — active template + its form values. When a
  // template is active, it drives the form fields AND the generation inputs
  // (purpose_key / subtype / infographic_layout / attachment_mode / slides).
  const [activeTemplate, setActiveTemplate] = React.useState<CreatorTemplate | null>(null);
  const [templateValues, setTemplateValues] = React.useState<TemplateFieldValues>({ fields: {} });
  // Canonical Brief ⇄ Editor sync state (per synchronized endpoint). Reset below
  // whenever a different template / new asset / different draft loads.
  const [syncState, setSyncState] = React.useState<BriefEditorSyncState>(freshSyncState);
  // Reset sync state on a new template / asset / draft so auto-fill resumes for a
  // genuinely new context (manual locks belong to the asset that was being edited).
  React.useEffect(() => {
    setSyncState(freshSyncState());
  }, [activeTemplate?.id, type, router.query.template_id, router.query.ingest, router.query.session, router.query.prefill]);
  // Field-level AI assist — the busyKey of the in-flight assist action (per
  // field / batch); the panel disables that single control while it runs.
  const [aiBusyKey, setAiBusyKey] = React.useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = React.useState('linkedin');
  // Connected platforms that support the current creator content type
  // (creator capability). null = still loading; [] = company has none
  // connected. Routes through the canonical bolt/available-platforms API
  // so capability filtering + token validity stay in sync with the
  // rest of the app.
  const [connectedPlatforms, setConnectedPlatforms] = React.useState<string[] | null>(null);
  const [overlayText, setOverlayText] = React.useState<WriterOverlayText>(EMPTY_OVERLAY_TEXT);
  const generationInFlightRef = React.useRef(false);
  const saveInFlightRef = React.useRef(false);
  const processedWriterPrefillRef = React.useRef('');
  // CreatorAttachmentSession token in flight (owns attach + return for this launch).
  const attachmentSessionTokenRef = React.useRef('');
  // Output panel ref + previous-result tracker. When `result`
  // transitions from null → non-null, we scroll the panel into view
  // so the operator can see the generated carousel/image/etc.
  // immediately — without this, on narrow viewports the output
  // stacks below the form and is easy to miss.
  const resultPanelRef = React.useRef<HTMLDivElement | null>(null);
  const hadResultRef = React.useRef(false);
  // Required "main topic" field — when generation is gated on an empty topic we
  // scroll to + focus + highlight this field (it sits at the top of a long form,
  // so a bottom-of-page error alone leaves the operator hunting for it).
  const topicFieldRef = React.useRef<HTMLDivElement | null>(null);
  const [topicMissing, setTopicMissing] = React.useState(false);
  // Render-job progress tracker. Carousel / infographic / pdf / slider
  // render in a durable background job; the polling effect updates this
  // state every 2s so the banner can show a real progress bar instead
  // of a generic spinner.
  // CREATOR-011 — snapshot the editor values that produced the asset, and count
  // regenerations, for the read-only Asset Review (presentation only).
  const [generatedSnapshot, setGeneratedSnapshot] = React.useState<TemplateFieldValues | null>(null);
  const [regenCount, setRegenCount] = React.useState(0);
  const regenSeenResultRef = React.useRef(false);
  const [renderJobProgress, setRenderJobProgress] = React.useState<{
    percent: number;
    status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'dead_letter' | 'waiting';
    attempts: number;
    /** Wall-clock seconds the job has spent in queued/waiting (worker
     *  hasn't picked it up). After ~20s this signals that no render
     *  worker is running locally (`npm run dev` without `dev:full`). */
    queuedSeconds: number;
  } | null>(null);
  // Inline-render escape hatch state. When the durable queue stalls
  // (no worker consuming), the operator can trigger a synchronous
  // render via /api/command-center/creator-content/render-inline.
  const [inlineRenderInFlight, setInlineRenderInFlight] = React.useState(false);
  const [inlineRenderError, setInlineRenderError] = React.useState<string | null>(null);
  const writerCompositionIntent = writerSource?.compositionIntent ?? null;
  const writerAttachmentMode: AttachmentMode | null = writerCompositionIntent?.attachmentMode ?? null;
  const writerAssetType: WriterCreatorAssetType | null = writerCompositionIntent?.assetType ?? null;
  const writerSupportingVisual = writerAttachmentMode === 'supporting_visual';
  const writerEmbeddedCopy = writerAttachmentMode === 'embedded_copy';

  // Creator Template Foundation — resolve the active template from the URL
  // (?template_id=…) once the router is ready. Initialises the template form
  // values and, for image templates, syncs the attachment-mode contract
  // (text-in-image vs clean visual) onto the existing standalone selector.
  // No template_id → activeTemplate stays null and the page is unchanged.
  React.useEffect(() => {
    if (!router.isReady) return;
    const templateId = typeof router.query.template_id === 'string' ? router.query.template_id : '';
    const family = familyForCreatorType(type);
    if (!templateId || !family) {
      setActiveTemplate(null);
      return;
    }
    const tpl = getTemplateById(templateId, family);
    setActiveTemplate(tpl);
    if (tpl) {
      setTemplateValues(initTemplateValues(tpl));
      // CREATOR-007 — seed the canonical form values from deterministic content
      // ingestion when handed off via ?ingest=<token>. The editor stays fully
      // editable; this only pre-fills. Guarded to the matching template id.
      const ingestToken = typeof router.query.ingest === 'string' ? router.query.ingest : '';
      if (ingestToken) {
        try {
          const rawV = window.sessionStorage.getItem(creatorIngestPrefillKey(ingestToken));
          if (rawV) {
            const parsed = JSON.parse(rawV) as { templateId?: string; values?: TemplateFieldValues };
            if (parsed && parsed.templateId === tpl.id && parsed.values && typeof parsed.values === 'object') {
              setTemplateValues(parsed.values);
            }
          }
        } catch { /* ignore malformed prefill */ }
      }
      if (tpl.assetFamily === 'image' && tpl.renderingContract.attachmentMode) {
        setStandaloneAttachmentMode(tpl.renderingContract.attachmentMode);
      }
    }
  }, [router.isReady, router.query.template_id, router.query.ingest, type]);

  // CREATOR-011 — snapshot values at generation; count regenerations.
  React.useEffect(() => {
    if (result) {
      setGeneratedSnapshot(templateValues);
      if (regenSeenResultRef.current) setRegenCount((c) => c + 1);
      regenSeenResultRef.current = true;
    } else {
      regenSeenResultRef.current = false; setRegenCount(0); setGeneratedSnapshot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Field-level AI assist handler. User-invoked; updates ONLY the targeted
  // field(s) returned by the endpoint — never a full asset, never an automatic
  // overwrite. Manual content for non-targeted fields is preserved.
  const handleTemplateAiAssist = React.useCallback(async (ctx: TemplateAiAssistContext) => {
    if (!activeTemplate || ctx.targets.length === 0) return;
    setAiBusyKey(ctx.busyKey);
    setError(null);
    try {
      const resp = await fetch('/api/creator-templates/field-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId || undefined,
          asset_family: activeTemplate.assetFamily,
          template_id: activeTemplate.id,
          action: ctx.action,
          targets: ctx.targets.map((t) => ({ scope: t.scope, field_key: t.fieldKey, index: t.index, current_value: t.currentValue })),
          context: {
            topic: String(answers.topic || '').trim(),
            audience: String(answers.audience || '').trim(),
            objective: String(answers.objective || '').trim(),
            tone: String(answers.styleDirection || '').trim(),
          },
        }),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail?.error || `AI assist failed (${resp.status})`);
      }
      const data = await resp.json();
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      if (updates.length > 0) {
        setTemplateValues((prev) => applyTemplateFieldUpdates(prev, updates));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed');
    } finally {
      setAiBusyKey(null);
    }
  }, [activeTemplate, selectedCompanyId, answers]);

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, isLoading, user?.userId, router]);

  React.useEffect(() => {
    const defaults = config ? buildDefaultAnswers(config) : {};
    // Operator feedback: when navigating to a creator-content type
    // from header or cards, no field should be prefilled — every
    // visit should start clean. The writer-prefill flow
    // (?source=writer&prefill=token) is an EXPLICIT carry-over that
    // continues to work via its own sessionStorage handshake below;
    // it does NOT use this localStorage draft.
    //
    // Side effect: also wipe any stale draft from a prior session so
    // it doesn't get re-applied on a future navigation.
    let restored: Record<string, unknown> | null = null;
    if (type && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(getCreatorDraftStorageKey(type));
      } catch {
        // localStorage access can fail in private-mode browsers — silent.
      }
    }
    // URL layout override (consolidation alias redirect) — when the
    // user arrives via /creator-content/image?layout=wide-banner (or
    // ?layout=widescreen-presentation on carousel), preselect the
    // layout choice so the form opens on the intended preset.
    const urlLayout = typeof router.query.layout === 'string' ? router.query.layout : '';
    const layoutOverride = (urlLayout === 'wide-banner' || urlLayout === 'widescreen-presentation' || urlLayout === 'square' || urlLayout === 'portrait' || urlLayout === 'landscape' || urlLayout === 'standard') ? { layout: urlLayout } : {};
    // CREATOR-106: EXPLICIT carry-over from the Marketing Workspace (?from=workspace).
    // Seed the editor fields from the workspace brief so the user doesn't re-enter what
    // they already gave; everything stays editable. Other entry points still start clean.
    let workspacePrefill: Record<string, string> = {};
    if (config && router.query.from === 'workspace' && typeof window !== 'undefined') {
      try {
        const wb = readMarketingBrief(window.sessionStorage.getItem(MARKETING_BRIEF_SESSION_KEY));
        if (wb) workspacePrefill = mapBriefToEditorAnswers(wb, config);
      } catch { /* ignore malformed brief */ }
    }
    setAnswers({
      ...defaults,
      ...workspacePrefill,
      ...((restored?.answers && typeof restored.answers === 'object') ? restored.answers as Record<string, string> : {}),
      ...layoutOverride,
    });
    setResult(null);
    setError(null);
    setNotice(null);
    setSavedBlock(null);
    setActionInProgress(null);
    setSelectedSuggestionId(typeof restored?.selectedSuggestionId === 'string' ? restored.selectedSuggestionId : 'safe-fit');
    setRefinePrompt('');
    setRefinedSuggestion(null);
    const hasPendingWriterPrefill =
      router.query.source === 'writer' && typeof router.query.prefill === 'string';
    if (!hasPendingWriterPrefill) {
      setWriterSource(null);
    }
    setSelectedPlatform(
      typeof restored?.selectedPlatform === 'string' && config?.primaryPlatforms.includes(restored.selectedPlatform)
        ? restored.selectedPlatform
        : config?.primaryPlatforms[0] || 'linkedin',
    );
    setOverlayText(
      restored?.overlayText && typeof restored.overlayText === 'object'
        ? { ...EMPTY_OVERLAY_TEXT, ...(restored.overlayText as Partial<WriterOverlayText>) }
        : EMPTY_OVERLAY_TEXT,
    );
    setStandaloneAttachmentMode(
      restored?.standaloneAttachmentMode === 'embedded_copy' || restored?.standaloneAttachmentMode === 'supporting_visual'
        ? (restored.standaloneAttachmentMode as AttachmentMode)
        : 'supporting_visual',
    );
    setRecommendedAttachmentMode(
      restored?.recommendedAttachmentMode === 'embedded_copy' || restored?.recommendedAttachmentMode === 'supporting_visual'
        ? (restored.recommendedAttachmentMode as AttachmentMode)
        : null,
    );
    // CREATOR-106: arriving from the workspace, open the Brand panel so the logo-size
    // (Small/Medium/Large) + brand controls are visible up front, not buried.
    setBrandPanelOpen(router.query.from === 'workspace');
    setBrandMode(restored?.brandMode === 'brand-aware' ? 'brand-aware' : 'independent');
    setBrandPresence(
      restored?.brandPresence === 'minimal' || restored?.brandPresence === 'strong'
        ? restored.brandPresence
        : 'balanced',
    );
    if (restored?.brandSelections && typeof restored.brandSelections === 'object') {
      setBrandSelections({ ...DEFAULT_BRAND_SELECTIONS, ...(restored.brandSelections as Partial<BrandContextSelections>) });
    }
    if (restored?.brandOverrides && typeof restored.brandOverrides === 'object') {
      setBrandOverrides(restored.brandOverrides as Record<string, string>);
    }
    setSelectedAssetId(typeof restored?.selectedAssetId === 'string' ? restored.selectedAssetId : null);
  }, [config, router.query.prefill, router.query.source, router.query.from, type]);

  // ── Variant deep-link pin (PHASE 1 — Variant Experience Embedding) ──
  // When the Writer (or any sibling surface) routes the operator here
  // with `?variant_family=v2`, pre-pin that family so the generation
  // request carries the variant attribution without the operator
  // having to re-pick it. Legacy URLs (no query) keep `variantPin`
  // null and the page generates the V1 baseline byte-identically to
  // the pre-variant flow (PHASE 10 regression-safety guarantee).
  React.useEffect(() => {
    const decoded = decodeVariantQuery(router.query as Record<string, string | string[] | undefined>);
    if (decoded.variantFamily) setVariantPin(decoded.variantFamily);
  }, [router.query]);

  React.useEffect(() => {
    if (!router.isReady || !config || !type || typeof window === 'undefined') return;
    // Canonical lifecycle: read the CreatorAttachmentSession (new `?session=` token;
    // `?prefill=` accepted as a legacy fallback inside loadAttachmentSession). The
    // session's launchContext IS the former writer payload, so derivation below is
    // byte-identical — only the source of the payload changed (one object, one key).
    const sessionToken = (typeof router.query.session === 'string' ? router.query.session : '')
      || (typeof router.query.prefill === 'string' ? router.query.prefill : '');
    const source = typeof router.query.source === 'string' ? router.query.source : '';
    if (!sessionToken || source !== 'writer' || processedWriterPrefillRef.current === sessionToken) return;

    try {
      const session = loadAttachmentSession(sessionToken);
      if (!session) return;
      const parsed = session.launchContext;
      if (parsed.sourceType !== 'post' && parsed.sourceType !== 'thread') return;

      processedWriterPrefillRef.current = sessionToken;
      attachmentSessionTokenRef.current = sessionToken;
      const assetType = normalizeWriterCreatorAssetType(parsed.compositionIntent?.assetType ?? router.query.asset_type);
      const attachmentMode = normalizeAttachmentMode(parsed.compositionIntent?.attachmentMode ?? router.query.attachment_mode);
      const sourceTextTransform = normalizeSourceTextTransform(
        parsed.compositionIntent?.copyPolicy?.sourceTextTransform ?? router.query.source_text_transform,
      );
      const compositionIntent: AssetCompositionIntent = parsed.compositionIntent ?? buildAssetCompositionIntent({
        assetType,
        attachmentMode,
        sourceTextTransform,
      });
      const normalizedSource: WriterCreatorSourcePayload = {
        ...parsed,
        compositionIntent,
      };
      setWriterSource(normalizedSource);
      const importedPlatform =
        (parsed.platform && config.primaryPlatforms.includes(parsed.platform) ? parsed.platform : null) ||
        (typeof router.query.platform === 'string' && config.primaryPlatforms.includes(router.query.platform) ? router.query.platform : null) ||
        config.primaryPlatforms[0] ||
        'linkedin';
      setSelectedPlatform(importedPlatform);
      // Auto-fill the overlay panel from the imported campaign/Writer content (the
      // "campaign theme") so the image opens populated, not blank. Was cleared to
      // EMPTY_OVERLAY_TEXT, which left hook / supportingText / keyInsight empty in
      // the generated image (headline alone survived via the answers fallback).
      setOverlayText(deriveOverlayFromContent(normalizedSource.title, normalizedSource.body));
      if (type === 'image') setRecommendedAttachmentMode(null);
      setAnswers((current) => ({
        ...current,
        ...buildCreatorAnswersFromWriterSource(config, type, normalizedSource),
      }));
      setBrandMode(normalizedSource.companyName || normalizedSource.brandContext ? 'brand-aware' : 'independent');
      if (normalizedSource.companyName || normalizedSource.brandContext) {
        setBrandPanelOpen(true);
        setBrandOverrides((current) => ({
          ...current,
          companyName: current.companyName || normalizedSource.companyName || '',
          audience: current.audience || normalizedSource.audience || '',
          brandTone: current.brandTone || normalizedSource.tone || '',
        }));
      }
      setSelectedSuggestionId(type === 'carousel' && normalizedSource.sourceType === 'thread' ? 'educator' : 'safe-fit');
      setRefinedSuggestion(
        type === 'carousel' && normalizedSource.sourceType === 'thread'
          ? 'Transform the imported thread before slide generation; do not map raw thread posts directly to slides.'
          : `Create a ${config.title.toLowerCase()} asset from the imported ${normalizedSource.sourceType} using the selected attachment mode.`,
      );
      setNotice(`Imported ${normalizedSource.sourceType} context into this ${config.title.toLowerCase()} flow.`);
    } catch {
      setError('Could not import the Writer context. You can still complete this Creator flow manually.');
    }
  }, [config, router.isReady, router.query.session, router.query.asset_type, router.query.attachment_mode, router.query.platform, router.query.prefill, router.query.source, router.query.source_text_transform, type]);

  // Operator feedback: navigating to a creator-content type from
  // header or content cards must NOT prefill any field. We kill the
  // localStorage draft persistence entirely — the mount effect above
  // already wipes any stored draft on every visit. With nothing
  // saved AND nothing restored, every visit starts genuinely fresh.
  //
  // The writer-prefill flow (?source=writer&prefill=token) is
  // unaffected — it uses sessionStorage with a one-time token, not
  // this draft cache.

  React.useEffect(() => {
    if (!selectedCompanyId) {
      setBrandProfile(null);
      return;
    }
    let cancelled = false;
    setIsLoadingBrandProfile(true);
    fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=0`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const profile = data?.profile || data || null;
        const mapped = mapCreatorBrandProfile(profile as Record<string, unknown> | null);
        if (!mapped.companyName && selectedCompanyName) mapped.companyName = selectedCompanyName;
        setBrandProfile(mapped);
        setBrandOverrides((current) => ({
          companyName: current.companyName || mapped.companyName || '',
          logoUrl: current.logoUrl || mapped.logoUrl || '',
          faviconUrl: current.faviconUrl || mapped.faviconUrl || '',
          tagline: current.tagline || mapped.tagline || '',
          brandTone: current.brandTone || mapped.brandTone || '',
          brandColors: current.brandColors || (mapped.brandColors || []).join(', '),
          audience: current.audience || mapped.audience || '',
          campaign: current.campaign || mapped.campaignAssociation || '',
        }));
      })
      .catch(() => {
        if (!cancelled) setBrandProfile(selectedCompanyName ? { companyName: selectedCompanyName } : null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBrandProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, selectedCompanyName]);

  // Progress tracker driver — when isGenerating flips true, schedule
  // (a) a 2-second timer that reveals the tracker (skips it on fast
  // runs) and (b) staged advancement timers that mirror the renderer
  // pipeline. When isGenerating flips back to false (success OR
  // error), every timer is torn down and the stage resets so the
  // next run starts fresh.
  React.useEffect(() => {
    if (!isGenerating) {
      setShowProgress(false);
      setGenerationStage(0);
      return;
    }
    // Reset for a fresh run.
    setGenerationStage(0);
    setShowProgress(false);
    // Timing tuned to the renderer pipeline:
    //   stage 0 (Preparing brief)    : t=0     until t=1.2s
    //   stage 1 (Generating with AI) : t=1.2s  until t=14s   (longest step)
    //   stage 2 (Composing overlay)  : t=14s   until t=22s
    //   stage 3 (Saving asset)       : t=22s   until done
    // Generation usually completes during stage 2 or 3; if it stalls
    // we hold on the final stage rather than lying that we are done.
    const showTimer = window.setTimeout(() => setShowProgress(true), 2000);
    const stageTimers = [
      window.setTimeout(() => setGenerationStage(1), 1_200),
      window.setTimeout(() => setGenerationStage(2), 14_000),
      window.setTimeout(() => setGenerationStage(3), 22_000),
    ];
    return () => {
      window.clearTimeout(showTimer);
      stageTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [isGenerating]);

  // Fetch creator-capable connected platforms for the current company so
  // the platform picker only surfaces platforms that (a) are actually
  // connected and (b) support image / carousel / etc. content. Mirrors
  // the BOLT picker's source-of-truth.
  React.useEffect(() => {
    if (!selectedCompanyId) {
      setConnectedPlatforms([]);
      return;
    }
    let cancelled = false;
    setConnectedPlatforms(null);
    fetch(
      `/api/bolt/available-platforms?companyId=${encodeURIComponent(selectedCompanyId)}&mode=bolt-creator`,
      { credentials: 'include' },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const supported = Array.isArray(data?.supported) ? data.supported as string[] : [];
        setConnectedPlatforms(supported);
      })
      .catch(() => {
        if (!cancelled) setConnectedPlatforms([]);
      });
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  React.useEffect(() => {
    if (!selectedCompanyId || !type) {
      setSavedAssets([]);
      setSelectedAssetId(null);
      setIsLoadingAssets(false);
      return;
    }
    let cancelled = false;
    setIsLoadingAssets(true);
    // Pull saved creator assets from the canonical creator_assets store,
    // FILTERED to the current page's type. For 'image' we query
    // 'supporting_image' which the API expands to ['supporting_image',
    // 'image'] via its alias map. Previously this read from
    // /api/block-templates?content_type=blog which polluted the blog
    // templates UI — that path is gone.
    const creatorTypeForRead = type === 'image' ? 'supporting_image' : type;
    fetch(
      `/api/creator-assets?company_id=${encodeURIComponent(selectedCompanyId)}&creator_type=${encodeURIComponent(creatorTypeForRead)}&limit=8`,
      { credentials: 'include' },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.assets) ? data.assets : [];
        const mapped: SavedCreatorAsset[] = rows.map((row: Record<string, unknown>) => {
          const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
            ? row.metadata as Record<string, unknown>
            : {};
          const continuity = (meta.creator_continuity && typeof meta.creator_continuity === 'object' && !Array.isArray(meta.creator_continuity))
            ? meta.creator_continuity as SavedCreatorAsset['creator_metadata']
            : undefined;
          return {
            id: String(row.id || ''),
            name: String(row.title || 'Creator asset'),
            description: typeof meta.description === 'string' ? meta.description as string : null,
            format_type: typeof row.creatorType === 'string' ? row.creatorType as string : null,
            tags: ['creator-asset', typeof row.creatorType === 'string' ? row.creatorType as string : ''].filter(Boolean),
            usage_count: 0,
            created_at: typeof row.createdAt === 'string' ? row.createdAt as string : undefined,
            creator_metadata: continuity,
            media_files: resolveSavedAssetMedia(row),
          } as SavedCreatorAsset;
        });
        setSavedAssets(mapped);
        // PHASE 14F: after a post-generate refetch, select the newest asset so
        // the freshly generated render is shown immediately (no page reload).
        if (selectNewestAssetRef.current && mapped.length > 0) {
          const newest = [...mapped].sort(
            (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
          )[0];
          if (newest) setSelectedAssetId(newest.id);
          selectNewestAssetRef.current = false;
        }
      })
      .catch(() => {
        if (!cancelled) setSavedAssets([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, savedBlock?.id, type, assetReloadNonce]);

  React.useEffect(() => {
    if (!selectedAssetId || isLoadingAssets || savedAssets.length === 0) return;
    if (!savedAssets.some((asset) => asset.id === selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [isLoadingAssets, savedAssets, selectedAssetId]);

  const repurposePaths = React.useMemo(
    () => (type ? getRepurposePaths(type, answers.assetSubtype) : []),
    [answers.assetSubtype, type],
  );
  const brandContextLines = React.useMemo(
    () => buildBrandContextLines({
      mode: brandMode,
      presence: brandPresence,
      selections: brandSelections,
      profile: brandProfile,
      overrides: brandOverrides,
    }),
    [brandMode, brandOverrides, brandPresence, brandProfile, brandSelections],
  );
  const suggestionOptions = React.useMemo(
    () => (config
      ? buildSuggestionOptions(config, answers, {
          brandMode,
          brandPresence,
          brandProfile,
          // Only carry a target platform when the session was hydrated from
          // a writer source. Direct-route image creation stays platform-agnostic.
          targetPlatform: writerSource?.platform ?? null,
        })
      : []),
    [answers, brandMode, brandPresence, brandProfile, config, writerSource],
  );

  // Rendering Forensic Audit follow-up. The early returns for
  // `!authChecked || isLoading`, `!user`, and `!config` were here at the
  // top of the component, but several hooks below them (useMemo /
  // useEffect / useCallback at lines for availablePlatforms, the
  // platform-snap effect, overlayFieldSuggestions,
  // freeformFieldSuggestions, and buildGenerationBody) get skipped on
  // renders where the early return fires. When the auth check completes
  // or user/config loads, React sees a different hook count and throws
  // "Rendered more hooks than during the previous render."
  // ALL early returns have been relocated to just before the final JSX
  // render path (right above the `const selectedSubtype =
  // config.subtypeOptions.find(...)` access that requires non-null
  // config). All hooks above that point fire on every render.

  // USER-input brief writer: marks `topic` manually_modified so the sync engine
  // never auto-fills/repopulates it again (respects an intentional edit or clear).
  // Programmatic restores use `setAnswerSilent` instead (no manual mark).
  const setAnswer = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (id === 'topic') {
      if (value.trim()) setTopicMissing(false);
      setSyncState((s) => markManual(s, 'topic'));
    }
  };
  const setAnswerSilent = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (id === 'topic' && value.trim()) setTopicMissing(false);
  };

  // USER-input editor writer: marks the editor lead field manually_modified only
  // when the lead value actually changes (so editing/clearing it is respected,
  // while edits to other fields don't lock the lead). The engine writes via the
  // raw `setTemplateValues` so its own writes never count as manual.
  const handleEditorChange = (next: TemplateFieldValues) => {
    if (activeTemplate) {
      const prevLead = editorLeadValue(activeTemplate, templateValues);
      const nextLead = editorLeadValue(activeTemplate, next);
      if (nextLead !== prevLead) setSyncState((s) => markManual(s, 'lead'));
    }
    setTemplateValues(next);
  };

  // Canonical Brief ⇄ Editor synchronization engine. EMPTY-ONLY mirroring driven
  // by `creatorBriefEditorSync` (the single sync service). Auto-fill runs only
  // while an endpoint is not `manually_modified`; one write per pass; converges
  // (each write fills an empty target, then both sides are non-empty / locked).
  React.useEffect(() => {
    if (!activeTemplate || !config) return;
    const hasTopicField = !!config.fields?.some((f) => f.id === 'topic');
    const plan = planBriefEditorSync({
      template: activeTemplate,
      topic: answers.topic ?? '',
      values: templateValues,
      state: syncState,
      hasTopicField,
    });
    if (plan.topicWrite !== undefined) {
      setAnswers((current) => ({ ...current, topic: plan.topicWrite! }));
      if (plan.topicWrite.trim()) setTopicMissing(false);
      setSyncState(plan.nextState);
    } else if (plan.editorWrite) {
      setTemplateValues(plan.editorWrite);
      setSyncState(plan.nextState);
    }
  }, [answers.topic, templateValues, activeTemplate, config, syncState]);

  // Surface the empty required topic field: highlight it, scroll it into view,
  // and focus its input so the operator immediately sees what's missing.
  const flagMissingTopic = () => {
    setTopicMissing(true);
    const node = topicFieldRef.current;
    if (!node) return;
    try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { node.scrollIntoView(); }
    const input = node.querySelector('input, textarea') as HTMLElement | null;
    if (input) window.setTimeout(() => { try { input.focus(); } catch { /* noop */ } }, 300);
  };

  const selectedAsset = savedAssets.find((asset) => asset.id === selectedAssetId) || null;
  const hasBrandProfile = Boolean(
    brandProfile?.companyName ||
    brandProfile?.logoUrl ||
    brandProfile?.faviconUrl ||
    brandProfile?.tagline ||
    brandProfile?.brandTone ||
    (brandProfile?.brandColors || []).length > 0 ||
    brandProfile?.audience,
  );
  const selectedSuggestion =
    suggestionOptions.find((option) => option.id === selectedSuggestionId) || suggestionOptions[0];
  const generationModeLabel =
    brandMode === 'brand-aware' ? 'brand-aware company context' : 'independent creative context';

  const buildCurrentContext = (primaryPlatform?: string | null): CreatorFlowContext => buildCreatorFlowContext({
    topic: answers.topic || config.title,
    audience: answers.audience,
    platform: primaryPlatform || selectedPlatform || config.primaryPlatforms[0],
    campaign: '',
    tone: answers.styleDirection || answers.objective,
    CTA: answers.cta,
    contentType: config.contentType,
    creatorType: type || config.title,
    sourceAssetId: selectedAsset?.id,
    sourceAssetName: selectedAsset?.name,
  });

  const setBrandSelection = (id: keyof BrandContextSelections, value: boolean) => {
    setBrandSelections((current) => ({ ...current, [id]: value }));
  };

  const setBrandOverride = (id: string, value: string) => {
    setBrandOverrides((current) => ({ ...current, [id]: value }));
  };

  const setOverlayField = (id: keyof WriterOverlayText, value: string) => {
    const limits: Record<keyof WriterOverlayText, number> = {
      hook: 76,
      headline: 84,
      keyInsight: 132,
      cta: 42,
      supportingText: 96,
    };
    setOverlayText((current) => ({ ...current, [id]: value.slice(0, limits[id]) }));
  };

  // Derive overlay-field suggestion chips from the actual Writer post
  // body (not generic templates or the topic/keyMessage descriptors).
  // We sentence-split the imported text and rank candidates per field:
  //   - hook       → shortest first sentence / strongest opener (≤76)
  //   - headline   → short declarative claims (≤84)
  //   - supporting → proof/benefit sentences (≤96)
  //   - keyInsight → longest substantive claim (≤132)
  // Intersection of the workflow's primary platforms and the company's
  // connected creator-capable platforms. Empty array when the company
  // has no creator-capable connections; null upstream means "loading".
  const availablePlatforms = React.useMemo(() => {
    if (!config) return [] as string[];
    if (!connectedPlatforms) return [] as string[]; // loading → render nothing yet
    const connectedSet = new Set(connectedPlatforms.map((p) => String(p).toLowerCase()));
    return config.primaryPlatforms.filter((p) => connectedSet.has(p.toLowerCase()));
  }, [config, connectedPlatforms]);

  // If the currently-selected platform is no longer in the connected/
  // capable set (e.g., the default 'linkedin' fired before the fetch
  // resolved, and LinkedIn isn't connected), snap to the first
  // available platform. Skip on the writer route — the writer source's
  // platform is authoritative there.
  React.useEffect(() => {
    if (writerSource) return;
    if (availablePlatforms.length === 0) return;
    if (!availablePlatforms.includes(selectedPlatform)) {
      setSelectedPlatform(availablePlatforms[0]);
    }
  }, [availablePlatforms, selectedPlatform, writerSource]);

  // Auto-scroll the generated-output panel into view the moment a
  // generation succeeds. On narrow viewports the right column stacks
  // below the form, so without this the operator stares at the form
  // wondering where their carousel went.
  React.useEffect(() => {
    if (!result) {
      hadResultRef.current = false;
      return;
    }
    if (hadResultRef.current) return;
    hadResultRef.current = true;
    const node = resultPanelRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        node.scrollIntoView();
      }
    }
  }, [result]);

  // Carousel / infographic / pdf / slider rendering is durable-queued
  // (canonical creatorAssetRegistry: `render_strategy: 'queue'`). The
  // generate API returns immediately with
  //   media_bundle.metadata = { render_async: true, render_job: {...} }
  // and NO `files`. Without polling, the operator sees slide text but
  // never the actual slide PNGs.
  //
  // This effect watches `result` for the async-render marker, polls the
  // render-job endpoint every 2s, and merges the rendered bundle
  // (url + files) into the result state once the job completes. Stops
  // polling on completion / failure / cancellation / unmount.
  React.useEffect(() => {
    if (!result) {
      setRenderJobProgress(null);
      return;
    }
    const bundleMeta = (result.output?.asset_payload?.media_bundle?.metadata ?? {}) as Record<string, unknown>;
    const isAsync = bundleMeta.render_async === true;
    if (!isAsync) {
      setRenderJobProgress(null);
      return;
    }
    const filesAlready = Array.isArray(result.output?.asset_payload?.media_bundle?.files)
      && (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean).length > 0;
    if (filesAlready) {
      setRenderJobProgress(null);
      return;
    }
    const renderJob = (bundleMeta.render_job ?? null) as { id?: string | number } | null;
    const jobId = renderJob && typeof renderJob === 'object'
      ? String((renderJob as { id?: unknown }).id ?? '').trim()
      : '';
    if (!jobId) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // ~3 minutes at 2s/poll
    const POLL_MS = 2000;
    const startedAt = Date.now();
    let firstActiveAt: number | null = null;
    // Seed the progress state so the banner shows 0% immediately rather
    // than waiting for the first poll response.
    setRenderJobProgress({ percent: 0, status: 'queued', attempts: 0, queuedSeconds: 0 });

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const response = await fetch(`/api/command-center/creator-content/render-job/${encodeURIComponent(jobId)}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (response.ok) {
          const payload = await response.json().catch(() => null) as {
            success?: boolean;
            render_job?: {
              status?: string;
              progress?: number;
              attemptsMade?: number;
              result?: { url?: string; files?: string[]; metadata?: Record<string, unknown> };
            };
          } | null;
          const status = payload?.render_job?.status;
          const rawPercent = Number(payload?.render_job?.progress ?? 0);
          const safePercent = Number.isFinite(rawPercent)
            ? Math.max(0, Math.min(100, Math.round(rawPercent)))
            : 0;
          const attemptsMade = Number(payload?.render_job?.attemptsMade ?? 0);
          if (!cancelled) {
            const normalizedStatus = ((): typeof renderJobProgress extends null ? never : NonNullable<typeof renderJobProgress>['status'] => {
              switch (status) {
                case 'completed': return 'completed';
                case 'active': return 'active';
                case 'failed': return 'failed';
                case 'cancelled': return 'cancelled';
                case 'dead_letter': return 'dead_letter';
                case 'waiting': return 'waiting';
                default: return 'queued';
              }
            })();
            // Track when the worker first picked up the job so we can
            // distinguish "queued (worker may be down)" from "active
            // (worker rendering but slow)" purely from elapsed time.
            if (normalizedStatus === 'active' && firstActiveAt === null) {
              firstActiveAt = Date.now();
            }
            const queuedSeconds = normalizedStatus === 'queued' || normalizedStatus === 'waiting'
              ? Math.round((Date.now() - startedAt) / 1000)
              : 0;
            setRenderJobProgress({
              percent: status === 'completed' ? 100 : safePercent,
              status: normalizedStatus,
              attempts: attemptsMade,
              queuedSeconds,
            });
          }
          if (status === 'completed' && payload?.render_job?.result) {
            const renderedBundle = payload.render_job.result;
            const renderedFiles = Array.isArray(renderedBundle.files)
              ? renderedBundle.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
              : [];
            const renderedUrl = typeof renderedBundle.url === 'string' ? renderedBundle.url : '';
            if (renderedFiles.length > 0 || renderedUrl) {
              setResult((current) => {
                if (!current) return current;
                const payload2 = current.output.asset_payload;
                const existingBundle = payload2.media_bundle ?? {};
                const mergedBundle = {
                  ...existingBundle,
                  ...(renderedUrl ? { url: renderedUrl } : {}),
                  ...(renderedFiles.length > 0 ? { files: renderedFiles } : {}),
                  metadata: {
                    ...(existingBundle.metadata ?? {}),
                    ...(renderedBundle.metadata ?? {}),
                    render_async: false,
                    render_completed_at: new Date().toISOString(),
                  },
                };
                return {
                  ...current,
                  output: {
                    ...current.output,
                    asset_payload: {
                      ...payload2,
                      media_bundle: mergedBundle,
                    },
                  },
                };
              });
            }
            return; // stop polling
          }
          if (status === 'failed' || status === 'cancelled' || status === 'dead_letter') {
            setError(`Slide rendering ${status}. The structured copy below is preserved; click Generate to retry.`);
            return; // stop polling
          }
        }
      } catch {
        // Best-effort — keep polling until MAX_ATTEMPTS.
      }
      if (attempts >= MAX_ATTEMPTS) return;
      window.setTimeout(() => { void poll(); }, POLL_MS);
    };

    window.setTimeout(() => { void poll(); }, POLL_MS);

    return () => { cancelled = true; };
  }, [result]);

  // Each source sentence is allocated to AT MOST one field (priority
  // order: hook → headline → supporting → keyInsight) so the four chip
  // lists never repeat the same underlying sentence. Falls back to the
  // title only when no body sentence fit a field.
  const overlayFieldSuggestions = React.useMemo(() => {
    const limits: Record<keyof WriterOverlayText, number> = {
      hook: 76, headline: 84, keyInsight: 132, cta: 42, supportingText: 96,
    };
    const compact = (raw: string, max: number): string => {
      const single = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!single) return '';
      return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
    };
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

    // Sentence-split the Writer body. Mirrors the splitter used by the
    // structured-prompt path so chips show the same content units the
    // renderer will see. Skips URLs, emoji-only fragments, and very short
    // particles.
    const body = String(writerSource?.body || answers.keyMessage || '').trim();
    const sentences = body
      .replace(/https?:\/\/\S+/gi, '')
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((s) => s.replace(/^[\-*\d.)\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 18 && /[A-Za-z]/.test(s));

    const title = String(writerSource?.title || answers.topic || '').trim();

    // Proof-ish keyword bias for the Supporting Text field.
    const PROOF_KEYWORDS = /\b(proof|trust|built|backed|teams|customers|data|result|outcome|measur|evidence|clarity|insight|because|reason)\b/i;

    // Ranked candidate lists per field (best-first). Same source sentence
    // can appear across multiple lists at this stage — the allocator
    // below resolves conflicts so each sentence ends up in only one
    // field's chip list.
    const hookCandidates = sentences
      .filter((s) => s.length <= 110)
      .sort((a, b) => a.length - b.length);

    const headlineCandidates = sentences
      .filter((s) => s.length >= 24 && s.length <= 110)
      .sort((a, b) => Math.abs(a.length - 60) - Math.abs(b.length - 60));

    const supportingCandidates = sentences
      .map((s) => ({ s, score: (PROOF_KEYWORDS.test(s) ? 1 : 0) + (s.length >= 40 && s.length <= 120 ? 1 : 0) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.s);

    const insightCandidates = sentences
      .filter((s) => s.length >= 40)
      .sort((a, b) => Math.min(b.length, 132) - Math.min(a.length, 132));

    // Cross-field allocation — each source sentence is claimed by at
    // most one field. Priority order (hook first) reflects how
    // constrained each slot is: hooks need short punchy openers and are
    // hardest to find, key insights are the most permissive.
    const claimed = new Set<string>();
    const allocate = (candidates: string[], limit: number, max: number): string[] => {
      const out: string[] = [];
      for (const sentence of candidates) {
        const key = normalize(sentence);
        if (!key || claimed.has(key)) continue;
        const value = compact(sentence, max);
        if (!value) continue;
        claimed.add(key);
        out.push(value);
        if (out.length >= limit) break;
      }
      return out;
    };

    const hook        = allocate(hookCandidates,       3, limits.hook);
    const headline    = allocate(headlineCandidates,   3, limits.headline);
    const supporting  = allocate(supportingCandidates, 3, limits.supportingText);
    const insight     = allocate(insightCandidates,    3, limits.keyInsight);

    // Operator feedback: "hook, headlines, supporting text, [key
    // insight] — pretty much all where we are sharing these
    // suggestions should be unique, should not be duplicated at all".
    //
    // The previous seed-derived framings ("Introducing: X", "Here's
    // what X brings", "Why X matters now") were intentionally varied
    // but read as duplicates of the same root phrase — and the
    // "Here's what [seed] brings" template produced broken double-
    // word strings like "Here's what What most teams miss brings".
    // Both behaviours removed. The operator's typed seeds now only
    // surface on the HOOK field (their natural home as the attention
    // grabber); the other three slots fall straight through to the
    // starter pool.
    //
    // A single global `globalChipKeys` set tracks every chip across
    // every slot, so duplicates can NEVER appear in two different
    // fields — even if the starter pools happen to overlap.
    const globalChipKeys = new Set<string>();
    const seedChips = [hook, headline, supporting, insight];
    for (const slot of seedChips) {
      for (const chip of slot) globalChipKeys.add(normalize(chip));
    }

    const seeds = [
      title,
      String(overlayText.hook || '').trim(),
      String(answers.keyMessage || '').trim(),
    ].filter(Boolean);
    const seenSeeds = new Set<string>();
    const dedupedSeeds = seeds.filter((s) => {
      const k = normalize(s);
      if (!k || seenSeeds.has(k)) return false;
      seenSeeds.add(k);
      return true;
    });
    // Seeds only fill the HOOK field — and only when HOOK has no
    // sentence-derived chip yet. They no longer get re-framed into
    // headline / supporting / insight (that was the duplication
    // source). The other slots fall through to starters below.
    for (const seed of dedupedSeeds) {
      if (hook.length > 0) break;
      const key = normalize(seed);
      if (!key || globalChipKeys.has(key)) continue;
      if (seed.length > limits.hook) continue;
      const value = compact(seed.charAt(0).toUpperCase() + seed.slice(1), limits.hook);
      if (!value) continue;
      hook.push(value);
      globalChipKeys.add(normalize(value));
    }

    // Starter-chip fallback. Each field draws from its content-type
    // pool. The global key set prevents the same chip from being
    // assigned to two different fields. Each field is capped at 4
    // chips — enough to feel useful without overwhelming the layout.
    const mergeStarters = (slot: string[], fieldId: string, max: number): void => {
      const starters = getStarterChips(type, fieldId);
      for (const candidate of starters) {
        if (slot.length >= 4) break;
        const value = compact(candidate, max);
        if (!value) continue;
        const key = normalize(value);
        if (globalChipKeys.has(key)) continue;
        slot.push(value);
        globalChipKeys.add(key);
      }
    };
    mergeStarters(hook, 'hook', limits.hook);
    mergeStarters(headline, 'headline', limits.headline);
    mergeStarters(supporting, 'supportingText', limits.supportingText);
    mergeStarters(insight, 'keyInsight', limits.keyInsight);

    return { hook, headline, supportingText: supporting, keyInsight: insight };
  }, [writerSource?.body, writerSource?.title, answers.topic, answers.keyMessage, overlayText.hook, type]);

  // Suggestions for the freeform "Who is this for?" (audience) and "What
  // is the main message?" (keyMessage) form fields. Sourced from real
  // context — writer source, brand profile, brand overrides, topic, hook,
  // key insight — capped at 3 chips per field and deduplicated.
  const freeformFieldSuggestions = React.useMemo(() => {
    const MAX_CHIPS = 3;
    const compact = (raw: string, max: number): string => {
      const single = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!single) return '';
      return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
    };
    const capFirst = (s: string): string =>
      s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const pushUnique = (list: string[], value: string | undefined | null, max: number): void => {
      const compacted = compact(capFirst(String(value || '')), max);
      if (!compacted) return;
      const key = norm(compacted);
      if (list.some((existing) => norm(existing) === key)) return;
      if (list.length >= MAX_CHIPS) return;
      list.push(compacted);
    };

    // Audience candidates — priority: writer audience, brand override,
    // brand profile audience. Stops at 3 unique chips.
    const audience: string[] = [];
    pushUnique(audience, writerSource?.audience, 80);
    pushUnique(audience, brandOverrides.audience, 80);
    pushUnique(audience, brandProfile?.audience, 80);

    // Key-message candidates — priority order surfaces the most
    // specific content first (writer first sentence > typed insight >
    // typed hook > topic > writer title). Capped at 3 distinct chips.
    const keyMessage: string[] = [];
    const writerBody = String(writerSource?.body || '').trim();
    const writerFirstSentence = writerBody
      .split(/(?<=[.!?])\s+|\n+/u)[0]
      ?.trim() || '';
    pushUnique(keyMessage, writerFirstSentence, 200);
    pushUnique(keyMessage, overlayText.keyInsight, 200);
    pushUnique(keyMessage, overlayText.hook, 200);
    pushUnique(keyMessage, answers.topic, 200);
    pushUnique(keyMessage, writerSource?.title, 200);

    // CTA candidates — strategy-aware. Resolves the selected purpose
    // strategy and surfaces its `ctaSuggestions` array as click-ready
    // chips under the "Desired CTA" input. The CTA cap is intentionally
    // higher than other freeform chips because operators expect to see
    // every CTA the strategy curated (typically 4–5 click-ready phrases).
    const cta: string[] = [];
    const ctaStrategy = resolvePurposeStrategy(type, answers.subtype);
    const ctaCap = 6;
    const pushUniqueCta = (value: string | undefined | null): void => {
      const compacted = compact(capFirst(String(value || '')), 64);
      if (!compacted) return;
      const key = norm(compacted);
      if (cta.some((existing) => norm(existing) === key)) return;
      if (cta.length >= ctaCap) return;
      cta.push(compacted);
    };
    // Operator's typed overlay CTA is offered first if present.
    pushUniqueCta(overlayText.cta);
    if (ctaStrategy?.ctaSuggestions?.length) {
      for (const suggestion of ctaStrategy.ctaSuggestions) {
        pushUniqueCta(suggestion);
      }
    }

    // Operator feedback: chips must be unique across every field.
    // We track a global key set spanning audience / keyMessage / cta /
    // topic / dataPoints / refinement / objective so a starter chip
    // can never appear in two different question lists.
    const globalFreeformKeys = new Set<string>();
    for (const c of audience) globalFreeformKeys.add(norm(c));
    for (const c of keyMessage) globalFreeformKeys.add(norm(c));
    for (const c of cta) globalFreeformKeys.add(norm(c));

    const buildStarterList = (fieldId: string, max: number, alreadyPicked: string[] = []): string[] => {
      const list: string[] = [...alreadyPicked];
      const starters = getStarterChips(type, fieldId);
      for (const starter of starters) {
        if (list.length >= MAX_CHIPS) break;
        const compacted = compact(capFirst(String(starter || '')), max);
        if (!compacted) continue;
        const key = norm(compacted);
        if (globalFreeformKeys.has(key)) continue;
        list.push(compacted);
        globalFreeformKeys.add(key);
      }
      return list;
    };
    // Merge starters AFTER operator-derived values so live brand /
    // writer signals stay in front.
    const audienceWithStarters = buildStarterList('audience', 80, audience);
    const keyMessageWithStarters = buildStarterList('keyMessage', 200, keyMessage);
    const topic = buildStarterList('topic', 120);
    const dataPoints = buildStarterList('dataPoints', 200);
    const refinement = buildStarterList('refinement', 200);
    const objective = buildStarterList('objective', 200);

    return {
      audience: audienceWithStarters,
      keyMessage: keyMessageWithStarters,
      cta,
      topic,
      dataPoints,
      refinement,
      objective,
    };
  }, [
    writerSource?.audience,
    writerSource?.body,
    writerSource?.title,
    brandOverrides.audience,
    brandProfile?.audience,
    answers.topic,
    answers.subtype,
    overlayText.hook,
    overlayText.keyInsight,
    overlayText.cta,
    type,
  ]);

  const handleUseExistingAsset = (asset: SavedCreatorAsset) => {
    if (isGenerating || actionInProgress) return;
    setSelectedAssetId(asset.id);
    setAnswer('refinement', [
      answers.refinement,
      `Reuse existing creator asset "${asset.name}" as the starting context.`,
    ].filter(Boolean).join('\n'));
    if (!String(answers.topic || '').trim()) {
      // Programmatic restore (reuse-asset) — not a user edit; never mark manual.
      setAnswerSilent('topic', asset.name.replace(/\s+Asset$/i, ''));
    }

    // Final phase — continuity bundle restore. Resolution order:
    //   1. `asset.creator_metadata`  — surfaced by the API from the
    //      typed `creator_continuity` block (canonical).
    //   2. `asset.metadata`          — legacy attached-asset path.
    //   3. `asset.last_metadata`     — older legacy path.
    // Any field that is missing / mistyped is silently skipped so legacy
    // assets fail gracefully (no resets, no undefined writes, no leakage).
    const canonical = asset.creator_metadata && typeof asset.creator_metadata === 'object'
      ? asset.creator_metadata as Record<string, unknown>
      : null;
    const legacyA = (asset as unknown as { metadata?: Record<string, unknown> }).metadata ?? null;
    const legacyB = (asset as unknown as { last_metadata?: Record<string, unknown> }).last_metadata ?? null;
    const blob: Record<string, unknown> | null = canonical
      ?? (legacyA && typeof legacyA === 'object' ? legacyA : null)
      ?? (legacyB && typeof legacyB === 'object' ? legacyB : null);

    // Creator-type guard. If the saved asset's `asset_type` is recorded
    // and disagrees with the current Creator type (e.g. loading an
    // 'image' asset into a 'carousel' flow), we still copy compatible
    // fields (topic, refinement) but DO NOT restore type-specific state
    // (overlay text, attachment mode, subtype, etc.). This prevents cross-
    // type leakage that would corrupt the current flow.
    const savedAssetType = blob && typeof blob.asset_type === 'string' ? blob.asset_type : null;
    const typeMatch = !savedAssetType || savedAssetType === type;

    // Image-mode restore — only meaningful when current type is 'image'.
    if (type === 'image' && blob && typeMatch) {
      const persistedMode = blob.attachment_mode;
      if (persistedMode === 'embedded_copy' || persistedMode === 'supporting_visual') {
        setStandaloneAttachmentMode(persistedMode as AttachmentMode);
      }
    }

    // Overlay-text restore — supported by image (text_embedded), banner,
    // infographic. Snake/camel keys both accepted for compat with older
    // saves; non-strings silently skipped.
    if (typeMatch && blob && blob.overlay_text && typeof blob.overlay_text === 'object') {
      const ot = blob.overlay_text as Record<string, unknown>;
      setOverlayText({
        hook:           typeof ot.hook === 'string' ? ot.hook : '',
        headline:       typeof ot.headline === 'string' ? ot.headline : '',
        keyInsight:     typeof ot.keyInsight === 'string' ? ot.keyInsight : (typeof ot.key_insight === 'string' ? ot.key_insight : ''),
        cta:            typeof ot.cta === 'string' ? ot.cta : '',
        supportingText: typeof ot.supportingText === 'string' ? ot.supportingText : (typeof ot.supporting_text === 'string' ? ot.supporting_text : ''),
      });
    }

    // Subtype restore — guarded against missing/non-string values.
    if (typeMatch && blob && typeof blob.subtype === 'string' && blob.subtype.trim()) {
      setAnswer('subtype', blob.subtype);
    }

    // Brand-mode restore — accepts only the two canonical values; opens
    // the brand panel on 'brand-aware' so the user sees the restored
    // brand context.
    if (typeMatch && blob && typeof blob.brand_mode === 'string') {
      const persistedBrandMode = blob.brand_mode === 'brand-aware' ? 'brand-aware' : 'independent';
      setBrandMode(persistedBrandMode);
      if (persistedBrandMode === 'brand-aware') setBrandPanelOpen(true);
    }

    // Brand-presence restore — only valid when brand_mode is brand-aware.
    if (typeMatch && blob && typeof blob.brand_presence === 'string') {
      const presence = blob.brand_presence;
      if (presence === 'minimal' || presence === 'balanced' || presence === 'strong') {
        setBrandPresence(presence);
      }
    }

    // Platform restore — gated on the current config's primaryPlatforms
    // so we never set a platform the current Creator type cannot target.
    // Preserves platform continuity per Part 5: restored assets do NOT
    // re-expand unrelated platforms; the chip selection stays valid.
    if (typeMatch && blob && typeof blob.platform === 'string' && config?.primaryPlatforms.includes(blob.platform)) {
      setSelectedPlatform(blob.platform);
    }

    if (savedAssetType && savedAssetType !== type) {
      setNotice(`Using "${asset.name}" as context (originally a ${savedAssetType} asset; type-specific state was not restored to avoid leakage into the current ${type} flow).`);
    } else {
      setNotice(`Using existing asset "${asset.name}" as context for this ${config.title.toLowerCase()} flow.`);
    }

    // Structured event — emits one log line per restore so production
    // dashboards can pivot on restore_status (full / partial / legacy /
    // type-mismatch). Aggregates with the server-side `creator_event`
    // stream via the shared shape. Detail now includes the discriminators
    // (attachment mode, creator_type, subtype, platform) PLUS an explicit
    // `restoreFlavor` so 'modern' (typed creator_continuity block) is
    // distinguishable from 'legacy_backfill' (synthesized from
    // description/tags by the server) and 'legacy_metadata' (older
    // attached-asset path).
    const restoreStatus = blob === null
      ? (canonical === null && legacyA === null && legacyB === null ? 'legacy_no_metadata' : 'restore_skipped')
      : (savedAssetType && savedAssetType !== type ? 'partial_type_mismatch' : 'full');
    const synthesizedFromLegacy = canonical
      && typeof (canonical as Record<string, unknown>).synthesized_from_legacy === 'boolean'
      && (canonical as Record<string, unknown>).synthesized_from_legacy === true;
    const restoreFlavor = canonical
      ? (synthesizedFromLegacy ? 'legacy_backfill' : 'modern')
      : (legacyA ? 'legacy_metadata' : (legacyB ? 'legacy_last_metadata' : 'none'));
    try {
      console.info(JSON.stringify({
        event:        'creator_event',
        stage:        'restore',
        status:       restoreStatus === 'full' ? 'ok' : 'fallback',
        restoreStatus,
        restoreFlavor,
        creatorType:  type,
        assetType:    savedAssetType ?? null,
        attachmentMode: blob && typeof blob.attachment_mode === 'string' ? blob.attachment_mode : null,
        subtype:      blob && typeof blob.subtype === 'string' ? blob.subtype : null,
        platform:     blob && typeof blob.platform === 'string' ? blob.platform : null,
        usedSource:   canonical ? 'creator_metadata' : (legacyA ? 'legacy_metadata' : (legacyB ? 'legacy_last_metadata' : 'none')),
      }));
    } catch {
      // Structured logging is best-effort — never blocks the restore.
    }
  };

  const handleRefineSuggestion = () => {
    const note = String(refinePrompt || '').trim();
    if (!note) {
      setError('Add a short refinement note so AI knows what to push further.');
      return;
    }

    setError(null);
    const refined = `${selectedSuggestion.summary} Refine it further by making it ${note}.`;
    setRefinedSuggestion(refined);
    setNotice('AI direction refined. Generate when this feels right.');
  };

  // Generation-body builder (P1-1 fix). Constructs the canonical
  // request payload from current form state so fan-out can fire on
  // first click without requiring a prior baseline Generate.
  //
  // Pass `variantPinOverride` to override the operator's `variantPin`
  // — fan-out passes `null` because the runner adds variant_family
  // per decision; the single-variant path passes `variantPin` so the
  // operator's mode pick rides on the request.
  //
  // Returns null when the form is not ready (missing topic) — fan-out
  // callers receive null and short-circuit; handleGenerate sets the
  // error directly.
  const buildGenerationBody = React.useCallback((variantPinOverride: VariantFamily | null): Record<string, unknown> | null => {
    if (!String(answers.topic || '').trim()) return null;
    const writerStructureGuidance = writerSource && isDeterministicStructuredType(type)
      ? buildWriterStructureGuidance(writerSource, type as CreatorTypeId)
      : '';
    const writerCopyPolicy = writerCompositionIntent?.copyPolicy ?? null;
    const standaloneEmbeddedCopy = standaloneAttachmentMode === 'embedded_copy';
    const overlayAllowed = !writerSource || writerEmbeddedCopy;
    const overlayPayload = isSocialCreativeType(type) && overlayAllowed && (!writerSource ? !(type === 'image' && !standaloneEmbeddedCopy) : writerEmbeddedCopy)
      ? {
          hook: String(overlayText.hook || '').trim(),
          headline: String(overlayText.headline || answers.headline || answers.topic || '').trim(),
          keyInsight: String(overlayText.keyInsight || '').trim(),
          cta: (writerCopyPolicy?.allowCTA || (!writerSource && standaloneEmbeddedCopy)) ? String(overlayText.cta || answers.cta || '').trim() : '',
          supportingText: String(overlayText.supportingText || '').trim(),
        }
      : null;
    const constraintLines = [
      answers.subtype ? `Subtype: ${answers.subtype}` : '',
      !writerSource && answers.cta ? `CTA: ${answers.cta}` : '',
      answers.dataPoints ? `Data points: ${answers.dataPoints}` : '',
      answers.sectionDirection ? `Sections: ${answers.sectionDirection}` : '',
      answers.slideDirection ? `Slide direction: ${answers.slideDirection}` : '',
      answers.assetSubtype ? `Supporting asset type: ${answers.assetSubtype}` : '',
      answers.assetDirection ? `Supporting asset direction: ${answers.assetDirection}` : '',
      answers.headline ? `Headline: ${answers.headline}` : '',
      answers.continuity ? `Continuity: ${answers.continuity}` : '',
      answers.visualSystem ? `Visual continuity: ${answers.visualSystem}` : '',
      answers.hierarchy ? `Visual hierarchy: ${answers.hierarchy}` : '',
      answers.structureMode ? `Structure mode: ${answers.structureMode}` : '',
      answers.density ? `Density: ${answers.density}` : '',
      answers.styleDirection ? `Style direction: ${answers.styleDirection}` : '',
      answers.refinement ? `Additional notes: ${answers.refinement}` : '',
      selectedAsset ? `Use existing asset: ${selectedAsset.name} (${getSavedAssetCreatorType(selectedAsset)})` : '',
      selectedSuggestion ? `Selected AI direction: ${selectedSuggestion.summary}` : '',
      refinedSuggestion ? `Refined AI direction: ${refinedSuggestion}` : '',
      refinePrompt ? `Refinement prompt: ${refinePrompt}` : '',
      writerSource && writerSupportingVisual
        ? [
            `Source content imported from ${writerSource.sourceType}: ${writerSource.title}`,
            'Attachment mode: supporting_visual.',
            'Provider image must contain no visible text, CTA, paragraph overlay, thread restatement, or slide duplication.',
          ].join('\n')
        : writerSource && isSocialCreativeType(type) && overlayPayload
          ? [
              `Source content imported from ${writerSource.sourceType}: ${writerSource.title}`,
              'Creator layer owns deterministic typography for embedded copy.',
              `Hook: ${overlayPayload.hook}`,
              `Headline: ${overlayPayload.headline}`,
              `Key insight: ${overlayPayload.keyInsight}`,
              overlayPayload.cta ? `CTA: ${overlayPayload.cta}` : '',
              `Supporting: ${overlayPayload.supportingText}`,
            ].filter(Boolean).join('\n')
          : writerSource
            ? `Source content imported from ${writerSource.sourceType}: ${writerSource.title}\n${writerSource.body.slice(0, 1200)}`
            : '',
      writerStructureGuidance
        ? `Structured asset sequence:\n${writerStructureGuidance}`
        : '',
      writerSource?.sourceType === 'thread' && type === 'carousel'
        ? `Thread carousel safety: transform the source with ${writerCompositionIntent?.copyPolicy?.sourceTextTransform ?? 'none'} before slide generation; never directly map raw thread segments to slides.`
        : '',
      overlayPayload
        ? `Overlay text:\nHook: ${overlayPayload.hook}\nHeadline: ${overlayPayload.headline}\nKey insight: ${overlayPayload.keyInsight}\nCTA: ${overlayPayload.cta}\nSupporting: ${overlayPayload.supportingText}`
        : '',
      `Lightweight context:\n${serializeCreatorFlowContext(buildCurrentContext(selectedPlatform))}`,
      `Brand context:\n${brandContextLines.join('\n')}`,
      'Quality guardrails: avoid generic phrases like premium quality, unlock growth, game-changing, or elevate your brand unless the user supplied that language.',
      'Make the output specific to the selected platform, audience, objective, CTA, and visual personality.',
      'Use concrete visual hierarchy, hook framing, and CTA language rather than abstract marketing adjectives.',
    ].filter(Boolean);
    const layoutChoice = String(answers.layout || '').trim();
    const consolidatedContentType =
      config.contentType === 'image' && layoutChoice === 'wide-banner' ? 'banner' :
      config.contentType === 'carousel' && layoutChoice === 'widescreen-presentation' ? 'slider' :
      config.contentType;
    // CREATOR-PROD-005 — deterministic runtime payload (only when the flag is ON;
    // OFF is the default and keeps the legacy projectors below). The user's typed
    // values seed MANUAL overrides so content is preserved verbatim (PROD-004:
    // 100% parity). Any failure falls back to the legacy payload — never blocks.
    const v2Runtime = creatorRuntimeV2Live() && activeTemplate
      ? (() => {
          try {
            const v2Source = [String(answers.topic || ''), ...Object.values(templateValues.fields || {})]
              .filter(Boolean).join('\n').trim() || 'content';
            return runCreatorRuntimeV2({ template: activeTemplate, sourceText: v2Source, existingValues: templateValues });
          } catch { return null; }
        })()
      : null;
    return {
      company_id: selectedCompanyId || undefined,
      creator_type: type,
      content_type: consolidatedContentType,
      topic: String(answers.topic || '').trim(),
      objective: String(answers.objective || '').trim(),
      audience: String(answers.audience || '').trim(),
      summary: String(
        answers.keyMessage || answers.headline || answers.sectionDirection || answers.slideDirection || '',
      ).trim(),
      creator_card: {
        objective: String(answers.objective || '').trim(),
        audience: String(answers.audience || '').trim(),
        tone: String(answers.styleDirection || '').trim(),
        visual_intent: [answers.subtype, answers.styleDirection, answers.visualSystem, answers.hierarchy]
          .filter(Boolean)
          .join(' | '),
        supporting_asset_type: String(answers.assetSubtype || '').trim(),
        existing_asset_id: selectedAsset?.id || null,
        existing_asset_name: selectedAsset?.name || null,
        lightweight_context: buildCurrentContext(selectedPlatform),
        selected_platform: selectedPlatform,
        ...(variantPinOverride ? { variant_family: variantPinOverride } : {}),
        // CREATOR-059 follow-up: carry the wizard-selected visual blueprint so the
        // server can derive style/colour/layout guidance (additive; absent ⇒ no-op).
        ...(typeof router.query.blueprint === 'string' && router.query.blueprint ? { blueprint_id: router.query.blueprint } : {}),
        ...(!writerSource && type === 'image' ? { attachment_mode: standaloneAttachmentMode } : {}),
        writer_asset_type: writerAssetType,
        creator_content_asset_type: type,
        attachment_mode: writerAttachmentMode,
        asset_composition_intent: writerCompositionIntent,
        copy_policy: writerCopyPolicy,
        source_text_transform: writerCopyPolicy?.sourceTextTransform ?? null,
        infographic_layout: type === 'infographic' ? String(answers.structureMode || 'framework') : null,
        overlay_text: activeTemplate && activeTemplate.assetFamily === 'image'
          // Template "Text Inside Image" — the template fields are the ONLY
          // source of on-image text. `__template_authoritative` tells the
          // renderer to render exactly these fields (no topic/title/"Learn
          // more" fallback injection) and collapse empty optional fields.
          ? (v2Runtime
              ? (v2Runtime.payload.overlay_text as Record<string, unknown>)
              : (() => {
                  // The overlay copy must be the OPERATOR'S submitted inputs, never a
                  // template placeholder example (which the model then bakes garbled).
                  // Prefer the intake answers (topic → headline, main message →
                  // keyInsight, CTA); fall back to any real template-field value.
                  const tv = projectImageOverlayText(activeTemplate, templateValues);
                  return {
                    hook: '',
                    headline: (String(answers.topic || '').trim() || String(tv.headline || '').trim()).slice(0, 84),
                    keyInsight: (String(answers.keyMessage || '').trim() || String(tv.keyInsight || '').trim()).slice(0, 190),
                    cta: (String(answers.cta || '').trim() || String(tv.cta || '').trim()).slice(0, 42),
                    supportingText: String(tv.supportingText || '').trim().slice(0, 96),
                    __template_authoritative: true,
                  } as Record<string, unknown>;
                })())
          : overlayPayload,
        brand_generation_mode: brandMode,
        brand_presence: brandMode === 'brand-aware' ? brandPresence : 'none',
        brand_context: brandMode === 'brand-aware'
          ? {
              selections: brandSelections,
              profile: brandProfile,
              overrides: brandOverrides,
              context_lines: brandContextLines,
            }
          : {
              disabled: true,
              context_lines: brandContextLines,
            },
        source_content: writerSource
          ? {
              source_type: writerSource.sourceType,
              source_id: writerSource.sourceId,
              title: writerSource.title,
              snippet: writerSource.body.slice(0, 500),
              platform: writerSource.platform,
              hashtags: writerSource.hashtags,
            }
          : null,
        constraints: constraintLines.join('\n'),
        asset_type: type,
        // Creator Template Foundation — project the active template onto the
        // EXISTING pipeline inputs (template_id + purpose_key / subtype /
        // infographic_layout / attachment_mode / slide_count). No template →
        // template_id stays null and nothing else changes.
        ...(activeTemplate ? resolveTemplateCreatorCardPatch(activeTemplate) : { template_id: null }),
        ...(activeTemplate && activeTemplate.assetFamily === 'carousel'
          ? (v2Runtime
              ? { slides: v2Runtime.payload.slides ?? [], slide_count: (v2Runtime.payload.slides ?? []).length || null }
              : { slides: projectCarouselSlides(templateValues), slide_count: templateValues.slideCount ?? null })
          : {}),
        ...(activeTemplate && activeTemplate.assetFamily === 'infographic'
          ? (v2Runtime
              ? { infographic_sections: v2Runtime.payload.infographic_sections ?? [], template_fields: v2Runtime.payload.template_fields }
              : { infographic_sections: projectInfographicSections(templateValues), template_fields: templateValues.fields })
          : {}),
      },
      target_platforms: [selectedPlatform || config.primaryPlatforms[0]],
    };
  }, [
    type, config, answers, selectedAsset, selectedSuggestion, refinedSuggestion, refinePrompt,
    writerSource, writerSupportingVisual, writerEmbeddedCopy, writerCompositionIntent,
    writerAssetType, writerAttachmentMode, standaloneAttachmentMode,
    overlayText, brandMode, brandPresence, brandSelections, brandProfile, brandOverrides,
    brandContextLines, selectedPlatform, selectedCompanyId,
    activeTemplate, templateValues,
  ]);

  const handleGenerate = async () => {
    if (generationInFlightRef.current || isGenerating) return;
    if (!String(answers.topic || '').trim()) {
      setError('Please answer the main topic question first.');
      flagMissingTopic();
      return;
    }

    generationInFlightRef.current = true;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setSavedBlock(null);
    setResult(null);

    // Local computations needed by the validation gate AND by the
    // downstream metadata echo (where the saved asset's record
    // mirrors the operator's intent). The full request body is
    // constructed by buildGenerationBody (P1-1).
    const writerCopyPolicy = writerCompositionIntent?.copyPolicy ?? null;
    const standaloneEmbeddedCopy = standaloneAttachmentMode === 'embedded_copy';
    const overlayAllowed = !writerSource || writerEmbeddedCopy;
    const overlayPayload = isSocialCreativeType(type) && overlayAllowed && (!writerSource ? !(type === 'image' && !standaloneEmbeddedCopy) : writerEmbeddedCopy)
      ? {
          hook: String(overlayText.hook || '').trim(),
          headline: String(overlayText.headline || answers.headline || answers.topic || '').trim(),
          keyInsight: String(overlayText.keyInsight || '').trim(),
          cta: (writerCopyPolicy?.allowCTA || (!writerSource && standaloneEmbeddedCopy)) ? String(overlayText.cta || answers.cta || '').trim() : '',
          supportingText: String(overlayText.supportingText || '').trim(),
        }
      : null;
    if (writerSource && writerCompositionIntent) {
      const validation = validateAttachmentPayload({
        attachmentMode: writerCompositionIntent.attachmentMode,
        assetType: writerCompositionIntent.assetType,
        copyPolicy: writerCompositionIntent.copyPolicy,
        overlayText: overlayPayload,
        cta: overlayPayload?.cta,
        sourceType: writerSource.sourceType,
      });
      if (!validation.ok) {
        generationInFlightRef.current = false;
        setIsGenerating(false);
        setError(validation.errors.join('. '));
        return;
      }
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CREATOR_GENERATION_TIMEOUT_MS);

    try {
      // Build via the shared payload builder (P1-1 fix). The same
      // helper feeds the variant fan-out path so fan-out works on
      // first click without needing a prior baseline Generate.
      const generationBody = buildGenerationBody(variantPin);
      if (!generationBody) {
        generationInFlightRef.current = false;
        setIsGenerating(false);
        setError('Please answer the main topic question first.');
        flagMissingTopic();
        return;
      }
      const response = await fetch('/api/command-center/creator-content/generate', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const baseMessage = data?.error || data?.message || 'Failed to generate creator content.';
        // Surface the server's actionable context (per-rule rejection
        // reasons + remediation hints) instead of the opaque top-line —
        // e.g. the writer attachment validator returns `details`/`hints`
        // explaining how to unblock the payload.
        const hintLines = Array.isArray(data?.hints) ? data.hints.filter(Boolean) : [];
        const detailLines = hintLines.length === 0 && Array.isArray(data?.details)
          ? data.details.filter(Boolean)
          : [];
        const extra = [...hintLines, ...detailLines];
        throw new Error(extra.length > 0 ? `${baseMessage} — ${extra.join(' ')}` : baseMessage);
      }
      setResult(data as CreatorResult);
      // PHASE 14F: the generate persisted a new creator_assets row server-side.
      // Refetch saved assets and select the newest so the freshly generated
      // render appears and is shown immediately — no page reload required.
      selectNewestAssetRef.current = true;
      setAssetReloadNonce((n) => n + 1);
      const generatedMediaBundle = data?.output?.asset_payload?.media_bundle || {};
      const generatedMediaUrl = typeof generatedMediaBundle.url === 'string' ? generatedMediaBundle.url : '';
      const generatedMetadata = generatedMediaBundle.metadata && typeof generatedMediaBundle.metadata === 'object'
        ? generatedMediaBundle.metadata as Record<string, unknown>
        : {};
      if (generatedMediaUrl && isSocialCreativeType(type)) {
        appendCreatorVisualReviewCandidate({
          id: `${Date.now()}-${type}-${selectedPlatform}`,
          createdAt: new Date().toISOString(),
          assetType: type,
          platform: selectedPlatform,
          title: String(answers.topic || config.title || '').trim() || `${config.title} creative`,
          mediaUrl: generatedMediaUrl,
          caption: String(data?.output?.packaging?.caption || '').trim(),
          metadata: generatedMetadata,
          overlayText: generatedMetadata.overlay_text && typeof generatedMetadata.overlay_text === 'object'
            ? generatedMetadata.overlay_text as Record<string, unknown>
            : undefined,
          score: Number((generatedMetadata.overlay_quality as { score?: unknown } | undefined)?.score ?? 0) || null,
        });
      }
      if (writerSource && type) {
        const mediaBundle = generatedMediaBundle;
        const renderedAttachmentMode = writerSource ? null : type === 'image'
          ? (generatedMetadata.attachment_mode === 'embedded_copy' || generatedMetadata.attachment_mode === 'supporting_visual'
              ? (generatedMetadata.attachment_mode as AttachmentMode)
              : standaloneAttachmentMode)
          : null;
        // Continuity bundle (Part 2). Every attached-asset record now carries
        // the full restore set:
        //   - attachmentMode (supporting_visual vs embedded_copy)
        //   - overlayText  (so reopening preserves the exact overlay copy)
        //   - subtype      (so promotional/quote/educational direction sticks)
        //   - platform     (so reopening keeps Writer-imported platform pin)
        //   - brandMode    (so brand-aware vs independent is preserved)
        //   - files        (multi-file assets — carousel slides, PDFs)
        //   - metadata     (full server response for diagnostic/remix paths)
        // Reads on `handleUseExistingAsset` + Writer chip render use these
        // fields; legacy callers see them as optional and ignore.
        const filesFromBundle = Array.isArray(mediaBundle.files)
          ? mediaBundle.files.filter((file: unknown): file is string => typeof file === 'string')
          : undefined;
        const attachmentMetadata = {
            ...generatedMetadata,
            // Echo the client-side intent so reopen restores subtype +
            // overlayText + brandMode without needing to parse them out of
            // the server response.
            subtype:    String(answers.subtype || '').trim() || undefined,
            attachment_mode: writerAttachmentMode,
            asset_composition_intent: writerCompositionIntent,
            copy_policy: writerCopyPolicy,
            source_text_transform: writerCopyPolicy?.sourceTextTransform,
            overlay_text: overlayPayload ?? undefined,
            brand_mode:     brandMode,
            brand_presence: brandMode === 'brand-aware' ? brandPresence : undefined,
            ...(!writerSource && type === 'image' ? { recommended_attachment_mode: recommendedAttachmentMode ?? undefined } : {}),
            platform: selectedPlatform,
          };
        // Canonical lifecycle — attach through the session (which owns the draft
        // target + lifecycle and delegates to the ONE durable persistence). Creator
        // never appends to writer storage directly.
        void attachAssetToSession(
          attachmentSessionTokenRef.current || (typeof router.query.session === 'string' ? router.query.session : ''),
          {
            id: generateCreatorAssetId({ kind: type }),
            creatorType: (writerAssetType ?? normalizeWriterCreatorAssetType(type)) as CreatorAssetLaunchType,
            title: `${config.title} for ${writerSource.title}`,
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined,
            files: filesFromBundle,
            previewKind: typeof mediaBundle.metadata?.preview_kind === 'string' ? mediaBundle.metadata.preview_kind : undefined,
            attachmentMode: writerAttachmentMode ?? undefined,
            compositionIntent: writerCompositionIntent ?? undefined,
            platformContext: selectedPlatform,
            renderIdentityHash: typeof generatedMetadata.renderIdentityHash === 'string'
              ? generatedMetadata.renderIdentityHash
              : typeof generatedMetadata.render_identity_hash === 'string'
                ? generatedMetadata.render_identity_hash
                : undefined,
            metadata: attachmentMetadata,
            createdAt: new Date().toISOString(),
          },
          {
            companyId: selectedCompanyId,
            sourceContent: {
              sourceType: writerSource.sourceType,
              sourceId: writerSource.sourceId,
              title: writerSource.title,
              body: writerSource.body,
              platform: writerSource.platform,
              hashtags: writerSource.hashtags,
            },
          },
        );
      }
    } catch (generationError) {
      const isAbort = generationError instanceof Error && generationError.name === 'AbortError';
      setError(
        isAbort
          ? 'Generation is taking longer than expected. Please try again in a moment.'
          : generationError instanceof Error
            ? generationError.message
            : 'Failed to generate creator content.',
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsGenerating(false);
      generationInFlightRef.current = false;
    }
  };

  const handleRenderInline = async () => {
    if (!result || inlineRenderInFlight) return;
    const assetPayload = result.output?.asset_payload as Record<string, unknown> | undefined;
    if (!assetPayload) return;
    setInlineRenderInFlight(true);
    setInlineRenderError(null);
    try {
      const response = await fetch('/api/command-center/creator-content/render-inline', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_payload: assetPayload,
          company_id: selectedCompanyId,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        rendered?: { url?: string; files?: string[]; metadata?: Record<string, unknown> };
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.success || !payload.rendered) {
        const msg = payload?.message || payload?.error || `Inline render failed (HTTP ${response.status})`;
        setInlineRenderError(msg);
        return;
      }
      const renderedFiles = Array.isArray(payload.rendered.files)
        ? payload.rendered.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
        : [];
      const renderedUrl = typeof payload.rendered.url === 'string' ? payload.rendered.url : '';
      if (renderedFiles.length === 0 && !renderedUrl) {
        setInlineRenderError('Inline render returned no images.');
        return;
      }
      setResult((current) => {
        if (!current) return current;
        const payload2 = current.output.asset_payload;
        const existingBundle = payload2.media_bundle ?? {};
        const mergedBundle = {
          ...existingBundle,
          ...(renderedUrl ? { url: renderedUrl } : {}),
          ...(renderedFiles.length > 0 ? { files: renderedFiles } : {}),
          metadata: {
            ...(existingBundle.metadata ?? {}),
            ...(payload.rendered!.metadata ?? {}),
            render_async: false,
            render_completed_at: new Date().toISOString(),
            rendered_via: 'inline_fallback',
          },
        };
        return {
          ...current,
          output: {
            ...current.output,
            asset_payload: {
              ...payload2,
              media_bundle: mergedBundle,
            },
          },
        };
      });
    } catch (err) {
      setInlineRenderError(err instanceof Error ? err.message : 'Inline render failed.');
    } finally {
      setInlineRenderInFlight(false);
    }
  };

  const handleOpenScheduler = (intent: 'schedule' | 'publish' = 'schedule') => {
    const socialActionLabel = config.contentType === 'thread' ? 'thread' : 'post';
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError(`Generate a usable creator output before using it as a ${socialActionLabel}.`);
      return;
    }
    setActionInProgress(intent === 'publish' ? `share-${socialActionLabel}` : `schedule-${socialActionLabel}`);
    try {
      const context = buildCurrentContext(result.primary_platform);
      const generatedMediaUrls = summarizeMediaUrls(result);
      const mediaBundle = result.output.asset_payload.media_bundle || {};
      const mediaMetadata = getMediaPreviewMetadata(result);
      const mediaTypes = generatedMediaUrls.map(() => (type === 'video' || type === 'reel' || type === 'short' ? 'video' : type === 'pdf' ? 'document' : 'image'));
      const primaryPlatform = selectedPlatform || result.primary_platform || null;
      const creatorAttachments = generatedMediaUrls.length > 0
        ? [{
            id: selectedAsset?.id || generateCreatorAssetId({ kind: type }),
            creatorType: config.contentType,
            title: String(answers.topic || config.title),
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : generatedMediaUrls[0],
            files: Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : generatedMediaUrls,
            previewKind: typeof mediaMetadata.preview_kind === 'string' ? mediaMetadata.preview_kind : null,
            platformContext: primaryPlatform,
            metadata: mediaMetadata,
            createdAt: new Date().toISOString(),
          }]
        : [];
      launchSocialPostingFromContent({
        router,
        contentType: config.contentType as any,
        title: String(answers.topic || config.title),
        content: `${result.output.packaging.caption}\n\n${context.CTA ? `CTA: ${context.CTA}` : ''}`.trim(),
        tags: result.output.packaging.hashtags,
        excerpt: result.output.packaging.meta_description,
        sourceId: selectedAsset?.id || null,
        platform: primaryPlatform,
        mediaUrls: generatedMediaUrls,
        mediaTypes,
        creatorAttachments,
        intent,
      });
    } catch (schedulerError) {
      setError(schedulerError instanceof Error ? schedulerError.message : `Could not open this output as a ${socialActionLabel}.`);
      setActionInProgress(null);
    }
  };

  const handleSaveAsBlog = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before saving it as a blog.');
      return;
    }
    setActionInProgress('blog');
    try {
      launchBlogFromCreator({
        router,
        title: String(answers.topic || config.title),
        output: result.output,
        context: buildCurrentContext(result.primary_platform),
      });
    } catch (blogError) {
      setError(blogError instanceof Error ? blogError.message : 'Could not open this output as a blog draft.');
      setActionInProgress(null);
    }
  };

  const handleRepurpose = (path: RepurposePath) => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before repurposing it.');
      return;
    }
    if (!repurposePaths.some((entry) => entry.id === path.id)) {
      setError('That repurpose path is not available for this creator type.');
      return;
    }
    const title = String(answers.topic || config.title);
    setActionInProgress(`repurpose-${path.id}`);
    try {
      if (path.id === 'linkedin-post') {
        launchSocialPostingFromContent({
          router,
          contentType: 'post',
          title,
          content: result.output.packaging.caption,
          tags: result.output.packaging.hashtags,
          excerpt: result.output.packaging.meta_description,
          sourceId: selectedAsset?.id || null,
        });
        return;
      }
      if (path.id === 'thread') {
        launchSocialPostingFromContent({
          router,
          contentType: 'thread',
          title,
          content: result.output.packaging.caption,
          tags: result.output.packaging.hashtags,
          excerpt: result.output.packaging.meta_description,
          sourceId: selectedAsset?.id || null,
        });
        return;
      }
      launchBlogFromCreator({
        router,
        title: path.id === 'long-form-outline' ? `${title} Long-Form Outline` : title,
        output: result.output,
        context: buildCurrentContext(result.primary_platform),
      });
    } catch (repurposeError) {
      setError(repurposeError instanceof Error ? repurposeError.message : 'Could not repurpose this output.');
      setActionInProgress(null);
    }
  };

  const handleSaveAsBlock = async () => {
    if (saveInFlightRef.current || isSavingBlock) return;
    if (!hasUsableCreatorOutput(result)) {
      setError('Generate a usable creator output before saving it as an asset.');
      return;
    }
    if (!selectedCompanyId) {
      setError('Select a company before saving this creator output as an asset.');
      return;
    }
    saveInFlightRef.current = true;
    setIsSavingBlock(true);
    setError(null);
    setNotice(null);

    try {
      const rendererMetadata = ((result.output.asset_payload?.media_bundle as any)?.metadata || {}) as Record<string, any>;
      const persistedRendererMetadata = {
        tenantId: rendererMetadata.tenantId || rendererMetadata.tenant_id || null,
        companyId: rendererMetadata.companyId || rendererMetadata.company_id || selectedCompanyId,
        paletteUsed: rendererMetadata.paletteUsed || rendererMetadata.palette_used || null,
        logoSource: rendererMetadata.logoSource || rendererMetadata.logo_source || null,
        rendererVersion: rendererMetadata.rendererVersion || rendererMetadata.renderer_version || null,
        layoutVariantId: rendererMetadata.layoutVariantId || rendererMetadata.layout_variant_id || null,
        platformContext: rendererMetadata.platformContext || result.primary_platform || null,
        renderIdentityHash: rendererMetadata.renderIdentityHash || rendererMetadata.render_identity_hash || null,
        exportCapabilities: rendererMetadata.exportCapabilities || rendererMetadata.export_capabilities || null,
      };
      // Continuity bundle (final phase). Build the metadata block that the
      // API will surface as `creator_metadata` on subsequent reads. Mirrors
      // the WriterAttachedAsset bundle so "Use Existing Asset" restore is
      // a superset of attached-asset reopen. The bundle is prepended to
      // content_blocks as a typed marker that downstream renderers skip.
      const mediaBundleForSave = (result.output.asset_payload?.media_bundle as any) || {};
      const filesForSave = Array.isArray(mediaBundleForSave.files)
        ? (mediaBundleForSave.files as unknown[]).filter((f): f is string => typeof f === 'string')
        : null;
      const continuityMetadata = {
        asset_type:             type,
        attachment_mode:        writerAttachmentMode,
        asset_composition_intent: writerCompositionIntent,
        copy_policy:            writerCompositionIntent?.copyPolicy ?? null,
        source_text_transform:  writerCompositionIntent?.copyPolicy?.sourceTextTransform ?? null,
        ...(!writerSource && type === 'image' ? {
          attachment_mode: standaloneAttachmentMode,
          recommended_attachment_mode: recommendedAttachmentMode ?? null,
        } : {}),
        overlay_text:           isSocialCreativeType(type) && !writerSupportingVisual && (!writerSource ? !(type === 'image' && standaloneAttachmentMode === 'supporting_visual') : writerEmbeddedCopy)
          ? {
              hook:           overlayText.hook,
              headline:       overlayText.headline,
              keyInsight:     overlayText.keyInsight,
              // CTA is no longer captured as a dedicated overlay input —
              // the workflow's "What action should the viewer take?"
              // (answers.cta) is the single source of truth. Preserve
              // overlayText.cta if a legacy session restored a value.
              cta:            overlayText.cta || String(answers.cta || '').trim(),
              supportingText: overlayText.supportingText,
            }
          : null,
        subtype:         String(answers.subtype || '').trim() || null,
        brand_mode:      brandMode,
        brand_presence:  brandMode === 'brand-aware' ? brandPresence : null,
        platform:        selectedPlatform || result.primary_platform || null,
        files:           filesForSave,
        preview_kind:    typeof rendererMetadata.preview_kind === 'string' ? rendererMetadata.preview_kind : null,
        platformContext: persistedRendererMetadata.platformContext,
        renderIdentityHash: persistedRendererMetadata.renderIdentityHash,
        renderer_metadata:  rendererMetadata,
      };
      // SINGLE storage path: creator_assets table, categorized by
      // creator_type. The block_templates POST that used to run here
      // polluted the blog-templates UI with creator assets — that path
      // is gone. The full continuity bundle now travels inside
      // asset.metadata.creator_continuity so "Use Existing Asset"
      // restore still has everything it needs without a parallel
      // block_template row.
      const assetTitle = `${String(answers.topic || config.title).trim()} Asset`;
      const description = `Creator asset from ${config.title}. Stored for future long-form writer reuse.\n\n${serializeCreatorFlowContext(buildCurrentContext(result.primary_platform))}`;
      const mediaBundle = result.output.asset_payload?.media_bundle || {};
      const creatorTypeForSave = writerAssetType ?? (type === 'image' ? 'supporting_image' : type);

      const response = await fetch('/api/creator-assets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          source_type: writerSource?.sourceType,
          source_id: writerSource?.sourceId,
          source_content: writerSource ? {
            sourceType: writerSource.sourceType,
            sourceId: writerSource.sourceId,
            title: writerSource.title,
            body: writerSource.body,
            platform: writerSource.platform,
            hashtags: writerSource.hashtags,
          } : null,
          asset: {
            creatorType: creatorTypeForSave,
            title: assetTitle,
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined,
            files: Array.isArray(mediaBundle.files) ? mediaBundle.files : undefined,
            previewKind: typeof rendererMetadata.preview_kind === 'string' ? rendererMetadata.preview_kind : undefined,
            platformContext: result.primary_platform || selectedPlatform,
            renderIdentityHash: persistedRendererMetadata.renderIdentityHash,
            metadata: {
              ...rendererMetadata,
              creatorContentAssetType: type,
              description,
              creator_continuity: { ...continuityMetadata, schema_version: 1 },
              tags: [
                ...result.output.packaging.hashtags,
                'creator-asset',
                config.contentType,
                `source:${type}`,
                answers.audience ? `audience:${answers.audience}` : '',
                answers.cta ? `cta:${answers.cta}` : '',
                persistedRendererMetadata.rendererVersion ? `renderer:${persistedRendererMetadata.rendererVersion}` : '',
                persistedRendererMetadata.logoSource ? `logo:${persistedRendererMetadata.logoSource}` : '',
                persistedRendererMetadata.layoutVariantId ? `layout:${persistedRendererMetadata.layoutVariantId}` : '',
                String(answers.assetSubtype || result.output.asset_type || '').trim(),
              ].filter(Boolean),
            },
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save this creator output as a reusable asset.');
      }

      const assetId = String(data?.asset?.id || '').trim();
      const nextSavedBlock = assetId
        ? {
            id: assetId,
            reference: buildBlockReference(assetId),
            name: assetTitle,
          }
        : null;

      setSavedBlock(nextSavedBlock);
      setNotice(
        nextSavedBlock
          ? `Saved to your ${config.title.toLowerCase()} asset library. Long-form content can pull this from the asset picker.`
          : 'Saved as a reusable creator asset. Long-form content can pull it from the asset picker.',
      );
      if (nextSavedBlock) {
        setSelectedAssetId(nextSavedBlock.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save this creator output as a reusable asset.');
    } finally {
      setIsSavingBlock(false);
      saveInFlightRef.current = false;
    }
  };

  const handleDownloadBrief = async () => {
    if (actionInProgress || !hasUsableCreatorOutput(result) || typeof window === 'undefined') {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before downloading it.');
      return;
    }
    setActionInProgress('download');
    try {
      // Download the rendered image asset itself (PNG / JPG) — NOT a
      // markdown brief. Earlier this handler emitted a `.md` summary of
      // the creator output which was the wrong artifact for an image-
      // focused workflow. We fetch the primary media URL, infer the
      // extension from the URL path, and stream it through a Blob anchor
      // so cross-origin Supabase storage URLs download cleanly.
      const imageUrl = mediaUrls[0];
      if (!imageUrl) {
        setError('No image available to download yet.');
        return;
      }
      const title = String(answers.topic || config.title || 'creator-asset').trim();
      const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'creator-asset';
      let ext = 'png';
      try {
        const parsed = new URL(imageUrl, window.location.href);
        const extMatch = parsed.pathname.match(/\.(png|jpe?g|webp|gif|svg)$/i);
        if (extMatch) ext = extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase();
      } catch {
        // keep png fallback
      }
      const filename = `${safeTitle}.${ext}`;
      const response = await fetch(imageUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error(`fetch failed (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      setNotice(`Downloaded ${filename}.`);
    } catch {
      setError('Could not prepare the download. Please try again.');
    } finally {
      setActionInProgress(null);
    }
  };

  const mediaUrls = summarizeMediaUrls(result);
  const previewMetadata = getMediaPreviewMetadata(result);
  const previewKind = previewMetadata.preview_kind || '';
  const isDirectionCardPreview = previewKind === 'direction_card';
  const isProviderImagePreview = previewKind === 'provider_image' || previewKind === 'social_creative';
  const isThemeTreatment = previewKind === 'theme_treatment';
  // Theme treatment payload exposed on asset_payload for guidance-only
  // formats (video, reel, short, podcast). Pulled out here so the JSX block
  // below stays readable.
  const themeAssetPayload = (result?.output?.asset_payload || {}) as Record<string, unknown>;
  const themeHookScene = (themeAssetPayload.hook_scene && typeof themeAssetPayload.hook_scene === 'object'
    ? themeAssetPayload.hook_scene as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeCtaScene = (themeAssetPayload.cta_scene && typeof themeAssetPayload.cta_scene === 'object'
    ? themeAssetPayload.cta_scene as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeScenes: Array<Record<string, unknown>> = Array.isArray(themeAssetPayload.scenes)
    ? (themeAssetPayload.scenes as unknown[]).filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && !Array.isArray(s)))
    : [];
  const themePlatformNotes = (themeAssetPayload.platform_notes && typeof themeAssetPayload.platform_notes === 'object'
    ? themeAssetPayload.platform_notes as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeDurationSeconds = Number(themeAssetPayload.duration_seconds ?? 0);
  const themeAspectRatio = String(themeAssetPayload.aspect_ratio || themePlatformNotes.optimal_aspect_ratio || '9:16');
  const documentUrl = typeof previewMetadata.document_url === 'string' ? previewMetadata.document_url : '';
  const documentFallbackReason = typeof previewMetadata.document_fallback_reason === 'string'
    ? previewMetadata.document_fallback_reason
    : '';
  // Part 3 — graceful-degradation surface fields. `pdf_document_status`
  // is the authoritative signal; `pdf_document_user_message` is ready-
  // to-display copy categorized by the renderer.
  const pdfDocumentStatus = typeof previewMetadata.pdf_document_status === 'string'
    ? previewMetadata.pdf_document_status
    : '';
  const pdfDocumentFallbackCategory = typeof previewMetadata.pdf_document_fallback_category === 'string'
    ? previewMetadata.pdf_document_fallback_category
    : '';
  const pdfDocumentUserMessage = typeof previewMetadata.pdf_document_user_message === 'string'
    ? previewMetadata.pdf_document_user_message
    : '';
  const pdfPreviewPagesAvailable = typeof previewMetadata.pdf_preview_pages_available === 'number'
    ? previewMetadata.pdf_preview_pages_available
    : 0;
  const previewWidth = Number(previewMetadata.width || 1) || 1;
  const previewHeight = Number(previewMetadata.height || 1) || 1;
  const previewAspectRatio = `${previewWidth} / ${previewHeight}`;
  const overlayQuality = previewMetadata.overlay_quality && typeof previewMetadata.overlay_quality === 'object'
    ? previewMetadata.overlay_quality as { score?: number; flags?: string[]; preset?: string }
    : null;
  const creatorQuality = previewMetadata.creator_quality_score && typeof previewMetadata.creator_quality_score === 'object'
    ? previewMetadata.creator_quality_score as { cleanliness?: number; readability?: number; clutterRisk?: number; warnings?: string[] }
    : null;
  const visualGovernanceWarnings = Array.isArray(previewMetadata.visual_governance_warnings)
    ? previewMetadata.visual_governance_warnings.map(String).filter(Boolean)
    : [];
  const slides = Array.isArray(result?.output.asset_payload.slides) ? result.output.asset_payload.slides : [];
  // config can be null here (router query not yet ready / unknown type) — this
  // const sits ABOVE the `if (!config)` guard below, so it must be null-safe.
  // The value is only consumed in the post-guard render where config is non-null.
  const socialActionLabel = config?.contentType === 'thread' ? 'thread' : 'post';

  // Relocated from the top of the component (post Rendering Forensic
  // Audit). These early returns must fire AFTER every hook in the
  // component has been called this render — otherwise React sees a
  // different hook count between renders. All three branches are pure
  // rendering decisions; they do not depend on state that hasn't been
  // computed by this point.
  if (!authChecked || isLoading) {
    return <PageLoader message="Loading creator studio…" />;
  }
  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;
  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-600">
          Unknown creator content type.
        </div>
      </div>
    );
  }

  const selectedSubtype = config.subtypeOptions.find((option) => option.value === answers.subtype) || config.subtypeOptions[0];
  const proposalLine = [
    refinedSuggestion || selectedSuggestion?.summary || '',
  ].filter(Boolean).join(' ');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <button
          onClick={() => router.push('/command-center/creator-content')}
          className="flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Creator Content
        </button>

        <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Creator Workflow
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
            {config.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-600 md:text-base">
            {config.intro}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Custom Brief</p>
                <p className="mt-1 text-sm text-gray-600">Pick the closest structured options first. AI will only need minimal extra direction after that.</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                {config.fields.length + 1} inputs
              </span>
            </div>

            <div className="space-y-5">
              {activeTemplate ? (
                <div>
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                    <div className="text-sm text-blue-900">
                      <span className="font-semibold">Template:</span> {activeTemplate.name}
                      <span className="ml-2 text-blue-700">{activeTemplate.description}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/command-center/creator-content/${type}/templates`)}
                      className="ml-3 shrink-0 text-xs font-semibold text-blue-700 underline hover:text-blue-900"
                    >
                      Change
                    </button>
                  </div>
                  <TemplateFieldsPanel
                    template={activeTemplate}
                    values={templateValues}
                    onChange={handleEditorChange}
                    onAiAssist={handleTemplateAiAssist}
                    aiBusyKey={aiBusyKey}
                  />
                </div>
              ) : null}
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{config.subtypeLabel}</span>
                <div className="grid gap-3 md:grid-cols-3">
                  {config.subtypeOptions.map((option) => {
                    const selected = (answers.subtype || config.subtypeOptions[0]?.value) === option.value;
                    // Pre-generation CTA suggestion. Looks up the
                    // strategy's CTA intensity + the CTA-slide intent
                    // text so the operator sees, at strategy-pick
                    // time, what the closing CTA will land like.
                    const optionStrategy = resolvePurposeStrategy(type, option.value);
                    const optionCtaIntensity = optionStrategy?.ctaIntensity ?? null;
                    const optionCtaSlide = optionStrategy?.slideArc
                      ?.find((s) => s.role === 'cta' || s.role === 'next_steps')?.intent ?? null;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAnswer('subtype', option.value)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className={`mt-1 text-xs leading-5 ${selected ? 'text-slate-200' : 'text-gray-500'}`}>
                          {option.description}
                        </p>
                        {optionCtaIntensity || optionCtaSlide ? (
                          <div
                            className={`mt-2 rounded-lg px-2 py-1.5 text-[10px] leading-4 ${
                              selected
                                ? 'bg-white/15 text-slate-100'
                                : 'bg-emerald-50 text-emerald-900'
                            }`}
                          >
                            {optionCtaIntensity ? (
                              <p className="font-semibold uppercase tracking-wider">
                                CTA: {optionCtaIntensity}
                              </p>
                            ) : null}
                            {optionCtaSlide ? (
                              <p className="mt-0.5">{optionCtaSlide}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Generation Context</p>
                    <p className="mt-1 text-sm text-gray-600">Choose whether this output should follow company identity or stay independent.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBrandPanelOpen((open) => !open)}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300"
                  >
                    Brand Context {brandPanelOpen ? 'Hide' : 'Show'}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    { id: 'brand-aware' as CreatorBrandMode, label: 'Brand-Aware Generation', body: 'Use selected company identity, tone, visual references, and audience context.' },
                    { id: 'independent' as CreatorBrandMode, label: 'Independent Creative Generation', body: 'Ignore company identity and keep the creative direction freeform.' },
                  ].map((option) => {
                    const selected = brandMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setBrandMode(option.id)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full border ${selected ? 'border-white bg-white' : 'border-gray-400 bg-white'}`} />
                          <p className="text-sm font-semibold">{option.label}</p>
                        </div>
                        <p className={`mt-2 text-xs leading-5 ${selected ? 'text-slate-200' : 'text-gray-500'}`}>
                          {option.body}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {brandPanelOpen && (
                  <div className="mt-4 space-y-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Brand Context</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {isLoadingBrandProfile
                            ? 'Loading company defaults...'
                            : hasBrandProfile
                              ? 'Defaults are prefilled from company profile, but nothing is forced.'
                              : 'No full company profile found. Add only the brand details you want to use.'}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        brandMode === 'brand-aware' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
                      }`}>
                        {brandMode === 'brand-aware' ? 'Branding enabled' : 'Branding ignored'}
                      </span>
                    </div>

                    {brandMode === 'brand-aware' && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Brand Presence</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            { id: 'minimal' as BrandPresence, label: 'Minimal' },
                            { id: 'balanced' as BrandPresence, label: 'Balanced' },
                            { id: 'strong' as BrandPresence, label: 'Strong' },
                          ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setBrandPresence(option.id)}
                              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                                brandPresence === option.id
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {brandMode === 'independent' ? (
                      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                        Independent mode keeps these brand fields out of generation. Your entered values stay here if you switch back.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Company Context</p>
                          <p className="mt-1 text-sm text-gray-600">Use the company identity, audience, and positioning signals you choose below.</p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            { id: 'companyContext' as const, label: 'Company Context', field: 'companyName', placeholder: 'Company name or identity context' },
                            { id: 'logo' as const, label: 'Company Logo', field: 'logoUrl', placeholder: 'Logo URL' },
                            { id: 'favicon' as const, label: 'Company Favicon', field: 'faviconUrl', placeholder: 'Favicon URL' },
                            { id: 'tagline' as const, label: 'Tagline', field: 'tagline', placeholder: 'Optional tagline' },
                            { id: 'brandTone' as const, label: 'Brand Tone', field: 'brandTone', placeholder: 'Professional, warm, bold...' },
                            { id: 'brandColors' as const, label: 'Brand Colors', field: 'brandColors', placeholder: '#0B5ED7, #111827...' },
                            { id: 'audience' as const, label: 'Audience', field: 'audience', placeholder: 'Target audience context' },
                            { id: 'campaign' as const, label: 'Campaign Association', field: 'campaign', placeholder: 'Campaign, launch, or initiative' },
                          ].map((item) => {
                            const isSizable = item.id === 'logo' || item.id === 'favicon';
                            const sizeFieldKey = isSizable ? `${item.id}Size` : '';
                            const currentSize = isSizable ? normalizeBrandAssetSize(brandOverrides[sizeFieldKey]) : null;
                            return (
                              <div key={item.id} className="rounded-xl border border-gray-200 bg-white px-3 py-3">
                                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                                  <input
                                    type="checkbox"
                                    checked={brandSelections[item.id]}
                                    onChange={(event) => setBrandSelection(item.id, event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-slate-900"
                                  />
                                  {item.label}
                                </label>
                                <input
                                  value={brandOverrides[item.field] || ''}
                                  onChange={(event) => setBrandOverride(item.field, event.target.value)}
                                  placeholder={item.placeholder}
                                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                                />
                                {isSizable && brandSelections[item.id] ? (
                                  <div className="mt-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                                      Size on asset
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-3">
                                      {BRAND_ASSET_SIZE_PRESETS.map((preset) => (
                                        <label
                                          key={preset.value}
                                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700"
                                        >
                                          <input
                                            type="radio"
                                            name={`${item.id}-size`}
                                            value={preset.value}
                                            checked={currentSize === preset.value}
                                            onChange={() => setBrandOverride(sizeFieldKey, preset.value)}
                                            className="h-3.5 w-3.5 border-gray-300 text-slate-900"
                                          />
                                          {preset.label} ({brandAssetSizePx(item.id, preset.value)}px)
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      {type === 'post' || type === 'thread' ? 'Use / Attach Existing Asset' : 'Use Existing Asset'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {type === 'post' || type === 'thread'
                        ? 'Optional: attach a saved Creator asset as context without creating a separate asset-based category.'
                        : 'Optional: pull a saved Creator asset into this brief as reusable context.'}
                    </p>
                  </div>
                  {selectedAsset ? (
                    <button
                      type="button"
                      onClick={() => setSelectedAssetId(null)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300"
                    >
                      Clear Asset
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {isLoadingAssets ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                      Loading saved assets...
                    </div>
                  ) : savedAssets.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                      No saved Creator assets yet. Generated outputs saved as assets will appear here.
                    </div>
                  ) : (
                    savedAssets.slice(0, 4).map((asset) => {
                      const selected = selectedAssetId === asset.id;
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => handleUseExistingAsset(asset)}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            selected
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                              : 'border-gray-200 bg-white text-gray-800 hover:border-emerald-200'
                          }`}
                        >
                          <p className="text-sm font-semibold">{asset.name}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {(() => {
                              const modeLabel = getSavedAssetAttachmentLabel(asset);
                              const parts = [
                                getSavedAssetCreatorType(asset),
                                modeLabel,
                                `${asset.usage_count || 0} uses`,
                              ].filter(Boolean);
                              return parts.join(' · ');
                            })()}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {(() => {
                // Selected-asset visual preview. Surfaces the slide
                // images of the existing saved carousel/infographic so
                // operators can SEE what they're reusing before they
                // generate. Falls back to the single image when the
                // asset is a single-frame type.
                if (!selectedAsset) return null;
                // Canonical reader path (PHASE 14F): resolve image URL(s) from
                // the reconciled media_files (creator_continuity.files →
                // metadata.files → files column → url column), instead of only
                // creator_metadata.files which most write paths never populate.
                const savedFiles: string[] = Array.isArray(selectedAsset.media_files)
                  ? selectedAsset.media_files.filter(Boolean)
                  : [];
                if (savedFiles.length === 0) return null;
                const savedType = getSavedAssetCreatorType(selectedAsset);
                const isCarousel = savedFiles.length > 1
                  || /carousel|pdf|slider|infographic/i.test(savedType);
                const sectionLabel = /infographic/i.test(savedType) ? 'Sections' : 'Slides';
                return (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800">
                        Selected Asset Preview · {selectedAsset.name}
                      </p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        {savedFiles.length} {savedFiles.length === 1 ? 'frame' : sectionLabel.toLowerCase()}
                      </span>
                    </div>
                    {isCarousel ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {savedFiles.map((src, idx) => (
                          <a
                            key={`${src}-${idx}`}
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${sectionLabel.slice(0, -1)} ${idx + 1}`}
                            className="block overflow-hidden rounded-xl border border-emerald-100 bg-white"
                          >
                            <div className="flex items-center justify-between bg-emerald-50/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                              <span>{sectionLabel.slice(0, -1)} {idx + 1} / {savedFiles.length}</span>
                            </div>
                            <img
                              src={src}
                              alt={`${selectedAsset.name} ${sectionLabel.slice(0, -1)} ${idx + 1}`}
                              loading="lazy"
                              className="block h-44 w-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <a
                        href={savedFiles[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-xl border border-emerald-100 bg-white"
                      >
                        <img
                          src={savedFiles[0]}
                          alt={selectedAsset.name}
                          loading="lazy"
                          className="block w-full object-cover"
                        />
                      </a>
                    )}
                  </div>
                );
              })()}

              {writerSource ? (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700">Source Content</p>
                  <p className="mt-2 text-sm font-semibold text-indigo-950">
                    Imported from {writerSource.sourceType === 'thread' ? 'Thread' : 'Post'}
                  </p>
                  <p className="mt-1 text-sm text-indigo-900">{writerSource.title}</p>
                  <p className="mt-2 text-xs font-semibold text-indigo-900">
                    {writerAttachmentMode === 'embedded_copy' ? 'Embedded copy' : 'Supporting visual'} · {writerCompositionIntent?.assetType ?? 'asset'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-indigo-800">
                    {writerSupportingVisual
                      ? 'No overlay text, CTA, paragraph rendering, or thread restatement is allowed for this asset.'
                      : `Copy policy: headline ${writerCompositionIntent?.copyPolicy?.allowHeadline ? 'allowed' : 'blocked'}, key insight ${writerCompositionIntent?.copyPolicy?.allowKeyInsight ? 'allowed' : 'blocked'}, CTA ${writerCompositionIntent?.copyPolicy?.allowCTA ? 'allowed' : 'blocked'}.`}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-indigo-800">
                    {writerSource.body}
                  </p>
                </div>
              ) : null}

              {/*
                Image-mode selector — shown only for the Image creator type.
                Two modes (composition / text_embedded). The recommendation
                pill renders when the launcher's recommendation differs from
                the audit-default (text_embedded for strong threads + quote-
                style posts); a click on the pill snaps to that mode.
              */}
              {type === 'image' && !writerSource ? (
                <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Attachment Mode</p>
                      <p className="mt-1 text-sm text-sky-900">
                        Choose how text and image relate. The renderer skips the deterministic overlay in <span className="font-semibold">Post + Image</span> mode.
                      </p>
                    </div>
                    {recommendedAttachmentMode && recommendedAttachmentMode !== standaloneAttachmentMode ? (
                      <button
                        type="button"
                        onClick={() => setStandaloneAttachmentMode(recommendedAttachmentMode)}
                        className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                        title="Use the recommended attachment mode"
                      >
                        Recommended:&nbsp;
                        {recommendedAttachmentMode === 'embedded_copy' ? 'Text Inside Image' : 'Post + Image'}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      {
                        value: 'supporting_visual' as AttachmentMode,
                        label: 'Post + Image',
                        description: 'Post text stays outside the image. The image visually complements your content.',
                      },
                      {
                        value: 'embedded_copy' as AttachmentMode,
                        label: 'Text Inside Image',
                        description: 'Headline, hook, and CTA are embedded directly inside the image.',
                      },
                    ].map((option) => {
                      const selected = standaloneAttachmentMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setStandaloneAttachmentMode(option.value)}
                          aria-pressed={selected}
                          data-attachment-mode={option.value}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            selected
                              ? 'border-sky-500 bg-sky-100 text-sky-950 shadow-sm'
                              : 'border-sky-200 bg-white text-sky-900 hover:border-sky-300'
                          }`}
                        >
                          <p className="text-sm font-semibold">{option.label}</p>
                          <p className="mt-1 text-xs leading-5 text-sky-800/80">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isSocialCreativeType(type) && !writerSupportingVisual && (!writerSource ? !(type === 'image' && standaloneAttachmentMode === 'supporting_visual') : writerEmbeddedCopy) ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Platform & Overlay Text</p>
                      <p className="mt-1 text-sm text-emerald-900">
                        This text is rendered programmatically on the final creative. Keep it short and platform-native.
                      </p>
                    </div>
                    {writerSource ? (
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
                        Prefilled from Writer
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Selected Platform</p>
                    {writerSource ? (
                      <p className="mb-2 text-xs leading-5 text-emerald-800">
                        Imported Writer platform is preserved for this creative. Open a new Add Asset flow to target another platform.
                      </p>
                    ) : connectedPlatforms === null ? (
                      <p className="mb-2 text-xs leading-5 text-emerald-700">Loading connected platforms…</p>
                    ) : availablePlatforms.length === 0 ? (
                      <p className="mb-2 text-xs leading-5 text-amber-700">
                        No connected platforms support this content type yet. Connect a platform from Settings to enable publishing for this creative.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {(writerSource ? [selectedPlatform] : availablePlatforms).filter(Boolean).map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => { if (!writerSource) setSelectedPlatform(platform); }}
                          disabled={Boolean(writerSource)}
                          className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                            selectedPlatform === platform
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-emerald-200 bg-white text-emerald-800 hover:border-emerald-300'
                          }`}
                        >
                          {humanizeValue(platform)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      { id: 'hook' as const, label: 'Hook', placeholder: 'Short attention hook', max: 76 },
                      { id: 'headline' as const, label: 'Headline', placeholder: 'Main creative headline', max: 84 },
                      { id: 'supportingText' as const, label: 'Supporting Text', placeholder: 'One short proof, context, or benefit line', max: 96 },
                    ].map((field) => {
                      const suggestions = overlayFieldSuggestions[field.id] || [];
                      return (
                        <label key={field.id} className="block">
                          <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                            <span>{field.label}</span>
                            <span className="font-medium normal-case tracking-normal text-emerald-600">
                              {(overlayText[field.id] || '').length}/{field.max}
                            </span>
                          </span>
                          <input
                            value={overlayText[field.id] || ''}
                            onChange={(event) => setOverlayField(field.id, event.target.value)}
                            placeholder={field.placeholder}
                            maxLength={field.max}
                            className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          />
                          {suggestions.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {suggestions.map((suggestion) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  onClick={() => setOverlayField(field.id, suggestion)}
                                  className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                                  title={`Use: ${suggestion}`}
                                >
                                  {suggestion.length > 36 ? `${suggestion.slice(0, 35).trimEnd()}…` : suggestion}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </label>
                      );
                    })}
                    <label className="block md:col-span-2">
                      <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                        <span>Key Insight</span>
                        <span className="font-medium normal-case tracking-normal text-emerald-600">
                          {(overlayText.keyInsight || '').length}/132
                        </span>
                      </span>
                      <textarea
                        value={overlayText.keyInsight || ''}
                        onChange={(event) => setOverlayField('keyInsight', event.target.value)}
                        rows={2}
                        placeholder="The strongest positioning statement or insight from the Writer content"
                        maxLength={132}
                        className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      {(overlayFieldSuggestions.keyInsight || []).length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {overlayFieldSuggestions.keyInsight.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => setOverlayField('keyInsight', suggestion)}
                              className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                              title={`Use: ${suggestion}`}
                            >
                              {suggestion.length > 56 ? `${suggestion.slice(0, 55).trimEnd()}…` : suggestion}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-emerald-800">
                    The CTA you set in "What action should the viewer take?" below is reused on the creative — set it once and we'll render it on the asset. Platform choice still controls density, CTA weight, and brand treatment.
                  </p>
                </div>
              ) : null}

              {config.fields.map((field) => {
                // Field-id → chip-array mapping. Every freeform text
                // field gets starter chips so the operator always has
                // a clickable suggestion (operator feedback: "for all
                // these issues offer suggestions that can be picked
                // to start with"). For 'single-select' fields we
                // don't render chips because the buttons themselves
                // are the picks.
                const freeformChips: string[] =
                  field.id === 'audience' ? freeformFieldSuggestions.audience
                  : field.id === 'keyMessage' ? freeformFieldSuggestions.keyMessage
                  : field.id === 'cta' ? freeformFieldSuggestions.cta
                  : field.id === 'topic' ? (freeformFieldSuggestions as Record<string, string[]>).topic ?? []
                  : field.id === 'dataPoints' ? (freeformFieldSuggestions as Record<string, string[]>).dataPoints ?? []
                  : field.id === 'refinement' ? (freeformFieldSuggestions as Record<string, string[]>).refinement ?? []
                  : field.id === 'objective' ? (freeformFieldSuggestions as Record<string, string[]>).objective ?? []
                  : [];
                const isTopicField = field.id === 'topic';
                const topicInvalid = isTopicField && topicMissing && !String(answers.topic || '').trim();
                return (
                <div key={field.id} ref={isTopicField ? topicFieldRef : undefined} className="block scroll-mt-24">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                    {field.label}{isTopicField ? <span className="text-rose-500"> *</span> : null}
                  </span>
                  {field.kind === 'single-select' ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      {field.options.map((option) => {
                        const selected = answers[field.id] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setAnswer(field.id, option.value)}
                            className={`rounded-2xl border px-4 py-4 text-left transition ${
                              selected
                                ? 'border-sky-500 bg-sky-50 text-sky-900'
                                : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                            }`}
                          >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className={`mt-1 text-xs leading-5 ${selected ? 'text-sky-700' : 'text-gray-500'}`}>
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : field.kind === 'textarea' ? (
                    <textarea
                      value={answers[field.id] || ''}
                      onChange={(event) => setAnswer(field.id, event.target.value)}
                      rows={field.rows || 3}
                      placeholder={field.placeholder}
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  ) : (
                    <div className="space-y-2">
                      {Array.isArray(field.presets) && field.presets.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {field.presets.map((preset) => {
                            const selected = (answers[field.id] || '').trim().toLowerCase() === preset.toLowerCase();
                            return (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setAnswer(field.id, preset)}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  selected
                                    ? 'border-sky-500 bg-sky-50 text-sky-800'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-slate-300'
                                }`}
                              >
                                {preset}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <input
                        value={answers[field.id] || ''}
                        onChange={(event) => setAnswer(field.id, event.target.value)}
                        placeholder={field.placeholder}
                        aria-invalid={topicInvalid || undefined}
                        className={`w-full rounded-2xl border px-4 py-3 text-sm text-gray-900 outline-none transition ${
                          topicInvalid
                            ? 'border-rose-400 ring-2 ring-rose-200 focus:border-rose-400 focus:ring-rose-200'
                            : 'border-gray-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200'
                        }`}
                      />
                      {topicInvalid ? (
                        <p className="text-xs font-medium text-rose-600">This is required to generate — tell us what the {type} is about.</p>
                      ) : null}
                    </div>
                  )}
                  {freeformChips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {freeformChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAnswer(field.id, chip)}
                          className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                          title={`Use: ${chip}`}
                        >
                          {chip.length > 56 ? `${chip.slice(0, 55).trimEnd()}…` : chip}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">AI Suggestion</p>
              <p className="mt-2 text-sm leading-relaxed text-sky-900">
                {proposalLine || `AI will propose a ${config.title.toLowerCase()} direction using your ${generationModeLabel} and the choices above.`}
              </p>
            </div>

            {error && (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {notice && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {notice}
              </div>
            )}

            {/* Variant Experience Embedding — surfaces variant
                planner + winner display when the operator's selected
                subtype resolves to a known strategy. Renders nothing
                when subtype is empty or unknown so legacy flows are
                untouched. */}
            <CreatorVariantExperienceSection
              type={type}
              subtype={answers.subtype}
              companyId={selectedCompanyId || ''}
              variantPin={variantPin}
              setVariantPin={setVariantPin}
              variantPlan={variantPlan}
              setVariantPlan={setVariantPlan}
              variantFanOutInFlight={variantFanOutInFlight}
              variantFanOutSummary={variantFanOutSummary}
              onSingleDecisionReady={(family) => {
                // P1-4 — single-decision modes (single_variant /
                // best_variant) auto-fire Generate once the planner
                // settles so operators don't have to click twice.
                setVariantPin(family);
                if (!generationInFlightRef.current && !isGenerating) {
                  void handleGenerate();
                }
              }}
              onFanOut={async (plan) => {
                if (!selectedCompanyId || !plan) return;
                setVariantFanOutInFlight(true);
                setVariantFanOutSummary(null);
                try {
                  // P1-1 — build the canonical payload directly from
                  // current form state so fan-out works on the first
                  // click. Variant pin is null because the runner
                  // adds `variant_family` per decision.
                  const basePayload = buildGenerationBody(null);
                  if (!basePayload) {
                    setVariantFanOutSummary('Please answer the main topic question first so the fan-out can describe the brief.');
                    return;
                  }
                  const result = await runVariantFanOut({
                    companyId: selectedCompanyId,
                    plan,
                    request: { basePayload },
                  });
                  setVariantFanOutSummary(
                    `${result.successCount} of ${result.outcomes.length} variant assets generated`
                    + (result.failureCount > 0 ? ` · ${result.failureCount} failed (see console)` : ''),
                  );
                } catch (err) {
                  setVariantFanOutSummary(err instanceof Error ? err.message : 'Variant fan-out failed.');
                } finally {
                  setVariantFanOutInFlight(false);
                }
              }}
            />

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating
                  ? 'Generating...'
                  : variantPin
                    ? `Generate ${config.title} — Variant ${variantPin.toUpperCase()}`
                    : `Generate ${config.title}`}
              </button>
            </div>

            {isGenerating && showProgress ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Working on your {config.title.toLowerCase()}</p>
                </div>
                <ol className="space-y-2">
                  {[
                    'Preparing your brief',
                    'Generating image with AI',
                    'Composing overlay text',
                    'Saving the asset',
                  ].map((label, idx) => {
                    const status: 'done' | 'active' | 'pending' =
                      idx < generationStage ? 'done' : idx === generationStage ? 'active' : 'pending';
                    return (
                      <li key={label} className="flex items-start gap-3 text-sm">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                            status === 'done'
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : status === 'active'
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-400'
                          }`}
                          aria-hidden="true"
                        >
                          {status === 'done' ? '✓' : idx + 1}
                        </span>
                        <span
                          className={
                            status === 'pending' ? 'text-slate-400'
                              : status === 'active' ? 'font-semibold text-slate-900'
                                : 'text-slate-700'
                          }
                        >
                          {label}
                          {status === 'active' ? <span className="ml-2 inline-block animate-pulse text-slate-500">…</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-[11px] text-slate-500">
                  Heavy renders can take 15–25 seconds. You can leave this page open — we keep working in the background.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <div
              ref={resultPanelRef}
              className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8 scroll-mt-24"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                {result ? 'Generated Output' : 'Pick A Direction'}
              </p>
              {/* Quality Inspector — read-only panel for the attached diagnostic
                  report (image / carousel / infographic). Renders only when the
                  asset metadata carries a creator_diagnostic_report. */}
              {(() => {
                const diagnosticReport = getDiagnosticReport(result);
                return diagnosticReport ? <CreatorQualityInspector report={diagnosticReport} /> : null;
              })()}
              {!result ? (
                <div className="mt-4 space-y-5">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <p className="text-sm font-medium text-gray-700">
                      AI has prepared starting directions from your selections. Pick one, refine it if needed, then generate.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {suggestionOptions.map((option) => {
                      const selected = selectedSuggestionId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedSuggestionId(option.id);
                            setRefinedSuggestion(null);
                            setNotice(null);
                          }}
                          className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                            selected
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">{option.label}</p>
                            {selected ? (
                              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                                Selected
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {option.badges.map((badge) => (
                              <span
                                key={badge}
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                                  selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                          <p className={`mt-2 text-sm leading-6 ${selected ? 'text-slate-100' : 'text-gray-700'}`}>
                            {option.summary}
                          </p>
                          <p className={`mt-2 text-xs leading-5 ${selected ? 'text-slate-300' : 'text-gray-500'}`}>
                            {option.rationale}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Refine With AI</p>
                    <p className="mt-2 text-sm leading-6 text-blue-900">
                      Tell AI what to change if the selected direction is close but not quite right.
                    </p>
                    <textarea
                      value={refinePrompt}
                      onChange={(event) => setRefinePrompt(event.target.value)}
                      rows={3}
                      placeholder="Example: make it less corporate, more premium, and more visual-first."
                      className="mt-3 w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={handleRefineSuggestion}
                      disabled={isGenerating || Boolean(actionInProgress)}
                      className="mt-3 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Refine Direction
                    </button>
                    {refinedSuggestion ? (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-white px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Refined Direction</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">{refinedSuggestion}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {result.output.asset_type}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700">
                        {result.primary_platform}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.output.packaging.caption}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {result.output.packaging.hashtags.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                          {tag.startsWith('#') ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* CREATOR-010 — Generation Review & Traceability (read-only,
                      derived from the existing result + diagnostic report). */}
                  {(() => {
                    const review = buildGenerationReview({
                      result,
                      error,
                      inProgress: isGenerating,
                      progressStatus: renderJobProgress?.status ?? null,
                    });
                    return (
                      <GenerationReviewPanel
                        model={review}
                        onRegenerate={handleGenerate}
                        onDownload={handleDownloadBrief}
                        onOpenInEditor={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        downloadBusy={actionInProgress === 'download'}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })()}

                  {/* CREATOR-011 — Asset Review & Quick Refine (read-only review +
                      lightweight refinement of EXISTING editor values). */}
                  {activeTemplate ? (() => {
                    const bundle = (result.output.asset_payload?.media_bundle ?? {}) as { url?: string; files?: string[]; metadata?: Record<string, unknown> };
                    const md = (bundle.metadata ?? {}) as Record<string, unknown>;
                    const diag = getDiagnosticReport(result);
                    const previewUrl = bundle.url ?? (Array.isArray(bundle.files) ? bundle.files[0] : undefined) ?? null;
                    const appliedVariant = (md.applied_variant ?? {}) as Record<string, unknown>;
                    const reviewMeta = { ...((diag?.rendering ?? {}) as Record<string, unknown>), brand_mode: md.brand_mode };
                    const edited = generatedSnapshot ? JSON.stringify(templateValues) !== JSON.stringify(generatedSnapshot) : false;
                    return (
                      <AssetReviewPanel
                        template={activeTemplate}
                        values={templateValues}
                        onChange={handleEditorChange}
                        meta={reviewMeta}
                        previewUrl={previewUrl}
                        assetId={(result as { persisted_asset_id?: string | null }).persisted_asset_id ?? null}
                        assetName={activeTemplate.name}
                        assetType={result.output.asset_type ?? null}
                        platform={result.primary_platform ?? null}
                        variant={typeof appliedVariant.variant_family === 'string' ? appliedVariant.variant_family : null}
                        status={isGenerating ? 'processing' : 'completed'}
                        timestamp={diag?.generatedAt ?? null}
                        templateVersion={diag?.template?.version ?? activeTemplate.version ?? null}
                        originalValues={generatedSnapshot}
                        edited={edited}
                        regenerations={regenCount}
                        onDownload={handleDownloadBrief}
                        onOpenEditor={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        onRegenerate={handleGenerate}
                        onDuplicate={handleSaveAsBlock}
                        downloadBusy={actionInProgress === 'download'}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })() : null}

                  {/* CAMPAIGN-005 / PLATFORM-001 — Campaign Package via the ONE
                      canonical creator-result→package projection (no inline asset
                      assembly). References only; no duplicate storage / re-render. */}
                  {activeTemplate ? (() => {
                    const edited = generatedSnapshot ? JSON.stringify(templateValues) !== JSON.stringify(generatedSnapshot) : false;
                    const pkg = buildCreatorCampaignPackage(result, {
                      templateName: activeTemplate.name,
                      templateId: activeTemplate.id,
                      assetFamily: activeTemplate.assetFamily,
                      selectedPlatform: selectedPlatform || result.primary_platform || null,
                      campaign: {
                        name: (typeof answers.topic === 'string' && answers.topic.trim()) ? answers.topic.trim() : activeTemplate.name,
                        objective: (typeof answers.objective === 'string' && answers.objective.trim()) ? answers.objective.trim() : null,
                        audience: (typeof answers.audience === 'string' && answers.audience.trim()) ? answers.audience.trim() : null,
                        platforms: [selectedPlatform || result.primary_platform].filter((p): p is string => !!p),
                      },
                      edited,
                      regenerations: regenCount,
                      inProgress: isGenerating,
                    });
                    return (
                      <CampaignPackagePanel
                        pkg={pkg}
                        onOpenAsset={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        onRegenerate={handleGenerate}
                        onDuplicate={handleSaveAsBlock}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })() : null}

                  {(() => {
                    // Async-render status banner. Carousel / infographic
                    // / pdf / slider go through a durable queue
                    // (creatorAssetRegistry: render_strategy='queue'),
                    // so generation returns before the slide PNGs are
                    // ready. The polling effect at the top of this
                    // component pulls them in once the job completes,
                    // but the operator needs a visible signal that the
                    // rendering is still in flight.
                    const bundleMeta = (result.output.asset_payload.media_bundle?.metadata ?? {}) as Record<string, unknown>;
                    const renderAsync = bundleMeta.render_async === true;
                    const hasFiles = Array.isArray(result.output.asset_payload.media_bundle?.files)
                      && (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean).length > 0;
                    if (!renderAsync || hasFiles) return null;
                    const percent = renderJobProgress?.percent ?? 0;
                    const status = renderJobProgress?.status ?? 'queued';
                    const queuedSeconds = renderJobProgress?.queuedSeconds ?? 0;
                    // If the job sits in queued/waiting for >25s, no
                    // render worker is consuming the queue. In dev that
                    // typically means `npm run dev` (--app-only) was used
                    // instead of `npm run dev:full`. Surface that
                    // explicitly so the operator stops staring at a
                    // frozen 0% bar.
                    const workerStalled = (status === 'queued' || status === 'waiting') && queuedSeconds >= 25;
                    const isQueued = status === 'queued' || status === 'waiting';
                    const isActive = status === 'active';
                    // Status label is fully honest: it never says
                    // "rendering" when the job is in fact just sitting
                    // in a queue waiting for a worker.
                    const statusLabel = workerStalled
                      ? 'Render worker not responding'
                      : isQueued
                        ? `Queued — waiting for a render worker (${queuedSeconds}s)`
                        : isActive
                          ? 'Rendering slides'
                          : status === 'completed'
                            ? 'Finalizing'
                            : 'Rendering slides';
                    const bannerColor = workerStalled ? 'rose' : 'amber';
                    // Progress-bar fill: honest. 0 means 0. We never
                    // paint a fake minimum just to make the bar visible.
                    // While queued, the bar is empty and the (indeterminate)
                    // animated stripe communicates "we're waiting".
                    return (
                      <div className={`rounded-2xl border ${bannerColor === 'rose' ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50'} px-4 py-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                workerStalled
                                  ? 'bg-rose-500'
                                  : isActive
                                    ? 'animate-pulse bg-emerald-500'
                                    : 'animate-pulse bg-amber-500'
                              }`}
                              aria-hidden="true"
                            />
                            <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${workerStalled ? 'text-rose-900' : 'text-amber-900'}`}>
                              {statusLabel}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold tabular-nums ${workerStalled ? 'text-rose-900' : 'text-amber-900'}`}>
                            {percent}%
                          </span>
                        </div>
                        <div
                          className={`mt-3 h-2 w-full overflow-hidden rounded-full ${workerStalled ? 'bg-rose-100' : 'bg-amber-100'}`}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label="Slide rendering progress"
                        >
                          {isQueued && percent === 0 ? (
                            // Indeterminate stripe for the queued state.
                            // No fake fill — the actual value is 0 and the
                            // animated pulse makes that visually honest.
                            <div className="h-full w-full animate-pulse rounded-full bg-amber-200" />
                          ) : (
                            <div
                              className={`h-full rounded-full ${workerStalled ? 'bg-rose-400' : 'bg-amber-500'} transition-[width] duration-700 ease-out`}
                              style={{ width: `${percent}%` }}
                            />
                          )}
                        </div>
                        {workerStalled ? (
                          <>
                            <p className="mt-2 text-sm leading-6 text-rose-900">
                              The render queue has the job but no worker is consuming it. In local dev this usually means the app was started with <code className="rounded bg-rose-100 px-1 py-0.5 text-[12px] font-mono">npm run dev</code> instead of <code className="rounded bg-rose-100 px-1 py-0.5 text-[12px] font-mono">npm run dev:full</code> — the latter starts the creator-render worker.
                            </p>
                            <p className="mt-1 text-[11px] text-rose-700">
                              Or bypass the queue entirely and render synchronously in this request. Slide structure + copy below are preserved either way.
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleRenderInline(); }}
                                disabled={inlineRenderInFlight}
                                className="rounded-2xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {inlineRenderInFlight ? 'Rendering inline… this can take 30–60s' : 'Render inline now'}
                              </button>
                              {inlineRenderError ? (
                                <span className="text-[11px] font-medium text-rose-800">{inlineRenderError}</span>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-amber-900">
                            Slide structure and copy are ready below. Slide images render asynchronously and will appear here automatically — usually within 30–60 seconds. Stay on this page.
                          </p>
                        )}
                        {renderJobProgress?.attempts && renderJobProgress.attempts > 1 ? (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Retry attempt {renderJobProgress.attempts} — the worker had a transient issue and is trying again.
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}

                  {isThemeTreatment && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Theme Treatment</p>
                        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">
                          {String(config.contentType).toUpperCase()}
                        </span>
                        {themeDurationSeconds > 0 ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                            {themeDurationSeconds}s target
                          </span>
                        ) : null}
                        {themeAspectRatio ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                            {themeAspectRatio}
                          </span>
                        ) : null}
                      </div>

                      <p className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-5 text-indigo-900">
                        AI cannot produce the final {String(config.contentType)} file — that requires human production. The treatment below is your shot-by-shot brief: hand it to your editor / producer as-is.
                      </p>

                      {Object.keys(themeHookScene).length > 0 && (
                        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Hook Scene</p>
                          {themeHookScene.duration_seconds ? (
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                              {String(themeHookScene.duration_seconds)}s
                            </p>
                          ) : null}
                          {themeHookScene.visual ? (
                            <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold">Visual: </span>{String(themeHookScene.visual)}</p>
                          ) : null}
                          {themeHookScene.text ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">On-screen / VO: </span>{String(themeHookScene.text)}</p>
                          ) : themeHookScene.dialogue ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Dialogue: </span>{String(themeHookScene.dialogue)}</p>
                          ) : null}
                          {themeHookScene.audio ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Audio: </span>{String(themeHookScene.audio)}</p>
                          ) : null}
                          {themeHookScene.camera_direction ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Camera: </span>{String(themeHookScene.camera_direction)}</p>
                          ) : null}
                        </div>
                      )}

                      {themeScenes.length > 0 && (
                        <div>
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Scenes</p>
                          <div className="space-y-2">
                            {themeScenes.map((scene, index) => (
                              <div key={`scene-${index}`} className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-900">Scene {String(scene.scene_number ?? index + 1)}</span>
                                  {scene.duration_seconds ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{String(scene.duration_seconds)}s</span>
                                  ) : null}
                                  {scene.transition ? (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">→ {String(scene.transition)}</span>
                                  ) : null}
                                </div>
                                {scene.visual ? (
                                  <p className="mt-2 text-sm leading-6 text-gray-700"><span className="font-semibold">Visual: </span>{String(scene.visual)}</p>
                                ) : null}
                                {scene.dialogue ? (
                                  <p className="mt-1 text-sm leading-6 text-gray-700"><span className="font-semibold">Dialogue / VO: </span>{String(scene.dialogue)}</p>
                                ) : null}
                                {scene.audio_cue ? (
                                  <p className="mt-1 text-sm leading-6 text-gray-700"><span className="font-semibold">Audio cue: </span>{String(scene.audio_cue)}</p>
                                ) : null}
                                {scene.pacing_note ? (
                                  <p className="mt-1 text-xs leading-5 text-gray-500"><span className="font-semibold">Pacing: </span>{String(scene.pacing_note)}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {Object.keys(themeCtaScene).length > 0 && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">CTA Scene</p>
                          {themeCtaScene.visual ? (
                            <p className="mt-2 text-sm leading-6 text-emerald-950"><span className="font-semibold">Visual: </span>{String(themeCtaScene.visual)}</p>
                          ) : null}
                          {themeCtaScene.text ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">On-screen / VO: </span>{String(themeCtaScene.text)}</p>
                          ) : null}
                          {themeCtaScene.audio ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">Audio: </span>{String(themeCtaScene.audio)}</p>
                          ) : null}
                          {themeCtaScene.platform_cta ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">Platform CTA: </span>{String(themeCtaScene.platform_cta)}</p>
                          ) : null}
                        </div>
                      )}

                      {Object.keys(themePlatformNotes).length > 0 && (
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Platform Notes</p>
                          {themePlatformNotes.optimal_aspect_ratio ? <p className="mt-1">Aspect ratio: {String(themePlatformNotes.optimal_aspect_ratio)}</p> : null}
                          {Array.isArray(themePlatformNotes.recommended_platforms) && themePlatformNotes.recommended_platforms.length > 0 ? (
                            <p className="mt-1">Recommended platforms: {(themePlatformNotes.recommended_platforms as unknown[]).map(String).join(', ')}</p>
                          ) : null}
                          {themePlatformNotes.trending_audio_style ? <p className="mt-1">Audio style: {String(themePlatformNotes.trending_audio_style)}</p> : null}
                          {themePlatformNotes.target_retention_point ? <p className="mt-1">Retention target: {String(themePlatformNotes.target_retention_point)}</p> : null}
                        </div>
                      )}
                    </div>
                  )}

                  {mediaUrls.length > 0 && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Preview</p>
                          {isProviderImagePreview ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                              Social creative
                            </span>
                          ) : null}
                          {overlayQuality ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                              Quality {overlayQuality.score ?? 'n/a'}
                            </span>
                          ) : null}
                          {creatorQuality ? (
                            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-semibold text-cyan-800">
                              Clean {creatorQuality.cleanliness ?? 'n/a'} · Read {creatorQuality.readability ?? 'n/a'}
                            </span>
                          ) : null}
                          {isDirectionCardPreview ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                              Direction preview
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={mediaUrls[0]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 3h6v6" />
                            <path d="M10 14 21 3" />
                            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                          </svg>
                          View full size
                        </a>
                      </div>
                      <div className="grid gap-3">
                        {mediaUrls.map((url, index) => (
                          <div key={url} className="max-w-xs overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open full size"
                              className="block"
                            >
                              <img
                                src={url}
                                alt={`${config.title} preview ${index + 1}`}
                                style={{ aspectRatio: previewAspectRatio }}
                                className="w-full bg-gray-100 object-contain"
                                loading="lazy"
                                onError={() => setError('Preview could not load. The generated media URL is still available in the output actions.')}
                              />
                            </a>
                            <div className="border-t border-gray-100 px-3 py-2">
                              <a href={url} target="_blank" rel="noreferrer" className="break-all text-[11px] font-medium text-blue-700 hover:text-blue-900">
                                {url}
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                      {documentUrl ? (
                        <a
                          href={documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          Open downloadable PDF
                        </a>
                      ) : null}
                      {previewKind === 'pdf_document' && !documentUrl ? (
                        <div
                          className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
                          role="status"
                          data-pdf-status={pdfDocumentStatus || 'preview_only'}
                          data-pdf-fallback={pdfDocumentFallbackCategory || 'unknown_storage_error'}
                        >
                          <p className="font-semibold">
                            Preview available · Download unavailable
                            {pdfPreviewPagesAvailable > 0 ? ` · ${pdfPreviewPagesAvailable} page${pdfPreviewPagesAvailable === 1 ? '' : 's'} ready` : ''}
                          </p>
                          <p className="mt-1">
                            {pdfDocumentUserMessage
                              || 'PDF preview pages are ready. Downloadable PDF storage is temporarily unavailable, so use the rendered pages for beta review.'}
                          </p>
                          {pdfDocumentFallbackCategory === 'storage_mime_blocked' ? (
                            <p className="mt-1 text-amber-700/80">
                              Detected: storage MIME restriction — `application/pdf` is not in the bucket allow-list.
                            </p>
                          ) : null}
                          {documentFallbackReason && process.env.NODE_ENV === 'development' ? (
                            <p className="mt-1 font-mono text-[10px] text-amber-700/70">{documentFallbackReason.slice(0, 220)}</p>
                          ) : null}
                        </div>
                      ) : null}
                      {isDirectionCardPreview ? (
                        <p className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                          Image provider preview was not available, so this output is showing a generated direction card. Customize or regenerate to try again.
                        </p>
                      ) : null}
                      {overlayQuality?.flags?.length ? (
                        <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                          Internal review flags: {overlayQuality.flags.join(', ')}.
                        </p>
                      ) : null}
                      {visualGovernanceWarnings.length > 0 ? (
                        <p className="mt-2 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                          Visual governance warnings: {visualGovernanceWarnings.join(', ')}.
                          {typeof creatorQuality?.clutterRisk === 'number' ? ` Density score: ${Math.max(0, 100 - creatorQuality.clutterRisk)}.` : ''}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {savedBlock && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Saved Asset Reference</p>
                      <div className="mt-2 space-y-1 text-sm text-amber-900">
                        <p className="font-semibold">{savedBlock.reference}</p>
                        <p>{savedBlock.name}</p>
                        <p className="break-all text-xs text-amber-800">Block ID: {savedBlock.id}</p>
                      </div>
                    </div>
                  )}

                  {selectedAsset && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Reusable Context</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-950">{selectedAsset.name}</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        Source creator type: {getSavedAssetCreatorType(selectedAsset)}
                      </p>
                    </div>
                  )}

                  {writerSource && (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700">Attached To</p>
                      <p className="mt-2 text-sm font-semibold text-indigo-950">{writerSource.title}</p>
                      <p className="mt-1 text-xs text-indigo-800">
                        {writerSource.sourceType === 'thread' ? 'Thread' : 'Post'} source context is preserved for this asset.
                      </p>
                    </div>
                  )}

                  {slides.length > 0 && (() => {
                    // Carousel/Infographic/Slider preview. The actual
                    // slide images come back in `media_bundle.files` (one
                    // URL per slide, same index as `slides`). Pair them
                    // with the slide structure metadata so each slide
                    // renders as a self-contained card with both visual
                    // and copy. The legacy "Preview" block above only
                    // showed the URLs as thumbnails; this block now
                    // makes the carousel preview the primary surface.
                    //
                    // Strategy lookup surfaces the selected strategy's
                    // CTA intensity + the CTA-slide intent text so the
                    // operator can see WHY the LLM is producing a
                    // particular CTA framing for the last slide.
                    const slideMediaUrls = Array.isArray(result?.output.asset_payload.media_bundle?.files)
                      ? (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean)
                      : [];
                    const slideStrategy = resolvePurposeStrategy(type, answers.subtype);
                    const ctaSlideIntent = slideStrategy?.slideArc
                      ?.find((s) => s.role === 'cta' || s.role === 'next_steps')
                      ?.intent ?? null;
                    return (
                      <div>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                            {type === 'infographic' ? 'Sections' : 'Slide Structure'} · {slides.length} {type === 'infographic' ? 'sections' : 'slides'}
                          </p>
                          {slideStrategy ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
                              CTA intensity: {slideStrategy.ctaIntensity}
                            </span>
                          ) : null}
                        </div>
                        {ctaSlideIntent ? (
                          <div className="mb-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800">
                              Suggested CTA for the closing slide
                            </p>
                            <p className="mt-1 text-sm leading-6 text-emerald-900">{ctaSlideIntent}</p>
                          </div>
                        ) : null}
                        <div className="space-y-3">
                          {slides.map((slide, index) => {
                            const slideUrl = slideMediaUrls[index] || '';
                            const role = String(slide.role ?? 'content');
                            const isCta = role === 'cta' || role === 'next_steps';
                            return (
                              <div
                                key={`${index}-${String(slide.slide_number ?? index + 1)}`}
                                className={`overflow-hidden rounded-2xl border ${isCta ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100 bg-gray-50'}`}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row">
                                  {slideUrl ? (
                                    <a
                                      href={slideUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Open full size"
                                      className="block w-full shrink-0 overflow-hidden bg-gray-100 sm:w-56"
                                    >
                                      <img
                                        src={slideUrl}
                                        alt={`${type} ${role} ${index + 1}`}
                                        loading="lazy"
                                        className="block h-full w-full object-cover"
                                      />
                                    </a>
                                  ) : null}
                                  <div className="flex-1 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                                        {type === 'infographic' ? 'Section' : 'Slide'} {String(slide.slide_number ?? index + 1)} · {role}
                                      </p>
                                      {isCta ? (
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                                          Suggested CTA
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold text-gray-900">{String(slide.headline ?? '')}</p>
                                    <p className="mt-1 text-sm text-gray-600">{String(slide.body_text ?? '')}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Customize With AI</p>
                    <p className="mt-2 text-sm leading-6 text-blue-900">
                      Ask AI to adjust the copy, visual hierarchy, tone, layout direction, CTA, or platform fit, then regenerate a new preview.
                    </p>
                    <textarea
                      value={refinePrompt}
                      onChange={(event) => setRefinePrompt(event.target.value)}
                      rows={3}
                      placeholder="Example: make it more minimal, use stronger CTA language, and make the visual feel less corporate."
                      className="mt-3 w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="mt-3 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGenerating ? 'Customizing...' : 'Customize With AI'}
                    </button>
                  </div>

                  {/*
                    Context-aware action surface (Phase 1–6).
                    Embedded writer flow: the asset is already attached
                    to the writer post/thread automatically when
                    generation succeeds (see appendWriterAttachedAssetDurable
                    above). This block exposes only the actions that make
                    semantic sense INSIDE the writer flow:
                      PRIMARY    → Return to Writer
                      SECONDARY  → Save As Asset · Download · Regenerate
                    Standalone-only / campaign / repurpose / duplicate
                    CTAs are deliberately hidden — they belong to the
                    standalone creator studio surface.
                  */}
                  {writerSource ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          // Return to the Writer draft (never back to Creator). The
                          // return destination is owned by the CreatorAttachmentSession
                          // — no page inspects return_to directly. Fallback to history.
                          const token = attachmentSessionTokenRef.current || (typeof router.query.session === 'string' ? router.query.session : '') || (typeof router.query.prefill === 'string' ? router.query.prefill : '');
                          const returnTo = resolveReturnDestination(token);
                          if (returnTo) { void router.push(returnTo); return; }
                          try { router.back(); } catch { /* router.back may throw if no history */ }
                        }}
                        disabled={Boolean(actionInProgress)}
                        className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Continue with your ${writerSource.sourceType === 'thread' ? 'thread' : 'post'}`}
                      </button>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={handleSaveAsBlock}
                          disabled={isSavingBlock || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingBlock ? 'Saving...' : 'Save As Asset'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBrief}
                          disabled={Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionInProgress === 'download' ? 'Preparing...' : 'Download'}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerate}
                          disabled={isGenerating || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isGenerating ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-500">
                        Asset is auto-attached to your {writerSource.sourceType === 'thread' ? 'thread' : 'post'}. Return to keep editing — or refine above and regenerate before going back.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleOpenScheduler('schedule')}
                          disabled={Boolean(actionInProgress)}
                          className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {actionInProgress === `schedule-${socialActionLabel}` ? 'Opening...' : `Schedule ${socialActionLabel}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenScheduler('publish')}
                          disabled={Boolean(actionInProgress)}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {actionInProgress === `share-${socialActionLabel}` ? 'Opening...' : `Share ${socialActionLabel} now`}
                        </button>
                      </div>
                      <p className="text-[11px] leading-5 text-gray-500">
                        Opens the selected platform with this {socialActionLabel} copy and generated media attached for final review.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={handleSaveAsBlock}
                          disabled={isSavingBlock || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingBlock ? 'Saving Asset...' : 'Save As Asset'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBrief}
                          disabled={Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionInProgress === 'download' ? 'Preparing...' : 'Download'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Variant Experience — Creator embedding subcomponent ──────────────
 * Encapsulates the variant card + winner card + fan-out preview so the
 * main CreatorWorkflowPage body stays focused on the existing
 * generation flow. Renders nothing when the operator's subtype does
 * not resolve to a known strategy id — legacy single-variant flows
 * remain byte-identical.
 */
function CreatorVariantExperienceSection(props: {
  type: CreatorTypeId | null;
  subtype: string | undefined;
  companyId: string;
  variantPin: VariantFamily | null;
  setVariantPin: React.Dispatch<React.SetStateAction<VariantFamily | null>>;
  variantPlan: VariantExecutionResult | null;
  setVariantPlan: React.Dispatch<React.SetStateAction<VariantExecutionResult | null>>;
  variantFanOutInFlight: boolean;
  variantFanOutSummary: string | null;
  onFanOut: (plan: VariantExecutionResult) => Promise<void>;
  /** P1-4 callback — fires when the planner returns a single-decision
   *  plan (single_variant / best_variant). Parent uses it to auto-fire
   *  Generate so operators don't have to click twice. */
  onSingleDecisionReady: (family: VariantFamily) => void;
}) {
  const {
    type, subtype, companyId,
    variantPin, setVariantPin,
    variantPlan, setVariantPlan,
    variantFanOutInFlight, variantFanOutSummary,
    onFanOut, onSingleDecisionReady,
  } = props;
  // Only run on the three variant-supporting creator types.
  if (type !== 'image' && type !== 'carousel' && type !== 'infographic') return null;
  const strategyId = resolveCreatorStrategyId(type as CreatorTypeForVariant, subtype ?? null);
  if (!strategyId || !companyId) return null;
  // P2-1 — read from shared analytics provider when one is mounted
  // upstream; falls back to a direct fetch when not. Saves redundant
  // GETs when multiple variant surfaces (e.g. CreatorVariantExperienceSection,
  // WriterVariantSection nested in a side panel) coexist on the same
  // page.
  const analytics = useSharedStrategyAnalytics({ companyId, enabled: Boolean(strategyId) });
  const winnerForStrategy = analytics.data?.execution.winner_recommendations.find(
    (w) => w.strategy_id === strategyId,
  ) ?? analytics.data?.variants.winners.find((w) => w.strategy_id === strategyId) ?? null;
  return (
    <div className="mt-6 space-y-3">
      <VariantExperienceEntryCard
        companyId={companyId}
        strategyId={strategyId}
        contentType={type as CreatorTypeForVariant}
        onPlanComplete={(plan) => {
          setVariantPlan(plan);
          // For single-variant + best-variant the planner returns one
          // decision — pin its family AND auto-fire Generate (P1-4)
          // so the operator's "Pick Best Variant" intent ships in
          // one click rather than two.
          if (plan.decisions.length === 1) {
            const fam = plan.decisions[0].variant.variant_family;
            if (fam === 'v1' || fam === 'v2' || fam === 'v3') {
              onSingleDecisionReady(fam);
            }
          }
        }}
      />
      {variantPin ? (
        <p className="text-xs text-indigo-700">
          Current Generate pinned to Variant {variantPin.toUpperCase()}. Switch the variant card mode to update.
        </p>
      ) : null}
      {variantPlan && variantPlan.decisions.length > 1 ? (
        <div className="rounded-xl border border-indigo-200 bg-white p-3 shadow-sm">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-900">Variant fan-out</h4>
            <span className="text-xs text-gray-500">
              Resolved mode: <strong>{variantPlan.resolvedMode}</strong>
              {variantPlan.experimentId ? <> · Experiment <strong>{variantPlan.experimentId}</strong></> : null}
            </span>
          </header>
          <VariantPreviewGrid decisions={variantPlan.decisions} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onFanOut(variantPlan)}
              disabled={variantFanOutInFlight}
              className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {variantFanOutInFlight ? 'Fanning out…' : `Generate ${variantPlan.decisions.length} variants`}
            </button>
            {variantFanOutSummary ? (
              <span className="text-xs text-gray-600">{variantFanOutSummary}</span>
            ) : (
              <span className="text-xs italic text-gray-500">
                Tip — run a baseline Generate first so the fan-out can replay the same brief per variant.
              </span>
            )}
          </div>
        </div>
      ) : null}
      {winnerForStrategy ? (
        <VariantWinnerCard winner={winnerForStrategy} />
      ) : null}
    </div>
  );
}
