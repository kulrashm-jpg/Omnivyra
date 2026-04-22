import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../../components/CompanyContext';
import { launchCampaignFromContent } from '../../../lib/content/launchCampaignFromContent';
import { launchSocialPostingFromContent } from '../../../lib/content/socialPosting';
import { buildCreatorContentBlocks, launchBlogFromCreator } from '../../../lib/content/creatorContentBridge';

type CreatorTypeId =
  | 'carousel'
  | 'image'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

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
    primaryPlatforms: ['linkedin', 'instagram', 'pinterest'],
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
    primaryPlatforms: ['linkedin', 'instagram', 'pinterest'],
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
        label: 'What visual tone fits best?',
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
    primaryPlatforms: ['linkedin', 'instagram'],
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
        label: 'Which visual tone should it follow?',
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
    primaryPlatforms: ['linkedin', 'pinterest', 'instagram'],
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
          { value: 'top-to-bottom', label: 'Top to Bottom', description: 'Linear, sequential explanation.' },
          { value: 'sectioned-grid', label: 'Sectioned Grid', description: 'Grouped modules with clear separation.' },
          { value: 'comparison-layout', label: 'Comparison', description: 'Side-by-side understanding or contrast.' },
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
        label: 'What presentation tone fits best?',
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
      media_bundle?: { url?: string; files?: string[] };
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

function summarizeMediaUrls(result: CreatorResult | null): string[] {
  if (!result) return [];
  const mediaBundle = result.output.asset_payload.media_bundle || {};
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : [];
  const url = typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : [];
  return [...url, ...files];
}

export default function CreatorTypeWorkflowPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId } = useCompanyContext();
  const type = typeof router.query.type === 'string' ? (router.query.type as CreatorTypeId) : null;
  const config = type ? WORKFLOW_CONFIG[type] : null;

  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isSavingBlock, setIsSavingBlock] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatorResult | null>(null);

  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  React.useEffect(() => {
    setAnswers(config ? { subtype: config.subtypeOptions[0]?.value || '' } : {});
    setResult(null);
    setError(null);
    setNotice(null);
  }, [config, type]);

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

  const handleGenerate = async () => {
    if (!selectedCompanyId) {
      setError('Select a company context before generating creator content.');
      return;
    }
    if (!String(answers.topic || '').trim()) {
      setError('Please answer the main topic question first.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setResult(null);

    const constraintLines = [
      answers.subtype ? `Subtype: ${answers.subtype}` : '',
      answers.cta ? `CTA: ${answers.cta}` : '',
      answers.dataPoints ? `Data points: ${answers.dataPoints}` : '',
      answers.sectionDirection ? `Sections: ${answers.sectionDirection}` : '',
      answers.slideDirection ? `Slide direction: ${answers.slideDirection}` : '',
      answers.headline ? `Headline: ${answers.headline}` : '',
      answers.continuity ? `Continuity: ${answers.continuity}` : '',
      answers.visualSystem ? `Visual continuity: ${answers.visualSystem}` : '',
      answers.hierarchy ? `Visual hierarchy: ${answers.hierarchy}` : '',
      answers.structureMode ? `Structure mode: ${answers.structureMode}` : '',
      answers.density ? `Density: ${answers.density}` : '',
      answers.styleDirection ? `Style direction: ${answers.styleDirection}` : '',
      answers.refinement ? `Additional notes: ${answers.refinement}` : '',
    ].filter(Boolean);

    try {
      const response = await fetch('/api/command-center/creator-content/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
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
            constraints: constraintLines.join('\n'),
            asset_type: type,
            template_id: null,
          },
          target_platforms: config.primaryPlatforms,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to generate creator content.');
      }
      setResult(data as CreatorResult);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Failed to generate creator content.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLaunchCampaign = () => {
    if (!result) return;
    launchCampaignFromContent({
      router,
      contentType: config.contentType as any,
      title: String(answers.topic || config.title),
      excerpt: result.output.packaging.meta_description || result.output.packaging.caption,
      tags: result.output.packaging.hashtags,
      formatType: result.output.asset_type,
      contentMarkdown: result.output.packaging.caption,
    });
  };

  const handleOpenScheduler = () => {
    if (!result) return;
    launchSocialPostingFromContent({
      router,
      contentType: config.contentType as any,
      title: String(answers.topic || config.title),
      content: result.output.packaging.caption,
      tags: result.output.packaging.hashtags,
      excerpt: result.output.packaging.meta_description,
      sourceId: null,
    });
  };

  const handleSaveAsBlog = () => {
    if (!result) return;
    launchBlogFromCreator({
      router,
      title: String(answers.topic || config.title),
      output: result.output,
    });
  };

  const handleSaveAsBlock = async () => {
    if (!result || !selectedCompanyId) return;
    setIsSavingBlock(true);
    setError(null);
    setNotice(null);

    try {
      const contentBlocks = buildCreatorContentBlocks(String(answers.topic || config.title), result.output);
      const response = await fetch('/api/block-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          name: `${String(answers.topic || config.title).trim()} Block`,
          description: `Creator-derived reusable block from ${config.title}.`,
          content_type: 'blog',
          format_type: result.output.asset_type,
          content_blocks: contentBlocks,
          tags: result.output.packaging.hashtags,
          is_public: false,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save this creator output as a reusable block.');
      }

      setNotice('Saved as a reusable block template. You can now pull it into long-form content.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save this creator output as a reusable block.');
    } finally {
      setIsSavingBlock(false);
    }
  };

  const mediaUrls = summarizeMediaUrls(result);
  const slides = Array.isArray(result?.output.asset_payload.slides) ? result.output.asset_payload.slides : [];
  const selectedSubtype = config.subtypeOptions.find((option) => option.value === answers.subtype) || config.subtypeOptions[0];
  const proposalLine = [
    selectedSubtype?.label ? `${selectedSubtype.label} ${config.title.toLowerCase()}` : config.title,
    answers.objective ? `optimized for ${answers.objective.replace(/-/g, ' ')}` : '',
    answers.styleDirection ? `with a ${answers.styleDirection.replace(/-/g, ' ')} visual tone` : '',
    answers.continuity ? `using ${answers.continuity.replace(/-/g, ' ')} flow` : '',
    answers.visualSystem ? `and ${answers.visualSystem.replace(/-/g, ' ')} continuity` : '',
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
                {proposalLine || `AI will propose a ${config.title.toLowerCase()} direction using your company context and the choices above.`}
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
              <button
                type="button"
                onClick={() => router.push('/command-center/writer-content')}
                className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
              >
                Open Writer Content
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Generated Output</p>
              {!result ? (
                <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-sm text-gray-500">
                  Once you generate, this panel will show the AI-built creator output for {config.title.toLowerCase()}, including media URLs and downstream actions.
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

                  {mediaUrls.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Rendered Media</p>
                      <div className="space-y-2">
                        {mediaUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-blue-700 hover:border-blue-200 hover:bg-blue-50">
                            {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {slides.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Slide Structure</p>
                      <div className="space-y-2">
                        {slides.map((slide, index) => (
                          <div key={`${index}-${String(slide.slide_number ?? index + 1)}`} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Slide {String(slide.slide_number ?? index + 1)} · {String(slide.role ?? 'content')}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">{String(slide.headline ?? '')}</p>
                            <p className="mt-1 text-sm text-gray-600">{String(slide.body_text ?? '')}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={handleSaveAsBlog}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
                    >
                      Save As Blog
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAsBlock}
                      disabled={isSavingBlock}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingBlock ? 'Saving Block...' : 'Save As Block'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunchCampaign}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Use In Campaign
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenScheduler}
                      className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
                    >
                      Use As Post
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
