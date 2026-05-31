/**
 * Purpose Strategy Registry.
 *
 * Maps (contentType + purposeKey) → a structured generation strategy
 * that materially influences:
 *
 *   - prompt directives (asset layer + composition layer)
 *   - composition hierarchy (focal point, density, branding intensity)
 *   - typography weight (lead vs support)
 *   - CTA intensity (absent → strong)
 *   - scene selection (what to depict, what to avoid)
 *   - creative-direction template affinity (bias selection toward
 *     templates whose profile aligns with the purpose intent)
 *   - slide-arc orchestration (carousel — distinct slide-role sequences
 *     per style)
 *   - information architecture (infographic — distinct structural
 *     skeletons per structure mode)
 *
 * Distinct from "subtype label" — subtype was a marketing tag that
 * surfaced in the UI only. Purpose strategies travel all the way
 * through the prompt composer to the LLM and into preview metadata.
 *
 * Avoids switch statements: callers look up by composite key and
 * receive the strategy object. Adding a new purpose is one new entry.
 *
 * Pure data + a thin resolver. No side effects.
 */

import type { CreativeDirectionTemplate } from './creatorPromptComposer';

/* ── Shared enums ──────────────────────────────────────────────────── */

export type PurposeContentType = 'image' | 'carousel' | 'infographic';

export type DensityBias = 'minimal' | 'balanced' | 'dense';
export type BrandingIntensity = 'subtle' | 'balanced' | 'strong';
export type TypographyWeight = 'support' | 'lead' | 'feature';
export type CtaIntensity = 'absent' | 'subtle' | 'standard' | 'strong';

export type SlideRole = {
  /** Compact role token used by structured normalization. */
  role: string;
  /** Operator-readable intent — describes what the slide should accomplish. */
  intent: string;
};

export type InfographicArchitecture = {
  /** Information-organization pattern: data-first, sequence-first, etc. */
  pattern:
    | 'data_first'
    | 'sequence_first'
    | 'chronology_first'
    | 'side_by_side'
    | 'structured_pillars'
    | 'phased_progression';
  /** Section blueprint that the upstream LLM uses to organize content. */
  sectionBlueprint: string[];
  /** Visual hierarchy notes for the renderer prompt. */
  hierarchyNotes: string;
};

export type PurposeStrategy = {
  /** Unique id (contentType:purposeKey) — useful as a metadata field. */
  id: string;
  contentType: PurposeContentType;
  purposeKey: string;
  displayLabel: string;
  /** Label surfaced in preview metadata ("Generated As: ..."). */
  generatedAsLabel: string;
  /** Operator-readable rationale shown alongside the preview. */
  whyChosen: string;

  /* ── Prompt composer hooks ────────────────────────────────────── */
  /** Directives injected into the prompt's asset/purpose layer. */
  promptDirectives: string[];
  /** Additional composition-layer directives. */
  compositionHints: string[];
  /** Scene-selection hints — what to depict and what to avoid. */
  sceneSelectionHints: string[];

  /* ── Quantitative biases ──────────────────────────────────────── */
  densityBias: DensityBias;
  brandingIntensity: BrandingIntensity;
  typographyWeight: TypographyWeight;
  ctaIntensity: CtaIntensity;

  /* ── CTA suggestions (operator-facing) ────────────────────────── */
  /** Strategy-tuned CTA copy chips surfaced under the "Desired CTA"
   *  input. Short, click-ready phrases that match the strategy's
   *  ctaIntensity. Empty when the strategy is CTA-absent (quote
   *  image). */
  ctaSuggestions?: ReadonlyArray<string>;

  /* ── Creative-direction selector bias ─────────────────────────── */
  /** Preferred creative-direction templates (selector reads first match). */
  creativeDirectionAffinity: CreativeDirectionTemplate[];

  /* ── Carousel-specific ────────────────────────────────────────── */
  slideArc?: SlideRole[];

  /* ── Infographic-specific ─────────────────────────────────────── */
  informationArchitecture?: InfographicArchitecture;
};

/* ── Image purposes ────────────────────────────────────────────────── */

const PROMOTIONAL_IMAGE: PurposeStrategy = {
  id: 'image:promotional-image',
  contentType: 'image',
  purposeKey: 'promotional-image',
  displayLabel: 'Promotional',
  generatedAsLabel: 'Promotional Image',
  whyChosen: 'Optimized for attention and conversion — strong focal point, marketing energy, stronger CTA emphasis.',
  promptDirectives: [
    'Visual purpose: a single-frame promotional creative that arrests the scroll and motivates immediate action.',
    'Bias the composition toward a powerful focal hero — let one element own the frame.',
    'Use high-contrast lighting and saturation discipline to communicate marketing energy without resorting to neon cliches.',
  ],
  compositionHints: [
    'Composition discipline: hero-led off-center placement; supporting context kept subordinate.',
    'Hierarchy bias: hero subject first, then atmosphere, then ambient brand mark — never the inverse.',
  ],
  sceneSelectionHints: [
    'Choose scenes that signal momentum, launch, or arrival — motion-implied stillness over static product shots.',
    'Avoid generic stock-style office tableaux or interchangeable team-of-three setups.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'lead',
  ctaIntensity: 'strong',
  ctaSuggestions: ['Shop now', 'Start free trial', 'Get it today', 'Claim the offer', 'Reserve your spot'],
  creativeDirectionAffinity: [
    'cinematic_product_launch',
    'product_launch',
    'feature_reveal',
    'premium_brand_campaign',
  ],
};

const EDUCATIONAL_IMAGE: PurposeStrategy = {
  id: 'image:educational-image',
  contentType: 'image',
  purposeKey: 'educational-image',
  displayLabel: 'Educational',
  generatedAsLabel: 'Educational Image',
  whyChosen: 'Optimized for clarity and learning — concept illustration, low visual noise, explanatory hierarchy.',
  promptDirectives: [
    'Visual purpose: a single-frame educational creative that helps the viewer understand one concept at a glance.',
    'Express the concept through metaphor, environment, or tangible objects — never as written explanation in-frame.',
    'Prioritize visual clarity: clean negative space, readable composition, one dominant idea.',
  ],
  compositionHints: [
    'Composition discipline: structured framing with clear figure-ground separation.',
    'Hierarchy bias: concept-illustration subject first, supporting context second, decorative elements never.',
  ],
  sceneSelectionHints: [
    'Choose scenes that abstract a concept into something concrete — a workflow gesture, a clean tool, a measured movement.',
    'Avoid information-dense backgrounds, cluttered desks, or simultaneous competing subjects.',
  ],
  densityBias: 'minimal',
  brandingIntensity: 'subtle',
  typographyWeight: 'support',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Learn more', 'Read the breakdown', 'Save for later', 'See the full guide'],
  creativeDirectionAffinity: [
    'editorial_modern_startup',
    'clean_editorial_product',
    'editorial_feature_reveal',
    'productivity_workflow',
  ],
};

const QUOTE_IMAGE: PurposeStrategy = {
  id: 'image:quote-image',
  contentType: 'image',
  purposeKey: 'quote-image',
  displayLabel: 'Quote',
  generatedAsLabel: 'Quote Image',
  whyChosen: 'Optimized for memorable statement — typography-first, visual support secondary, authority-building.',
  promptDirectives: [
    'Visual purpose: a quote-anchored statement creative where typography carries primary weight and the image is supporting atmosphere.',
    'Compose the scene as restrained editorial backdrop — quiet, premium, and deferring to a future overlay headline.',
    'Reserve approximately the upper-third or left-third of the frame for the headline that will be composed atop later.',
  ],
  compositionHints: [
    'Composition discipline: leave deliberate negative space in the headline region; let the supporting image breathe.',
    'Hierarchy bias: planned overlay typography zone first (treat as primary), atmospheric subject second.',
  ],
  sceneSelectionHints: [
    'Choose scenes that signal authority and reflection — a thoughtful subject in considered light, an editorial still life, a quiet workspace.',
    'Avoid theatrical poses, crowds, or anything that would visually compete with overlay text.',
  ],
  densityBias: 'minimal',
  brandingIntensity: 'subtle',
  typographyWeight: 'feature',
  ctaIntensity: 'absent',
  ctaSuggestions: [],
  creativeDirectionAffinity: [
    'founder_storytelling',
    'executive_insight',
    'editorial_modern_startup',
    'editorial_feature_reveal',
  ],
};

const PRODUCT_SHOWCASE_IMAGE: PurposeStrategy = {
  id: 'image:product-showcase-image',
  contentType: 'image',
  purposeKey: 'product-showcase-image',
  displayLabel: 'Product Showcase',
  generatedAsLabel: 'Product Showcase Image',
  whyChosen: 'Optimized for product prominence — product-first composition, cleaner backgrounds, reduced decorative clutter.',
  promptDirectives: [
    'Visual purpose: a product-led creative where the product surface or hero device owns the focal hierarchy.',
    'Treat the background as a controlled, premium environment that defers to the product subject.',
    'Render product UI surfaces (if present) with believable layout discipline but no readable glyphs or invented brand names.',
  ],
  compositionHints: [
    'Composition discipline: product positioned with intent — centered for feature focus, or off-center with motivated negative space.',
    'Hierarchy bias: product surface first, ambient context second, brand mark a quiet third.',
  ],
  sceneSelectionHints: [
    'Choose scenes that frame the product as the hero — clean studio surface, considered desk, ambient workflow.',
    'Avoid decorative collage, secondary subjects competing with the product, or fake-product stock-tropes.',
  ],
  densityBias: 'minimal',
  brandingIntensity: 'balanced',
  typographyWeight: 'support',
  ctaIntensity: 'standard',
  ctaSuggestions: ['See pricing', 'Book a demo', 'Try it free', 'Tour the product'],
  creativeDirectionAffinity: [
    'minimal_product_hero',
    'clean_editorial_product',
    'product_ecosystem_visual',
    'dashboard_centric',
  ],
};

const BRAND_FOCUS_IMAGE: PurposeStrategy = {
  id: 'image:brand-focus-image',
  contentType: 'image',
  purposeKey: 'brand-focus-image',
  displayLabel: 'Brand Focus',
  generatedAsLabel: 'Brand Focus Image',
  whyChosen: 'Optimized for trust and authority — premium composition, brand color reinforcement, intentional brand-mark integration.',
  promptDirectives: [
    'Visual purpose: a brand-led creative that builds trust and positioning through atmosphere, palette discipline, and considered subject choice.',
    'Reinforce brand identity through controlled palette and lighting — never through literal logos or wordmarks composed into the scene.',
    'Aim for editorial restraint: spacious, intentional, premium.',
  ],
  compositionHints: [
    'Composition discipline: editorial wide-format breathing room; subject placed with intent, never centered by default.',
    'Hierarchy bias: atmospheric brand tone first, considered subject second, brand-mark ambient third.',
  ],
  sceneSelectionHints: [
    'Choose scenes that signal stewardship, craft, or expertise — a considered hand, a measured tool, a thoughtful environment.',
    'Avoid hyper-corporate teamwork shots, marketing-collage layouts, or stock-photo authority cliches.',
  ],
  densityBias: 'minimal',
  brandingIntensity: 'strong',
  typographyWeight: 'support',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Follow us', 'Discover our story', 'Learn what we stand for', 'Join the community'],
  creativeDirectionAffinity: [
    'premium_brand_campaign',
    'founder_storytelling',
    'editorial_modern_startup',
    'premium_ai_editorial',
  ],
};

/* ── Carousel styles ───────────────────────────────────────────────── */

const EDUCATIONAL_CAROUSEL: PurposeStrategy = {
  id: 'carousel:educational-carousel',
  contentType: 'carousel',
  purposeKey: 'educational-carousel',
  displayLabel: 'Educational',
  generatedAsLabel: 'Educational Carousel',
  whyChosen: 'Slide arc: Hook → Concept → Explanation → Example → Summary → CTA. Each slide builds learning; the CTA invites continued engagement.',
  promptDirectives: [
    'Carousel orchestration: produce slides that build understanding step by step. Each slide must teach one specific thing.',
    'Hook slide must be a curiosity gap or framing question. Summary slide must recap the core idea in one line.',
    'CTA slide must extend the learning loop — suggest a save, share, or follow-up action, not a hard conversion ask.',
  ],
  compositionHints: [
    'Per-slide composition: one dominant illustration concept per slide, supporting text low-density.',
    'Visual continuity: shared color system across slides; layout system rotates by slide role.',
  ],
  sceneSelectionHints: [
    'Each slide is a teaching unit — scenes should embody the abstract concept being taught on that slide.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'subtle',
  typographyWeight: 'lead',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Save for later', 'Follow for more lessons', 'Share with your team', 'Bookmark this thread'],
  creativeDirectionAffinity: ['editorial_modern_startup', 'clean_editorial_product'],
  slideArc: [
    { role: 'hook', intent: 'Open with a curiosity gap, contradiction, or framing question.' },
    { role: 'concept', intent: 'Introduce the core concept in a single clear sentence.' },
    { role: 'explanation', intent: 'Unpack the concept with the simplest possible explanation or analogy.' },
    { role: 'example', intent: 'Ground the concept in a specific worked example or scenario.' },
    { role: 'summary', intent: 'Recap the takeaway in one memorable line.' },
    { role: 'cta', intent: 'Soft CTA — invite the reader to save, share, or follow for the next lesson. No hard conversion ask.' },
  ],
};

const FRAMEWORK_CAROUSEL: PurposeStrategy = {
  id: 'carousel:framework-carousel',
  contentType: 'carousel',
  purposeKey: 'framework-carousel',
  displayLabel: 'Framework',
  generatedAsLabel: 'Framework Carousel',
  whyChosen: 'Slide arc: Hook → Framework Overview → Pillar 1 → Pillar 2 → Pillar 3 → Conclusion → CTA. Structured pillar reveal closing with a direct next step.',
  promptDirectives: [
    'Carousel orchestration: produce slides that introduce a 3-pillar framework. Each pillar must be parallel in shape, weight, and depth.',
    'Overview slide must show all 3 pillars at a glance. Pillar slides must each deep-dive on one.',
    'CTA slide must offer a clear next step — try the framework, download a worksheet, or book a deeper conversation. Standard intensity, not aggressive.',
  ],
  compositionHints: [
    'Per-slide composition: shape-motif continuity across pillars; identical layout grid; only pillar-specific accent shifts.',
    'Visual continuity: layout system primary; color system secondary; shape motif rotates per pillar.',
  ],
  sceneSelectionHints: [
    'Pillar slides should each represent the pillar concept through a distinct visual motif while sharing the parent composition grid.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'lead',
  ctaIntensity: 'standard',
  ctaSuggestions: ['Try the framework', 'Download the worksheet', 'Book a deeper conversation', 'Get the full playbook'],
  creativeDirectionAffinity: ['executive_insight', 'editorial_modern_startup', 'automation_orchestration'],
  slideArc: [
    { role: 'hook', intent: 'Set up the problem the framework solves.' },
    { role: 'overview', intent: 'Reveal the 3-pillar structure at a glance.' },
    { role: 'pillar_1', intent: 'Deep-dive on the first pillar — definition, why it matters, one anchor example.' },
    { role: 'pillar_2', intent: 'Deep-dive on the second pillar — same structural shape as pillar 1.' },
    { role: 'pillar_3', intent: 'Deep-dive on the third pillar — same structural shape as pillars 1 + 2.' },
    { role: 'conclusion', intent: 'Synthesize how the three pillars work together; close with the framework name.' },
    { role: 'cta', intent: 'Standard CTA — invite the reader to apply the framework: try it, download the worksheet, or book a deeper conversation.' },
  ],
};

const STORY_CAROUSEL: PurposeStrategy = {
  id: 'carousel:story-carousel',
  contentType: 'carousel',
  purposeKey: 'story-carousel',
  displayLabel: 'Story',
  generatedAsLabel: 'Story Carousel',
  whyChosen: 'Slide arc: Hook → Problem → Journey → Transformation → Outcome → CTA. Narrative arc closing with a reflective CTA that invites the reader into the story.',
  promptDirectives: [
    'Carousel orchestration: produce a narrative arc. Each slide advances the story in time or stakes.',
    'Use changing lighting / palette progression across slides to signal narrative transformation.',
    'CTA slide must land softly — invite the reader to reflect, share, or follow the protagonist. No hard sales close.',
  ],
  compositionHints: [
    'Per-slide composition: cinematic framing on hook + outcome; quieter editorial framing on middle beats.',
    'Visual continuity: progressive color palette shift (cooler to warmer, or muted to vivid) signals story arc.',
  ],
  sceneSelectionHints: [
    'Each slide is a story beat — scenes should feel like frames from the same narrative, not interchangeable stills.',
  ],
  densityBias: 'minimal',
  brandingIntensity: 'subtle',
  typographyWeight: 'feature',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Have you experienced this?', 'Follow the journey', 'Share your story', 'Save this story'],
  creativeDirectionAffinity: ['founder_storytelling', 'cinematic_product_launch', 'editorial_modern_startup'],
  slideArc: [
    { role: 'hook', intent: 'Open with the inciting moment or curiosity that earns the swipe.' },
    { role: 'problem', intent: 'Stake out the problem with concrete texture; make the friction felt.' },
    { role: 'journey', intent: 'Show the path — what changed, what was tried, what the protagonist learned.' },
    { role: 'transformation', intent: 'Show the pivot or breakthrough that resolves the problem.' },
    { role: 'outcome', intent: 'Close with the outcome and one line of insight that lands the story.' },
    { role: 'cta', intent: 'Soft CTA — invite the reader into the story: reflect on a similar moment, share, or follow for the next chapter.' },
  ],
};

const PRODUCT_SHOWCASE_CAROUSEL: PurposeStrategy = {
  id: 'carousel:product-showcase-carousel',
  contentType: 'carousel',
  purposeKey: 'product-showcase-carousel',
  displayLabel: 'Product Showcase',
  generatedAsLabel: 'Product Showcase Carousel',
  whyChosen: 'Slide arc: Problem → Feature → Feature → Benefit → CTA. Feature-led product walkthrough.',
  promptDirectives: [
    'Carousel orchestration: produce a feature-led walkthrough. Each feature slide must show the product surface clearly.',
    'CTA slide is the explicit close — direct, action-oriented, single next step.',
  ],
  compositionHints: [
    'Per-slide composition: product surface as hero on feature slides; problem slide more atmospheric; CTA slide most direct.',
    'Visual continuity: dashboard-centric continuity; brand-mark anchored to consistent corner.',
  ],
  sceneSelectionHints: [
    'Feature slides must depict the actual product surface or workflow context — never generic screens.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'strong',
  typographyWeight: 'lead',
  ctaIntensity: 'strong',
  ctaSuggestions: ['Start free trial', 'Book a demo', 'See pricing', 'Try it today'],
  creativeDirectionAffinity: ['minimal_product_hero', 'dashboard_centric', 'product_ecosystem_visual'],
  slideArc: [
    { role: 'problem', intent: 'Frame the customer problem this product solves; one concrete pain point.' },
    { role: 'feature_1', intent: 'Show the primary feature in context — product surface as hero.' },
    { role: 'feature_2', intent: 'Show a complementary feature; same hero treatment, different angle.' },
    { role: 'benefit', intent: 'Translate the features into a measurable customer outcome.' },
    { role: 'cta', intent: 'Direct next step — single action with strong CTA framing.' },
  ],
};

const PRESENTATION_CAROUSEL: PurposeStrategy = {
  id: 'carousel:presentation-carousel',
  contentType: 'carousel',
  purposeKey: 'presentation-carousel',
  displayLabel: 'Presentation',
  generatedAsLabel: 'Presentation Carousel',
  whyChosen: 'Slide arc: Title → Agenda → Content Slides → Summary → Next Steps. Deck-style flow optimized for the Widescreen layout.',
  promptDirectives: [
    'Carousel orchestration: produce a deck-style flow. Title and Agenda must establish what the deck will cover.',
    'Each content slide must own one concept (one idea per slide). Summary recaps, Next Steps is action-oriented.',
  ],
  compositionHints: [
    'Per-slide composition: widescreen layout with presentation typography weight; consistent margin discipline.',
    'Visual continuity: agenda numbering carries forward as slide indicators on each content slide.',
  ],
  sceneSelectionHints: [
    'Treat scenes as deck-grade illustrations — quieter, more considered than feed-native imagery.',
  ],
  densityBias: 'dense',
  brandingIntensity: 'balanced',
  typographyWeight: 'feature',
  ctaIntensity: 'standard',
  ctaSuggestions: ['Schedule a walkthrough', 'Get the deck', 'Talk to our team', 'Continue the conversation'],
  creativeDirectionAffinity: ['executive_insight', 'premium_ai_editorial', 'editorial_modern_startup'],
  slideArc: [
    { role: 'title', intent: 'Title slide — deck name, presenter context, single hero impression.' },
    { role: 'agenda', intent: 'Agenda slide — what the audience will learn, numbered.' },
    { role: 'content', intent: 'Content slide — one concept per slide, with visual anchor and tight body.' },
    { role: 'summary', intent: 'Summary slide — recap of agenda items + the takeaway in one line.' },
    { role: 'next_steps', intent: 'Next-steps slide — what the audience does after the deck.' },
  ],
};

/* ── Infographic structures ───────────────────────────────────────── */

const STATISTICS_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:stats',
  contentType: 'infographic',
  purposeKey: 'stats',
  displayLabel: 'Statistics',
  generatedAsLabel: 'Statistics Infographic',
  whyChosen: 'Data-first architecture — metric blocks anchor the layout; supporting copy is subordinate.',
  promptDirectives: [
    'Infographic orchestration: lead with metric blocks. Each section centers a single number or rate, with a one-line caption.',
    'Use restraint: 3–6 metric blocks maximum; never crowd the canvas with secondary data.',
  ],
  compositionHints: [
    'Composition discipline: metric-block grid as the primary scaffold; section labels typed above each metric.',
    'Hierarchy bias: metric numerals are typographic feature; everything else supports them.',
  ],
  sceneSelectionHints: [
    'No literal scenes — the infographic surface is the scene. Background remains a quiet brand-aligned color or texture.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'feature',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Get the full report', 'Download the data', 'Share these stats', 'See the methodology'],
  creativeDirectionAffinity: ['dashboard_centric', 'editorial_modern_startup'],
  informationArchitecture: {
    pattern: 'data_first',
    sectionBlueprint: ['headline', 'metric_block_1', 'metric_block_2', 'metric_block_3', 'metric_block_4', 'context_line'],
    hierarchyNotes: 'Each metric block: large numeral + small unit + caption. Numerals dominate; captions are 1/3 type size.',
  },
};

const PROCESS_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:process',
  contentType: 'infographic',
  purposeKey: 'process',
  displayLabel: 'Process',
  generatedAsLabel: 'Process Infographic',
  whyChosen: 'Sequence-first architecture — linear step-by-step flow with explicit ordering and gentle connectors.',
  promptDirectives: [
    'Infographic orchestration: present the process as 3–6 ordered steps. Each step must have a number, label, and one-line description.',
    'Connectors between steps should be ambient (gradient, arc, gentle line) — never literal arrows that compete with content.',
  ],
  compositionHints: [
    'Composition discipline: sequential row or column of step cards; numerals lead each step.',
    'Hierarchy bias: step number + label is feature; description is support.',
  ],
  sceneSelectionHints: [
    'No literal scenes — process cards on a quiet brand-aligned surface.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'lead',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Try the process', 'Download the checklist', 'Walk through the steps', 'Save this playbook'],
  creativeDirectionAffinity: ['productivity_workflow', 'automation_orchestration'],
  informationArchitecture: {
    pattern: 'sequence_first',
    sectionBlueprint: ['headline', 'step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'outcome'],
    hierarchyNotes: 'Each step: numeral first, label second, description third. Ambient connectors between steps.',
  },
};

const TIMELINE_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:timeline',
  contentType: 'infographic',
  purposeKey: 'timeline',
  displayLabel: 'Timeline',
  generatedAsLabel: 'Timeline Infographic',
  whyChosen: 'Chronology-first architecture — anchored time markers carry the layout; events attach to dates.',
  promptDirectives: [
    'Infographic orchestration: structure around a chronological spine (horizontal or vertical). Each event anchors to a specific date or period.',
    'Spine ordering must be visually unambiguous — earlier left/top, later right/bottom.',
  ],
  compositionHints: [
    'Composition discipline: timeline spine as primary scaffold; event blocks attach at marker points.',
    'Hierarchy bias: date markers + event labels feature; descriptions support.',
  ],
  sceneSelectionHints: [
    'No literal scenes — event markers along a quiet temporal spine.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'feature',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Plan your timeline', 'Get the roadmap', 'Schedule a planning session', 'Save this timeline'],
  creativeDirectionAffinity: ['editorial_modern_startup', 'executive_insight'],
  informationArchitecture: {
    pattern: 'chronology_first',
    sectionBlueprint: ['headline', 'event_marker_1', 'event_marker_2', 'event_marker_3', 'event_marker_4', 'event_marker_5', 'horizon_note'],
    hierarchyNotes: 'Each marker: date + event label + short description. Spine connects markers linearly.',
  },
};

const COMPARISON_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:comparison',
  contentType: 'infographic',
  purposeKey: 'comparison',
  displayLabel: 'Comparison',
  generatedAsLabel: 'Comparison Infographic',
  whyChosen: 'Side-by-side architecture — two parallel columns enable direct contrast on identical dimensions.',
  promptDirectives: [
    'Infographic orchestration: two parallel columns sharing the same dimension axis. Each row compares one attribute side-by-side.',
    'Both columns must be visually parallel — same shape, same weight, same row count — so the contrast lands.',
  ],
  compositionHints: [
    'Composition discipline: two-column grid; row-by-row attribute comparison; subtle vertical divider between columns.',
    'Hierarchy bias: column labels feature; per-row attributes lead; values support.',
  ],
  sceneSelectionHints: [
    'No literal scenes — the comparison columns are the surface. Two distinct but balanced accent colors per column.',
  ],
  densityBias: 'dense',
  brandingIntensity: 'balanced',
  typographyWeight: 'lead',
  ctaIntensity: 'standard',
  ctaSuggestions: ['Compare your options', 'See which fits you', 'Talk to us about your choice', 'Get the full comparison'],
  creativeDirectionAffinity: ['dashboard_centric', 'executive_insight', 'editorial_modern_startup'],
  informationArchitecture: {
    pattern: 'side_by_side',
    sectionBlueprint: ['headline', 'column_a_label', 'column_b_label', 'row_1', 'row_2', 'row_3', 'row_4', 'verdict'],
    hierarchyNotes: 'Headline → two column labels → attribute rows in parallel → final verdict line.',
  },
};

const FRAMEWORK_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:framework',
  contentType: 'infographic',
  purposeKey: 'framework',
  displayLabel: 'Framework',
  generatedAsLabel: 'Framework Infographic',
  whyChosen: 'Structured pillars architecture — grouped modules with clear separation; each pillar is visually parallel.',
  promptDirectives: [
    'Infographic orchestration: 3–4 parallel pillar modules. Each pillar must be visually equivalent in weight, with its own label and 2–3 sub-points.',
    'Group the pillars under a shared parent label that names the framework.',
  ],
  compositionHints: [
    'Composition discipline: pillar grid (3-up or 4-up); shared module shape; parent label above the grid.',
    'Hierarchy bias: framework parent label feature; pillar labels lead; sub-points support.',
  ],
  sceneSelectionHints: [
    'No literal scenes — pillar modules sit on the canvas as structural elements.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'lead',
  ctaIntensity: 'subtle',
  ctaSuggestions: ['Apply the framework', 'Try it on your team', 'Book a workshop', 'Save the framework'],
  creativeDirectionAffinity: ['executive_insight', 'automation_orchestration', 'editorial_modern_startup'],
  informationArchitecture: {
    pattern: 'structured_pillars',
    sectionBlueprint: ['framework_label', 'pillar_1', 'pillar_2', 'pillar_3', 'pillar_4', 'synthesis_note'],
    hierarchyNotes: 'Framework parent label → pillar modules in parallel grid → synthesis note tying them together.',
  },
};

const ROADMAP_INFOGRAPHIC: PurposeStrategy = {
  id: 'infographic:roadmap',
  contentType: 'infographic',
  purposeKey: 'roadmap',
  displayLabel: 'Roadmap',
  generatedAsLabel: 'Roadmap Infographic',
  whyChosen: 'Phased progression — milestone-anchored plan rendered atop the timeline scaffold with phase labels.',
  promptDirectives: [
    'Infographic orchestration: phased progression with explicit phase labels (e.g. Now / Next / Later, or Phase 1 / 2 / 3).',
    'Internally borrows the timeline spine — milestones attach to phase markers, not raw dates.',
  ],
  compositionHints: [
    'Composition discipline: phase spine with bracketed milestone clusters under each phase.',
    'Hierarchy bias: phase labels feature; milestone labels lead; milestone descriptions support.',
  ],
  sceneSelectionHints: [
    'No literal scenes — the roadmap canvas is the surface. Phase bands shade subtly to differentiate phases.',
  ],
  densityBias: 'balanced',
  brandingIntensity: 'balanced',
  typographyWeight: 'feature',
  ctaIntensity: 'standard',
  ctaSuggestions: ['See the roadmap', 'Schedule a planning call', 'Get the milestones', 'Map this to your team'],
  creativeDirectionAffinity: ['executive_insight', 'automation_orchestration', 'productivity_workflow'],
  informationArchitecture: {
    pattern: 'phased_progression',
    sectionBlueprint: ['headline', 'phase_1_label', 'phase_1_milestones', 'phase_2_label', 'phase_2_milestones', 'phase_3_label', 'phase_3_milestones', 'horizon_note'],
    hierarchyNotes: 'Phase labels span the spine; each phase contains a cluster of 2–4 milestones with short descriptions.',
  },
};

/* ── Registry assembly + resolver ──────────────────────────────────── */

const REGISTRY: ReadonlyArray<PurposeStrategy> = [
  PROMOTIONAL_IMAGE,
  EDUCATIONAL_IMAGE,
  QUOTE_IMAGE,
  PRODUCT_SHOWCASE_IMAGE,
  BRAND_FOCUS_IMAGE,
  EDUCATIONAL_CAROUSEL,
  FRAMEWORK_CAROUSEL,
  STORY_CAROUSEL,
  PRODUCT_SHOWCASE_CAROUSEL,
  PRESENTATION_CAROUSEL,
  STATISTICS_INFOGRAPHIC,
  PROCESS_INFOGRAPHIC,
  TIMELINE_INFOGRAPHIC,
  COMPARISON_INFOGRAPHIC,
  FRAMEWORK_INFOGRAPHIC,
  ROADMAP_INFOGRAPHIC,
];

const REGISTRY_BY_ID = new Map<string, PurposeStrategy>(REGISTRY.map((s) => [s.id, s]));
const REGISTRY_BY_COMPOSITE = new Map<string, PurposeStrategy>(
  REGISTRY.map((s) => [`${s.contentType}:${s.purposeKey.toLowerCase()}`, s]),
);

/**
 * Resolve a purpose strategy by contentType + purposeKey. Returns null
 * when no strategy matches — callers should treat this as "no purpose
 * bias" and fall back to the existing prompt composition path.
 *
 * `purposeKey` may be a UI-side subtype value (e.g. 'promotional-image',
 * 'story-carousel', 'stats') OR the canonical strategy id token after
 * the colon — both forms resolve identically.
 */
export function resolvePurposeStrategy(
  contentType: string,
  purposeKey: string | null | undefined,
): PurposeStrategy | null {
  if (!purposeKey) return null;
  const normalizedType = String(contentType || '').trim().toLowerCase();
  const normalizedKey = String(purposeKey).trim().toLowerCase();
  if (!normalizedType || !normalizedKey) return null;
  // Map UI contentType aliases to registry contentType (image / carousel /
  // infographic). Banner / slider users land on image / carousel after
  // the taxonomy consolidation, so they share the image / carousel
  // strategy lookup.
  const registryType: PurposeContentType =
    normalizedType === 'banner' ? 'image' :
    normalizedType === 'slider' || normalizedType === 'pdf' ? 'carousel' :
    normalizedType === 'image' || normalizedType === 'carousel' || normalizedType === 'infographic' ? normalizedType :
    'image';
  // First try composite key. Then try by full id.
  const composite = REGISTRY_BY_COMPOSITE.get(`${registryType}:${normalizedKey}`);
  if (composite) return composite;
  const byId = REGISTRY_BY_ID.get(`${registryType}:${normalizedKey}`);
  if (byId) return byId;
  return null;
}

/** Diagnostics — used by tests + admin tooling. */
export function listPurposeStrategies(): ReadonlyArray<PurposeStrategy> {
  return REGISTRY;
}

export function listPurposeStrategiesForContentType(
  contentType: PurposeContentType,
): ReadonlyArray<PurposeStrategy> {
  return REGISTRY.filter((s) => s.contentType === contentType);
}
