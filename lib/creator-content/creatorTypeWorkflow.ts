/**
 * Creator type-workflow domain model — extracted verbatim from
 * pages/command-center/creator-content/[type].tsx (decomposition: page < 1000 LOC).
 *
 * PURE module scope only: type ids, workflow field/config definitions (WORKFLOW_CONFIG),
 * starter chips, overlay defaults + derivation, brand-context model, writer-source →
 * answers mapping, saved-asset helpers and suggestion builders. No React, no state,
 * no side effects — everything here is deterministic data + functions.
 *
 * ENFORCEMENT (creatorAssetIdFactory.test.ts): no Creator Asset IDs may be minted here —
 * this file is part of the forbidden-pattern scan list.
 */
import {
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../content/writerCreatorAssetLaunch';
import type { MarketingBrief } from '../content/unifiedCreationModel';
import type { AttachmentMode } from '../content/writerCreatorAttachmentContracts';
import type { CreatorDiagnosticReport } from '../../backend/services/creator/creatorDiagnosticReport';
import { resolvePurposeStrategy } from '../../backend/services/creator/purposeStrategyRegistry';
import { serializeCreatorFlowContext, type CreatorFlowContext } from '../content/creatorFlowContext';
import type { AssetCompositionIntent, WriterCreatorAssetType } from '../content/writerCreatorAttachmentContracts';
import { resolveTemplateCreatorCardPatch, type CreatorTemplate } from '../creator-templates';
import {
  type TemplateFieldValues,
  projectImageOverlayText,
  projectCarouselSlides,
  projectInfographicSections,
} from '../creator-templates/values';
import { creatorRuntimeV2Live } from '../creator-templates/creatorRuntimeFlag';
import { runCreatorRuntimeV2 } from '../creator-templates/creatorRuntimeV2';

export type CreatorTypeId =
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

export const GUIDANCE_ONLY_TYPES: CreatorTypeId[] = ['video', 'reel', 'short', 'podcast'];

export function isGuidanceOnlyType(type: CreatorTypeId | null): boolean {
  return Boolean(type && GUIDANCE_ONLY_TYPES.includes(type));
}

export type ChoiceOption = {
  value: string;
  label: string;
  description: string;
};

export type WorkflowField =
  | { id: string; label: string; placeholder: string; rows?: number; kind: 'text' | 'textarea'; presets?: ReadonlyArray<string> }
  | { id: string; label: string; kind: 'single-select'; options: ChoiceOption[] };

export const DEFAULT_CTA_PRESETS: ReadonlyArray<string> = [
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
export const STARTER_CHIPS_BY_CONTENT_TYPE: Record<string, Record<string, ReadonlyArray<string>>> = {
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
export function getStarterChips(contentType: string | undefined, fieldId: string): readonly string[] {
  const ct = String(contentType || '').toLowerCase();
  return STARTER_CHIPS_BY_CONTENT_TYPE[ct]?.[fieldId] ?? [];
}

export type WorkflowConfig = {
  title: string;
  contentType: string;
  intro: string;
  subtypeLabel: string;
  subtypeOptions: ChoiceOption[];
  fields: WorkflowField[];
  primaryPlatforms: string[];
};

export const SOCIAL_CREATIVE_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'reddit'];

/** Overlay-role display labels — used to frame sibling fields for AI distinctness. */
export const OVERLAY_FIELD_LABELS: Record<keyof WriterOverlayText, string> = {
  hook: 'Hook', headline: 'Headline', supportingText: 'Supporting text', keyInsight: 'Key insight', cta: 'CTA',
};

export const EMPTY_OVERLAY_TEXT: WriterOverlayText = {
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
export function deriveOverlayFromContent(title: string, body: string): WriterOverlayText {
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

export function isSocialCreativeType(type: CreatorTypeId | null): boolean {
  return type === 'image' || type === 'banner' || type === 'infographic';
}

export function isDeterministicStructuredType(type: CreatorTypeId | null): boolean {
  return type === 'carousel' || type === 'pdf' || type === 'slider';
}

// Note: `banner` and `slider` are intentionally absent from this map
// after the taxonomy consolidation. They remain in CreatorTypeId only
// so the URL-alias redirect effect at the top of CreatorTypeWorkflowPage
// can detect them and redirect to image/carousel with the appropriate
// layout pre-selected. Their old generation behavior is preserved via
// the layout selector + content_type override in handleGenerate.
export const WORKFLOW_CONFIG: Partial<Record<CreatorTypeId, WorkflowConfig>> = {
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

export type CreatorResult = {
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

export type SuggestionOption = {
  id: string;
  label: string;
  summary: string;
  rationale: string;
  badges: string[];
};

export type SavedBlockReference = {
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
export function resolveSavedAssetMedia(row: Record<string, unknown>): string[] {
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

export type SavedCreatorAsset = {
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

export type CreatorBrandMode = 'brand-aware' | 'independent';
export type BrandPresence = 'minimal' | 'balanced' | 'strong';

export type BrandContextSelections = {
  companyContext: boolean;
  logo: boolean;
  favicon: boolean;
  tagline: boolean;
  brandTone: boolean;
  brandColors: boolean;
  audience: boolean;
  campaign: boolean;
};

export type CreatorBrandProfile = {
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

export type RepurposePath = {
  id: 'blog' | 'linkedin-post' | 'thread' | 'blog-section' | 'long-form-outline';
  label: string;
  description: string;
};

export const DEFAULT_BRAND_SELECTIONS: BrandContextSelections = {
  companyContext: true,
  logo: true,
  favicon: false,
  tagline: true,
  brandTone: true,
  brandColors: true,
  audience: true,
  campaign: false,
};

export type BrandAssetSize = 'small' | 'medium' | 'large';

// Each step up is 80% bigger than the previous: small = 1.0x (current size on
// the rendered asset), medium = 1.8x, large = ~3.24x. The numeric factor is
// surfaced in the brief so the renderer can scale logo / favicon proportionally.
export const BRAND_ASSET_SIZE_PRESETS: ReadonlyArray<{ value: BrandAssetSize; label: string; scale: number }> = [
  { value: 'small',  label: 'Small',  scale: 1.0  },
  { value: 'medium', label: 'Medium', scale: 1.8  },
  { value: 'large',  label: 'Large',  scale: 3.24 },
];

export const DEFAULT_BRAND_ASSET_SIZE: BrandAssetSize = 'small';

// "Small" is the current rendered baseline per asset class. Medium / large
// derive from this base via the scale factor in BRAND_ASSET_SIZE_PRESETS.
export const BRAND_ASSET_BASE_PX: Readonly<Record<'logo' | 'favicon', number>> = {
  logo:    96,
  favicon: 32,
};

export function normalizeBrandAssetSize(value: unknown): BrandAssetSize {
  return BRAND_ASSET_SIZE_PRESETS.some((p) => p.value === value)
    ? (value as BrandAssetSize)
    : DEFAULT_BRAND_ASSET_SIZE;
}

export function brandAssetSizePx(asset: 'logo' | 'favicon', size: BrandAssetSize): number {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return Math.round(BRAND_ASSET_BASE_PX[asset] * preset.scale);
}

export function describeBrandAssetSize(asset: 'logo' | 'favicon', size: BrandAssetSize): string {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return `${preset.label.toLowerCase()} (~${brandAssetSizePx(asset, size)}px on the asset)`;
}

export function buildDefaultAnswers(config: WorkflowConfig): Record<string, string> {
  const defaults: Record<string, string> = {
    subtype: config.subtypeOptions[0]?.value || '',
  };
  config.fields.forEach((field) => {
    if (field.kind === 'single-select') {
      defaults[field.id] = field.options[0]?.value || '';
      return;
    }
    // Pre-populate preset-backed fields — notably the CTA ("What action should
    // the viewer take?") — with a sensible default so the creative always ships
    // WITH a call-to-action instead of a blank field. Any campaign/workspace
    // prefill or restored value overrides this in the setAnswers merge.
    const presets = (field as { presets?: ReadonlyArray<string> }).presets;
    if (Array.isArray(presets) && presets.length > 0) {
      defaults[field.id] = String(presets[0]);
    }
  });
  return defaults;
}

export function getCreatorDraftStorageKey(type: CreatorTypeId): string {
  return `creator_flow_draft_${type}`;
}

/**
 * CREATOR-106: seed the editor's text fields from the Marketing Workspace brief so the
 * user doesn't re-enter what they already gave (Who is it for / core message / topic /
 * constraints). Only fields that exist in this asset's config are set, and all stay
 * editable. Lossy by design — the workspace brief is freeform, so structured fields
 * (e.g. dataPoints) seed from the same description and the user refines.
 */
export function mapBriefToEditorAnswers(brief: MarketingBrief, config: WorkflowConfig): Record<string, string> {
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

export const CREATOR_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
export const CREATOR_GENERATION_TIMEOUT_MS = 1000 * 90;

export function hasUsableCreatorOutput(result: CreatorResult | null): result is CreatorResult {
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

export function summarizeMediaUrls(result: CreatorResult | null): string[] {
  if (!result) return [];
  const mediaBundle = result.output.asset_payload.media_bundle || {};
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : [];
  const url = typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : [];
  return Array.from(new Set([...url, ...files]));
}

export function getMediaPreviewMetadata(result: CreatorResult | null) {
  const mediaBundle = result?.output.asset_payload.media_bundle || {};
  return mediaBundle.metadata || {};
}

/** Read-only: extract the deterministic diagnostic report from asset metadata. */
export function getDiagnosticReport(result: CreatorResult | null): CreatorDiagnosticReport | null {
  const meta = getMediaPreviewMetadata(result) as Record<string, unknown>;
  const r = meta.creator_diagnostic_report;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as CreatorDiagnosticReport) : null;
}

export function pickOptionValue(field: WorkflowField | undefined, candidates: string[]): string | null {
  if (!field || field.kind !== 'single-select') return null;
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
  const match = field.options.find((option) => {
    const haystack = `${option.value} ${option.label} ${option.description}`.toLowerCase();
    return normalizedCandidates.some((candidate) => candidate && haystack.includes(candidate));
  });
  return match?.value || null;
}

export function setIfFieldExists(
  config: WorkflowConfig,
  answers: Record<string, string>,
  id: string,
  value?: string | null,
): void {
  if (!value || !config.fields.some((field) => field.id === id)) return;
  answers[id] = value;
}

export function splitWriterSourcePoints(source: WriterCreatorSourcePayload): string[] {
  const bodyPoints = String(source.body || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\n{2,}|\n(?=[-*\d])|(?<=[.!?])\s+/)
    .map((segment) => segment.replace(/^[-*\d.)\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length >= 18)
    .slice(0, 5);
  return bodyPoints.slice(0, 7);
}

export function buildWriterStructureGuidance(
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

export function buildCreatorAnswersFromWriterSource(
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

export function humanizeValue(value: string | undefined): string {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function buildBlockReference(templateId: string): string {
  const compact = String(templateId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();
  return compact ? `BLK-${compact}` : 'BLK-PENDING';
}

export function getSavedAssetCreatorType(asset: SavedCreatorAsset): string {
  const sourceTag = asset.tags.find((tag) => tag.startsWith('source:'));
  if (sourceTag) return humanizeValue(sourceTag.replace(/^source:/, ''));
  return humanizeValue(asset.format_type || 'creator asset');
}

export function getSavedAssetAttachmentLabel(asset: SavedCreatorAsset): string | null {
  const metadata = asset.creator_metadata;
  if (!metadata || metadata.asset_type !== 'image') return null;
  if (metadata.attachment_mode === 'embedded_copy') return 'Text Inside Image';
  if (metadata.attachment_mode === 'supporting_visual') return 'Post + Image';
  return null;
}

export function getRepurposePaths(type: CreatorTypeId, assetSubtype?: string): RepurposePath[] {
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

export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

export function mapCreatorBrandProfile(profile: Record<string, unknown> | null | undefined): CreatorBrandProfile {
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

export function buildBrandContextLines(input: {
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

export function getOptionLabel(config: WorkflowConfig, fieldId: string, value: string | undefined): string {
  const field = config.fields.find(
    (entry): entry is Extract<WorkflowField, { kind: 'single-select' }> =>
      entry.id === fieldId && entry.kind === 'single-select',
  );
  if (!field || !value) return humanizeValue(value);
  return field.options.find((option) => option.value === value)?.label || humanizeValue(value);
}

export function buildSuggestionOptions(
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


/* ── Suggestion-chip builders (extracted from the page's useMemo bodies) ──
 * Pure functions over explicit inputs; the page keeps thin useMemo wrappers
 * with the same dependency arrays, so recompute behavior is unchanged. */

/** Overlay-field chips (hook / headline / supportingText / keyInsight) derived from the
 *  Writer body with cross-field allocation + global dedupe + starter fallback. */
export function buildOverlayFieldSuggestions(input: {
  type: CreatorTypeId | null;
  writerTitle: string;
  writerBody: string;
  topic: string;
  keyMessage: string;
  currentHook: string;
}): { hook: string[]; headline: string[]; supportingText: string[]; keyInsight: string[] } {
  const { type } = input;
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
  const body = String(input.writerBody || input.keyMessage || '').trim();
  const sentences = body
    .replace(/https?:\/\/\S+/gi, '')
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.replace(/^[\-*\d.)\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 18 && /[A-Za-z]/.test(s));

  const title = String(input.writerTitle || input.topic || '').trim();

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

  // Operator feedback: chips must be unique — a single global key set
  // spans every slot so duplicates can NEVER appear in two fields.
  // Typed seeds only surface on the HOOK field (their natural home).
  const globalChipKeys = new Set<string>();
  const seedChips = [hook, headline, supporting, insight];
  for (const slot of seedChips) {
    for (const chip of slot) globalChipKeys.add(normalize(chip));
  }

  const seeds = [
    title,
    String(input.currentHook || '').trim(),
    String(input.keyMessage || '').trim(),
  ].filter(Boolean);
  const seenSeeds = new Set<string>();
  const dedupedSeeds = seeds.filter((s) => {
    const k = normalize(s);
    if (!k || seenSeeds.has(k)) return false;
    seenSeeds.add(k);
    return true;
  });
  // Seeds only fill the HOOK field — and only when HOOK has no
  // sentence-derived chip yet.
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
  // pool; the global key set prevents cross-field repeats; capped at 4.
  const mergeStarters = (slot: string[], fieldId: string, max: number): void => {
    const starters = getStarterChips(type ?? undefined, fieldId);
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
}

/** Freeform-question chips (audience / keyMessage / cta / topic / dataPoints / refinement /
 *  objective) from real context — writer source, brand profile/overrides, typed overlay values —
 *  strategy-aware CTAs, globally deduped, starter fallback. */
export function buildFreeformFieldSuggestions(input: {
  type: CreatorTypeId | null;
  subtype: string;
  writerAudience: string;
  writerBody: string;
  writerTitle: string;
  brandOverrideAudience: string;
  brandProfileAudience: string;
  topic: string;
  overlayHook: string;
  overlayKeyInsight: string;
  overlayCta: string;
}): { audience: string[]; keyMessage: string[]; cta: string[]; topic: string[]; dataPoints: string[]; refinement: string[]; objective: string[] } {
  const { type } = input;
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
  pushUnique(audience, input.writerAudience, 80);
  pushUnique(audience, input.brandOverrideAudience, 80);
  pushUnique(audience, input.brandProfileAudience, 80);

  // Key-message candidates — most specific content first (writer first
  // sentence > typed insight > typed hook > topic > writer title).
  const keyMessage: string[] = [];
  const writerBody = String(input.writerBody || '').trim();
  const writerFirstSentence = writerBody
    .split(/(?<=[.!?])\s+|\n+/u)[0]
    ?.trim() || '';
  pushUnique(keyMessage, writerFirstSentence, 200);
  pushUnique(keyMessage, input.overlayKeyInsight, 200);
  pushUnique(keyMessage, input.overlayHook, 200);
  pushUnique(keyMessage, input.topic, 200);
  pushUnique(keyMessage, input.writerTitle, 200);

  // CTA candidates — strategy-aware: the selected purpose strategy's
  // ctaSuggestions surface as click-ready chips (cap intentionally
  // higher — operators expect the strategy's full curated set).
  const cta: string[] = [];
  const ctaStrategy = resolvePurposeStrategy(String(type ?? ''), input.subtype);
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
  pushUniqueCta(input.overlayCta);
  if (ctaStrategy?.ctaSuggestions?.length) {
    for (const suggestion of ctaStrategy.ctaSuggestions) {
      pushUniqueCta(suggestion);
    }
  }

  // Operator feedback: chips must be unique across every field — one
  // global key set spans all seven lists.
  const globalFreeformKeys = new Set<string>();
  for (const c of audience) globalFreeformKeys.add(norm(c));
  for (const c of keyMessage) globalFreeformKeys.add(norm(c));
  for (const c of cta) globalFreeformKeys.add(norm(c));

  const buildStarterList = (fieldId: string, max: number, alreadyPicked: string[] = []): string[] => {
    const list: string[] = [...alreadyPicked];
    const starters = getStarterChips(type ?? undefined, fieldId);
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
}

/* ── Generation payload builder (extracted from the page's useCallback) ──
 * The SINGLE payload shape sent to /api/command-center/creator-content/generate —
 * shared by baseline Generate and the variant fan-out path (P1-1). Pure over
 * explicit inputs, so the payload contract is unit-testable. */

export interface BuildGenerationBodyInput {
  type: CreatorTypeId | null;
  config: WorkflowConfig;
  answers: Record<string, string>;
  selectedAsset: SavedCreatorAsset | null;
  selectedSuggestion: SuggestionOption | null;
  refinedSuggestion: string | null;
  refinePrompt: string;
  writerSource: WriterCreatorSourcePayload | null;
  writerSupportingVisual: boolean;
  writerEmbeddedCopy: boolean;
  writerCompositionIntent: AssetCompositionIntent | null;
  writerAssetType: WriterCreatorAssetType | null;
  writerAttachmentMode: AttachmentMode | null;
  standaloneAttachmentMode: AttachmentMode;
  overlayText: WriterOverlayText;
  brandMode: CreatorBrandMode;
  brandPresence: BrandPresence;
  brandSelections: BrandContextSelections;
  brandProfile: CreatorBrandProfile | null;
  brandOverrides: Record<string, string>;
  brandContextLines: string[];
  selectedPlatform: string;
  selectedCompanyId: string | null | undefined;
  activeTemplate: CreatorTemplate | null;
  templateValues: TemplateFieldValues;
  /** Serialized once by the caller (was buildCurrentContext(selectedPlatform)). */
  lightweightContext: CreatorFlowContext;
  /** From ?blueprint= (was router.query.blueprint). */
  blueprintId: string | null;
  variantPinOverride: string | null;
}

export function buildCreatorGenerationBody(input: BuildGenerationBodyInput): Record<string, unknown> | null {
  const {
    type, config, answers, selectedAsset, selectedSuggestion, refinedSuggestion, refinePrompt,
    writerSource, writerSupportingVisual, writerEmbeddedCopy, writerCompositionIntent,
    writerAssetType, writerAttachmentMode, standaloneAttachmentMode,
    overlayText, brandMode, brandPresence, brandSelections, brandProfile, brandOverrides,
    brandContextLines, selectedPlatform, selectedCompanyId,
    activeTemplate, templateValues, lightweightContext, blueprintId, variantPinOverride,
  } = input;
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
      `Lightweight context:\n${serializeCreatorFlowContext(lightweightContext)}`,
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
        lightweight_context: lightweightContext,
        selected_platform: selectedPlatform,
        ...(variantPinOverride ? { variant_family: variantPinOverride } : {}),
        // CREATOR-059 follow-up: carry the wizard-selected visual blueprint so the
        // server can derive style/colour/layout guidance (additive; absent ⇒ no-op).
        ...(blueprintId ? { blueprint_id: blueprintId } : {}),
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
}
