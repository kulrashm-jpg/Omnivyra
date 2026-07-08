/** Blog generation — types, prompts, outline + section builders — split from blogGenerationEngine.ts (barrel preserved; importers unchanged). */
/**
 * Blog Generation Engine
 *
 * Builds prompts for two AI calls:
 *   1. Angle generation  — 3 strategic directions (analytical / contrarian / strategic)
 *   2. Full generation   — complete publication-ready blog for the chosen angle
 *
 * Hard rules baked into prompts:
 *   - No hallucination — reason from first principles if unsure
 *   - Narrative construction, not content dumping
 *   - Required structure: Key Insights → executive intro → 3–5 H2s → Summary → References
 *   - Minimum 2–3 real references
 *   - Thought leadership tone — analytical, never promotional
 */

import { getStructureRules, getArticleStructureRules, getWhitepaperStructureRules, getNewsletterStructureRules, getStoryStructureRules, getGuideStructureRules, isValidArticleFormat, isValidWhitepaperFormat, isValidNewsletterFormat, isValidStoryFormat, isValidGuideFormat, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from './blogStructureTemplates';
import {
  type CompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
} from '../content/companyContextBlock';
import type { OrganizationPerspective } from '../../backend/services/longForm/organizationPerspectiveEngine';

/**
 * Wrap a base system prompt with mandatory company enforcement.
 * Prepends identity lock (includes strategy perspective) and appends
 * anti-generic rules. Returns base unchanged when identity is empty
 * so zero-context flows are unaffected.
 */

export function wrapWithCompanyEnforcement(
  base: string,
  contentType: string,
  identity?: CompanyIdentity,
): string {
  if (!identity || (!identity.companyName && !identity.industry && !identity.coreProblem)) {
    return base;
  }
  const head = buildIdentityLock(identity, contentType);
  const tail = buildAntiGenericRules(identity);
  return `${head}\n\n${base}\n${tail}`;
}

/**
 * Blog Governance Parity — prepend the canonical governance preamble
 * to any blog system prompt. Returns the base prompt unchanged when no
 * governance context applies (industry='none', null, etc.) — preserving
 * byte-identical output for legacy callers.
 */
function applyBlogGovernancePreamble(
  base: string,
  governance: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null | undefined,
): string {
  const { applyGovernancePreambleToSystemPrompt } =
    require('../../backend/services/creator/strategyGovernancePromptContext') as typeof import('../../backend/services/creator/strategyGovernancePromptContext');
  return applyGovernancePreambleToSystemPrompt(base, governance ?? null);
}

// ── Angle types ───────────────────────────────────────────────────────────────

export type AngleType = 'analytical' | 'contrarian' | 'strategic';

export interface BlogAngle {
  type:          AngleType;
  label:         string;    // "Analytical", "Contrarian", "Strategic"
  title:         string;    // proposed article title for this angle
  angle_summary: string;    // 1–2 sentences describing the argument direction
  hook:          string;    // opening sentence — the hook for this angle
}

// ── Generation types ──────────────────────────────────────────────────────────

export interface BlogGenerationInput {
  topic:            string;
  cluster?:         string;
  intent?:          string;                // awareness | authority | conversion | retention
  related_blogs?:   string[];              // titles of related posts
  series_summaries?: SeriesSummary[];      // extracted summaries for continuation mode
  series_context?:  string;
  answers?:         Record<string, string>;
  tone?:            string;
  goal_type?:       string;
  selected_angle?:  BlogAngle;             // chosen angle from angle-picker step
  /**
   * Pre-formatted writing style instructions block from WritingStyleEngine.
   * Injected as a WRITING STYLE GUIDE section in the user prompt.
   * Build with: buildFormattedStyleInstructions(profile) from lib/content/writingStyleEngine
   */
  writingStyleInstructions?: string;
  /** 'blog' (default) or 'article' or 'whitepaper' or 'newsletter' or 'story' — controls prompt variants */
  contentType?: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide';
  /** Blog, article, whitepaper, newsletter, story, or guide format type — controls structural rules in the system prompt */
  formatType?: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType;
  /** Pre-formatted performance learnings from feedbackOptimizationEngine. Injected into generation prompt. */
  performanceLearningsPrompt?: string;
  /** Single-line performance hint for angle generation prompt. */
  performanceHint?: string;
  /** Optional template name from the writer flow for template-specific prompt tuning. */
  templateName?: string;
  /** Pre-formatted keyword targeting section from seoIntelligenceEngine. Injected into generation prompt. */
  keywordContextPrompt?: string;
  /** Primary keyword phrase for angle generation hint. */
  primaryKeyword?: string;
  /** Pre-formatted trend signals section from trendIntelligenceEngine. Injected into generation prompt. */
  trendContextPrompt?: string;
  /** Freshness directive from trendIntelligenceEngine. Injected into generation prompt. */
  freshnessDirective?: string;
  /**
   * Unified prompt context from contentGenerationOrchestrator.
   * When present, replaces all individual intelligence sections
   * (performanceLearningsPrompt, keywordContextPrompt, trendContextPrompt, freshnessDirective).
   */
  unifiedPromptContext?: string;
  /** Mandatory organization-level POV layer for thought-leadership content. */
  organizationPerspective?: OrganizationPerspective;
}

export interface SeriesSummary {
  title:       string;
  headings:    string[];
  key_points:  string[];
  summary:     string;
}

export interface BlogGenerationOutput {
  title:                string;
  excerpt:              string;
  content_html:         string;
  tags:                 string[];
  category:             string;
  seo_meta_title:       string;
  seo_meta_description: string;
  key_insights:         string[];
}

// ── ANGLE PROMPTS ─────────────────────────────────────────────────────────────

export function buildAnglesSystemPrompt(
  contentType: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' = 'blog',
  companyIdentity?: CompanyIdentity,
  // Blog Governance Parity — optional governance prompt context. When
  // present and the resolved industry is regulated, the system prompt
  // is prepended with the canonical compliance preamble. Null /
  // industry='none' → strict no-op (byte-identical system prompt to
  // legacy callers).
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null,
): string {
  const currentYear = new Date().getFullYear();
  const nextYear    = currentYear + 1;
  const isArticle   = contentType === 'article';
  const isWhitepaper = contentType === 'whitepaper';
  const isNewsletter = contentType === 'newsletter';
  const isStory     = contentType === 'story';
  const isGuide     = contentType === 'guide';

  const identity = isWhitepaper
    ? `You are a senior research analyst and domain authority writing for ${currentYear}. Given a topic, you generate three distinct whitepaper angles with research depth:`
    : isGuide
    ? `You are a subject matter expert and pillar content architect writing for ${currentYear}. Given a topic, you generate three distinct guide angles that establish deep, evergreen authority:`
    : isStory
    ? `You are a narrative storyteller, brand voice specialist, and creative writer for ${currentYear}. Given a topic, you generate three distinct story angles that create emotional connection:`
    : isNewsletter
    ? `You are a newsletter editor and audience engagement specialist writing for ${currentYear}. Given a topic, you generate three distinct newsletter angles that maximize reader value:`
    : isArticle
    ? `You are a senior journalist and industry analyst writing for ${currentYear}. Given a topic, you generate three distinct editorial angles with journalistic depth:`
    : `You are a B2B content strategist writing for ${currentYear}. Given a topic, you generate three distinct editorial angles:`;

  const angle1 = isWhitepaper
    ? '1. ANALYTICAL  — data-driven research approach, examines evidence with rigorous methodology and quantified findings'
    : isGuide
    ? '1. ANALYTICAL  — systematic, evidence-based deep dive — maps the landscape with data, frameworks, and structured analysis'
    : isStory
    ? '1. ANALYTICAL  — grounds the narrative in real data, research, or evidence — the story SHOWS the insight through concrete scenes'
    : isNewsletter
    ? '1. ANALYTICAL  — curates the best data, research, and evidence into actionable insights for the reader'
    : isArticle
    ? '1. ANALYTICAL  — investigative, examines evidence, data, and root causes with journalistic rigour'
    : '1. ANALYTICAL  — data-driven, examines patterns, evidence, and causality';
  const angle2 = isWhitepaper
    ? '2. CONTRARIAN  — challenges industry consensus with counter-evidence, original analysis, and alternative frameworks'
    : isGuide
    ? '2. CONTRARIAN  — challenges conventional approaches and presents a better path — "here\'s what most guides get wrong and how to actually do it"'
    : isStory
    ? '2. CONTRARIAN  — tells the story nobody expects — challenges assumptions through character choices, surprising turns, and unconventional perspectives'
    : isNewsletter
    ? '2. CONTRARIAN  — challenges what everyone assumes, surfaces overlooked perspectives and surprising counter-evidence'
    : isArticle
    ? '2. CONTRARIAN  — challenges the dominant narrative with original reporting and counter-evidence'
    : '2. CONTRARIAN  — challenges conventional wisdom, exposes flawed assumptions';
  const angle3 = isWhitepaper
    ? '3. STRATEGIC   — frames the topic as a strategic decision with market analysis, ROI projections, and implementation guidance'
    : isGuide
    ? '3. STRATEGIC   — frames the topic as a capability to build — connects knowledge to outcomes, includes implementation paths and real-world application'
    : isStory
    ? '3. STRATEGIC   — frames the narrative as a transformation journey — a protagonist faces a strategic challenge and emerges with actionable wisdom'
    : isNewsletter
    ? '3. STRATEGIC   — frames the topic as a practical playbook — what to do, when, and why it matters for the reader\'s goals'
    : isArticle
    ? '3. STRATEGIC   — frames the story through a business-impact lens with expert sourcing and analysis'
    : '3. STRATEGIC   — frames the topic as a business lever; connects it to measurable outcomes';

  const contentLabel = isWhitepaper ? 'whitepaper' : isGuide ? 'guide' : isStory ? 'story' : isNewsletter ? 'newsletter' : 'article';

  const extraRules = isWhitepaper ? `
## WHITEPAPER-SPECIFIC RULES
- Each angle must reflect authority-grade research — not marketing content.
- Angles should imply publishable-quality analysis with data, methodology, and citations.
- Titles should read like research report titles from a leading consultancy or analyst firm.
` : isGuide ? `
## GUIDE-SPECIFIC RULES
- Each angle must establish deep, evergreen authority — this is pillar content that compounds over time.
- Angles should imply comprehensive coverage — a reader following this guide should become competent in the domain.
- Titles should read like the definitive resource on the topic ("The Complete Guide to...", "Everything You Need to Know About...").
- Each angle must make the reader think "this is THE guide I need to bookmark."
` : isStory ? `
## STORY-SPECIFIC RULES
- Each angle must be a NARRATIVE — not an article, not an explainer, not a listicle.
- Angles should imply vivid, human storytelling with characters, scenes, and emotional arcs.
- Titles should read like compelling story titles — evocative, intriguing, specific.
- The hook sentence must drop the reader INTO a scene, not describe what the story is about.
` : isNewsletter ? `
## NEWSLETTER-SPECIFIC RULES
- Each angle must feel like a must-open newsletter edition — not a blog post repackaged.
- Angles should imply curated, timely value that rewards the reader's attention.
- Titles should read like compelling email subject lines from a trusted industry newsletter.
- Each angle must deliver standalone value — the reader should learn something just from the summary.
` : isArticle ? `
## ARTICLE-SPECIFIC RULES
- Each angle must reflect a balanced, journalistic perspective — not promotional content.
- Angles should imply original analysis with multiple viewpoints and cited sources.
- Titles should read like headlines from a respected industry publication.
` : '';

  const base = `${identity}

${angle1}
${angle2}
${angle3}

## TEMPORAL RULES (non-negotiable)
- The current year is ${currentYear}. Write for the present and near future (${currentYear}–${nextYear}).
- NEVER anchor titles or content to past years (e.g., 2023, 2024). Do not use phrases like "in 2023" or "last year".
- Reference what is happening NOW or what practitioners should do going forward.
- If citing a trend, frame it as current reality or emerging direction — not historical recap.
${extraRules}
For each angle, produce:
- A specific, compelling ${contentLabel} title (not generic, not clickbait, no past year in the title)
- A 1–2 sentence angle summary describing the argument direction for a ${currentYear} audience
- A single hook sentence that would open the ${contentLabel} (not a question)

Return ONLY valid JSON — no markdown, no prose:

{
  "angles": [
    {
      "type":          "analytical",
      "label":         "Analytical",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "contrarian",
      "label":         "Contrarian",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "strategic",
      "label":         "Strategic",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    }
  ]
}`;

  return applyBlogGovernancePreamble(
    wrapWithCompanyEnforcement(base, `${contentType} angles`, companyIdentity),
    governance,
  );
}

export function buildAnglesUserPrompt(input: BlogGenerationInput): string {
  const currentYear = new Date().getFullYear();
  const lines: string[] = [
    `CURRENT YEAR: ${currentYear} — all angles must reflect present-day or forward-looking market reality.`,
    `TOPIC: ${input.topic}`,
  ];

  if (input.intent)  lines.push(`INTENT: ${input.intent}`);
  if (input.cluster) lines.push(`CLUSTER: ${input.cluster}`);
  if (input.tone)    lines.push(`TONE: ${input.tone}`);

  const a = input.answers ?? {};

  // Audience & industry
  const contextParts: string[] = [];
  if (a.audience) contextParts.push(`Audience: ${a.audience}`);
  if (a.industry) contextParts.push(`Industry: ${a.industry}`);
  if (a.depth)    contextParts.push(`Depth: ${a.depth}`);
  if (a.reader_stage) contextParts.push(`Reader stage: ${a.reader_stage}`);
  if (contextParts.length) lines.push(`CONTEXT: ${contextParts.join(' | ')}`);

  // Company context — makes angles specific to this business
  if (a.company_context)  lines.push(`COMPANY CONTEXT: ${a.company_context}`);
  if (a.current_content)  lines.push(`EXISTING CONTENT GAPS: ${a.current_content}`);
  if (a.writing_style)    lines.push(`WRITING STYLE: ${a.writing_style}`);

  // Directional inputs — these must shape the angles directly
  if (a.uniqueness_directive)  lines.push(`UNIQUENESS DIRECTIVE (angles must honour this): ${a.uniqueness_directive}`);
  // Phase 2.7 — section-level strategic assignments replace the
  // must_include_points blob for the auto-synthesized case. User-supplied
  // must_include_points is still honored (explicit user override).
  if (a.section_strategic_assignments) lines.push(`\n${a.section_strategic_assignments}`);
  if (a.must_include_points)   lines.push(`MUST-INCLUDE POINTS (weave into each angle): ${a.must_include_points}`);
  if (a.campaign_objective)    lines.push(`CAMPAIGN OBJECTIVE: ${a.campaign_objective}`);
  if (a.trend_context)         lines.push(`TREND CONTEXT: ${a.trend_context}`);
  if (a.cta_preference)        lines.push(`CTA STYLE: ${a.cta_preference}`);
  if (a.target_word_count)     lines.push(`TARGET LENGTH: ${a.target_word_count} words`);

  // Performance hint from feedback optimization engine
  if (input.performanceHint) lines.push(`\n${input.performanceHint}`);

  // Primary keyword hint from SEO intelligence engine
  if (input.primaryKeyword) lines.push(`PRIMARY KEYWORD: "${input.primaryKeyword}" — each angle title should naturally incorporate this keyword phrase`);

  lines.push('\nGenerate 3 distinct editorial angles for this topic. Each angle title and summary must be specifically tailored to the context above — not generic.');
  const templateNameForTemplatePrompt = typeof input.templateName === 'string' ? input.templateName.trim().toLowerCase() : '';
  if (input.contentType === 'blog' && (templateNameForTemplatePrompt || input.formatType)) {
    if (templateNameForTemplatePrompt === 'visual feature') {
      lines.push('\n## VISUAL FEATURE DEPTH DIRECTIVE');
      lines.push('The visuals should support the article, but the writing must still carry full editorial depth.');
      lines.push('Ensure each paragraph block includes analysis and interpretation, not just scene-setting.');
    } else if (templateNameForTemplatePrompt === 'comparison' || input.formatType === 'comparison') {
      lines.push('\n## COMPARISON DEPTH DIRECTIVE');
      lines.push('Make the comparison decision-useful. Explain strengths, tradeoffs, ideal use cases, and clear verdict criteria.');
    } else if (templateNameForTemplatePrompt === 'tutorial' || input.formatType === 'tutorial') {
      lines.push('\n## TUTORIAL DEPTH DIRECTIVE');
      lines.push('Each instructional block must teach what to do, why it matters, and what can go wrong.');
    } else if (templateNameForTemplatePrompt === 'magazine') {
      lines.push('\n## MAGAZINE TEMPLATE DEPTH DIRECTIVE');
      lines.push('Keep the editorial feel, but make sure the body sections still build a strong argument with concrete detail and interpretation.');
    } else if (templateNameForTemplatePrompt && templateNameForTemplatePrompt !== 'classic') {
      lines.push('\n## CUSTOM TEMPLATE DEPTH DIRECTIVE');
      lines.push('Honor the selected layout, but fully populate every substantive block with real content depth and standalone value.');
    }
  }

  return lines.join('\n');
}

export function validateAnglesOutput(raw: unknown): BlogAngle[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.angles)) return null;

  const angles: BlogAngle[] = [];
  for (const item of r.angles as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.type          === 'string' &&
      typeof a.label         === 'string' &&
      typeof a.title         === 'string' &&
      typeof a.angle_summary === 'string' &&
      typeof a.hook          === 'string'
    ) {
      angles.push({
        type:          a.type as AngleType,
        label:         a.label,
        title:         a.title,
        angle_summary: a.angle_summary,
        hook:          a.hook,
      });
    }
  }
  return angles.length === 3 ? angles : null;
}

// ── FULL GENERATION PROMPTS ───────────────────────────────────────────────────

export function buildGenerationSystemPrompt(
  targetWordCount?: number,
  contentType: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' = 'blog',
  formatType?: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType,
  companyIdentity?: CompanyIdentity,
  // Blog Governance Parity — optional governance prompt context.
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null,
): string {
  const currentYear = new Date().getFullYear();
  const nextYear    = currentYear + 1;
  const tw          = targetWordCount && targetWordCount >= 300 ? targetWordCount : 1200;
  const isArticle   = contentType === 'article';
  const isWhitepaper = contentType === 'whitepaper';
  const isNewsletter = contentType === 'newsletter';
  const isStory     = contentType === 'story';
  const isGuide     = contentType === 'guide';

  // Scale section requirements to target word count
  // Budget: intro ~120w, summary ~120w, key insights ~80w → ~320w fixed overhead
  // Remaining budget goes to H2 sections
  const bodyBudget     = tw - 320;
  const sectionCount   = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : tw <= 1600 ? '5–6' : '5–7';
  const minSections    = tw <= 800 ? 3 : tw <= 1200 ? 4 : 5;
  const maxSections    = tw <= 800 ? 4 : tw <= 1200 ? 5 : tw <= 1600 ? 6 : 7;
  const wordsPerSection = Math.round(bodyBudget / minSections);
  const minPerSection   = Math.max(150, Math.round(wordsPerSection * 0.8));
  const paragraphsPerSection = tw >= 2000 ? '4–6' : tw >= 1600 ? '3–5' : '3–4';

  const identity = isWhitepaper
    ? `You are a senior research analyst, strategy consultant, and technical writer specializing in executive-level business publications. Today is ${currentYear}.

Your task: generate a complete, publication-ready whitepaper that reads like it was produced by a top-tier consultancy — rigorous methodology, data-driven insights, executive summary, and actionable strategic recommendations. The whitepaper should demonstrate institutional-grade expertise, not blog-level commentary.`
    : isGuide
    ? `You are a subject matter expert, pillar content architect, and technical educator. Today is ${currentYear}.

Your task: generate a complete, publication-ready guide that reads like the definitive resource on its topic — comprehensive coverage, progressive structure, practical depth, and evergreen authority. The guide should be the kind of resource readers bookmark, share with teammates, and return to repeatedly. Each section must be substantive enough to stand alone as an article.`
    : isStory
    ? `You are a narrative storyteller, creative writer, and brand voice specialist. Today is ${currentYear}.

Your task: generate a complete, publication-ready story that reads like it was written by a skilled author — vivid scenes, authentic dialogue, emotional depth, and a clear narrative arc. The story should make the reader FEEL something, not just learn something. The brand message or business insight should emerge naturally from the narrative, never feel forced.`
    : isNewsletter
    ? `You are a newsletter editor, audience engagement specialist, and industry curator. Today is ${currentYear}.

Your task: generate a complete, publication-ready newsletter that feels like it was written by a trusted industry insider — conversational tone, curated insights, and actionable takeaways. The newsletter should make the reader feel smarter in 5 minutes and compel them to share it.`
    : isArticle
    ? `You are a senior journalist, investigative reporter, and industry analyst. Today is ${currentYear}.

Your task: generate a complete, publication-ready article with journalistic depth — balanced perspectives, cited sources, and original analysis. The article should read like it was published in a respected industry journal — not a company blog.`
    : `You are a senior B2B content strategist and writer for a marketing intelligence platform. Today is ${currentYear}.

Your task: generate a complete, publication-ready blog post that reads like it was written by a genuine expert — not by AI.`;

  const toneRule = isWhitepaper
    ? `4. **Executive tone**: Formal, authoritative, data-driven. Present findings with institutional credibility. Use precise language — no marketing buzzwords. Never use: "game-changing", "revolutionary", "leverage", "synergy", "cutting-edge".`
    : isGuide
    ? `4. **Authoritative educator tone**: Clear, thorough, and practical. Write like the best teacher you've ever had — patient with fundamentals, precise with details, generous with examples. Assume the reader is smart but new to this specific domain. Never use: "game-changing", "revolutionary", "leverage", "synergy".`
    : isStory
    ? `4. **Narrative tone**: Authentic, human, experiential. Write like a skilled storyteller — vivid imagery, natural dialogue, emotional resonance. Show, don't tell. Never use: "game-changing", "revolutionary", "leverage", "synergy". No corporate jargon in the narrative voice.`
    : isNewsletter
    ? `4. **Conversational tone**: Direct, warm, audience-first. Write like a trusted colleague sharing insights — not a corporation broadcasting. Use "you" and "your". Be opinionated where evidence supports it. Never use: "game-changing", "revolutionary", "leverage", "synergy".`
    : isArticle
    ? `4. **Journalistic tone**: Balanced, evidence-based, multi-perspective. Present competing viewpoints fairly. Attribution matters — quote or cite sources. Never promotional. Never use: "game-changing", "revolutionary", "leverage", "synergy".`
    : `4. **Thought leadership tone**: Analytical, direct, opinionated where evidence supports it. Not promotional. Never use: "game-changing", "revolutionary", "leverage", "synergy".`;

  const refMin = isWhitepaper ? '5–8' : isGuide ? '5–7' : isArticle ? '5–6' : isNewsletter ? '2–4' : isStory ? '1–2' : '3–4';
  const refRule = isWhitepaper
    ? `   - References section (minimum ${refMin} authoritative sources — academic papers, industry reports, named studies with URLs)`
    : isGuide
    ? `   - References section (minimum ${refMin} authoritative sources — documentation, industry publications, research, and practitioner resources with URLs)`
    : isStory
    ? `   - References section (optional, ${refMin} sources if the story draws on real data, testimonials, or case studies)`
    : isNewsletter
    ? `   - References section (minimum ${refMin} sources — link to the original articles, reports, or announcements being curated)`
    : isArticle
    ? `   - References section (minimum ${refMin} real, authoritative sources with URLs — journalistic standard)`
    : `   - References section (minimum ${refMin} real, plausible sources with URLs)`;

  const articleExtra = isWhitepaper ? `
## WHITEPAPER-SPECIFIC STANDARDS

- **Executive Summary**: Open with a 150–250 word executive summary that gives C-level readers the core findings and recommended actions without reading further.
- **Methodology transparency**: State how findings were derived — survey data, market analysis, case study review, or expert synthesis. Even if synthesized from public sources, describe the analytical framework.
- **Data density**: Every major claim must be supported by a data point, named source, or quantified example. Vague assertions are unacceptable.
- **Strategic recommendations**: Each major section should conclude with 1–2 actionable recommendations tied to the evidence presented.
- **Cross-referencing**: Refer back to earlier sections ("As noted in Section 2...") to build a cohesive argument.
- **Formal citation style**: Use numbered references [1], [2] inline and a full references section at the end.
- **Balanced assessment**: Present limitations, risks, and counter-arguments alongside recommendations.
` : isGuide ? `
## GUIDE-SPECIFIC DEPTH STANDARDS

- **Progressive structure**: Build from foundational concepts to advanced techniques. A reader should be able to start from the beginning and emerge competent.
- **Concrete examples in every section**: Abstract advice without examples is useless. Every concept must include at least one concrete example, code snippet, real-world scenario, or case study.
- **Actionable takeaways**: Each major section must end with specific, implementable advice — not vague recommendations.
- **Cross-referencing**: Refer back to earlier sections ("Building on the framework from Section 2...") to create a cohesive learning path.
- **Definitions and terminology**: Define technical terms when first introduced. Use consistent terminology throughout.
- **Common mistakes**: Include "what NOT to do" guidance — readers learn as much from anti-patterns as from best practices.
- **Practical depth over breadth**: Go deep enough that a reader could act on the advice immediately — don't just skim the surface of many topics.
` : isNewsletter ? `
## NEWSLETTER-SPECIFIC STANDARDS

- **Audience-first**: Every section should answer "why should the reader care about this RIGHT NOW?"
- **Scannability**: Use bold key phrases, short paragraphs (2–4 sentences), and clear section headings that telegraph value.
- **Original commentary**: Don't just curate — add your perspective, connect dots between items, and tell the reader what it means for them.
- **Actionability**: Each section or item should leave the reader with something to DO, THINK, or SHARE.
- **Conversational warmth**: Write in second person. Use contractions. Feel like a trusted advisor, not a content mill.
- **Mobile-first**: Assume the reader is scanning on a phone. Short paragraphs, clear hierarchy, no walls of text.
` : isStory ? `
## STORY-SPECIFIC CRAFT STANDARDS

- **Show, don't tell**: Use sensory details, dialogue, and action to convey meaning — not exposition. "She slammed the laptop shut" is better than "She was frustrated."
- **Emotional arc**: The story must take the reader on an emotional journey — start with tension or curiosity, build through complications, resolve with insight or transformation.
- **Concrete, specific details**: Ground the narrative in specific names, places, numbers, textures. "A Tuesday in March at the downtown WeWork" is better than "One day at a meeting."
- **Natural dialogue**: When using dialogue, make it sound like real humans talking — contractions, interruptions, subtext. Not stilted or robotic.
- **Strategic subtlety**: The brand message or insight must emerge naturally from the narrative. The reader should absorb the lesson through the story, not be lectured.
- **Pacing**: Vary sentence length. Short punchy sentences for impact. Longer ones for scene-setting. Never let the rhythm go flat.
- **Character through action**: Develop characters through what they DO and CHOOSE, not through adjective-heavy descriptions.
` : isArticle ? `
## ARTICLE-SPECIFIC JOURNALISTIC STANDARDS

- **Multiple perspectives**: Each major section should present at least one alternative viewpoint or counter-argument.
- **Attribution**: When making claims, attribute them — "According to X", "Research from Y shows", "Industry practitioners report".
- **Evidence density**: Prefer concrete data points, named studies, and expert quotes over generalizations.
- **Balanced conclusion**: The summary should synthesize perspectives, not push a single narrative.
- **Original analysis**: Go beyond surface-level reporting — connect dots, identify patterns, and draw non-obvious conclusions.
` : '';

  // ── Format-specific structure injection ─────────────────────────────────────
  // For non-standard formats, replace the default structure rules with
  // format-specific rules from blogStructureTemplates. Standard format
  // falls through to the original hardcoded rules for zero regression.
  // Article formats use getArticleStructureRules; whitepaper formats use getWhitepaperStructureRules;
  // newsletter formats use getNewsletterStructureRules; story formats use getStoryStructureRules; blog formats use getStructureRules.
  const formatRules = formatType
    ? (isWhitepaper && isValidWhitepaperFormat(formatType)
        ? getWhitepaperStructureRules(formatType, tw)
        : isGuide && isValidGuideFormat(formatType)
          ? getGuideStructureRules(formatType, tw)
          : isStory && isValidStoryFormat(formatType)
            ? getStoryStructureRules(formatType, tw)
            : isNewsletter && isValidNewsletterFormat(formatType)
              ? getNewsletterStructureRules(formatType, tw)
              : isArticle && isValidArticleFormat(formatType)
          ? getArticleStructureRules(formatType, tw)
          : getStructureRules(formatType as BlogFormatType, tw))
    : null;

  const structureRule = formatRules
    ? `7. **Structure is mandatory** — follow the ${formatType.toUpperCase()} structure exactly (see below)`
    : `7. **Structure is mandatory** — follow it exactly:
   - Key Insights block (4–5 bullet points, each 15–25 words, standalone value for scanners)
   - Opening thesis (120–180 words, opens with a sharp insight, problem, or counterintuitive claim — NOT a question)
   - ${sectionCount} H2 sections (each **${minPerSection}–${wordsPerSection} words**, builds on the previous)
   - Summary (120–180 words, distilled so the reader knows what to do next)
${refRule}`;

  const depthRules = formatRules
    ? `${formatRules.structure_rules_prompt}

## DEPTH RULES (non-negotiable)

- Each paragraph must be 60–120 words. No single-sentence paragraphs. No paragraphs under 40 words.
- Achieve depth through: concrete examples, data points, practitioner implications, cause-effect reasoning, comparison with alternatives, and actionable takeaways.
- Use H3 sub-headings within longer sections to structure the argument (max 2 per H2 section).`
    : `## SECTION DEPTH RULES (non-negotiable)

- Use exactly ${minSections}–${maxSections} H2 sections (excluding Summary and References). NEVER create more than ${maxSections} H2 sections.
- **Every H2 section MUST contain at least ${minPerSection} words**. A section under ${Math.round(minPerSection * 0.7)} words is unacceptable.
- Each H2 section must have ${paragraphsPerSection} paragraphs of substantive analysis — not a heading followed by one or two sentences.
- Each paragraph must be 60–120 words. No single-sentence paragraphs. No paragraphs under 40 words.
- Achieve depth through: concrete examples, data points, practitioner implications, cause-effect reasoning, comparison with alternatives, and actionable takeaways.
- Use H3 sub-headings within longer sections to structure the argument (max 2 per H2 section).
- Do NOT fragment one idea across multiple H2 sections. Combine related points into fewer, deeper sections.
- If you feel the need for more than ${maxSections} sections, MERGE related ideas instead.`;

  const base = `${identity}

## MANDATORY WORD COUNT: ${tw} words (±10%)

This is the #1 constraint. The finished article MUST be between ${Math.round(tw * 0.9)} and ${Math.round(tw * 1.1)} words. An article significantly shorter than ${Math.round(tw * 0.9)} words is a failure — you must write substantive, detailed content to meet this target. Count your words carefully.${tw >= 1600 ? `\n\nFor a ${tw}-word article, each of the ${minSections}–${maxSections} H2 sections must average ${wordsPerSection} words. Do NOT create thin sections under 50 words — every section needs ${paragraphsPerSection} full paragraphs of real analysis.` : ''}

## NON-NEGOTIABLE RULES

1. **No hallucination**: Never invent statistics, company names, or study results. If you reference data, it must be real or clearly reasoned from first principles.
2. **No filler**: Every sentence must earn its place. Meet the word count through depth of analysis, examples, and evidence — not padding or repetition.
3. **Narrative construction**: Build an argument progressively. Each section must logically lead to the next.
3a. **Must-include contract**: The draft is INVALID unless all must_include_points are materially covered in the body. Mentioning them is not sufficient â€” they must be explained, demonstrated, or applied.
3b. **Strategic perspective contract**: STRATEGIC PERSPECTIVE (MANDATORY): You must reflect the company's perspective, beliefs, and differentiation in every section.
${toneRule}
5. **Write for NOW**: The current year is ${currentYear}. All content must reflect the current state of the market or what is emerging in ${currentYear}–${nextYear}. Do NOT write about past trends, past years, or historical recaps.
6. **No year-anchored titles**: Never put a past year (e.g., 2023, 2024) in the title or H2 headings. If a year is needed, use ${currentYear} or ${nextYear}.
${structureRule}
${articleExtra}
${depthRules}

## GEO OPTIMIZATION RULES (for AI search engine visibility)

- **Key Insights must be quotable**: Each bullet must be a self-contained, authoritative statement an AI could cite directly. Not vague — include specifics (numbers, named concepts, clear claims).
- **References must be real and authoritative**: Use well-known publications, research firms, or reputable industry platforms. Minimum ${isWhitepaper ? 5 : (isArticle || isGuide) ? 5 : 3} references. Include proper titles and URLs.
- **Use <blockquote> for key data points or expert-level claims** — at least ${isWhitepaper ? '3–5' : isGuide ? '2–4' : isNewsletter ? '1–2' : isArticle ? '2–3' : '1–2'} blockquotes in the article. These become extraction targets for AI engines.
- **Summary must be a standalone synthesis**: A reader (or AI) who only reads the Summary should understand the article's core argument and recommended actions.

## OUTPUT FORMAT

Return ONLY valid JSON — no markdown, no prose, no code fences:

{
  "title":                "string — compelling, specific, not clickbait",
  "excerpt":              "string — 2–3 sentences, what the reader will gain (80–150 chars)",
  "content_html":         "string — full HTML blog post matching the structure above",
  "tags":                 ["string", "string", "string"],
  "category":             "string",
  "seo_meta_title":       "string — ≤60 chars",
  "seo_meta_description": "string — 120–155 chars",
  "key_insights":         ["string", "string", "string", "string"]
}

## HTML STRUCTURE REQUIREMENTS

The content_html field must be valid HTML using only these elements:
- <div class="key-insights"> wrapping a <ul> with <li> for the key insights list
- <h2> for section headings
- <h3> for sub-points within a section (max 2 per section)
- <p> for paragraphs (each 60–120 words)
- <ul> or <ol> for lists within sections
- <blockquote> for quotable insights or data points (use at least ${isWhitepaper ? '3–5' : isGuide ? '2–4' : isArticle ? '2–3' : '1–2'} in the article)
- <strong> for emphasis (use sparingly — max 2 per section)
- <a href="..."> for reference links in the References section
- End with a <h2>References</h2> and <ol> of cited sources (minimum ${isWhitepaper ? 5 : (isArticle || isGuide) ? 5 : 3})

Do NOT use: <div> (except key-insights), <span>, <table>, inline styles, class attributes (except the key-insights div), or any JavaScript.`;

  return applyBlogGovernancePreamble(
    wrapWithCompanyEnforcement(base, contentType, companyIdentity),
    governance,
  );
}

export function buildGenerationUserPrompt(input: BlogGenerationInput): string {
  const currentYear = new Date().getFullYear();
  const lines: string[] = [
    `CURRENT YEAR: ${currentYear} — write for present-day and near-future market reality. Do not anchor content to past years.`,
  ];

  // If a specific angle was selected, lead with it
  if (input.selected_angle) {
    const a = input.selected_angle;
    lines.push(`ARTICLE TITLE: ${a.title}`);
    lines.push(`EDITORIAL ANGLE (${a.label.toUpperCase()}): ${a.angle_summary}`);
    lines.push(`OPENING HOOK TO USE: ${a.hook}`);
    lines.push('');
  }

  lines.push(`TOPIC: ${input.topic}`);

  if (input.intent) {
    const intentLabels: Record<string, string> = {
      awareness:  'Awareness — introduce the problem or concept to readers unfamiliar with it',
      authority:  'Authority — establish deep expertise, reference evidence, build credibility',
      conversion: 'Conversion — move readers toward a decision; make the value of acting clear',
      retention:  'Retention — help existing practitioners go deeper; assume prior knowledge',
    };
    lines.push(`STRATEGIC INTENT: ${intentLabels[input.intent] ?? input.intent}`);
  }

  if (input.cluster) {
    lines.push(`CONTENT CLUSTER: ${input.cluster} — ensure thematic coherence with this cluster`);
  }

  if (input.series_context) {
    lines.push(`SERIES CONTEXT: ${input.series_context}`);
  }

  // Continuation mode — show what was already covered
  if (input.series_summaries && input.series_summaries.length > 0) {
    lines.push('\nPREVIOUS ARTICLES IN THIS SERIES (do NOT repeat these angles or foundational concepts):');
    for (const s of input.series_summaries) {
      lines.push(`\n  Article: "${s.title}"`);
      if (s.headings.length > 0) lines.push(`  Covered: ${s.headings.join(' → ')}`);
      if (s.key_points.length > 0) lines.push(`  Key points: ${s.key_points.slice(0, 3).join('; ')}`);
      if (s.summary) lines.push(`  Summary: ${s.summary}`);
    }
    lines.push('\nThis article must build on — not repeat — the above. Assume the reader has read all previous parts. Go deeper.');
  } else if (input.related_blogs && input.related_blogs.length > 0) {
    lines.push(`\nRELATED ARTICLES:\n${input.related_blogs.map(b => `  - ${b}`).join('\n')}\nAvoid duplicating angles already covered.`);
  }

  // Clarification answers
  if (input.answers && Object.keys(input.answers).length > 0) {
    lines.push('\nCONTEXT FROM AUTHOR:');
    const labelMap: Record<string, string> = {
      audience: 'Target audience',
      industry: 'Industry / context',
      depth:    'Depth level',
      tone:     'Tone preference',
      examples: 'Examples / data to include',
      target_word_count: 'Target word count',
      reader_stage: 'Reader stage',
      cta_preference: 'CTA preference',
      uniqueness_directive: 'Uniqueness directive',
      must_include_points: 'Must-include points',
      campaign_objective: 'Campaign objective',
      strategy_perspective: 'Strategic perspective',
      trend_context: 'Trend context',
      company_context: 'Company context',
      current_content: 'Current content coverage',
      writing_style: 'Writing style guidance',
    };
    for (const [key, value] of Object.entries(input.answers)) {
      if (value.trim()) lines.push(`  ${labelMap[key] ?? key}: ${value.trim()}`);
    }
  }

  if (input.tone) lines.push(`TONE: ${input.tone}`);

  if (input.organizationPerspective) {
    const p = input.organizationPerspective;
    lines.push('\n## ORGANIZATIONAL POV LAYER (MANDATORY)');
    lines.push(`Primary executive audience: ${p.primaryAudience}`);
    lines.push(`Company viewpoint: ${p.companyViewpoint}`);
    lines.push(`Market observation: ${p.marketObservation}`);
    lines.push(`Strategic recommendation: ${p.strategicRecommendation}`);
    lines.push(`Tradeoff analysis: ${p.tradeoffAnalysis}`);
    lines.push(`Proprietary insight: ${p.proprietaryInsight}`);
    lines.push('Every major section must use this POV. If the article would remain valid after replacing the company with a generic consultancy, the draft is invalid.');
  }

  // ── Writing style guide from WritingStyleEngine ───────────────────────────
  if (input.writingStyleInstructions) {
    lines.push(`\n${input.writingStyleInstructions}`);
  }

  // ── Intelligence context (unified or individual fallback) ─────────────────
  if (input.unifiedPromptContext) {
    // Orchestrator provides a single pre-built block
    lines.push(input.unifiedPromptContext);
  } else {
    // Backward-compatible: individual engine outputs
    if (input.performanceLearningsPrompt) {
      lines.push(`\n${input.performanceLearningsPrompt}`);
    }
    if (input.keywordContextPrompt) {
      lines.push(`\n${input.keywordContextPrompt}`);
    }
    if (input.trendContextPrompt) {
      lines.push(`\n${input.trendContextPrompt}`);
    }
    if (input.freshnessDirective) {
      lines.push(`\n${input.freshnessDirective}`);
    }
    if (input.keywordContextPrompt && input.performanceLearningsPrompt) {
      lines.push('\n## BALANCE DIRECTIVE');
      lines.push('Balance keyword targeting with effective angle style. Do not compromise clarity for keyword placement.');
    }
  }

  const targetWords = input.answers?.target_word_count ? String(input.answers.target_word_count).trim() : '';
  const tw = targetWords ? parseInt(targetWords, 10) : 0;
  const minSections = tw >= 2000 ? 5 : tw >= 1600 ? 5 : tw >= 1200 ? 4 : 3;
  const maxSections = tw >= 2000 ? 7 : tw >= 1600 ? 6 : tw >= 1200 ? 5 : 4;
  const parasPerSection = tw >= 2000 ? '4–6' : tw >= 1600 ? '3–5' : '3–4';

  const isClassicTemplate = typeof input.templateName === 'string' && input.templateName.trim().toLowerCase() === 'classic';
  const templateName = typeof input.templateName === 'string' ? input.templateName.trim().toLowerCase() : '';

  if (tw >= 300) {
    lines.push(`\n## WORD COUNT TARGET: ${tw} words (MANDATORY)`);
    lines.push(`Your article MUST be between ${Math.round(tw * 0.9)} and ${Math.round(tw * 1.1)} words. This is the most important constraint.`);
    lines.push(`To achieve this, use ${minSections}–${maxSections} H2 sections, each with ${Math.round((tw - 320) / minSections)} or more words.`);
    lines.push(`Do NOT stop writing early. Every section needs ${parasPerSection} substantive paragraphs with concrete examples, data, and analysis.`);
    if (tw >= 1600) {
      lines.push(`CRITICAL: Do NOT create thin sections under 50 words. If you produce more than ${maxSections} sections, you are fragmenting — merge them.`);
    }
    lines.push('');
  }

  if (isClassicTemplate) {
    if (tw >= 2000) {
      lines.push('## CLASSIC TEMPLATE DEPTH DIRECTIVE');
      lines.push('- This article uses the Classic template. Write it like a flagship deep dive, not a routine blog post.');
      lines.push(`- Build ${minSections}-${Math.min(maxSections, 6)} major sections with strong internal progression.`);
      lines.push('- In every major section, include explanation, a concrete example, an implication, and a practical takeaway.');
      lines.push('- At least two sections should include tradeoffs, risks, or decision criteria so the article feels genuinely expert-level.');
      lines.push('- The conclusion must synthesize the argument into a sharp point of view and a clear next-step path.');
      lines.push('');
    } else if (tw >= 1600) {
      lines.push('## CLASSIC TEMPLATE DEPTH DIRECTIVE');
      lines.push('- This article uses the Classic template. Treat it as a serious deep dive.');
      lines.push('- Every major section must feel complete and substantial, not like a summary.');
      lines.push('- In every major section, include explanation, a concrete example, and a practical implication for the reader.');
      lines.push('- At least one section should show common mistakes, weak execution patterns, or practical pitfalls.');
      lines.push('');
    } else if (tw >= 1200) {
      lines.push('## CLASSIC TEMPLATE DEPTH DIRECTIVE');
      lines.push('- This article uses the Classic template. Make each section teach the reader something concrete.');
      lines.push('- Avoid generic advice. Support claims with examples, reasoning, or practical specifics.');
      lines.push('- Use at least 4 substantial H2 sections, and each one should contain 2-4 full paragraphs instead of short fragments.');
      lines.push('- The Summary must be fully written and synthesize the argument into a clear takeaway.');
      lines.push('- The References section must include at least 3 credible sources so the draft has real GEO support.');
      lines.push('- Each section should end with a clear takeaway sentence.');
      lines.push('');
    } else {
      lines.push('## CLASSIC TEMPLATE DEPTH DIRECTIVE');
      lines.push('- This article uses the Classic template. Even at 800+ words, sections must contain real explanation and practical value.');
      lines.push('- Keep the writing concise, but do not write thin filler or outline-like paragraphs.');
      lines.push('- Use at least 3 substantial H2 sections, and make the Summary and References blocks complete rather than token.');
      lines.push('- Each section should include at least one useful example, implication, or takeaway.');
      lines.push('');
    }
  }

  if (input.contentType === 'blog' && !isClassicTemplate && (templateName || input.formatType)) {
    const pushDirective = (heading: string, bullets: string[]) => {
      lines.push(heading);
      for (const bullet of bullets) lines.push(`- ${bullet}`);
      lines.push('');
    };

    if (templateName === 'visual feature') {
      pushDirective('## VISUAL FEATURE DEPTH DIRECTIVE', [
        'The visuals support the article, but the writing must still carry full editorial depth.',
        'Every major written section should combine scene-setting, analysis, and practical interpretation.',
        'Do not let image-related blocks replace substantive body content.',
      ]);
    } else if (templateName === 'comparison' || input.formatType === 'comparison') {
      pushDirective('## COMPARISON DEPTH DIRECTIVE', [
        'Make the comparison decision-useful, not descriptive only.',
        'For each option, explain strengths, tradeoffs, ideal use cases, and decision criteria.',
        'The verdict should clearly explain who should choose what and why.',
      ]);
    } else if (templateName === 'tutorial' || input.formatType === 'tutorial') {
      pushDirective('## TUTORIAL DEPTH DIRECTIVE', [
        'Each step must teach the reader what to do, why it matters, and what can go wrong.',
        'Include setup context, practical examples, and troubleshooting guidance where helpful.',
        'Do not write step headings with shallow explanatory text underneath them.',
      ]);
    } else if (templateName === 'magazine') {
      pushDirective('## MAGAZINE TEMPLATE DEPTH DIRECTIVE', [
        'Keep the editorial feel, but ensure the article still develops a strong argument.',
        'Columns, quotes, and visual variety should enrich the piece, not reduce content depth.',
        'Every narrative section should include concrete detail, interpretation, and why-it-matters analysis.',
      ]);
    } else {
      pushDirective('## CUSTOM TEMPLATE DEPTH DIRECTIVE', [
        'Honor the selected layout, but fully populate every substantive section with real content depth.',
        'If the layout includes columns or special blocks, each one should add meaningful standalone value.',
        'Do not let structure become an excuse for short or skeletal writing.',
      ]);
    }
  }

  const isArticle    = input.contentType === 'article';
  const isWhitepaper = input.contentType === 'whitepaper';
  const isNewsletter = input.contentType === 'newsletter';
  const isStory      = input.contentType === 'story';
  const isGuide      = input.contentType === 'guide';
  const refMin = isWhitepaper ? 5 : (isArticle || isGuide) ? 5 : isNewsletter ? 2 : isStory ? 1 : 3;
  const bqMin  = isWhitepaper ? '3–5' : isGuide ? '2–4' : isArticle ? '2–3' : isStory ? '1–2' : '1–2';
  const contentLabel = isWhitepaper ? 'whitepaper' : isGuide ? 'guide' : isStory ? 'story' : isNewsletter ? 'newsletter' : isArticle ? 'article' : 'blog post';

  lines.push(`REQUIREMENTS:
- Apply ALL system prompt rules without exception
- Build a clear argument, not a list of observations
- The opening thesis must NOT start with a question${input.selected_angle ? '\n- Use the provided hook sentence as the opening of the intro paragraph' : ''}
- Each H2 section must end with a clear takeaway sentence
- References must be real and authoritative (well-known publications, research firms, or reputable platforms) — minimum ${refMin}
- key_insights must be standalone, quotable statements — a reader (or AI engine) who only reads them should understand the article's core value
- Include at least ${bqMin} <blockquote> elements for key data points or expert-level claims
- Every paragraph must be 60–120 words. No single-sentence paragraphs.${isArticle ? '\n- Present balanced perspectives — include at least one counter-argument or alternative viewpoint per major section\n- Attribute claims to named sources where possible' : isGuide ? '\n- Build progressively — foundational concepts before advanced techniques\n- Include concrete examples, code snippets, or real-world scenarios in every section\n- Cross-reference between sections to create a cohesive learning path\n- Each section must end with actionable, implementable advice' : isStory ? '\n- Show, don\'t tell — use sensory details, dialogue, and action instead of exposition\n- Include at least one moment of dialogue or internal thought\n- Build an emotional arc — the reader must FEEL the story, not just read it\n- Keep paragraphs short (2–4 sentences) for pacing' : isNewsletter ? '\n- Write in second person — address the reader directly\n- Keep paragraphs short (2–4 sentences) for mobile readability\n- Each section must deliver standalone value — reward scanners' : ''}
${tw >= 300 ? `- REMINDER: Target is ${tw} words. Do NOT deliver fewer than ${Math.round(tw * 0.9)} words.` : ''}

Generate the complete ${contentLabel} now.`);

  return lines.join('\n');
}

// ── Validation ────────────────────────────────────────────────────────────────

