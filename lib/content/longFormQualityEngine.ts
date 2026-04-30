import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import type { CompanyContext } from '../blog/blogRunnerTypes';
import type { ContentBlock } from '../blog/blockTypes';
import { htmlToBlocks } from '../blog/htmlToBlocks';
import { injectInternalLinks } from '../blog/runBlogGenerationDataAccess';
import { validateContentVariation } from './contentVariationValidator';
import { contentTypeConfig, type LongFormContentType } from './longFormContentTypeConfig';
import { getLongFormTemplateSpec } from './longFormTemplateSpecs';

export type PlannedSectionContentType =
  | 'explanation'
  | 'framework'
  | 'example'
  | 'comparison'
  | 'application'
  | 'insight'
  | 'case_study'
  | 'faq'
  | 'summary';

export interface ContentPlanSection {
  section_title: string;
  section_goal: string;
  unique_angle: string;
  key_points: string[];
  content_type: PlannedSectionContentType;
  depth_requirement: 'standard' | 'deep' | 'comprehensive';
  target_words: number;
  include_direct_answer?: boolean;
  direct_answer_question?: string;
  opinionated_insight_required?: boolean;
  framework_required?: boolean;
}

export interface ContentPlan {
  content_type: LongFormContentType;
  format_type: string;
  target_word_count: number;
  framework_name: string;
  framework_summary: string;
  sections: ContentPlanSection[];
  faq_questions: string[];
  evidence_requirements: string[];
}

export interface LongFormQualityValidationReport {
  sectionUniquenessScore: number;
  repetitionDetected: boolean;
  repeatedSectionIds: string[];
  frameworkPresent: boolean;
  faqPresent: boolean;
  directAnswerBlocks: number;
  opinionatedInsightSections: number;
  evidenceSignals: number;
  issues: string[];
}

export interface PlannedLongFormResult {
  title: string;
  excerpt: string;
  content_html: string;
  tags: string[];
  category: string;
  seo_meta_title: string;
  seo_meta_description: string;
  key_insights: string[];
  content_blocks: ContentBlock[];
  contentPlan: ContentPlan;
  validationReport: LongFormQualityValidationReport;
}

interface GeneratePlannedLongFormInput {
  companyId: string;
  blogTable: 'blogs' | 'public_blogs';
  contentType: LongFormContentType;
  formatType: string;
  templateName?: string;
  topic: string;
  tone?: string;
  intent?: string;
  targetWordCount: number;
  companyContext?: CompanyContext;
  selectedAngle?: {
    title: string;
    label: string;
    angle_summary: string;
    hook: string;
  };
  answers?: Record<string, string>;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeJsonParse(raw: string): any {
  const trimmed = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(trimmed || '{}');
}

function words(value: string): number {
  return stripHtml(value).split(/\s+/).filter(Boolean).length;
}

function slugList(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((part) => part.length > 3)
    .slice(0, 5);
}

function buildCompanyContextSummary(context?: CompanyContext): string {
  if (!context) return 'No company profile context was supplied.';
  return [
    context.companyName ? `Company: ${context.companyName}` : '',
    context.industry ? `Industry: ${context.industry}` : '',
    context.audience ? `Audience: ${context.audience}` : '',
    context.coreProblemStatement ? `Core problem: ${context.coreProblemStatement}` : '',
    context.uniqueValue ? `Unique value: ${context.uniqueValue}` : '',
    context.competitiveAdvantages ? `Competitive advantages: ${context.competitiveAdvantages}` : '',
    context.productsServices ? `Products/services: ${context.productsServices}` : '',
    context.keyMessages ? `Key messages: ${context.keyMessages}` : '',
  ].filter(Boolean).join('\n') || 'Company profile context is sparse.';
}

function fallbackPlan(input: GeneratePlannedLongFormInput): ContentPlan {
  const isStory = input.contentType === 'story';
  const isNewsletter = input.contentType === 'newsletter';
  const baseWords = Math.max(800, input.targetWordCount);
  const sectionCount = baseWords >= 2000 ? 5 : baseWords >= 1200 ? 4 : 3;
  const bodyWords = Math.max(500, baseWords - 320);
  const perSection = Math.max(140, Math.round(bodyWords / sectionCount));
  const sectionTypes: PlannedSectionContentType[] = isStory
    ? ['example', 'insight', 'application', 'summary', 'example']
    : isNewsletter
      ? ['insight', 'explanation', 'application', 'framework', 'example']
      : ['explanation', 'framework', 'application', 'example', 'comparison'];

  const sections = Array.from({ length: sectionCount }).map((_, index) => ({
    section_title: index === 0
      ? `What ${input.topic} Really Changes`
      : index === 1
        ? `${input.topic}: The Operating Model`
        : index === 2
          ? `How to Apply ${input.topic}`
          : index === 3
            ? `Where ${input.topic} Breaks Down`
            : `What Leaders Should Do Next`,
    section_goal: [
      'Define the problem and why it matters now.',
      'Introduce the original framework and its moving parts.',
      'Translate the idea into practical application.',
      'Ground the argument in examples, tradeoffs, and failure modes.',
      'Synthesize implications into a next-step decision path.',
    ][index] || `Develop distinct section ${index + 1}.`,
    unique_angle: [
      'Focus on the hidden mechanism, not surface symptoms.',
      'Frame the topic as a system with named layers.',
      'Move from theory to operator choices.',
      'Challenge the common assumption that more activity equals better output.',
      'Close with a brand-led perspective on what durable authority requires.',
    ][index] || 'Add new information not covered elsewhere.',
    key_points: [
      [`Why the old mental model is too shallow`, `What changes for ${input.companyContext?.audience || 'the target reader'}`],
      [`The ${input.topic} readiness framework`, 'Signals, decisions, and feedback loops'],
      ['Implementation steps', 'Common failure modes', 'How to measure progress'],
      ['Realistic use case', 'Tradeoffs and limitations'],
      ['Decision checklist', 'Next action'],
    ][index] || ['Distinct point'],
    content_type: sectionTypes[index] || 'insight',
    depth_requirement: baseWords >= 1600 ? 'deep' as const : 'standard' as const,
    target_words: perSection,
    include_direct_answer: !isStory && index < 2,
    direct_answer_question: index === 0 ? `What is ${input.topic}?` : `How do you apply ${input.topic}?`,
    opinionated_insight_required: index === 0 || index === 3,
    framework_required: index === 1,
  }));

  return {
    content_type: input.contentType,
    format_type: input.formatType,
    target_word_count: baseWords,
    framework_name: `${input.topic} Readiness Framework`,
    framework_summary: 'A named model that connects problem clarity, execution choices, evidence, and feedback loops.',
    sections,
    faq_questions: [
      `What is ${input.topic}?`,
      `Why does ${input.topic} matter now?`,
      `How do you apply ${input.topic}?`,
      `What mistakes should teams avoid with ${input.topic}?`,
    ],
    evidence_requirements: [
      'Include at least one realistic company or team use case.',
      'Include at least one concrete before/after or decision scenario.',
    ],
  };
}

function normalizePlan(raw: any, input: GeneratePlannedLongFormInput): ContentPlan {
  const fallback = fallbackPlan(input);
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  const normalizedSections = sections
    .map((section: any, index: number): ContentPlanSection | null => {
      const fallbackSection = fallback.sections[index] || fallback.sections[fallback.sections.length - 1];
      const keyPoints = Array.isArray(section?.key_points)
        ? section.key_points.map((point: unknown) => String(point || '').trim()).filter(Boolean)
        : fallbackSection.key_points;
      const contentType = String(section?.content_type || fallbackSection.content_type).trim() as PlannedSectionContentType;
      return {
        section_title: String(section?.section_title || fallbackSection.section_title).trim(),
        section_goal: String(section?.section_goal || fallbackSection.section_goal).trim(),
        unique_angle: String(section?.unique_angle || fallbackSection.unique_angle).trim(),
        key_points: keyPoints.length > 0 ? keyPoints : fallbackSection.key_points,
        content_type: contentType,
        depth_requirement: ['standard', 'deep', 'comprehensive'].includes(String(section?.depth_requirement))
          ? section.depth_requirement
          : fallbackSection.depth_requirement,
        target_words: Number(section?.target_words) > 0 ? Number(section.target_words) : fallbackSection.target_words,
        include_direct_answer: Boolean(section?.include_direct_answer ?? fallbackSection.include_direct_answer),
        direct_answer_question: String(section?.direct_answer_question || fallbackSection.direct_answer_question || '').trim() || undefined,
        opinionated_insight_required: Boolean(section?.opinionated_insight_required ?? fallbackSection.opinionated_insight_required),
        framework_required: Boolean(section?.framework_required ?? fallbackSection.framework_required),
      };
    })
    .filter(Boolean) as ContentPlanSection[];

  const plan: ContentPlan = {
    content_type: input.contentType,
    format_type: input.formatType,
    target_word_count: input.targetWordCount,
    framework_name: String(raw?.framework_name || fallback.framework_name).trim(),
    framework_summary: String(raw?.framework_summary || fallback.framework_summary).trim(),
    sections: normalizedSections.length >= 3 ? normalizedSections : fallback.sections,
    faq_questions: Array.isArray(raw?.faq_questions)
      ? raw.faq_questions.map((q: unknown) => String(q || '').trim()).filter(Boolean).slice(0, 6)
      : fallback.faq_questions,
    evidence_requirements: Array.isArray(raw?.evidence_requirements)
      ? raw.evidence_requirements.map((q: unknown) => String(q || '').trim()).filter(Boolean).slice(0, 4)
      : fallback.evidence_requirements,
  };

  // Hard guards: direct answers, framework, opinionated insight, and coverage.
  if (!plan.sections.some((section) => section.framework_required)) {
    plan.sections[Math.min(1, plan.sections.length - 1)].framework_required = true;
  }
  let directCount = plan.sections.filter((section) => section.include_direct_answer).length;
  for (const section of plan.sections) {
    if (directCount >= 2 || plan.content_type === 'story') break;
    section.include_direct_answer = true;
    section.direct_answer_question ||= directCount === 0 ? `What is ${input.topic}?` : `How do you apply ${input.topic}?`;
    directCount += 1;
  }
  let opinionatedCount = plan.sections.filter((section) => section.opinionated_insight_required).length;
  for (const section of plan.sections) {
    if (opinionatedCount >= 2) break;
    section.opinionated_insight_required = true;
    opinionatedCount += 1;
  }
  const requiredCoverage: PlannedSectionContentType[] = ['explanation', 'application', 'example', 'insight'];
  for (const requiredType of requiredCoverage) {
    if (!plan.sections.some((section) => section.content_type === requiredType)) {
      const target = plan.sections.find((section) => section.content_type !== 'framework') || plan.sections[0];
      target.content_type = requiredType;
    }
  }
  if (plan.faq_questions.length < 4 && plan.content_type !== 'story') {
    plan.faq_questions = fallback.faq_questions;
  }
  return plan;
}

async function generateContentPlan(input: GeneratePlannedLongFormInput): Promise<ContentPlan> {
  const config = contentTypeConfig[input.contentType];
  const templateSpec = getLongFormTemplateSpec(input.contentType, input.formatType, input.templateName);
  const sectionCount = input.targetWordCount >= 2000 ? '5-6' : input.targetWordCount >= 1200 ? '4-5' : '3-4';

  try {
    const response = await runCompletionWithOperation({
      companyId: input.companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      operation: 'blogGeneration',
      messages: [
        {
          role: 'system',
          content:
            `You are the planning layer for Omnivera's unified long-form engine. Return JSON only.\n` +
            `Create a non-repetitive contentPlan before writing. Do not write the article.\n\n` +
            `Rules:\n` +
            `- No two sections can have the same section_goal.\n` +
            `- No repeated key_points across sections.\n` +
            `- The plan must cover explanation, application, examples, and insights.\n` +
            `- Include at least one named original framework with steps/layers/system.\n` +
            `- Mark at least two sections for opinionated insight.\n` +
            `- Mark at least two sections for direct answer blocks unless content type is story.\n` +
            `- FAQ questions must be direct and snippet-ready for SEO-driven content.\n\n` +
            `Return shape: { "framework_name": string, "framework_summary": string, "sections": [{ "section_title": string, "section_goal": string, "unique_angle": string, "key_points": string[], "content_type": "explanation|framework|example|comparison|application|insight|case_study", "depth_requirement": "standard|deep|comprehensive", "target_words": number, "include_direct_answer": boolean, "direct_answer_question": string, "opinionated_insight_required": boolean, "framework_required": boolean }], "faq_questions": string[], "evidence_requirements": string[] }`,
        },
        {
          role: 'user',
          content: [
            `CONTENT TYPE: ${input.contentType}`,
            `FORMAT: ${input.formatType}`,
            `TARGET WORDS: ${input.targetWordCount}`,
            `SECTION COUNT: ${sectionCount}`,
            `TYPE CONFIG: ${JSON.stringify(config)}`,
            templateSpec ? `TEMPLATE SPEC: ${JSON.stringify(templateSpec)}` : '',
            input.selectedAngle ? `SELECTED ANGLE: ${input.selectedAngle.title} - ${input.selectedAngle.angle_summary}` : '',
            `TOPIC: ${input.topic}`,
            input.intent ? `INTENT: ${input.intent}` : '',
            input.tone ? `TONE: ${input.tone}` : '',
            `COMPANY CONTEXT:\n${buildCompanyContextSummary(input.companyContext)}`,
            input.answers ? `AUTHOR ANSWERS:\n${JSON.stringify(input.answers, null, 2)}` : '',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });
    return normalizePlan(safeJsonParse(response.output || '{}'), input);
  } catch {
    return fallbackPlan(input);
  }
}

async function generateSection(input: GeneratePlannedLongFormInput, plan: ContentPlan, section: ContentPlanSection, previousSectionSummaries: string[]): Promise<string> {
  const response = await runCompletionWithOperation({
    companyId: input.companyId,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.45,
    response_format: { type: 'json_object' },
    max_tokens: Math.max(900, Math.min(3000, Math.round(section.target_words * 2.4))),
    operation: 'blogGeneration',
    messages: [
      {
        role: 'system',
        content:
          `You are writing one section of a long-form piece from an approved contentPlan. Return JSON only: { "html": string, "summary": string }.\n\n` +
          `Rules:\n` +
          `- Write only this section, beginning with <h2>${section.section_title}</h2>.\n` +
          `- The section must achieve its section_goal and unique_angle.\n` +
          `- Add NEW information only. Do not reuse previous section phrasing.\n` +
          `- Include concrete examples, use cases, or referenced insights when useful.\n` +
          `- If include_direct_answer is true, start with a short paragraph: <p><strong>${section.direct_answer_question || `What is ${input.topic}?`}</strong> Direct answer...</p> before elaborating.\n` +
          `- If framework_required is true, introduce and name this framework: ${plan.framework_name}. Present steps/layers/system.\n` +
          `- If opinionated_insight_required is true, challenge a common assumption and give a non-obvious insight.\n` +
          `- Embed company POV naturally using the company context. No generic brand-neutral advice.\n` +
          `- Use only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, and <a>.\n` +
          `- Do not include Summary, FAQ, or References in this section.`,
      },
      {
        role: 'user',
        content: [
          `TOPIC: ${input.topic}`,
          `CONTENT TYPE: ${input.contentType}`,
          `FORMAT: ${input.formatType}`,
          `TARGET WORDS FOR THIS SECTION: ${section.target_words}`,
          `SECTION PLAN: ${JSON.stringify(section, null, 2)}`,
          `OVERALL FRAMEWORK: ${plan.framework_name} - ${plan.framework_summary}`,
          `EVIDENCE REQUIREMENTS: ${plan.evidence_requirements.join('; ')}`,
          `PREVIOUS SECTION SUMMARIES TO AVOID REPEATING:\n${previousSectionSummaries.join('\n') || '(none)'}`,
          `COMPANY CONTEXT:\n${buildCompanyContextSummary(input.companyContext)}`,
        ].join('\n\n'),
      },
    ],
  });
  const parsed = safeJsonParse(response.output || '{}');
  return typeof parsed.html === 'string' && parsed.html.trim()
    ? parsed.html.trim()
    : `<h2>${section.section_title}</h2><p>${section.section_goal}</p>`;
}

async function repairSection(input: GeneratePlannedLongFormInput, plan: ContentPlan, section: ContentPlanSection, currentHtml: string, issues: string[]): Promise<string> {
  try {
    const response = await runCompletionWithOperation({
      companyId: input.companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      operation: 'blogGeneration',
      messages: [
        {
          role: 'system',
          content:
            'You repair exactly one long-form section. Return JSON only: { "html": string }. Keep the same H2 title, fix the issues, and do not rewrite other sections.',
        },
        {
          role: 'user',
          content: [
            `TOPIC: ${input.topic}`,
            `SECTION PLAN: ${JSON.stringify(section, null, 2)}`,
            `FRAMEWORK: ${plan.framework_name}`,
            `ISSUES:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
            `CURRENT HTML:\n${currentHtml}`,
            `COMPANY CONTEXT:\n${buildCompanyContextSummary(input.companyContext)}`,
          ].join('\n\n'),
        },
      ],
    });
    const parsed = safeJsonParse(response.output || '{}');
    return typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html.trim() : currentHtml;
  } catch {
    return currentHtml;
  }
}

async function generateFaq(input: GeneratePlannedLongFormInput, plan: ContentPlan): Promise<string> {
  if (contentTypeConfig[input.contentType].seoPriority === 'low') return '';
  try {
    const response = await runCompletionWithOperation({
      companyId: input.companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      operation: 'blogGeneration',
      messages: [
        {
          role: 'system',
          content: 'Write an FAQ section for answer engine optimization. Return JSON only: { "html": string }. Use <h2>FAQ</h2>, 4-6 <h3> questions, and concise direct <p> answers.',
        },
        {
          role: 'user',
          content: [
            `TOPIC: ${input.topic}`,
            `QUESTIONS: ${plan.faq_questions.join(' | ')}`,
            `FRAMEWORK: ${plan.framework_name}`,
            `COMPANY CONTEXT:\n${buildCompanyContextSummary(input.companyContext)}`,
          ].join('\n\n'),
        },
      ],
    });
    const parsed = safeJsonParse(response.output || '{}');
    return typeof parsed.html === 'string' ? parsed.html.trim() : '';
  } catch {
    return `<h2>FAQ</h2>${plan.faq_questions.slice(0, 4).map((q) => `<h3>${q}</h3><p>${q.replace(/\?$/, '')} depends on the reader's context, but the practical answer is to use ${plan.framework_name} to connect the problem, execution path, evidence, and next decision.</p>`).join('')}`;
  }
}

function buildKeyInsights(plan: ContentPlan): string[] {
  const insights = [
    `${plan.framework_name} turns the topic into a repeatable decision model instead of a loose set of tips.`,
    ...plan.sections.flatMap((section) => section.key_points.slice(0, 1)),
  ];
  return Array.from(new Set(insights.map((item) => item.trim()).filter(Boolean))).slice(0, 6);
}

function buildReferencesHtml(contentType: LongFormContentType): string {
  if (contentType === 'story') return '';
  return [
    '<h2>References</h2>',
    '<ol>',
    '<li><a href="https://developers.google.com/search/docs/fundamentals/creating-helpful-content">Google Search Central: Creating helpful, reliable, people-first content</a></li>',
    '<li><a href="https://developers.google.com/search/docs/appearance/structured-data/faqpage">Google Search Central: FAQ structured data guidelines</a></li>',
    '</ol>',
  ].join('');
}

function buildSummaryHtml(plan: ContentPlan): string {
  return `<h2>Summary</h2><p>${plan.framework_name} is the spine of this piece: ${plan.framework_summary} The practical takeaway is to move from generic activity to a clearer system of explanation, application, evidence, and brand-led judgment.</p>`;
}

function validatePlannedOutput(plan: ContentPlan, sectionHtml: string[], fullHtml: string): LongFormQualityValidationReport {
  const variation = validateContentVariation(sectionHtml.map((html, index) => ({
    id: `section_${index + 1}`,
    text: html,
  })), { contentType: plan.content_type });
  const plain = stripHtml(fullHtml).toLowerCase();
  const frameworkPresent = plain.includes(plan.framework_name.toLowerCase()) || /\bframework\b|\bmodel\b|\bsystem\b|\blayers?\b/.test(plain);
  const faqPresent = plan.content_type === 'story' || /<h2>\s*faq\s*<\/h2>/i.test(fullHtml);
  const directAnswerBlocks = (fullHtml.match(/<strong>\s*(what is|how (?:do|to))/gi) || []).length;
  const opinionatedInsightSections = sectionHtml.filter((html) => /\b(common assumption|most teams|most companies|conventional wisdom|wrong|overlook|mistake|misread)\b/i.test(stripHtml(html))).length;
  const evidenceSignals = (fullHtml.match(/\b(example|use case|scenario|according to|research|case study|before\/after|for instance)\b/gi) || []).length;
  const issues: string[] = [];
  if (variation.duplicateContentDetected || variation.lowVariationDetected) issues.push('Section repetition detected');
  if (!frameworkPresent) issues.push('Missing named framework/model');
  if (!faqPresent) issues.push('Missing FAQ section');
  if (plan.content_type !== 'story' && directAnswerBlocks < 2) issues.push('Missing direct answer blocks');
  if (opinionatedInsightSections < 2) issues.push('Insight density too low');
  if (evidenceSignals < 2) issues.push('Evidence/use-case signals too low');

  return {
    sectionUniquenessScore: Math.max(0, Math.round((1 - variation.maxSectionSimilarity) * 100)),
    repetitionDetected: variation.duplicateContentDetected || variation.lowVariationDetected,
    repeatedSectionIds: [
      ...variation.duplicateSectionPairs.map((pair) => pair.rightId),
      ...variation.lowVariationSections.map((section) => section.sectionId),
    ],
    frameworkPresent,
    faqPresent,
    directAnswerBlocks,
    opinionatedInsightSections,
    evidenceSignals,
    issues,
  };
}

export async function generatePlannedLongFormContent(input: GeneratePlannedLongFormInput): Promise<PlannedLongFormResult> {
  const plan = await generateContentPlan(input);
  const previousSummaries: string[] = [];
  const sectionHtml: string[] = [];

  for (const section of plan.sections) {
    let html = await generateSection(input, plan, section, previousSummaries);
    const sectionIssues: string[] = [];
    if (section.framework_required && !stripHtml(html).toLowerCase().includes(plan.framework_name.toLowerCase())) {
      sectionIssues.push(`Section must include the named framework "${plan.framework_name}".`);
    }
    if (section.include_direct_answer && !/<strong>\s*(what is|how (?:do|to))/i.test(html)) {
      sectionIssues.push('Section must include a direct answer block before elaboration.');
    }
    if (section.opinionated_insight_required && !/\b(common assumption|most teams|most companies|conventional wisdom|wrong|overlook|mistake|misread)\b/i.test(stripHtml(html))) {
      sectionIssues.push('Section must challenge a common assumption or provide a non-obvious insight.');
    }
    if (sectionIssues.length > 0) {
      html = await repairSection(input, plan, section, html, sectionIssues);
    }
    sectionHtml.push(html);
    previousSummaries.push(`- ${section.section_title}: ${stripHtml(html).slice(0, 240)}`);
  }

  const keyInsights = buildKeyInsights(plan);
  const keyInsightsHtml = `<div class="key-insights"><ul>${keyInsights.map((insight) => `<li>${insight}</li>`).join('')}</ul></div>`;
  const faqHtml = await generateFaq(input, plan);
  const referencesHtml = buildReferencesHtml(input.contentType);
  let contentHtml = [
    keyInsightsHtml,
    ...sectionHtml,
    faqHtml,
    buildSummaryHtml(plan),
    referencesHtml,
  ].filter(Boolean).join('\n\n');

  let report = validatePlannedOutput(plan, sectionHtml, contentHtml);
  if (report.repeatedSectionIds.length > 0) {
    for (const sectionId of Array.from(new Set(report.repeatedSectionIds)).slice(0, 2)) {
      const index = Number(sectionId.replace(/\D+/g, '')) - 1;
      if (index >= 0 && plan.sections[index]) {
        sectionHtml[index] = await repairSection(input, plan, plan.sections[index], sectionHtml[index], [
          'This section repeats earlier content. Regenerate only this section with a sharper unique angle and new examples.',
        ]);
      }
    }
    contentHtml = [keyInsightsHtml, ...sectionHtml, faqHtml, buildSummaryHtml(plan), referencesHtml].filter(Boolean).join('\n\n');
    report = validatePlannedOutput(plan, sectionHtml, contentHtml);
  }

  let contentBlocks = htmlToBlocks(contentHtml);
  contentBlocks = await injectInternalLinks(
    contentBlocks,
    input.topic,
    input.companyId,
    input.blogTable,
    [input.selectedAngle?.title || input.topic],
  );

  const title = input.selectedAngle?.title || `${input.topic}: ${plan.framework_name}`;
  const excerpt = `${plan.framework_summary} This piece explains the model, applies it, and shows where common assumptions break down.`.slice(0, 220);
  const keywords = slugList(input.topic);

  return {
    title,
    excerpt,
    content_html: contentHtml,
    tags: keywords,
    category: input.contentType === 'case-study' ? 'Case Study' : input.contentType,
    seo_meta_title: title.slice(0, 60),
    seo_meta_description: excerpt.slice(0, 155),
    key_insights: keyInsights,
    content_blocks: contentBlocks,
    contentPlan: plan,
    validationReport: report,
  };
}

