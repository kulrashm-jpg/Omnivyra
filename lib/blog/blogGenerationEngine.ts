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
 *   - Required structure: Key Insights → Hook Intro → 3–5 H2s → Summary → References
 *   - Minimum 2–3 real references
 *   - Thought leadership tone — analytical, never promotional
 */

import { getStructureRules, getArticleStructureRules, getWhitepaperStructureRules, getNewsletterStructureRules, getStoryStructureRules, getGuideStructureRules, isValidArticleFormat, isValidWhitepaperFormat, isValidNewsletterFormat, isValidStoryFormat, isValidGuideFormat, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from './blogStructureTemplates';
import {
  type CompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
} from '../content/companyContextBlock';

/**
 * Wrap a base system prompt with mandatory company enforcement.
 * Prepends identity lock (includes strategy perspective) and appends
 * anti-generic rules. Returns base unchanged when identity is empty
 * so zero-context flows are unaffected.
 */
function wrapWithCompanyEnforcement(
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

  return wrapWithCompanyEnforcement(base, `${contentType} angles`, companyIdentity);
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
   - Hook intro (120–180 words, opens with a sharp insight, problem, or counterintuitive claim — NOT a question)
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

  return wrapWithCompanyEnforcement(base, contentType, companyIdentity);
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
- The hook intro must NOT start with a question${input.selected_angle ? '\n- Use the provided hook sentence as the opening of the intro paragraph' : ''}
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

export function validateGenerationOutput(raw: unknown): BlogGenerationOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const title                = typeof r.title                === 'string' ? r.title.trim()                : '';
  const excerpt              = typeof r.excerpt              === 'string' ? r.excerpt.trim()              : '';
  const content_html         = typeof r.content_html         === 'string' ? r.content_html.trim()         : '';
  const category             = typeof r.category             === 'string' ? r.category.trim()             : '';
  const seo_meta_title       = typeof r.seo_meta_title       === 'string' ? r.seo_meta_title.trim()       : '';
  const seo_meta_description = typeof r.seo_meta_description === 'string' ? r.seo_meta_description.trim() : '';

  const tags         = Array.isArray(r.tags)         ? (r.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];
  const key_insights = Array.isArray(r.key_insights) ? (r.key_insights as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];

  if (!title || !content_html) return null;

  return { title, excerpt, content_html, tags, category, seo_meta_title, seo_meta_description, key_insights };
}

// ── Fallback angles ───────────────────────────────────────────────────────────

export function buildFallbackAngles(topic: string): BlogAngle[] {
  const short = topic.length > 50 ? topic.slice(0, 50) + '…' : topic;
  return [
    {
      type:          'analytical',
      label:         'Analytical',
      title:         `The Data Behind ${short}`,
      angle_summary: 'Examines the evidence, patterns, and causal relationships that explain why this matters.',
      hook:          'The numbers tell a story most practitioners are too busy to read.',
    },
    {
      type:          'contrarian',
      label:         'Contrarian',
      title:         `Why Everything You Know About ${short} Is Wrong`,
      angle_summary: 'Challenges the dominant narrative and exposes the assumptions that lead teams astray.',
      hook:          'The prevailing advice on this topic has a quiet but expensive flaw.',
    },
    {
      type:          'strategic',
      label:         'Strategic',
      title:         `How to Turn ${short} Into a Competitive Advantage`,
      angle_summary: 'Connects the topic directly to business outcomes and shows leaders how to act on it.',
      hook:          'Most companies treat this as a tactic. The ones winning treat it as infrastructure.',
    },
  ];
}

// ── Deterministic fallback ────────────────────────────────────────────────────

export function buildGenerationFallback(input: BlogGenerationInput): BlogGenerationOutput {
  const title = input.selected_angle?.title ?? (input.topic.length > 80 ? input.topic.slice(0, 80) : input.topic);

  const content_html = `<div class="key-insights">
<ul>
<li>Add your first key insight here</li>
<li>Add your second key insight here</li>
<li>Add your third key insight here</li>
</ul>
</div>

<p>${input.selected_angle?.hook ?? 'Start your introduction here — open with a sharp insight or surprising observation.'}</p>

<h2>Section One</h2>
<p>Develop your first major point here.</p>

<h2>Section Two</h2>
<p>Build on section one here.</p>

<h2>Section Three</h2>
<p>Drive toward your conclusion here.</p>

<h2>Summary</h2>
<p>Distil the most important takeaways and tell the reader what to do next.</p>

<h2>References</h2>
<ol>
<li><a href="#">Add your first reference</a></li>
<li><a href="#">Add your second reference</a></li>
</ol>`;

  return {
    title,
    excerpt:              '',
    content_html,
    tags:                 input.cluster ? [input.cluster] : [],
    category:             input.cluster ?? '',
    seo_meta_title:       title.slice(0, 60),
    seo_meta_description: '',
    key_insights:         [],
  };
}

// ── Template-Aware Generation ────────────────────────────────────────────────
// When a user provides a template (ContentBlock[] with hints), the AI fills
// each block's content directly instead of generating monolithic HTML.

import type { ContentBlock } from './blockTypes';

/**
 * Serialize a template block into a human-readable description for the prompt.
 */
function describeBlock(block: ContentBlock, depth = 0): string {
  const indent = '  '.repeat(depth);
  const hint = (block as any).hint ? ` — "${(block as any).hint}"` : '';

  switch (block.type) {
    case 'paragraph':
      return `${indent}- PARAGRAPH${hint || ' — "Write substantive content relevant to the surrounding headings and topic"}'}`;
    case 'heading':
      return `${indent}- H${block.level} HEADING${hint || ' — "Write a concise, descriptive heading for this section"'}`;
    case 'key_insights':
      return `${indent}- KEY INSIGHTS (${block.items.length} items)${hint || ' — "Summarize the most important takeaways"'}`;
    case 'callout':
      return `${indent}- CALLOUT (${block.variant})${hint || ` — "Write an important ${block.variant} for the reader"`}`;
    case 'quote':
      return `${indent}- QUOTE${hint || ' — "Provide a relevant expert quote with attribution"'}`;
    case 'image':
      return `${indent}- IMAGE${hint || ' — "Provide descriptive alt text and caption for an illustrative image"'}`;
    case 'media':
      return `${indent}- MEDIA EMBED${hint}`;
    case 'divider':
      return `${indent}- DIVIDER`;
    case 'list':
      return `${indent}- ${block.listType.toUpperCase()} LIST (${block.items.length} items)${hint || ' — "Write substantive list items relevant to this section"'}`;
    case 'references':
      return `${indent}- REFERENCES (${block.items.length} sources)${hint || ` — "Provide ${block.items.length} credible source references"`}`;
    case 'summary':
      return `${indent}- SUMMARY${hint || ' — "Synthesize the article into a concise conclusion"'}`;
    case 'internal_link':
      return `${indent}- INTERNAL LINK`;
    case 'columns':
      const colLines = block.columns.map((col, ci) => {
        const innerLines = col.blocks.map((b) => describeBlock(b, depth + 2));
        return `${indent}  Column ${ci + 1}:\n${innerLines.join('\n') || `${indent}    (empty)`}`;
      });
      return `${indent}- ${block.columnCount}-COLUMN LAYOUT:\n${colLines.join('\n')}`;
    default:
      return `${indent}- ${(block as any).type?.toUpperCase() ?? 'BLOCK'}${hint}`;
  }
}

function serializeTemplateStructure(blocks: ContentBlock[]): string {
  return blocks.map((b, i) => `Block ${i + 1}: ${describeBlock(b)}`).join('\n');
}

type TemplateSectionSummary = {
  title: string;
  blockTypes: string[];
  hints: string[];
};

function summarizeTemplateSections(blocks: ContentBlock[]): TemplateSectionSummary[] {
  const sections: TemplateSectionSummary[] = [];
  let current: TemplateSectionSummary | null = null;

  const ensureSection = (fallbackTitle: string) => {
    if (!current) {
      current = { title: fallbackTitle, blockTypes: [], hints: [] };
      sections.push(current);
    }
    return current;
  };

  const pushBlock = (block: ContentBlock, nested = false) => {
    if (block.type === 'heading' && block.level === 2 && !nested) {
      const headingTitle = block.text?.trim() || (block as any).hint?.trim() || `Section ${sections.length + 1}`;
      current = { title: headingTitle, blockTypes: ['heading'], hints: [] };
      if ((block as any).hint?.trim()) current.hints.push((block as any).hint.trim());
      sections.push(current);
      return;
    }

    const target = ensureSection(sections.length === 0 ? 'Introduction and setup' : `Section ${sections.length}`);
    target.blockTypes.push(block.type);

    const hint = typeof (block as any).hint === 'string' ? (block as any).hint.trim() : '';
    if (hint) target.hints.push(hint);

    if (block.type === 'columns') {
      for (const column of block.columns) {
        for (const inner of column.blocks) pushBlock(inner, true);
      }
    }
  };

  for (const block of blocks) pushBlock(block);

  return sections.map((section) => ({
    title: section.title,
    blockTypes: Array.from(new Set(section.blockTypes)),
    hints: Array.from(new Set(section.hints)).slice(0, 3),
  }));
}

function buildTemplateSectionGuidance(template: ContentBlock[]): string {
  const sections = summarizeTemplateSections(template);
  if (sections.length === 0) return '';

  const lines: string[] = ['## SECTION MAPPING RULES'];
  lines.push('Do not spread every input evenly across the whole article.');
  lines.push('Attach each chosen directive to the section where it is most relevant, based on the section title, block types, and hints below.');
  lines.push('Use campaign objective most strongly in the outcome / why-it-matters / action sections.');
  lines.push('Use trend context most strongly in context-setting, market-shift, or why-now sections.');
  lines.push('Use must-include points in the sections where they naturally belong, not as a forced checklist in every block.');
  lines.push('Use uniqueness directive to shape the strongest differentiating section and the article thesis.');

  sections.forEach((section, index) => {
    const hints = section.hints.length > 0 ? ` | hints: ${section.hints.join(' ; ')}` : '';
    lines.push(`${index + 1}. ${section.title} | block types: ${section.blockTypes.join(', ')}${hints}`);
  });

  return lines.join('\n');
}

/**
 * Build the generation output schema description for template-aware generation.
 * The AI returns a JSON object matching the template structure.
 */
function buildTemplateOutputSchema(blocks: ContentBlock[]): string {
  const lines: string[] = [];
  lines.push('Return a JSON object with these fields:');
  lines.push('{');
  lines.push('  "title": "SEO-optimized article title",');
  lines.push('  "excerpt": "2-sentence meta description",');
  lines.push('  "tags": ["tag1", "tag2", ...],');
  lines.push('  "category": "article category",');
  lines.push('  "seo_meta_title": "title for search (max 60 chars)",');
  lines.push('  "seo_meta_description": "meta description (max 160 chars)",');
  lines.push('  "key_insights": ["insight 1", "insight 2", ...],');
  lines.push('  "blocks": [');
  lines.push('    // One entry per block in the template, IN ORDER.');
  lines.push('    // Each entry fills that block\'s content:');
  lines.push('    // For paragraph: { "html": "<p>...</p>" }');
  lines.push('    // For heading:   { "text": "..." }');
  lines.push('    // For key_insights: { "items": ["...", "..."] }');
  lines.push('    // For callout:   { "title": "...", "body": "..." }');
  lines.push('    // For quote:     { "text": "...", "author": "...", "source": "..." }');
  lines.push('    // For image:     { "alt": "descriptive alt text aligned to the article topic", "caption": "contextual caption explaining the image relevance" }');
  lines.push('    // For list:      { "items": [{ "text": "..." }, ...] }');
  lines.push('    // For summary:   { "body": "..." }');
  lines.push('    // For references: { "items": [{ "title": "...", "url": "..." }, ...] }');
  lines.push('    // For divider:   {} (no content needed)');
  lines.push('    // For columns:   { "columns": [ { "blocks": [... filled inner blocks ...] }, ... ] }');
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n');
}

export function buildTemplateAwareSystemPrompt(
  targetWordCount: number,
  contentType: string,
  template: ContentBlock[],
): string {
  const tw = targetWordCount;
  const structure = serializeTemplateStructure(template);
  // Count total paragraph blocks (including those inside columns)
  const paraCount = template.filter((b) => b.type === 'paragraph').length
    + template.reduce((n, b) => b.type === 'columns'
      ? n + b.columns.reduce((cn, c) => cn + c.blocks.filter((ib) => ib.type === 'paragraph').length, 0)
      : n, 0);
  const avgWordsPerBlock = Math.max(120, Math.round(tw / Math.max(1, paraCount)));
  const minWordsPerBlock = Math.max(100, Math.round(avgWordsPerBlock * 0.75));
  const paragraphTagGuidance =
    tw >= 2000 ? '3-5 <p> elements' :
    tw >= 1600 ? '2-4 <p> elements' :
    tw >= 1200 ? '2-3 <p> elements' :
    '1-3 <p> elements';

  return `You are a senior ${contentType} content strategist. You fill pre-designed content templates with high-quality, publication-ready content.

## YOUR TASK
You are given a template structure (a sequence of typed content blocks). Fill EVERY block with substantive content about the provided topic. Each block type has specific content requirements.

## TEMPLATE STRUCTURE
${structure}

## CONTENT RULES
- TARGET WORD COUNT: ${tw} words (±15%). This is the #1 constraint. YOU MUST REACH AT LEAST ${Math.round(tw * 0.85)} words.
- Distribute words proportionally across blocks. Paragraph blocks should average ${Math.round(tw / Math.max(1, paraCount))} words each — NEVER write a paragraph under 80 words.
- For ${tw}+ word targets: paragraphs should be 100-200 words each with multiple sentences, concrete examples, data points, and analysis.
- Paragraph HTML must use <p>, <strong>, <em>, and <a> tags. No other HTML elements.
- Headings must be concise (3-8 words) and descriptive.
- Key insights must be complete sentences, each expressing a standalone takeaway.
- Lists must have substantive items (10-30 words each), not single-word bullets.
- Summary must synthesize the article's key arguments, not just repeat headings.
- References must have real, plausible titles and URLs.
- For columns: fill each column's blocks independently but ensure they relate to each other contextually (e.g., comparison columns should compare the same criteria).

## QUALITY STANDARDS
- Thought leadership tone — analytical, evidence-based, never promotional
- Concrete examples, data points, and practitioner implications
- Each paragraph: 60-120 words, no single-sentence paragraphs
- Narrative flow: each section should logically lead to the next
- No hallucination — reason from first principles if data is unavailable

## OUTPUT FORMAT
${buildTemplateOutputSchema(template)}

The "blocks" array MUST have exactly ${template.length} entries, one per template block, in order.`;
}

export function buildTemplateAwareUserPrompt(
  input: BlogGenerationInput,
  template: ContentBlock[],
): string {
  const lines: string[] = [];
  const templateName = typeof input.templateName === 'string' ? input.templateName.trim().toLowerCase() : '';
  const isNewsletter = input.contentType === 'newsletter';
  const isInsightLetter = isNewsletter && input.formatType === 'insight-letter';
  const isMinimalThesis = templateName === 'minimal thesis';
  const isSplitScreenInsight = templateName === 'split-screen insight';

  lines.push(`## TOPIC: ${input.topic}`);

  if (input.selected_angle) {
    lines.push(`\n## ANGLE: ${input.selected_angle.title}`);
    lines.push(input.selected_angle.angle_summary);
  }

  if (input.answers) {
    const companyLines: string[] = [];
    if (input.answers.companyName) companyLines.push(`Company: ${input.answers.companyName}`);
    if (input.answers.industry) companyLines.push(`Industry: ${input.answers.industry}`);
    if (input.answers.audience || input.answers.target_audience) companyLines.push(`Target audience: ${input.answers.audience || input.answers.target_audience}`);
    if (input.answers.company_context) companyLines.push(`Context: ${input.answers.company_context}`);
    if (companyLines.length > 0) {
      lines.push(`\n## COMPANY CONTEXT\n${companyLines.join('\n')}`);
    }
    if (input.answers.uniqueness_directive) {
      lines.push(`\n## UNIQUENESS DIRECTIVE: ${input.answers.uniqueness_directive}`);
    }
    // Phase 2.7 — Section-level strategic assignments are the primary
    // anchor-distribution mechanism. The model receives per-section
    // bundles rather than a single comma-joined checklist.
    if (input.answers.section_strategic_assignments) {
      lines.push(`\n## ${input.answers.section_strategic_assignments}`);
    }
    if (input.answers.must_include_points) {
      lines.push(`\n## MUST-INCLUDE POINTS: ${input.answers.must_include_points}`);
    }
    if (input.answers.strategy_perspective) {
      lines.push(`\n## STRATEGIC PERSPECTIVE\n${input.answers.strategy_perspective}`);
    }
    if (input.answers.campaign_objective) {
      lines.push(`\n## CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
    }
    if (input.answers.trend_context) {
      lines.push(`\n## TREND CONTEXT: ${input.answers.trend_context}`);
    }
  }

  if (input.unifiedPromptContext) {
    lines.push(`\n## INTELLIGENCE CONTEXT\n${input.unifiedPromptContext}`);
  }

  const sectionGuidance = buildTemplateSectionGuidance(template);
  if (sectionGuidance) {
    lines.push(`\n${sectionGuidance}`);
  }

  if (isInsightLetter) {
    lines.push('\n## INSIGHT LETTER CONTRACT');
    lines.push('- The final newsletter must clearly deliver Hook, Context, Insight, Expansion, Implication, and Closing.');
    lines.push('- The core idea should feel original, specific, and reusable, not like a generic article summary.');
    lines.push('- Use at least one concrete example, recognizable pattern, or grounded scenario so the argument is not abstract.');
    lines.push('- Key Insights and Summary must be strong enough to stand alone in AI answers, forwarding, and inbox previews.');
    lines.push('- The writing should leave the reader with a changed lens, not just information.');
  }

  if (isMinimalThesis) {
    lines.push('\n## MINIMAL THESIS DEPTH CONTRACT');
    lines.push('- Give real weight to Hook, Insight, Expansion, and Implication. These sections cannot read like placeholders.');
    lines.push('- Build the idea through first-principles reasoning, a reusable mental model, and one grounded scenario or pattern.');
    lines.push('- Make the quote block genuinely memorable and thesis-sharpening.');
    lines.push('- The summary must synthesize the thesis and the resulting decision or perspective shift.');
    lines.push('- Keep the exact section sequence visible: Hook, Context, Insight, Expansion, Implication, Closing. Do not merge or skip them.');
    lines.push('- Key Insights, quote, callout, and summary should each add something distinct so the letter is structurally complete and GEO-friendly.');
  }

  if (isSplitScreenInsight) {
    lines.push('\n## SPLIT-SCREEN INSIGHT CONTRACT');
    lines.push('- Make the contrast between the surface story and the deeper reality unmistakably clear and useful.');
    lines.push('- The framing callout, quote, and summary must all be extractable on their own.');
    lines.push('- The surface story should sound plausible; the deeper reality should reveal the hidden mechanism or second-order effect.');
    lines.push('- Turn that contrast into a practical implication the reader can actually use.');
    lines.push('- Add enough body depth that the contrast feels argued, not merely stated. Use one grounded example, clear mechanism, and an earned implication.');
  }

  if (input.series_summaries?.length) {
    lines.push('\n## SERIES CONTEXT (prior articles):');
    for (const s of input.series_summaries) {
      lines.push(`- "${s.title}": ${s.summary}`);
    }
  }

  const tw = input.answers?.target_word_count ? parseInt(String(input.answers.target_word_count), 10) : 1200;
  lines.push(`\n## WORD COUNT TARGET: ${tw} words (MANDATORY)`);
  lines.push(`Fill all ${template.length} blocks in the template. The total content must be ${tw} words (±15%).`);

  return lines.join('\n');
}

export function buildTemplateAwareSystemPromptV2(
  targetWordCount: number,
  contentType: string,
  template: ContentBlock[],
  templateName?: string,
  companyIdentity?: CompanyIdentity,
): string {
  const tw = targetWordCount;
  const structure = serializeTemplateStructure(template);
  const normalizedTemplateName = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
  const paraCount = template.filter((b) => b.type === 'paragraph').length
    + template.reduce((n, b) => b.type === 'columns'
      ? n + b.columns.reduce((cn, c) => cn + c.blocks.filter((ib) => ib.type === 'paragraph').length, 0)
      : n, 0);
  const avgWordsPerBlock = Math.max(120, Math.round(tw / Math.max(1, paraCount)));
  const minWordsPerBlock = Math.max(100, Math.round(avgWordsPerBlock * 0.75));
  const paragraphTagGuidance =
    tw >= 2000 ? '3-5 <p> elements' :
    tw >= 1600 ? '2-4 <p> elements' :
    tw >= 1200 ? '2-3 <p> elements' :
    '1-3 <p> elements';

  const base = `You are a senior ${contentType} content strategist. You fill pre-designed content templates with high-quality, publication-ready content.

## YOUR TASK
You are given a template structure (a sequence of typed content blocks). Fill EVERY block with substantive content about the provided topic. Each block type has specific content requirements.

## TEMPLATE STRUCTURE
${structure}

## CONTENT RULES
- TARGET WORD COUNT: ${tw} words (+/-15%). This is the #1 constraint. YOU MUST REACH AT LEAST ${Math.round(tw * 0.85)} words.
- Distribute words proportionally across blocks. Paragraph blocks are the main depth carriers and should average about ${avgWordsPerBlock} words each.
- Treat ${minWordsPerBlock} words per paragraph block as the practical minimum unless the block is clearly just a short transition.
- A single paragraph block may contain ${paragraphTagGuidance} when needed. Do not assume one block means one short paragraph.
- For body sections, use layered depth: explanation + example + implication + action step where relevant.
- The draft is INVALID unless all must_include_points are materially covered in the body. Mentioning them is not sufficient - they must be explained, demonstrated, or applied.
- STRATEGIC PERSPECTIVE (MANDATORY): You must reflect the company's perspective, beliefs, and differentiation in every section.
- Paragraph HTML must use only <p>, <strong>, <em>, and <a> tags. No other HTML elements.
- Headings must be concise (3-8 words) and descriptive.
- Key insights must be complete sentences, each expressing a standalone takeaway.
- Lists must have substantive items (10-30 words each), not single-word bullets.
- Summary must synthesize the article's key arguments, not just repeat headings.
- References must have real, plausible titles and URLs.
- For columns: fill each column's blocks independently but ensure they relate to each other contextually.
- Fill EVERY substantive block. Never leave paragraph HTML empty, headings blank, or list items skeletal.
${normalizedTemplateName === 'comparison' ? '- For comparison templates: compare the same decision criteria across both options, explain tradeoffs explicitly, and make every verdict scenario-specific.\n- In comparison columns, each option needs real analysis plus concrete strengths or limitations, not headline bullets only.' : ''}
${normalizedTemplateName === 'tutorial' ? '- For tutorial templates: every step needs action, rationale, and at least one caution, check, or implementation note.' : ''}
${normalizedTemplateName === 'magazine' ? '- For magazine templates: quotes, columns, and visual moments should deepen the editorial argument instead of replacing it.' : ''}
${normalizedTemplateName === 'visual feature' ? '- For visual feature templates: images can support the story, but the written sections must still carry full analytical weight.\n- Fill every H2 heading, write a complete summary, include at least 3 credible references, and give every image block both a descriptive alt text and a contextual caption.' : ''}
${normalizedTemplateName === 'comparison' ? '- For comparison templates: every top-level H2 must be filled, the verdict callout must be decisive, the summary must be complete, and the references block must include at least 3 credible sources.' : ''}
${contentType === 'newsletter' ? '- For newsletter templates: write for forwarding and extraction. Key insights, callouts, quotes, and summary blocks must be sharp enough to stand alone in inbox previews, AI answers, and social sharing.\n- Make every section feel like part of one coherent letter, not detached article fragments.\n- Use current, concrete stakes so the newsletter feels timely and reader-relevant right now.' : ''}
${contentType === 'newsletter' ? '- For newsletter templates: do not underwrite the main idea. Build depth through reasoning, concrete examples, recognizable patterns, and clear implications for the reader.\n- Every substantive newsletter paragraph must feel complete and standalone, not like a note to expand later.' : ''}
${contentType === 'newsletter' ? '- For insight-letter newsletters specifically: the reader must be able to point to a clear hook, context, insight, expansion, implication, and closing by the time the draft is finished.' : ''}
${normalizedTemplateName === 'minimal thesis' ? '- For the Minimal Thesis template: the writing must feel like original thinking, not curated recap. Build the argument through first-principles reasoning, one reusable mental model, and a memorable perspective shift.\n- The hook must carry real tension, the insight must explain the mechanism, and the closing synthesis must feel quotable and complete.\n- Include at least one concrete example, recognizable pattern, or grounded scenario so the insight does not stay abstract.\n- The quote block should sharpen the thesis with a line worth saving, not filler commentary.' : ''}
${normalizedTemplateName === 'minimal thesis' ? '- Keep the six core insight-letter sections visibly intact: Hook, Context, Insight, Expansion, Implication, and Closing.\n- Key Insights, callout, quote, and summary must all be filled with distinct, extractable value so the structure feels complete and GEO-ready.' : ''}
${normalizedTemplateName === 'split-screen insight' ? '- For the Split-Screen Insight template: make the contrast between the surface story and the deeper reality unmistakably clear and genuinely useful.\n- The surface story should sound plausible and familiar, while the deeper reality must reveal a hidden mechanism, second-order effect, or better lens.\n- The framing callout, quote block, and summary must each be strong enough to stand alone in GEO extraction, inbox previews, and AI answers.\n- The insight and implication sections should translate that contrast into a reusable mental model and a practical shift for the reader.\n- Add one grounded example or observed pattern that proves why the deeper reality is more useful than the surface story, so the draft has real body depth.' : ''}

## QUALITY STANDARDS
- Thought leadership tone: analytical, evidence-based, never promotional
- Concrete examples, data points, practitioner implications, and implementation detail
- Each paragraph block must feel complete and substantial, not like notes or an outline
- Narrative flow: each section should logically lead to the next
- No hallucination: reason from first principles if data is unavailable

## OUTPUT FORMAT
${buildTemplateOutputSchema(template)}

The "blocks" array MUST have exactly ${template.length} entries, one per template block, in order.`;

  return wrapWithCompanyEnforcement(base, `${contentType} template`, companyIdentity);
}

/**
 * Parse the AI output and merge it back into the template structure.
 */
export function parseTemplateOutput(
  raw: any,
  template: ContentBlock[],
): (BlogGenerationOutput & { content_blocks: ContentBlock[] }) | null {
  if (!raw || typeof raw !== 'object') return null;

  // Flexible key detection: AI might use "blocks", "template_blocks", "filled_blocks", "content_blocks"
  const blocksArr = raw.blocks ?? raw.template_blocks ?? raw.filled_blocks ?? raw.content_blocks ?? raw.content;
  const title = raw.title || raw.seo_meta_title || 'Untitled';

  if (!Array.isArray(blocksArr)) {
    console.error('[parseTemplateOutput] No blocks array found. Keys:', Object.keys(raw));
    return null;
  }

  const filledBlocks: ContentBlock[] = [];

  for (let i = 0; i < template.length; i++) {
    const tplBlock = template[i];
    const aiBlock = blocksArr[i] || {};

    filledBlocks.push(mergeBlockContent(tplBlock, aiBlock));
  }

  const topLevelKeyInsights = Array.isArray(raw.key_insights)
    ? raw.key_insights
        .map((item: unknown) => String(item ?? '').trim())
        .filter(Boolean)
    : [];
  const topLevelReferences = Array.isArray(raw.references)
    ? raw.references
    : Array.isArray(raw.sources)
    ? raw.sources
    : [];
  const fallbackSummary =
    typeof raw.summary === 'string' ? raw.summary.trim() :
    typeof raw.excerpt === 'string' ? raw.excerpt.trim() :
    '';

  const normalizedBlocks = filledBlocks.map((block) => {
    if (block.type === 'key_insights') {
      const hasFilledItems = block.items.some((item) => item.trim().length > 0);
      if (!hasFilledItems && topLevelKeyInsights.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => topLevelKeyInsights[index] ?? ''),
        };
      }
    }

    if (block.type === 'summary' && block.body.trim().length === 0 && fallbackSummary) {
      return {
        ...block,
        body: fallbackSummary,
      };
    }

    if (block.type === 'references') {
      const hasFilledRefs = block.items.some((item) => item.title.trim().length > 0 || item.url.trim().length > 0);
      if (!hasFilledRefs && topLevelReferences.length > 0) {
        return {
          ...block,
          items: block.items.map((existing, index) => {
            const ref = topLevelReferences[index];
            if (!ref) return existing;
            if (typeof ref === 'string') {
              return { ...existing, title: ref.trim(), url: '' };
            }
            return {
              ...existing,
              title: String(ref?.title ?? ref?.text ?? '').trim(),
              url: String(ref?.url ?? ref?.href ?? '').trim(),
            };
          }),
        };
      }
    }

    return block;
  });

  return {
    title,
    excerpt:              raw.excerpt || '',
    content_html:         '', // not used for template path
    tags:                 Array.isArray(raw.tags) ? raw.tags : [],
    category:             raw.category || '',
    seo_meta_title:       raw.seo_meta_title || '',
    seo_meta_description: raw.seo_meta_description || '',
    key_insights:         Array.isArray(raw.key_insights) ? raw.key_insights : [],
    content_blocks:       normalizedBlocks,
  };
}

function normalizeParagraphHtml(aiData: any): string {
  const rawHtml = typeof aiData?.html === 'string' ? aiData.html.trim() : '';
  if (rawHtml) return rawHtml;

  const rawTextCandidate =
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.content === 'string' ? aiData.content :
    typeof aiData?.value === 'string' ? aiData.value :
    '';

  const rawText = rawTextCandidate.trim();
  if (!rawText) return '<p></p>';

  if (/<p[\s>]/i.test(rawText)) return rawText;

  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((part: string) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs.map((part: string) => `<p>${part}</p>`).join('');
}

function normalizeHeadingText(aiData: any): string {
  const value =
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.title === 'string' ? aiData.title :
    typeof aiData?.heading === 'string' ? aiData.heading :
    typeof aiData?.label === 'string' ? aiData.label :
    '';
  return value.trim();
}

function fallbackHeadingFromHint(tplBlock: ContentBlock): string {
  const hint = typeof (tplBlock as any)?.hint === 'string' ? (tplBlock as any).hint.trim() : '';
  if (!hint) return '';

  const beforeDash = hint.split(/[-—–]/)[0]?.trim() ?? '';
  const candidate = (beforeDash || hint)
    .replace(/^write\s+/i, '')
    .replace(/^add\s+/i, '')
    .replace(/^create\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!candidate) return '';
  return candidate.length <= 80 ? candidate : candidate.slice(0, 77).trimEnd();
}

function normalizeSummaryBody(aiData: any): string {
  const value =
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.content === 'string' ? aiData.content :
    '';
  return value.trim();
}

function mergeBlockContent(tplBlock: ContentBlock, aiData: any): ContentBlock {
  const { hint: _hint, ...rest } = tplBlock as any; // strip hint
  switch (tplBlock.type) {
    case 'paragraph':
      return { ...rest, html: normalizeParagraphHtml(aiData) };
    case 'heading':
      return {
        ...rest,
        text: typeof tplBlock.text === 'string' && tplBlock.text.trim().length > 0
          ? tplBlock.text
          : (normalizeHeadingText(aiData) || fallbackHeadingFromHint(tplBlock)),
        anchor: '',
      };
    case 'key_insights':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((item: any) => String(typeof item === 'string' ? item : item?.text || '').trim())
          : Array.isArray(aiData.points)
          ? aiData.points.map((item: any) => String(item ?? '').trim())
          : tplBlock.items,
      };
    case 'callout':
      return {
        ...rest,
        title: typeof aiData?.title === 'string' ? aiData.title : '',
        body: typeof aiData?.body === 'string'
          ? aiData.body
          : typeof aiData?.text === 'string'
          ? aiData.text
          : '',
      };
    case 'quote':
      return {
        ...rest,
        text: typeof aiData?.text === 'string' ? aiData.text : typeof aiData?.quote === 'string' ? aiData.quote : '',
        author: typeof aiData?.author === 'string' ? aiData.author : '',
        source: typeof aiData?.source === 'string' ? aiData.source : '',
      };
    case 'image':
      return {
        ...rest,
        url: typeof aiData?.url === 'string' ? aiData.url : rest.url || '',
        alt: typeof aiData?.alt === 'string'
          ? aiData.alt
          : typeof aiData?.caption === 'string'
          ? aiData.caption
          : '',
        caption: typeof aiData?.caption === 'string' ? aiData.caption : '',
      };
    case 'list':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((item: any) => ({
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              text: typeof item === 'string' ? item : item?.text || '',
              children: item?.children,
            }))
          : tplBlock.items,
      };
    case 'summary':
      return { ...rest, body: normalizeSummaryBody(aiData) };
    case 'references':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((ref: any) => ({
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              title: typeof ref === 'string' ? ref : ref?.title || ref?.text || '',
              url: typeof ref === 'string' ? '' : ref?.url || ref?.href || '',
            }))
          : tplBlock.items,
      };
    case 'divider':
      return { ...rest };
    case 'columns': {
      const aiCols = Array.isArray(aiData?.columns)
        ? aiData.columns
        : Array.isArray(aiData)
        ? aiData
        : [];
      return {
        ...rest,
        columns: tplBlock.columns.map((tplCol, ci) => {
          const aiCol = aiCols[ci] || {};
          const aiInnerBlocks = Array.isArray(aiCol?.blocks)
            ? aiCol.blocks
            : Array.isArray(aiCol)
            ? aiCol
            : [];
          return {
            ...tplCol,
            blocks: tplCol.blocks.map((innerTpl, bi) =>
              mergeBlockContent(innerTpl, aiInnerBlocks[bi] || {}),
            ),
          };
        }),
      };
    }
    default:
      return { ...rest };
  }
}
