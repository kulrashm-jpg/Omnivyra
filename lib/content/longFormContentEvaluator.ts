import { contentTypeConfig, type LongFormContentType } from './longFormContentTypeConfig';
import {
  buildSerpStructureHints,
  classifySearchIntent,
  expandTopicEntities,
  type SearchIntent,
  type TopicEntityMap,
} from './longFormSeoIntelligence';

export interface LongFormContentEvaluationInput {
  generatedContent: string;
  topic: string;
  contentType: LongFormContentType;
  targetIntent?: SearchIntent | string | null;
  engineTrace?: Record<string, any> | null;
}

export interface SimulatedCompetitorArticle {
  name: string;
  structure: string[];
  strengths: string[];
  weaknesses: string[];
}

export interface ScoreBreakdown {
  seo: {
    keywordCoverage: number;
    entityDepth: number;
    headingStructure: number;
    internalLinkingReadiness: number;
    topicalCompleteness: number;
    overall: number;
  };
  aeo: {
    directAnswers: number;
    conciseExtractability: number;
    faqQuality: number;
    snippetReadiness: number;
    overall: number;
  };
  geo: {
    originalFrameworks: number;
    insightOriginality: number;
    brandVoiceStrength: number;
    citationLikelihood: number;
    overall: number;
  };
  differentiation: {
    avoidsGenericPatterns: number;
    uniqueAngle: number;
    hookEffectiveness: number;
    competitiveGapCoverage: number;
    overall: number;
  };
  humanQuality: {
    clarity: number;
    depth: number;
    usefulness: number;
    authority: number;
  };
}

export interface ContentWeaknesses {
  repetitiveSections: string[];
  shallowAreas: string[];
  genericStatements: string[];
  missingExamplesOrProof: string[];
}

export interface LongFormContentEvaluationResult {
  competitorSimulation: SimulatedCompetitorArticle[];
  comparativeAnalysis: {
    outperforms: string[];
    fallsShort: string[];
  };
  scoreBreakdown: ScoreBreakdown;
  weaknesses: ContentWeaknesses;
  improvementRecommendations: string[];
  finalScorecard: {
    seoScore: number;
    aeoScore: number;
    geoScore: number;
    differentiationScore: number;
    clarity: number;
    depth: number;
    usefulness: number;
    authority: number;
  };
}

const GENERIC_PHRASES = [
  'in today\'s fast-paced world',
  'in today\'s digital landscape',
  'it is important to',
  'businesses need to',
  'game changer',
  'unlock the power',
  'take your business to the next level',
  'more than ever',
];

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp10(value: number): number {
  return Math.max(1, Math.min(10, Number(value.toFixed(1))));
}

function average(values: number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + ((text.match(pattern) || []).length), 0);
}

function extractHeadings(content: string): string[] {
  const headings = Array.from(content.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
  if (headings.length > 0) return headings;
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,4}\s+/.test(line))
    .map((line) => line.replace(/^#{1,4}\s+/, '').trim());
}

function splitSections(content: string): Array<{ title: string; text: string }> {
  const headingMatches = Array.from(content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi));
  if (headingMatches.length === 0) {
    return [{ title: 'Full content', text: stripHtml(content) }];
  }
  return headingMatches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const next = headingMatches[index + 1]?.index ?? content.length;
    return {
      title: stripHtml(match[1]) || `Section ${index + 1}`,
      text: stripHtml(content.slice(start, next)),
    };
  }).filter((section) => section.text.length > 0);
}

function containsEntity(text: string, entity: string): boolean {
  const normalizedText = normalize(text);
  const normalizedEntity = normalize(entity);
  if (!normalizedEntity) return false;
  if (normalizedText.includes(normalizedEntity)) return true;
  const tokens = normalizedEntity.split(/\s+/).filter((token) => token.length > 3);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function simulateCompetitors(topic: string, intent: SearchIntent): SimulatedCompetitorArticle[] {
  const serpHints = buildSerpStructureHints(intent);
  return [
    {
      name: 'Competitor 1: exhaustive search-first guide',
      structure: ['Definition', 'Why it matters', ...serpHints.requiredStructures, 'FAQ', 'Conclusion'],
      strengths: ['Broad keyword coverage', 'Clear heading hierarchy', 'Strong FAQ coverage', 'Matches common search intent tightly'],
      weaknesses: ['Often generic', 'Limited original POV', 'Examples are usually broad', 'Frameworks are borrowed rather than named'],
    },
    {
      name: 'Competitor 2: practitioner playbook',
      structure: ['Problem framing', 'Step-by-step process', 'Examples', 'Mistakes', 'Templates/checklists'],
      strengths: ['High usefulness', 'Concrete implementation guidance', 'Strong examples', 'Good dwell-time potential'],
      weaknesses: ['May under-serve definitions', 'Often weaker for snippet extraction', 'Can miss semantic entity breadth'],
    },
    {
      name: intent === 'comparison' ? 'Competitor 3: comparison table article' : 'Competitor 3: opinion-led thought leadership article',
      structure: intent === 'comparison'
        ? ['Decision criteria', 'Comparison table', 'Pros and cons', 'Scenario verdict', 'FAQ']
        : ['Contrarian hook', 'Market context', 'Opinionated argument', 'Evidence/examples', 'Implications'],
      strengths: ['Strong angle', 'More memorable than generic guides', 'Good link/citation potential if evidence is strong'],
      weaknesses: ['Can be incomplete', 'May sacrifice search coverage', 'Often lacks balanced proof or internal linking structure'],
    },
  ];
}

function scoreSeo(input: LongFormContentEvaluationInput, text: string, headings: string[], entityMap: TopicEntityMap): ScoreBreakdown['seo'] {
  const allEntities = [
    entityMap.primaryTopic,
    ...entityMap.relatedEntities,
    ...entityMap.subtopics,
    ...entityMap.semanticVariations,
  ].filter(Boolean);
  const entityHits = allEntities.filter((entity) => containsEntity(text, entity)).length;
  const keywordCoverage = containsEntity(text, input.topic) ? 8.5 : 4.5;
  const entityDepth = clamp10(2 + (entityHits / Math.max(1, allEntities.length)) * 8);
  const headingStructure = clamp10(headings.length >= 5 ? 8.5 : headings.length >= 3 ? 7 : 4.5);
  const internalLinkingReadiness = /href=|https?:\/\/|\/blog\/|\/guides\//i.test(input.generatedContent) ? 8 : 5;
  const requiredCoverage = ['what', 'how', 'why', 'example'];
  const coverageHits = requiredCoverage.filter((term) => normalize(text).includes(term)).length;
  const topicalCompleteness = clamp10(3 + coverageHits * 1.3 + Math.min(3, headings.length * 0.35));
  return {
    keywordCoverage: clamp10(keywordCoverage),
    entityDepth,
    headingStructure,
    internalLinkingReadiness: clamp10(internalLinkingReadiness),
    topicalCompleteness,
    overall: clamp10(average([keywordCoverage, entityDepth, headingStructure, internalLinkingReadiness, topicalCompleteness])),
  };
}

function scoreAeo(content: string, text: string): ScoreBreakdown['aeo'] {
  const faqCount = countMatches(content.toLowerCase(), [/<h3[^>]*>[\s\S]*?\?/gi, /\bfaq\b/g]);
  const directAnswerCount = countMatches(content.toLowerCase(), [/direct answer/g, /what is /g, /how to /g]);
  const shortParagraphs = (content.match(/<p[^>]*>([\s\S]{40,260}?)<\/p>/gi) || []).length;
  const directAnswers = clamp10(2 + Math.min(8, directAnswerCount * 2.3));
  const conciseExtractability = clamp10(3 + Math.min(7, shortParagraphs * 0.6));
  const faqQuality = clamp10(faqCount >= 5 ? 8.5 : faqCount >= 3 ? 7 : faqCount >= 1 ? 5 : 2.5);
  const snippetReadiness = clamp10(2 + Math.min(8, countMatches(text.toLowerCase(), [/what /g, /how /g, /why /g, /steps?/g]) * 0.8));
  return {
    directAnswers,
    conciseExtractability,
    faqQuality,
    snippetReadiness,
    overall: clamp10(average([directAnswers, conciseExtractability, faqQuality, snippetReadiness])),
  };
}

function scoreGeo(input: LongFormContentEvaluationInput, text: string): ScoreBreakdown['geo'] {
  const traceFramework = input.engineTrace?.contentPlan?.framework?.name || input.engineTrace?.contentPlan?.framework;
  const frameworkSignals = countMatches(text.toLowerCase(), [/framework/g, /model/g, /matrix/g, /system/g, /layers/g]);
  const originalFrameworks = clamp10(traceFramework || frameworkSignals >= 2 ? 8 : frameworkSignals === 1 ? 6 : 3);
  const insightSignals = countMatches(text.toLowerCase(), [/common assumption/g, /most teams/g, /counterintuitive/g, /non-obvious/g, /instead/g, /tradeoff/g]);
  const insightOriginality = clamp10(3 + Math.min(7, insightSignals * 1.2));
  const brandSignals = input.engineTrace?.contentPositioning || input.engineTrace?.differentiationStrategy || input.engineTrace?.performanceInsights;
  const brandVoiceStrength = clamp10(brandSignals ? 7.5 : countMatches(text.toLowerCase(), [/we believe/g, /our view/g, /point of view/g]) > 0 ? 6 : 4);
  const proofSignals = countMatches(text.toLowerCase(), [/for example/g, /case study/g, /according to/g, /data/g, /benchmark/g, /research/g]);
  const citationLikelihood = clamp10(3 + Math.min(7, frameworkSignals + proofSignals * 0.8 + insightSignals * 0.5));
  return {
    originalFrameworks,
    insightOriginality,
    brandVoiceStrength,
    citationLikelihood,
    overall: clamp10(average([originalFrameworks, insightOriginality, brandVoiceStrength, citationLikelihood])),
  };
}

function scoreDifferentiation(input: LongFormContentEvaluationInput, text: string, sections: Array<{ title: string; text: string }>): ScoreBreakdown['differentiation'] {
  const genericHits = GENERIC_PHRASES.filter((phrase) => text.toLowerCase().includes(phrase)).length;
  const avoidsGenericPatterns = clamp10(9 - genericHits * 1.8);
  const positioning = input.engineTrace?.contentPositioning;
  const uniqueAngle = clamp10(positioning ? 8 : countMatches(text.toLowerCase(), [/contrarian/g, /instead/g, /tradeoff/g, /decision criteria/g]) >= 2 ? 7 : 4.5);
  const intro = sections[0]?.text || text.slice(0, 600);
  const hookEffectiveness = clamp10(/wrong|miss|trap|cost|tension|instead|criteria|model|framework/i.test(intro) ? 8 : 4.5);
  const gapSignals = countMatches(text.toLowerCase(), [/failure mode/g, /decision criteria/g, /example/g, /framework/g, /tradeoff/g]);
  const competitiveGapCoverage = clamp10(3 + Math.min(7, gapSignals * 0.9));
  return {
    avoidsGenericPatterns,
    uniqueAngle,
    hookEffectiveness,
    competitiveGapCoverage,
    overall: clamp10(average([avoidsGenericPatterns, uniqueAngle, hookEffectiveness, competitiveGapCoverage])),
  };
}

function scoreHumanQuality(text: string, sections: Array<{ title: string; text: string }>): ScoreBreakdown['humanQuality'] {
  const words = text.split(/\s+/).filter(Boolean);
  const avgSectionWords = words.length / Math.max(1, sections.length);
  const examples = countMatches(text.toLowerCase(), [/for example/g, /use case/g, /scenario/g, /case study/g]);
  const proof = countMatches(text.toLowerCase(), [/data/g, /research/g, /benchmark/g, /according to/g, /percent/g, /%/g]);
  return {
    clarity: clamp10(avgSectionWords <= 450 ? 8 : avgSectionWords <= 700 ? 6.5 : 5),
    depth: clamp10(3 + Math.min(7, words.length / 300 + examples * 0.8 + proof * 0.8)),
    usefulness: clamp10(3 + Math.min(7, countMatches(text.toLowerCase(), [/step/g, /checklist/g, /how to/g, /apply/g, /example/g]) * 0.9)),
    authority: clamp10(3 + Math.min(7, proof * 1.1 + countMatches(text.toLowerCase(), [/framework/g, /criteria/g, /model/g]) * 0.8)),
  };
}

function detectWeaknesses(content: string, text: string, sections: Array<{ title: string; text: string }>): ContentWeaknesses {
  const repetitiveSections: string[] = [];
  const seenTokens = new Map<string, string>();
  for (const section of sections) {
    const tokens = new Set(normalize(section.text).split(/\s+/).filter((token) => token.length > 5));
    const signature = Array.from(tokens).slice(0, 20).join(' ');
    for (const [title, prior] of seenTokens.entries()) {
      const overlap = signature.split(/\s+/).filter((token) => prior.includes(token)).length;
      if (overlap >= 12) repetitiveSections.push(`${section.title} repeats concepts from ${title}`);
    }
    seenTokens.set(section.title, signature);
  }
  const shallowAreas = sections
    .filter((section) => section.text.split(/\s+/).length < 90)
    .map((section) => `${section.title} is underdeveloped`);
  const genericStatements = GENERIC_PHRASES.filter((phrase) => text.toLowerCase().includes(phrase));
  const missingExamplesOrProof: string[] = [];
  if (!/for example|use case|scenario|case study/i.test(text)) missingExamplesOrProof.push('No concrete examples or use cases detected');
  if (!/data|research|benchmark|according to|%|percent/i.test(text)) missingExamplesOrProof.push('No data, benchmark, or referenced proof detected');
  if (!/href=|https?:\/\//i.test(content)) missingExamplesOrProof.push('No external references or source links detected');
  return { repetitiveSections, shallowAreas, genericStatements, missingExamplesOrProof };
}

function buildComparativeAnalysis(scores: ScoreBreakdown, weaknesses: ContentWeaknesses): LongFormContentEvaluationResult['comparativeAnalysis'] {
  const outperforms: string[] = [];
  const fallsShort: string[] = [];
  if (scores.geo.originalFrameworks >= 7) outperforms.push('Stronger original framework signal than generic SERP guides.');
  if (scores.differentiation.uniqueAngle >= 7) outperforms.push('Clearer positioning and angle than standard definition-led articles.');
  if (scores.aeo.faqQuality >= 7) outperforms.push('Better answer extraction surface than opinion-led competitors.');
  if (scores.humanQuality.usefulness >= 7) outperforms.push('More actionable than broad thought-leadership pieces.');
  if (scores.seo.entityDepth < 7) fallsShort.push('Entity coverage is likely thinner than exhaustive search-first guides.');
  if (scores.seo.internalLinkingReadiness < 7) fallsShort.push('Internal/external linking readiness is weaker than mature ranking pages.');
  if (weaknesses.missingExamplesOrProof.length > 0) fallsShort.push('Proof density is weaker than strong practitioner or research-led competitors.');
  if (scores.aeo.directAnswers < 7) fallsShort.push('Direct answer formatting is not strong enough for consistent snippet selection.');
  return { outperforms, fallsShort };
}

function buildRecommendations(scores: ScoreBreakdown, weaknesses: ContentWeaknesses): string[] {
  const recommendations: string[] = [];
  if (scores.seo.entityDepth < 8) recommendations.push('System: require entity coverage mapping per section and fail validation when any major entity cluster is unused.');
  if (scores.aeo.directAnswers < 8 || scores.aeo.faqQuality < 8) recommendations.push('System: force 2-3 direct-answer blocks and 4-6 FAQ items with answers under 45 words for SEO-driven content.');
  if (scores.geo.citationLikelihood < 8) recommendations.push('System: add an evidence planner that requires real examples, sourced claims, or explicit “no source available” handling before final assembly.');
  if (scores.differentiation.hookEffectiveness < 8) recommendations.push('System: add a hook repair pass that rejects broad market openers and requires tension, contrast, or a decision trap in the first section.');
  if (weaknesses.repetitiveSections.length > 0) recommendations.push('System: raise section-level uniqueness thresholds and regenerate only sections with high conceptual overlap.');
  if (scores.humanQuality.usefulness < 8) recommendations.push('System: require each non-intro section to include an application step, example, decision criterion, or failure mode.');
  if (recommendations.length < 5) recommendations.push('System: compare final output against simulated competitor structures and explicitly fill at least two competitor gaps before scoring passes.');
  if (recommendations.length < 5) recommendations.push('System: expose score deltas in engine_trace so future performance learning can correlate scores with real rankings and engagement.');
  if (recommendations.length < 5) recommendations.push('System: store evaluator weaknesses alongside generated feature snapshots so re-optimization can target the exact missing proof, entity, or AEO surface.');
  return recommendations.slice(0, 5);
}

export function evaluateLongFormContent(input: LongFormContentEvaluationInput): LongFormContentEvaluationResult {
  const intent = (input.targetIntent || input.engineTrace?.searchIntent || classifySearchIntent({
    topic: input.topic,
    contentType: input.contentType,
    intent: undefined,
  })) as SearchIntent;
  const text = stripHtml(input.generatedContent);
  const headings = extractHeadings(input.generatedContent);
  const sections = splitSections(input.generatedContent);
  const entityMap = input.engineTrace?.topicEntityMap || expandTopicEntities({
    topic: input.topic,
    contentType: input.contentType,
  });
  const competitorSimulation = simulateCompetitors(input.topic, intent);
  const seo = scoreSeo(input, text, headings, entityMap);
  const aeo = scoreAeo(input.generatedContent, text);
  const geo = scoreGeo(input, text);
  const differentiation = scoreDifferentiation(input, text, sections);
  const humanQuality = scoreHumanQuality(text, sections);
  const weaknesses = detectWeaknesses(input.generatedContent, text, sections);
  const scoreBreakdown: ScoreBreakdown = { seo, aeo, geo, differentiation, humanQuality };
  const comparativeAnalysis = buildComparativeAnalysis(scoreBreakdown, weaknesses);
  return {
    competitorSimulation,
    comparativeAnalysis,
    scoreBreakdown,
    weaknesses,
    improvementRecommendations: buildRecommendations(scoreBreakdown, weaknesses),
    finalScorecard: {
      seoScore: seo.overall,
      aeoScore: aeo.overall,
      geoScore: geo.overall,
      differentiationScore: differentiation.overall,
      clarity: humanQuality.clarity,
      depth: humanQuality.depth,
      usefulness: humanQuality.usefulness,
      authority: humanQuality.authority,
    },
  };
}
