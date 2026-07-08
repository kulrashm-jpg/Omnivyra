/**
 * Creator workflow configuration — type ids, workflow field/config definitions
 * (WORKFLOW_CONFIG), starter chips, overlay defaults + derivation. Pure data + functions.
 * ENFORCEMENT: part of the asset-id-minting forbidden-pattern scan (creatorAssetIdFactory.test.ts).
 */
import { type WriterOverlayText } from '../content/writerCreatorAssetLaunch';

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

