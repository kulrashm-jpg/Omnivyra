/**
 * refinementPrompts.ts — AI prompt builders and evidence cleaning helpers
 * used during the company profile refinement pipeline.
 */

import { runCompletionWithOperation } from '../aiGateway';
import { CompanyProfile, CompanyProfileExtractionOutput, EntityArchetypeIntelligence } from './types';
import { buildArchetypePromptContext, isAudienceLedArchetype, isArchetypeInfluential } from './entityArchetype';

export const cleanEvidenceWithAi = async (
  companyId: string | null,
  summaries: Array<{ label: string; url: string; summary: string }>
): Promise<Array<{ label: string; url: string; summary: string }>> => {
  if (summaries.length === 0) return [];
  const systemPrompt = 'You are a business content cleaner. Return JSON only. No prose.';
  const userPrompt =
    'From the text below, remove:' +
    '\n- any lines containing "_next/static"' +
    '\n- any .css, .js, .map content' +
    '\n- UI animation text (e.g., "Card flips automatically", "click here", "hover", "menu")' +
    '\n- navigation/footer text' +
    '\n- repeated slogans' +
    '\n\nKeep ONLY:' +
    '\n- about/company descriptions' +
    '\n- mission or vision statements' +
    '\n- product & service descriptions' +
    '\n- blog topics or headings' +
    '\n- social profile bio text' +
    '\n- references to locations, industries, users, or competitors' +
    '\n\nReturn only clean business evidence as JSON.' +
    '\n\nText:\n' +
    JSON.stringify(summaries);

  const result = await runCompletionWithOperation({
    companyId,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'profileEnrichment',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = result.output?.trim() || '{}';
  const parsed = JSON.parse(raw);
  const cleaned = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.evidence) ? parsed.evidence : [];
  const deduped = new Map<string, { label: string; url: string; summary: string }>();
  cleaned.forEach((entry: any) => {
    if (!entry?.summary || !entry?.url) return;
    deduped.set(`${entry.url}:${entry.summary}`, entry);
  });
  return Array.from(deduped.values());
};

export const buildExtractionPrompt = (
  cleanedEvidence: Array<{ label: string; url: string; summary: string }>,
  _currentProfile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
) => {
  const archetypeContext = buildArchetypePromptContext(archetype);
  const audienceLedGuidance = isAudienceLedArchetype(archetype)
    ? '\nArchetype guidance:\n' +
      '- This entity appears audience-led, creator-led, thought-led, media-led, community-led, or hybrid.\n' +
      '- Interpret "products/services" broadly as offers, formats, education products, advisory work, community access, media properties, tools, or recurring value surfaces.\n' +
      '- Do not force SaaS-style positioning, rigid transactional funnels, or buyer-only ICP language when evidence points to readers, subscribers, learners, followers, members, or operators.\n' +
      '- Preserve worldview, educational focus, audience relationship, and authority signals as useful profile context.\n'
    : '';
  const conservativeGuidance = archetype && !isArchetypeInfluential(archetype)
    ? '\nArchetype guidance: low confidence. Stay close to conventional company extraction and do not over-adapt.\n'
    : '';
  const systemPrompt =
    'You are a Company Profile Extraction Engine.\n\n' +
    'Extract structured business facts from the provided evidence (website + social profiles).\n\n' +
    'Rules:\n' +
    '- Ignore CSS, JS, UI text, animations, navigation, and layout artifacts.\n' +
    '- Use only meaningful business content.\n' +
    '- Do not invent facts.\n' +
    '- Support multiple values for industry, geography, competitors, and content themes.\n' +
    '- If evidence exists, always return concrete values.\n' +
    '- If evidence is insufficient, return null with source="missing".\n\n' +
    'For each field return:\n' +
    '{ values: string[] | string | null, source: "website" | "social" | "inferred" | "missing", confidence: "High" | "Medium" | "Low" }\n\n' +
    'Output must be structured JSON only. No commentary.' +
    (archetypeContext ? `\n\nENTITY ARCHETYPE CONTEXT:\n${archetypeContext}` : '') +
    audienceLedGuidance +
    conservativeGuidance;

  const userPrompt =
    'Extract a structured Company Profile from the evidence below.\n\n' +
    'For each field return:\n' +
    '- values: string[] (or null)\n' +
    '- source: "website" | "social" | "inferred" | "missing"\n' +
    '- confidence: "High" | "Medium" | "Low"\n\n' +
    'Fields:\n' +
    '- company_name\n- industry_list\n- category_list\n- geography_list\n' +
    '- products_services\n- target_audience\n- brand_voice\n- goals\n' +
    '- competitors_list\n- unique_value_proposition\n- content_themes_list\n- website_url\n' +
    '- social_profiles (object with linkedin, facebook, instagram, x, youtube, tiktok, reddit, pinterest, whatsapp, blog)\n\n' +
    'Important:\n' +
    '- category_list should reflect what the company does (product/service categories), not just industry.\n' +
    '- Prefer 3-7 concise categories when evidence supports it.\n' +
    '- Use website headings, product/service sections, and positioning statements to infer categories.\n' +
    '- Avoid overly generic categories like "technology" unless explicitly stated.\n' +
    '- industry_list, category_list, geography_list, competitors_list, content_themes_list must be arrays.\n' +
    '- Do not return empty arrays if evidence exists.\n' +
    '- If multiple industries or geographies apply, include all.\n\n' +
    (archetypeContext ? `Entity archetype context:\n${archetypeContext}\n\n` : '') +
    'Evidence:\n' +
    JSON.stringify(cleanedEvidence);

  return { systemPrompt, userPrompt };
};

type MissingFieldQuestion = {
  field?: unknown;
  question?: unknown;
  options?: unknown;
  allow_multiple?: unknown;
};

const ALLOWED_MISSING_QUESTION_FIELDS = [
  'industry',
  'category',
  'categories',
  'geography',
  'geographic',
  'geographical',
  'target_audience',
  'brand_voice',
  'goals',
  'unique_value',
  'unique_value_proposition',
  'content_themes',
  'products_services',
];

const BLOCKED_MISSING_QUESTION_TOKENS = [
  'competitor',
  'competitors',
  'social',
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'tiktok',
  'reddit',
  'blog',
  'website',
  'url',
  'link',
];

const normalizeQuestionKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isAllowedMissingFieldQuestion = (entry: MissingFieldQuestion) => {
  const field = typeof entry.field === 'string' ? entry.field : '';
  const question = typeof entry.question === 'string' ? entry.question : '';
  if (!field || !question) return false;

  const normalized = normalizeQuestionKey(`${field} ${question}`);
  if (BLOCKED_MISSING_QUESTION_TOKENS.some((token) => normalized.includes(token))) {
    return false;
  }

  return ALLOWED_MISSING_QUESTION_FIELDS.some((fieldKey) =>
    normalized.includes(normalizeQuestionKey(fieldKey))
  );
};

const sanitizeMissingFieldQuestion = (entry: MissingFieldQuestion) => ({
  field: String(entry.field || '').trim(),
  question: String(entry.question || '').trim(),
  options: Array.isArray(entry.options)
    ? entry.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 8)
    : [],
  allow_multiple: Boolean(entry.allow_multiple),
});

export const generateMissingFieldQuestions = async (
  companyId: string | null,
  extraction: CompanyProfileExtractionOutput
): Promise<Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>> => {
  const systemPrompt =
    'From the Company Profile output and missing_fields list, generate a user questionnaire. ' +
    'For each missing or low-confidence field: write a clear question, provide dropdown-style options, ' +
    'allow multiple selections where relevant. Return JSON array only.\n\n' +
    'Do NOT generate questions for competitors, competitor names, social profile accounts, website URLs, ' +
    'blog presence, or link availability. Those are captured by dedicated fields or the competitor engine. ' +
    'Only ask questions that map directly to the allowed profile fields.';

  const userPrompt = JSON.stringify({
    extraction,
    missing_fields: extraction.missing_fields || [],
    fields_to_cover: [
      'industry', 'category', 'geography', 'target_audience', 'brand_voice',
      'goals', 'unique_value_proposition', 'content_themes', 'products_services',
    ],
    blocked_fields: [
      'competitors',
      'social_profiles',
      'linkedin_url',
      'facebook_url',
      'instagram_url',
      'x_url',
      'youtube_url',
      'tiktok_url',
      'reddit_url',
      'pinterest_url',
      'whatsapp_url',
      'blog_url',
      'website_url',
    ],
    format: [
      {
        field: 'Industry',
        question: 'What industry best describes your company?',
        options: ['AI', 'SaaS', 'Wellness', 'Education', 'Finance', 'Other'],
        allow_multiple: true,
      },
    ],
  });

  const result = await runCompletionWithOperation({
    companyId,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'profileEnrichment',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = result.output?.trim() || '{}';
  const parsed = JSON.parse(raw);
  const questions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
  return questions
    .filter(isAllowedMissingFieldQuestion)
    .map(sanitizeMissingFieldQuestion)
    .filter((question) => question.options.length > 0)
    .slice(0, 8);
};
