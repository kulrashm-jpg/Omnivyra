import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../../components/CompanyContext';
import { launchCampaignFromContent } from '../../../lib/content/launchCampaignFromContent';
import { launchSocialPostingFromContent } from '../../../lib/content/socialPosting';
import { buildCreatorContentBlocks, launchBlogFromCreator } from '../../../lib/content/creatorContentBridge';
import { buildCreatorFlowContext, serializeCreatorFlowContext, type CreatorFlowContext } from '../../../lib/content/creatorFlowContext';
import { appendCreatorVisualReviewCandidate } from '../../../lib/content/creatorVisualReview';
import {
  appendWriterAttachedAssetDurable,
  getWriterCreatorPrefillKey,
  type CreatorAssetLaunchType,
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../../../lib/content/writerCreatorAssetLaunch';
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
  | { id: string; label: string; placeholder: string; rows?: number; kind: 'text' | 'textarea' }
  | { id: string; label: string; kind: 'single-select'; options: ChoiceOption[] };

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

function isSocialCreativeType(type: CreatorTypeId | null): boolean {
  return type === 'image' || type === 'banner' || type === 'infographic';
}

function isDeterministicStructuredType(type: CreatorTypeId | null): boolean {
  return type === 'carousel' || type === 'pdf' || type === 'slider';
}

const WORKFLOW_CONFIG: Record<CreatorTypeId, WorkflowConfig> = {
  carousel: {
    title: 'Carousel',
    contentType: 'carousel',
    intro: 'Pick the kind of carousel you want, set the core direction, and let AI turn that into a structured creator asset.',
    subtypeLabel: 'What kind of carousel do you want to create?',
    subtypeOptions: [
      { value: 'educational-carousel', label: 'Educational', description: 'Teach a concept through a clear slide-by-slide sequence.' },
      { value: 'authority-carousel', label: 'Authority', description: 'Position expertise with insights, proof, and a strong close.' },
      { value: 'framework-carousel', label: 'Framework', description: 'Present a model, process, or repeatable structure.' },
    ],
    primaryPlatforms: ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'reddit', 'pinterest'],
    fields: [
      { id: 'topic', label: 'What is the carousel about?', placeholder: 'Main topic, offer, framework, or idea', kind: 'text' },
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
    intro: 'Choose the image style first, then guide AI with a few structured inputs so it can propose the right visual direction.',
    subtypeLabel: 'What kind of image do you want to create?',
    subtypeOptions: [
      { value: 'promotional-image', label: 'Promotional', description: 'Highlight an offer, announcement, or launch message.' },
      { value: 'quote-image', label: 'Quote Image', description: 'Turn one memorable line into a strong static visual.' },
      { value: 'educational-image', label: 'Educational', description: 'Present one clear concept in a static visual format.' },
    ],
    primaryPlatforms: SOCIAL_CREATIVE_PLATFORMS,
    fields: [
      { id: 'topic', label: 'What is the image about?', placeholder: 'Topic, offer, message, or announcement', kind: 'text' },
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
      { id: 'cta', label: 'What action should the viewer take?', placeholder: 'Desired CTA', kind: 'text' },
    ],
  },
  banner: {
    title: 'Banner',
    contentType: 'banner',
    intro: 'Choose the banner intent and let AI shape the hierarchy, message emphasis, and visual direction around that use case.',
    subtypeLabel: 'What kind of banner do you want to create?',
    subtypeOptions: [
      { value: 'launch-banner', label: 'Launch', description: 'Announce a launch, release, or important new update.' },
      { value: 'promo-banner', label: 'Promotion', description: 'Push an offer, campaign, or conversion-oriented CTA.' },
      { value: 'event-banner', label: 'Event', description: 'Promote a webinar, event, or date-led initiative.' },
    ],
    primaryPlatforms: SOCIAL_CREATIVE_PLATFORMS,
    fields: [
      { id: 'topic', label: 'What is the banner promoting?', placeholder: 'Offer, launch, event, campaign, or message', kind: 'text' },
      {
        id: 'objective',
        label: 'What should this banner optimize for?',
        kind: 'single-select',
        options: [
          { value: 'clicks', label: 'Clicks', description: 'Drive immediate traffic or visits.' },
          { value: 'signups', label: 'Signups', description: 'Push the audience toward registration or lead capture.' },
          { value: 'awareness', label: 'Awareness', description: 'Make the message memorable and visible.' },
        ],
      },
      {
        id: 'hierarchy',
        label: 'What should dominate visually?',
        kind: 'single-select',
        options: [
          { value: 'headline-first', label: 'Headline First', description: 'Lead with bold message clarity.' },
          { value: 'offer-first', label: 'Offer First', description: 'Lead with the practical value or benefit.' },
          { value: 'cta-first', label: 'CTA First', description: 'Make the next step feel most prominent.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'Which visual personality should it follow?',
        kind: 'single-select',
        options: [
          { value: 'clean-brand', label: 'Clean + Brand-Led', description: 'Professional, consistent, and controlled.' },
          { value: 'high-energy', label: 'High Energy', description: 'More vivid, urgent, and promotional.' },
          { value: 'minimal-premium', label: 'Minimal + Premium', description: 'Simple, spacious, and elevated.' },
        ],
      },
      { id: 'audience', label: 'Who should notice this first?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'headline', label: 'What should the banner headline communicate?', placeholder: 'Primary headline or statement', rows: 3, kind: 'textarea' },
      { id: 'cta', label: 'What CTA should appear?', placeholder: 'Book now, Learn more, Download, Join...', kind: 'text' },
    ],
  },
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
          { value: 'stats', label: 'Stats', description: 'Metric-led sections with compact proof points.' },
          { value: 'comparison', label: 'Comparison', description: 'Side-by-side understanding or contrast.' },
          { value: 'process', label: 'Process', description: 'Linear, sequential explanation.' },
          { value: 'framework', label: 'Framework', description: 'Grouped modules with clear separation.' },
          { value: 'hierarchy', label: 'Hierarchy', description: 'Priority-led structure with nested importance.' },
          { value: 'timeline', label: 'Timeline', description: 'Chronological sequence with clear stages.' },
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
  slider: {
    title: 'Slider',
    contentType: 'slider',
    intro: 'Choose the slider style first, then guide AI with the message flow, audience, and presentation direction you want.',
    subtypeLabel: 'What kind of slider do you want to create?',
    subtypeOptions: [
      { value: 'pitch-slider', label: 'Pitch', description: 'Present an offer, value proposition, or proposal.' },
      { value: 'teaching-slider', label: 'Teaching', description: 'Walk through a topic in presentation form.' },
      { value: 'summary-slider', label: 'Summary', description: 'Condense a longer idea into a slide-ready sequence.' },
    ],
    primaryPlatforms: ['linkedin'],
    fields: [
      { id: 'topic', label: 'What is the slider about?', placeholder: 'Theme, topic, or presentation subject', kind: 'text' },
      {
        id: 'objective',
        label: 'What should the slider achieve?',
        kind: 'single-select',
        options: [
          { value: 'pitch', label: 'Pitch', description: 'Move the audience toward belief in an offer or direction.' },
          { value: 'explain', label: 'Explain', description: 'Clarify a concept in a slide-led format.' },
          { value: 'summarize', label: 'Summarize', description: 'Compress information into a structured set of slides.' },
        ],
      },
      {
        id: 'continuity',
        label: 'How should the slide flow feel?',
        kind: 'single-select',
        options: [
          { value: 'continuous', label: 'Continuous', description: 'Each slide should build directly into the next.' },
          { value: 'sectioned', label: 'Sectioned', description: 'Slides should group into distinct parts.' },
          { value: 'progressive', label: 'Progressive', description: 'Slides should escalate or deepen over time.' },
        ],
      },
      {
        id: 'styleDirection',
        label: 'What presentation personality fits best?',
        kind: 'single-select',
        options: [
          { value: 'corporate-clean', label: 'Corporate + Clean', description: 'Structured, professional, and polished.' },
          { value: 'premium-editorial', label: 'Premium Editorial', description: 'Refined and more design-forward.' },
          { value: 'bold-modern', label: 'Bold Modern', description: 'Sharper, stronger, and more visually expressive.' },
        ],
      },
      { id: 'audience', label: 'Who is it for?', placeholder: 'Audience segment', kind: 'text' },
      { id: 'keyMessage', label: 'What is the key message?', placeholder: 'Main argument or narrative', rows: 3, kind: 'textarea' },
      { id: 'slideDirection', label: 'How should the slides flow?', placeholder: 'Suggested sequence or slide logic', rows: 4, kind: 'textarea' },
    ],
  },
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

type SavedCreatorAsset = {
  id: string;
  name: string;
  description: string | null;
  format_type?: string | null;
  tags: string[];
  usage_count: number;
  created_at?: string;
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
    if (logo) lines.push(`Company logo reference: ${logo}`);
  }
  if (input.selections.favicon) {
    const favicon = input.overrides.faviconUrl || profile.faviconUrl;
    if (favicon) lines.push(`Company favicon reference: ${favicon}`);
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
  const platform = config.primaryPlatforms[0] === 'linkedin' ? 'LinkedIn' : humanizeValue(config.primaryPlatforms[0]);
  const companySignal = context.brandMode === 'brand-aware'
    ? `${context.brandProfile?.companyName ? `${context.brandProfile.companyName} ` : ''}${context.brandPresence} brand presence`
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

  return [
    {
      id: 'safe-fit',
      label: 'Authority Direction',
      summary: `${platform}-friendly ${subtypeLabel.toLowerCase()} ${config.title.toLowerCase()} for ${objective.toLowerCase()} that frames "${message}" through ${companySignal}, ${industrySignal}, and ${objectiveSignal}${assetSignal}.`,
      rationale: `Use this when ${audience} needs a polished, credible direction with strong retention and low execution risk.`,
      badges: ['Brand Safe', `${platform} Friendly`, 'Educational'],
    },
    {
      id: 'standout',
      label: 'Standout Direction',
      summary: `High-attention ${config.title.toLowerCase()} that leads with a sharper hook around "${message}", uses ${style.toLowerCase()} personality, and makes the first-screen payoff unmistakable for ${platform}.`,
      rationale: `Best when the priority is stopping attention quickly without turning the output into generic hype.`,
      badges: ['High Attention', style.toLowerCase().includes('premium') ? 'Premium' : 'Bold', 'High CTR'],
    },
    {
      id: 'educator',
      label: 'Conversion Direction',
      summary: `Structured ${config.title.toLowerCase()} that turns "${message}" into a clear sequence, keeps ${continuity.toLowerCase()}, and gives the CTA a specific next-step role instead of generic closing copy.`,
      rationale: `Best when clarity, downstream reuse, and action are more important than novelty alone.`,
      badges: ['Conversion Focused', 'Educational', objective.toLowerCase().includes('conversion') ? 'High CTR' : 'Reusable'],
    },
  ];
}

export default function CreatorTypeWorkflowPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const type = typeof router.query.type === 'string' ? (router.query.type as CreatorTypeId) : null;
  const config = type ? WORKFLOW_CONFIG[type] : null;

  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isSavingBlock, setIsSavingBlock] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savedBlock, setSavedBlock] = React.useState<SavedBlockReference | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = React.useState('safe-fit');
  const [refinePrompt, setRefinePrompt] = React.useState('');
  const [refinedSuggestion, setRefinedSuggestion] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatorResult | null>(null);
  const [savedAssets, setSavedAssets] = React.useState<SavedCreatorAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = React.useState(false);
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);
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
  const [selectedPlatform, setSelectedPlatform] = React.useState('linkedin');
  const [overlayText, setOverlayText] = React.useState<WriterOverlayText>(EMPTY_OVERLAY_TEXT);
  const generationInFlightRef = React.useRef(false);
  const saveInFlightRef = React.useRef(false);
  const processedWriterPrefillRef = React.useRef('');
  const writerCompositionIntent = writerSource?.compositionIntent ?? null;
  const writerAttachmentMode: AttachmentMode | null = writerCompositionIntent?.attachmentMode ?? null;
  const writerAssetType: WriterCreatorAssetType | null = writerCompositionIntent?.assetType ?? null;
  const writerSupportingVisual = writerAttachmentMode === 'supporting_visual';
  const writerEmbeddedCopy = writerAttachmentMode === 'embedded_copy';

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, isLoading, user?.userId, router]);

  React.useEffect(() => {
    const defaults = config ? buildDefaultAnswers(config) : {};
    let restored: Record<string, unknown> | null = null;
    if (type && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(getCreatorDraftStorageKey(type));
        restored = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        const savedAt = typeof restored?.saved_at === 'string' ? Date.parse(restored.saved_at) : 0;
        const isStale = Boolean(savedAt && Date.now() - savedAt > CREATOR_DRAFT_MAX_AGE_MS);
        if (isStale) {
          window.localStorage.removeItem(getCreatorDraftStorageKey(type));
          restored = null;
        }
      } catch {
        restored = null;
      }
    }
    setAnswers({
      ...defaults,
      ...((restored?.answers && typeof restored.answers === 'object') ? restored.answers as Record<string, string> : {}),
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
    setBrandPanelOpen(false);
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
  }, [config, router.query.prefill, router.query.source, type]);

  React.useEffect(() => {
    if (!router.isReady || !config || !type || typeof window === 'undefined') return;
    const prefillToken = typeof router.query.prefill === 'string' ? router.query.prefill : '';
    const source = typeof router.query.source === 'string' ? router.query.source : '';
    if (!prefillToken || source !== 'writer' || processedWriterPrefillRef.current === prefillToken) return;

    try {
      const raw = window.sessionStorage.getItem(getWriterCreatorPrefillKey(prefillToken));
      if (!raw) return;
      const parsed = JSON.parse(raw) as WriterCreatorSourcePayload;
      if (parsed.sourceType !== 'post' && parsed.sourceType !== 'thread') return;

      processedWriterPrefillRef.current = prefillToken;
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
      setOverlayText(EMPTY_OVERLAY_TEXT);
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
  }, [config, router.isReady, router.query.asset_type, router.query.attachment_mode, router.query.platform, router.query.prefill, router.query.source, router.query.source_text_transform, type]);

  React.useEffect(() => {
    if (!type || typeof window === 'undefined') return;
    const persistTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(getCreatorDraftStorageKey(type), JSON.stringify({
          answers,
          selectedSuggestionId,
          brandMode,
          brandPresence,
          brandSelections,
          brandOverrides,
          selectedAssetId,
          selectedPlatform,
          overlayText,
          standaloneAttachmentMode,
          recommendedAttachmentMode,
          saved_at: new Date().toISOString(),
        }));
      } catch {
        // Draft persistence is best-effort; generation should keep working.
      }
    }, 250);
    return () => window.clearTimeout(persistTimer);
  }, [answers, brandMode, brandOverrides, brandPresence, brandSelections, overlayText, standaloneAttachmentMode, recommendedAttachmentMode, selectedAssetId, selectedPlatform, selectedSuggestionId, type]);

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

  React.useEffect(() => {
    if (!selectedCompanyId) {
      setSavedAssets([]);
      setSelectedAssetId(null);
      setIsLoadingAssets(false);
      return;
    }
    let cancelled = false;
    setIsLoadingAssets(true);
    fetch(`/api/block-templates?company_id=${encodeURIComponent(selectedCompanyId)}&content_type=blog`, {
      credentials: 'include',
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const templates = Array.isArray(data?.templates) ? data.templates : [];
        const creatorAssets = templates
          .filter((template: SavedCreatorAsset) => Array.isArray(template.tags) && template.tags.includes('creator-asset'))
          .slice(0, 8);
        setSavedAssets(creatorAssets);
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
  }, [selectedCompanyId, savedBlock?.id]);

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
    () => (config ? buildSuggestionOptions(config, answers, { brandMode, brandPresence, brandProfile }) : []),
    [answers, brandMode, brandPresence, brandProfile, config],
  );

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-slate-700" />
      </div>
    );
  }

  if (!user?.userId) return null;

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-600">
          Unknown creator content type.
        </div>
      </div>
    );
  }

  const setAnswer = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
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

  const handleUseExistingAsset = (asset: SavedCreatorAsset) => {
    if (isGenerating || actionInProgress) return;
    setSelectedAssetId(asset.id);
    setAnswer('refinement', [
      answers.refinement,
      `Reuse existing creator asset "${asset.name}" as the starting context.`,
    ].filter(Boolean).join('\n'));
    if (!String(answers.topic || '').trim()) {
      setAnswer('topic', asset.name.replace(/\s+Asset$/i, ''));
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

  const handleGenerate = async () => {
    if (generationInFlightRef.current || isGenerating) return;
    if (!String(answers.topic || '').trim()) {
      setError('Please answer the main topic question first.');
      return;
    }

    generationInFlightRef.current = true;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setSavedBlock(null);
    setResult(null);

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
          cta: writerCopyPolicy?.allowCTA ? String(overlayText.cta || answers.cta || '').trim() : '',
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
      // Writer-source context. For type='image' + composition mode, we
      // DROP the structured overlay candidates from the prompt — they only
      // make sense when the renderer will composite them. We still pass
      // the imported Writer body so the LLM can shape visual direction
      // around the source content.
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

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CREATOR_GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch('/api/command-center/creator-content/generate', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId || undefined,
          creator_type: type,
          content_type: config.contentType,
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
            // Attachment-mode contract: when type === 'image' AND mode is
            // supporting_visual, the overlay editor is hidden and the renderer
            // skips the overlay composite — so we omit overlay_text from
            // the payload entirely (sending it would confuse a v1-shape
            // consumer). banner/infographic still always emit overlay_text
            // since they're text_embedded by definition.
            ...(!writerSource && type === 'image' ? { attachment_mode: standaloneAttachmentMode } : {}),
            writer_asset_type: writerAssetType,
            creator_content_asset_type: type,
            attachment_mode: writerAttachmentMode,
            asset_composition_intent: writerCompositionIntent,
            copy_policy: writerCopyPolicy,
            source_text_transform: writerCopyPolicy?.sourceTextTransform ?? null,
            infographic_layout: type === 'infographic' ? String(answers.structureMode || 'framework') : null,
            overlay_text: overlayPayload,
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
            template_id: null,
          },
          target_platforms: [selectedPlatform || config.primaryPlatforms[0]],
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to generate creator content.');
      }
      setResult(data as CreatorResult);
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
        void appendWriterAttachedAssetDurable({
          companyId: selectedCompanyId,
          sourceType: writerSource.sourceType,
          sourceId: writerSource.sourceId,
          sourceContent: {
            sourceType: writerSource.sourceType,
            sourceId: writerSource.sourceId,
            title: writerSource.title,
            body: writerSource.body,
            platform: writerSource.platform,
            hashtags: writerSource.hashtags,
          },
          asset: {
          id: `${writerSource.id}-${type}-${Date.now()}`,
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
        });
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

  const handleLaunchCampaign = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before using it in a campaign.');
      return;
    }
    setActionInProgress('campaign');
    try {
      const context = buildCurrentContext(result.primary_platform);
      launchCampaignFromContent({
        router,
        contentType: config.contentType as any,
        title: String(answers.topic || config.title),
        excerpt: result.output.packaging.meta_description || result.output.packaging.caption,
        tags: result.output.packaging.hashtags,
        formatType: result.output.asset_type,
        sourceId: selectedAsset?.id || null,
        contentMarkdown: `${result.output.packaging.caption}\n\n${serializeCreatorFlowContext(context)}`,
      });
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Could not open this output in Campaigns.');
      setActionInProgress(null);
    }
  };

  const handleOpenScheduler = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before using it as a post.');
      return;
    }
    setActionInProgress('post');
    try {
      const context = buildCurrentContext(result.primary_platform);
      launchSocialPostingFromContent({
        router,
        contentType: config.contentType as any,
        title: String(answers.topic || config.title),
        content: `${result.output.packaging.caption}\n\n${context.CTA ? `CTA: ${context.CTA}` : ''}`.trim(),
        tags: result.output.packaging.hashtags,
        excerpt: result.output.packaging.meta_description,
        sourceId: selectedAsset?.id || null,
      });
    } catch (schedulerError) {
      setError(schedulerError instanceof Error ? schedulerError.message : 'Could not open this output as a post.');
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

  const handleDuplicateOutput = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result) || typeof window === 'undefined') {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before duplicating it.');
      return;
    }
    setActionInProgress('duplicate');
    try {
      const token = `creator_duplicate_${Date.now()}`;
      window.sessionStorage.setItem(token, JSON.stringify({
        result,
        answers,
        context: buildCurrentContext(result.primary_platform),
        duplicated_at: new Date().toISOString(),
      }));
      setNotice('Duplicated this creator output as a temporary reusable draft for this browser session.');
    } catch {
      setError('Could not duplicate this output in the browser session.');
    } finally {
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
      const baseContentBlocks = buildCreatorContentBlocks(String(answers.topic || config.title), result.output);
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
              cta:            overlayText.cta,
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
      const continuityBlock = {
        type: 'creator_continuity' as const,
        data: { ...continuityMetadata, schema_version: 1 },
      };
      // Prepend the continuity block; downstream blog/post renderers skip
      // unknown types via their existing filter, and the API strips the
      // block out of content_blocks via `extractCreatorContinuity` before
      // it reaches client renderers.
      const contentBlocks = [continuityBlock, ...baseContentBlocks];
      const response = await fetch('/api/block-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          name: `${String(answers.topic || config.title).trim()} Asset`,
          // Description is now prose-only. Renderer metadata used to be
          // JSON.stringified here for restoration; that's been superseded by
          // the structured `creator_continuity` block prepended to
          // content_blocks. Old assets still restore correctly via the
          // legacy fallback path in `handleUseExistingAsset`.
          description: `Creator asset from ${config.title}. Stored for future long-form writer reuse.\n\n${serializeCreatorFlowContext(buildCurrentContext(result.primary_platform))}`,
          content_type: 'blog',
          format_type: result.output.asset_type,
          content_blocks: contentBlocks,
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
          is_public: false,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save this creator output as a reusable block.');
      }

      const templateId = String(data?.template?.id || '').trim();
      const templateName = String(data?.template?.name || `${String(answers.topic || config.title).trim()} Asset`).trim();
      const mediaBundle = result.output.asset_payload?.media_bundle || {};
      void fetch('/api/creator-assets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          block_template_id: templateId || undefined,
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
            creatorType: writerAssetType ?? (type === 'image' ? 'supporting_image' : type),
            title: templateName,
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined,
            files: Array.isArray(mediaBundle.files) ? mediaBundle.files : undefined,
            previewKind: typeof rendererMetadata.preview_kind === 'string' ? rendererMetadata.preview_kind : undefined,
            platformContext: result.primary_platform || selectedPlatform,
            renderIdentityHash: persistedRendererMetadata.renderIdentityHash,
            metadata: {
              ...rendererMetadata,
              creatorContentAssetType: type,
              savedBlockReference: templateId ? buildBlockReference(templateId) : null,
              blockTemplateId: templateId || null,
            },
          },
        }),
      }).catch(() => undefined);
      const nextSavedBlock = templateId
        ? {
            id: templateId,
            reference: buildBlockReference(templateId),
            name: templateName,
          }
        : null;

      setSavedBlock(nextSavedBlock);
      setNotice(
        nextSavedBlock
          ? `Saved as creator asset ${nextSavedBlock.reference}. Writer Content can pull this asset later in long-form content.`
          : 'Saved as a reusable creator asset. You can pull it into long-form content later.',
      );
      if (nextSavedBlock) {
        setSelectedAssetId(nextSavedBlock.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save this creator output as a reusable block.');
    } finally {
      setIsSavingBlock(false);
      saveInFlightRef.current = false;
    }
  };

  const handleDownloadBrief = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result) || typeof window === 'undefined') {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before downloading it.');
      return;
    }
    setActionInProgress('download');
    try {
      const title = String(answers.topic || config.title || 'creator-asset').trim();
      const assetLines = [
        `# ${title}`,
        '',
        `Type: ${config.title}`,
        `Asset: ${result.output.asset_type}`,
        answers.assetSubtype ? `Supporting asset: ${humanizeValue(answers.assetSubtype)}` : '',
        result.primary_platform ? `Primary platform: ${result.primary_platform}` : '',
        '',
        '## Context',
        serializeCreatorFlowContext(buildCurrentContext(result.primary_platform)),
        '',
        '## Caption',
        result.output.packaging.caption || '',
        '',
        '## CTA',
        result.output.packaging.cta || '',
        '',
        '## Summary',
        result.output.packaging.meta_description || '',
        '',
        '## Hashtags',
        result.output.packaging.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
        '',
        '## Media',
        ...summarizeMediaUrls(result),
      ].filter((line) => line !== undefined).join('\n');
      const blob = new Blob([assetLines], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'creator-asset'}-brief.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice('Downloaded this creator brief.');
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
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{config.subtypeLabel}</span>
                <div className="grid gap-3 md:grid-cols-3">
                  {config.subtypeOptions.map((option) => {
                    const selected = (answers.subtype || config.subtypeOptions[0]?.value) === option.value;
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
                          ].map((item) => (
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
                            </div>
                          ))}
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
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {(writerSource ? [selectedPlatform] : config.primaryPlatforms).filter(Boolean).map((platform) => (
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
                      { id: 'cta' as const, label: 'CTA', placeholder: 'Book a demo, Learn more...', max: 42 },
                      { id: 'supportingText' as const, label: 'Supporting Text', placeholder: 'One short proof, context, or benefit line', max: 96 },
                    ].map((field) => (
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
                      </label>
                    ))}
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
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-emerald-800">
                    Platform choice controls density, CTA weight, and brand treatment. X, Threads, and Reddit use lighter overlays; Instagram and Facebook use stronger CTA presence.
                  </p>
                </div>
              ) : null}

              {config.fields.map((field) => (
                <div key={field.id} className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{field.label}</span>
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
                    <input
                      value={answers[field.id] || ''}
                      onChange={(event) => setAnswer(field.id, event.target.value)}
                      placeholder={field.placeholder}
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  )}
                </div>
              ))}
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

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? 'Generating...' : `Generate ${config.title}`}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                {result ? 'Generated Output' : 'Pick A Direction'}
              </p>
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
                          className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                        >
                          Open full size
                        </a>
                      </div>
                      <div className="grid gap-3">
                        {mediaUrls.map((url, index) => (
                          <div key={url} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <img
                              src={url}
                              alt={`${config.title} preview ${index + 1}`}
                              style={{ aspectRatio: previewAspectRatio }}
                              className="w-full bg-gray-100 object-contain"
                              loading="lazy"
                              onError={() => setError('Preview could not load. The generated media URL is still available in the output actions.')}
                            />
                            <div className="border-t border-gray-100 px-4 py-3">
                              <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs font-medium text-blue-700 hover:text-blue-900">
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

                  {slides.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Slide Structure</p>
                      <div className="space-y-2">
                        {slides.map((slide, index) => (
                          <div key={`${index}-${String(slide.slide_number ?? index + 1)}`} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Slide {String(slide.slide_number ?? index + 1)} - {String(slide.role ?? 'content')}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">{String(slide.headline ?? '')}</p>
                            <p className="mt-1 text-sm text-gray-600">{String(slide.body_text ?? '')}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                      onClick={handleSaveAsBlog}
                      disabled={Boolean(actionInProgress)}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionInProgress === 'blog' ? 'Opening Blog...' : 'Save As Blog'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunchCampaign}
                      disabled={Boolean(actionInProgress)}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionInProgress === 'campaign' ? 'Opening Campaign...' : 'Use In Campaign'}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenScheduler}
                      disabled={Boolean(actionInProgress)}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionInProgress === 'post' ? 'Opening Post...' : 'Use As Post'}
                    </button>
                    <button
                      type="button"
                      onClick={() => repurposePaths[0] && handleRepurpose(repurposePaths[0])}
                      disabled={repurposePaths.length === 0 || Boolean(actionInProgress)}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionInProgress?.startsWith('repurpose') ? 'Repurposing...' : 'Repurpose'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadBrief}
                      disabled={Boolean(actionInProgress)}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionInProgress === 'download' ? 'Preparing...' : 'Download'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDuplicateOutput}
                      disabled={Boolean(actionInProgress)}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
                    >
                      {actionInProgress === 'duplicate' ? 'Duplicating...' : 'Duplicate'}
                    </button>
                  </div>

                  {repurposePaths.length > 0 && (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Repurpose Paths</p>
                      <div className="mt-3 grid gap-2">
                        {repurposePaths.map((path) => (
                          <button
                            key={path.id}
                            type="button"
                            onClick={() => handleRepurpose(path)}
                            disabled={Boolean(actionInProgress)}
                            className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-left text-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="font-semibold text-gray-900">{path.label}</span>
                            <span className="mt-1 block text-xs text-gray-500">{path.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
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
