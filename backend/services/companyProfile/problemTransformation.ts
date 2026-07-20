import { runCompletionWithOperation } from '../aiGateway';
import { parseModelOutput } from '../ai/safety';
import {
  CompanyProfile,
  EntityArchetypeIntelligence,
  ProblemTransformationQuestionsResult,
  ProblemTransformationRefinedOutput,
  ProblemTransformationExistingFields,
  ProblemTransformationPromptResult,
} from './types';
import { PROBLEM_TRANSFORMATION_FIELD_NAMES } from './fieldConstants';
import { buildArchetypePromptContext } from './entityArchetype';
import {
  buildGroundedDifferentiationSignal,
  buildStructuredCompetitorDimensionBlock,
  shouldUseAudienceLedSynthesis,
  validateAudienceLedGrounding,
} from './competitorSynthesis';
import { buildUserGuidanceContextBlock } from './userGuidance';

export function buildProblemTransformationQuestions(): ProblemTransformationQuestionsResult {
  return {
    section: 'problem_transformation_intelligence',
    questions: [
      'What core problem do your customers face?',
      'What symptoms show this problem exists?',
      'What do customers usually misunderstand about this problem?',
      'What happens if this problem is not solved?',
      'Describe customer life BEFORE your solution.',
      'Describe customer life AFTER your solution.',
      'What transformation does your solution create?',
      'How does your company uniquely create this transformation?',
      'In which domains is your company an authority?',
    ],
  };
}

const PROBLEM_TRANSFORMATION_QUESTIONS = buildProblemTransformationQuestions().questions;

const PT_FIELD_NAMES = [
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'life_with_problem',
  'life_after_solution',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
] as const;

/** Strategic prompt builder: THINK → ANALYZE → STRUCTURE → OUTPUT */
export function buildProblemTransformationStrategicPrompt(
  mode: 'fill' | 'refine',
  profile: CompanyProfile | null,
  existingFields: ProblemTransformationExistingFields & { qaPairs?: Array<{ question: string; answer: string }> },
  archetype?: EntityArchetypeIntelligence | null,
): ProblemTransformationPromptResult {
  const effectiveArchetype = archetype ?? profile?.report_settings?.entity_archetype ?? null;
  const thinkFlow =
    'Follow this reasoning flow: THINK (absorb context) → ANALYZE (identify gaps/weaknesses) → STRUCTURE (organize) → OUTPUT (strict JSON only).';

  const archetypeContext = buildArchetypePromptContext(effectiveArchetype);
  const audienceLed = shouldUseAudienceLedSynthesis(effectiveArchetype, profile?.report_settings?.competitor_intelligence ?? null);
  const competitorIntelligence = audienceLed
    ? buildStructuredCompetitorDimensionBlock(profile?.report_settings?.competitor_intelligence ?? null)
    : '';
  const userGuidanceContext = buildUserGuidanceContextBlock(profile);
  const archetypeInstruction = audienceLed
    ? 'For this audience-led/entity-led profile, interpret customers as audience/readers/members/learners/subscribers/operators when the evidence supports it. Treat the solution as the mix of offers, media, education, advisory, community, trust, and worldview mechanics. Use structured competitor dimensions only to sharpen problem, trust, authority, and differentiation context. Do not turn peer traits into company facts unless company evidence supports them. At least one field should reflect a grounded trust, audience, ecosystem, monetization, publication, worldview, or narrative distinction.'
    : '';

  const companyContext = profile
    ? [
        `Industry: ${profile.industry ?? ''}`,
        `Target audience: ${(profile.target_audience ?? (profile.target_audience_list ?? []).join(', ')) || ''}`,
        `Campaign focus: ${profile.campaign_focus ?? ''}`,
        `Content themes: ${(profile.content_themes ?? (profile.content_themes_list ?? []).join(', ')) || ''}`,
        `Brand positioning: ${profile.brand_positioning ?? ''}`,
        `Unique value: ${profile.unique_value ?? ''}`,
        `Authority domains (existing): ${(profile.authority_domains ?? []).join(', ') || 'none'}`,
        archetypeContext ? `Entity archetype: ${archetypeContext}` : '',
        competitorIntelligence ? `Structured competitor dimensions: ${competitorIntelligence}` : '',
        userGuidanceContext,
        archetypeInstruction,
      ]
        .filter(Boolean)
        .join('. ')
    : 'No company context.';

  if (mode === 'fill') {
    const qaPairs = existingFields.qaPairs ?? [];
    const systemPrompt =
      'You are the Problem & Transformation AI Engine — AUTO FILL MODE.\n\n' +
      'Your ONLY job: Automatically fill or improve ALL Problem & Transformation fields.\n' +
      'You MUST NOT behave like chat.\n\n' +
      thinkFlow +
      '\n\nMODE: fill_with_ai\n\n' +
      'BEHAVIOR (STRICT):\n' +
      '1. Read ALL available context.\n' +
      '2. Infer missing strategic intelligence.\n' +
      '3. Fill ALL empty fields.\n' +
      '4. Improve weak or generic wording.\n' +
      '5. Generate DIAMOND-oriented angles.\n\n' +
      'HARD RULES:\n' +
      '- DO NOT ask ANY question.\n' +
      '- DO NOT request clarification.\n' +
      '- DO NOT start conversation.\n' +
      '- DO NOT ask \"what else\".\n' +
      '- If information is missing: infer best deterministic assumption.\n\n' +
      'THINKING ORDER:\n' +
      '1) Core Problem\n2) Emotional pain\n3) Practical pain\n4) Awareness gap (misconceptions)\n' +
      '5) Problem impact\n6) Life with problem\n7) Life after solution\n8) Desired transformation\n' +
      '9) Transformation mechanism\n10) Authority domains\n11) Diamond opportunities\n\n' +
      'Return JSON only in this schema:\n' +
      '{\n' +
      '  "updates": {\n' +
      '    "core_problem_statement": string | null,\n' +
      '    "pain_symptoms": [] | null,\n' +
      '    "awareness_gap": string | null,\n' +
      '    "problem_impact": string | null,\n' +
      '    "life_with_problem": string | null,\n' +
      '    "life_after_solution": string | null,\n' +
      '    "desired_transformation": string | null,\n' +
      '    "transformation_mechanism": string | null,\n' +
      '    "authority_domains": [] | null\n' +
      '  },\n' +
      '  "strategic_insights": [],\n' +
      '  "diamond_opportunities": [],\n' +
      '  "one_next_question": null,\n' +
      '  "reasoning_summary": ""\n' +
      '}';

    const userPrompt =
      `Company context:\n${companyContext}\n\n` +
      (qaPairs.length > 0
        ? 'User Q&A:\n' +
          qaPairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n') +
          '\n\nUse full company profile + existing context to auto-fill and improve all fields.'
        : 'Use full company profile + existing context to auto-fill and improve all fields.');

    return { systemPrompt, userPrompt };
  }

  // refine mode
  const existingText =
    existingFields && typeof existingFields === 'object'
      ? PT_FIELD_NAMES.map((k) => {
          const v = existingFields[k as keyof ProblemTransformationExistingFields];
          const display = Array.isArray(v) ? (v as string[]).join(', ') : String(v ?? '').trim();
          return `${k}: ${display || '(empty)'}`;
        }).join('\n')
      : '';

  const strategistInstruction =
    'Think like a strategist helping this company discover hidden customer pains and transformation gaps. Expand depth, not verbosity.';

  const systemPrompt =
    strategistInstruction +
    '\n\n' +
    thinkFlow +
    '\n\n**REFINE MODE:**\n' +
    '1. Read current values. Identify weaknesses: too generic, too broad, duplicated meaning, not actionable, missing angles.\n' +
    '2. Expand coverage across: awareness, education, authority, transformation, conversion intent.\n' +
    '3. Improve fields WITHOUT losing original intent. Preserve essence; increase specificity.\n' +
    '4. Add nuanced misconceptions (awareness_gap). Add emotional + practical pain.\n\n' +
    '**RULES:**\n' +
    '- Ask ONE short question at a time when conversing. When outputting done: merge user input with improvements.\n' +
    '- pain_symptoms and authority_domains: string arrays.\n' +
    'Response: { "nextQuestion": "..." } or { "done": true, "structuredFields": { ...all 9 fields } }\n' +
    'Return valid JSON only. No markdown.';

  const userPrompt =
    `Company context:\n${companyContext}\n\n` +
    `Current values:\n${existingText}\n\n` +
    'Refine: identify weaknesses, improve specificity, add depth. Output all 9 fields when done.';

  return { systemPrompt, userPrompt };
}

function normalizeToArray(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((v) => String(v).split(/[,;|\n]+/).map((s) => s.trim()))
      .filter(Boolean);
  }
  return String(value)
    .split(/[,;|\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeArray(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const lower = s.toLowerCase().trim();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

const EMPTY_PT_OUTPUT: ProblemTransformationRefinedOutput = {
  core_problem_statement: null,
  pain_symptoms: [],
  awareness_gap: null,
  problem_impact: null,
  life_with_problem: null,
  life_after_solution: null,
  desired_transformation: null,
  transformation_mechanism: null,
  authority_domains: [],
};

function parseAndNormalizePT(parsed: Record<string, unknown>): ProblemTransformationRefinedOutput {
  const payload =
    parsed && typeof parsed === 'object' && parsed.updates && typeof parsed.updates === 'object'
      ? (parsed.updates as Record<string, unknown>)
      : parsed;
  const str = (v: unknown): string | null =>
    v != null && String(v).trim() ? String(v).trim() : null;
  const pain = normalizeToArray(payload.pain_symptoms as string | string[] | null | undefined);
  const auth = normalizeToArray(payload.authority_domains as string | string[] | null | undefined);
  return {
    core_problem_statement: str(payload.core_problem_statement),
    pain_symptoms: dedupeArray(pain),
    awareness_gap: str(payload.awareness_gap),
    problem_impact: str(payload.problem_impact),
    life_with_problem: str(payload.life_with_problem),
    life_after_solution: str(payload.life_after_solution),
    desired_transformation: str(payload.desired_transformation),
    transformation_mechanism: str(payload.transformation_mechanism),
    authority_domains: dedupeArray(auth),
  };
}

/** Anti-stuck: merge AI result with existing; never return partial structure. */
function mergeWithExisting(
  aiResult: ProblemTransformationRefinedOutput,
  existing: ProblemTransformationExistingFields
): ProblemTransformationRefinedOutput {
  return {
    core_problem_statement: aiResult.core_problem_statement ?? existing.core_problem_statement ?? null,
    pain_symptoms: (aiResult.pain_symptoms?.length ? aiResult.pain_symptoms : existing.pain_symptoms) ?? [],
    awareness_gap: aiResult.awareness_gap ?? existing.awareness_gap ?? null,
    problem_impact: aiResult.problem_impact ?? existing.problem_impact ?? null,
    life_with_problem: aiResult.life_with_problem ?? existing.life_with_problem ?? null,
    life_after_solution: aiResult.life_after_solution ?? existing.life_after_solution ?? null,
    desired_transformation: aiResult.desired_transformation ?? existing.desired_transformation ?? null,
    transformation_mechanism: aiResult.transformation_mechanism ?? existing.transformation_mechanism ?? null,
    authority_domains: (aiResult.authority_domains?.length ? aiResult.authority_domains : existing.authority_domains) ?? [],
  };
}

function enforceProblemTransformationGrounding(
  result: ProblemTransformationRefinedOutput,
  profile: CompanyProfile | null,
  archetype?: EntityArchetypeIntelligence | null,
): ProblemTransformationRefinedOutput {
  if (!profile) return result;
  if (validateAudienceLedGrounding([
    result.core_problem_statement,
    result.pain_symptoms,
    result.awareness_gap,
    result.problem_impact,
    result.desired_transformation,
    result.transformation_mechanism,
    result.authority_domains,
  ], profile, archetype ?? profile.report_settings?.entity_archetype ?? null)) return result;
  const signal = buildGroundedDifferentiationSignal(profile.report_settings?.competitor_intelligence ?? null);
  if (!signal) return result;
  return {
    ...result,
    transformation_mechanism: [result.transformation_mechanism, `Ground differentiation in ${signal}.`]
      .filter(Boolean)
      .join(' '),
  };
}

function isPartialOrEmpty(result: ProblemTransformationRefinedOutput): boolean {
  const hasCore = !!result.core_problem_statement;
  const hasAnyArray = (result.pain_symptoms?.length ?? 0) > 0 || (result.authority_domains?.length ?? 0) > 0;
  const textCount = [
    result.awareness_gap,
    result.problem_impact,
    result.life_with_problem,
    result.life_after_solution,
    result.desired_transformation,
    result.transformation_mechanism,
  ].filter(Boolean).length;
  return !hasCore && !hasAnyArray && textCount === 0;
}

export async function refineProblemTransformationAnswers(
  rawAnswers: (string | null | undefined)[],
  options?: {
    companyId?: string;
    profile?: CompanyProfile | null;
    existingFields?: ProblemTransformationExistingFields;
    archetype?: EntityArchetypeIntelligence | null;
  }
): Promise<ProblemTransformationRefinedOutput> {
  const profile = options?.profile ?? null;
  const companyId = options?.companyId ?? (profile?.company_id ? String(profile.company_id) : null);
  const qaPairs = PROBLEM_TRANSFORMATION_QUESTIONS.map((q, i) => ({
    question: q,
    answer: rawAnswers[i] ?? '',
  }));
  const existingFields = options?.existingFields ?? {};
  const useStrategic = !!profile || options?.companyId;

  let systemPrompt: string;
  let userPrompt: string;

  if (useStrategic && profile) {
    const built = buildProblemTransformationStrategicPrompt('fill', profile, {
      ...existingFields,
      qaPairs,
    }, options?.archetype ?? profile.report_settings?.entity_archetype ?? null);
    systemPrompt = built.systemPrompt;
    userPrompt = built.userPrompt;
  } else {
    systemPrompt =
      'You are a company profile refinement engine. Extract and structure problem-transformation intelligence from user answers.\n\n' +
      'THINK → ANALYZE → STRUCTURE → OUTPUT. Return valid JSON only.\n' +
      'Output: { core_problem_statement, pain_symptoms: string[], awareness_gap, problem_impact, life_with_problem, life_after_solution, desired_transformation, transformation_mechanism, authority_domains: string[] }';
    userPrompt =
      'Q&A:\n' +
      qaPairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n') +
      '\n\nGenerate ALL 9 fields. Output JSON only.';
  }

  const runLLM = async (retryStrict: boolean) => {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      operation: 'refineProblemTransformation',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: retryStrict ? userPrompt + '\n\nReturn ONLY valid JSON. No markdown, no commentary.' : userPrompt },
      ],
    });
    return result.output?.trim() || '{}';
  };

  let raw = '';
  try {
    raw = await runLLM(false);
  } catch {
    return enforceProblemTransformationGrounding(mergeWithExisting(EMPTY_PT_OUTPUT, existingFields), profile, options?.archetype ?? profile?.report_settings?.entity_archetype ?? null);
  }

  // WAVE-1C-001 §C1: canonical safe-parse. Behavior preserved — a parse miss
  // still triggers the runLLM(true) retry, then falls back to grounded defaults.
  let parsed: Record<string, unknown>;
  const p1 = parseModelOutput<Record<string, unknown>>(raw, { surface: 'profile.problemTransformation' });
  if (p1.ok) {
    parsed = p1.value;
  } else {
    try {
      raw = await runLLM(true);
    } catch {
      return enforceProblemTransformationGrounding(mergeWithExisting(EMPTY_PT_OUTPUT, existingFields), profile, options?.archetype ?? profile?.report_settings?.entity_archetype ?? null);
    }
    const p2 = parseModelOutput<Record<string, unknown>>(raw, { surface: 'profile.problemTransformation.retry' });
    if (!p2.ok) {
      return enforceProblemTransformationGrounding(mergeWithExisting(EMPTY_PT_OUTPUT, existingFields), profile, options?.archetype ?? profile?.report_settings?.entity_archetype ?? null);
    }
    parsed = p2.value;
  }

  const result = parseAndNormalizePT(parsed);
  if (isPartialOrEmpty(result)) {
    return enforceProblemTransformationGrounding(mergeWithExisting(result, existingFields), profile, options?.archetype ?? profile?.report_settings?.entity_archetype ?? null);
  }
  return enforceProblemTransformationGrounding(result, profile, options?.archetype ?? profile?.report_settings?.entity_archetype ?? null);
}

// saveProblemTransformationAnswers is defined in dbOperations.ts to avoid circular deps
// (it calls fetchProfileRaw and saveProfile). Re-exported from the main index.
