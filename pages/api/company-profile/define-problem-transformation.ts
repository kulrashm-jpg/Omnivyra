import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import {
  getProfile,
  buildProblemTransformationStrategicPrompt,
  type CompanyProfile,
  type ProblemTransformationExistingFields,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

const normalizeText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .trim();

const summarize = (value: string, maxWords = 22): string => {
  const words = normalizeText(value).split(' ').filter(Boolean);
  return words.slice(0, maxWords).join(' ');
};

const detectTargetField = (text: string): keyof ProblemTransformationExistingFields | null => {
  const t = text.toLowerCase();
  if (t.includes('core problem')) return 'core_problem_statement';
  if (t.includes('pain symptom') || t.includes('emotional') || t.includes('friction')) return 'pain_symptoms';
  if (t.includes('awareness') || t.includes('misconception') || t.includes('misunderstand')) return 'awareness_gap';
  if (t.includes('impact') || t.includes('consequence')) return 'problem_impact';
  if (t.includes('life with') || t.includes('before state')) return 'life_with_problem';
  if (t.includes('life after') || t.includes('after state')) return 'life_after_solution';
  if (t.includes('transformation') || t.includes('from to')) return 'desired_transformation';
  if (t.includes('mechanism') || t.includes('how')) return 'transformation_mechanism';
  if (t.includes('authority domain') || t.includes('authority')) return 'authority_domains';
  return null;
};

const deterministicRefineFallback = (
  existing: ProblemTransformationExistingFields,
  latestUserMessage: string
): Record<string, string | string[] | null> => {
  const msg = normalizeText(latestUserMessage);
  if (!msg) return {};

  const targetField = detectTargetField(msg);
  const lines = msg
    .split(/[.\n,;]+/g)
    .map((s) => normalizeText(s))
    .filter((s) => s.length > 8);

  const candidateCore =
    lines.find((l) => /(struggle|problem|issue|stuck|confus|decision|clarity|overwhelm)/i.test(l)) ||
    lines[0] ||
    msg;
  const candidateSymptoms = lines
    .filter((l) => /(stress|anx|delay|confus|overwhelm|blocked|friction|issue|money|time|trust)/i.test(l))
    .slice(0, 5);
  const candidateImpact =
    lines.find((l) => /(lose|loss|delay|miss|cost|waste|burnout|frustration|drop|churn)/i.test(l)) ||
    '';

  const scoped = (field: keyof ProblemTransformationExistingFields) =>
    targetField == null || targetField === field;

  const updates: Record<string, string | string[] | null> = {};
  if (scoped('core_problem_statement')) {
    updates.core_problem_statement = `People struggle with ${summarize(candidateCore, 18)}.`;
  }
  if (scoped('pain_symptoms') && candidateSymptoms.length > 0) {
    updates.pain_symptoms = Array.from(
      new Set([...(existing.pain_symptoms ?? []), ...candidateSymptoms.map((s) => summarize(s, 10))])
    ).slice(0, 8);
  }
  if (scoped('problem_impact') && candidateImpact) {
    updates.problem_impact = `If unresolved, this leads to ${summarize(candidateImpact, 16)}.`;
  }
  if (scoped('awareness_gap')) {
    updates.awareness_gap =
      existing.awareness_gap ??
      'Many assume this is a motivation issue, but the deeper issue is decision structure and clarity under uncertainty.';
  }
  if (scoped('desired_transformation')) {
    updates.desired_transformation =
      existing.desired_transformation ??
      'From scattered, reactive decision-making to clear, confident, and prioritized action.';
  }
  if (scoped('transformation_mechanism')) {
    updates.transformation_mechanism =
      existing.transformation_mechanism ??
      'A structured clarity framework that converts vague problems into prioritized actions and measurable progress.';
  }
  if (scoped('authority_domains')) {
    const domains = existing.authority_domains ?? [];
    if (domains.length === 0) {
      updates.authority_domains = ['decision clarity', 'problem framing', 'priority setting'];
    }
  }
  return updates;
};

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
  const latestUserMessage = [...conversation]
    .reverse()
    .find((m: { role?: string; content?: string }) => m?.role === 'user' && typeof m?.content === 'string')
    ?.content;
  const currentFields = req.body?.currentFields as Record<string, unknown> | undefined;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    const existingPT: ProblemTransformationExistingFields = currentFields && typeof currentFields === 'object'
      ? {
          core_problem_statement: (currentFields.core_problem_statement as string) ?? null,
          pain_symptoms: (currentFields.pain_symptoms as string[]) ?? [],
          awareness_gap: (currentFields.awareness_gap as string) ?? null,
          problem_impact: (currentFields.problem_impact as string) ?? null,
          life_with_problem: (currentFields.life_with_problem as string) ?? null,
          life_after_solution: (currentFields.life_after_solution as string) ?? null,
          desired_transformation: (currentFields.desired_transformation as string) ?? null,
          transformation_mechanism: (currentFields.transformation_mechanism as string) ?? null,
          authority_domains: (currentFields.authority_domains as string[]) ?? [],
        }
      : {};

    const { systemPrompt } = buildProblemTransformationStrategicPrompt(
      'refine',
      profile as CompanyProfile | null,
      existingPT
    );
    const fullSystemPrompt =
      systemPrompt +
      '\n\nMODE = "chat_refine".\n' +
      'You are the Problem & Transformation AI Engine — STRATEGIC REFINE MODE.\n' +
      'You are NOT a questionnaire bot.\n\n' +
      'Behavior (strict) on every user message:\n' +
      '1) Analyze meaning\n' +
      '2) Infer strategic implications\n' +
      '3) Update fields automatically FIRST\n' +
      '4) Show improvements\n' +
      '5) Ask MAX ONE deep strategic question only if needed\n\n' +
      'Hard rules:\n' +
      '- NEVER ask field-selection questions\n' +
      '- NEVER ask "which field to start with"\n' +
      '- NEVER run one-field interviews\n' +
      '- NEVER ask multiple questions\n' +
      '- ANTI-LOOP: if questioning repeats, STOP asking and propose updates immediately\n\n' +
      '- MUST propose at least one concrete field improvement in "updates" on each turn unless user explicitly says keep all as-is.\n\n' +
      '- Prioritize the latest user message, and keep updates tightly scoped to the user intent.\n' +
      '- Replace weak/long text with concise stronger phrasing; avoid additive bloat.\n' +
      '- De-duplicate list fields and limit to the most relevant items.\n\n' +
      'Output JSON ONLY in this schema:\n' +
      '{\n' +
      '  "updates": {\n' +
      '    "core_problem_statement": null | string,\n' +
      '    "pain_symptoms": null | [],\n' +
      '    "awareness_gap": null | string,\n' +
      '    "problem_impact": null | string,\n' +
      '    "life_with_problem": null | string,\n' +
      '    "life_after_solution": null | string,\n' +
      '    "desired_transformation": null | string,\n' +
      '    "transformation_mechanism": null | string,\n' +
      '    "authority_domains": null | []\n' +
      '  },\n' +
      '  "strategic_insights": [],\n' +
      '  "diamond_opportunities": [],\n' +
      '  "one_next_question": null | string,\n' +
      '  "reasoning_summary": ""\n' +
      '}\n' +
      'Only include fields that changed in "updates".';

    const userContent = [
      `Company: ${profile?.name ?? companyId}. Industry: ${profile?.industry ?? ''}. Category: ${profile?.category ?? ''}.`,
      `Current values:\n${Object.entries(existingPT).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '').trim() || '(empty)'}`).join('\n')}`,
      conversation.length === 0
        ? 'Start strategic refine. Propose concrete updates immediately, then ask at most one deep strategic question only if necessary.'
        : 'Conversation so far:\n' +
          conversation
            .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
            .join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      { role: 'user', content: userContent },
    ];

    const client = getOpenAiClient();
    const callLLM = (retryStrict = false) =>
      client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: retryStrict
          ? [
              { role: 'system', content: fullSystemPrompt },
              { role: 'user', content: userContent + '\n\nReturn ONLY valid JSON.' },
            ]
          : messages,
      });

    let raw = '';
    try {
      const completion = await callLLM(false);
      raw = completion.choices[0]?.message?.content?.trim() || '{}';
    } catch {
      return res.status(500).json({ error: 'Failed to run refinement' });
    }

    let parsed: {
      nextQuestion?: string;
      done?: boolean;
      structuredFields?: Record<string, string | string[] | null>;
      updates?: Record<string, string | string[] | null>;
      strategic_insights?: string[];
      diamond_opportunities?: string[];
      one_next_question?: string | null;
      reasoning_summary?: string;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        const retry = await callLLM(true);
        raw = retry.choices[0]?.message?.content?.trim() || '{}';
        parsed = JSON.parse(raw);
      } catch {
        return res.status(500).json({ error: 'Invalid AI response' });
      }
    }

    const sf = (parsed.updates || parsed.structuredFields || {}) as Record<
      string,
      string | string[] | null
    >;
    if (parsed.done || parsed.updates || parsed.structuredFields) {
      const normalizeArr = (v: unknown): string[] =>
        Array.isArray(v)
          ? Array.from(
              new Set(
                v
                  .map((x) => summarize(String(x), 12))
                  .map((x) => x.trim())
                  .filter(Boolean)
              )
            ).slice(0, 8)
          : [];
      const normalizeStr = (v: unknown): string | null =>
        v != null && String(v).trim() ? summarize(String(v).trim(), 35) : null;
      const result = {
        core_problem_statement:
          sf.core_problem_statement === undefined
            ? existingPT.core_problem_statement ?? null
            : normalizeStr(sf.core_problem_statement),
        pain_symptoms:
          sf.pain_symptoms === undefined ? existingPT.pain_symptoms ?? [] : normalizeArr(sf.pain_symptoms),
        awareness_gap:
          sf.awareness_gap === undefined ? existingPT.awareness_gap ?? null : normalizeStr(sf.awareness_gap),
        problem_impact:
          sf.problem_impact === undefined ? existingPT.problem_impact ?? null : normalizeStr(sf.problem_impact),
        life_with_problem:
          sf.life_with_problem === undefined
            ? existingPT.life_with_problem ?? null
            : normalizeStr(sf.life_with_problem),
        life_after_solution:
          sf.life_after_solution === undefined
            ? existingPT.life_after_solution ?? null
            : normalizeStr(sf.life_after_solution),
        desired_transformation:
          sf.desired_transformation === undefined
            ? existingPT.desired_transformation ?? null
            : normalizeStr(sf.desired_transformation),
        transformation_mechanism:
          sf.transformation_mechanism === undefined
            ? existingPT.transformation_mechanism ?? null
            : normalizeStr(sf.transformation_mechanism),
        authority_domains:
          sf.authority_domains === undefined
            ? existingPT.authority_domains ?? []
            : normalizeArr(sf.authority_domains),
      };
      const changedUpdates: Record<string, string | string[] | null> = {};
      const pushIfChanged = (key: keyof typeof result, prev: unknown, next: unknown) => {
        const prevNorm = Array.isArray(prev) ? prev.map((v) => String(v).trim()) : prev ?? null;
        const nextNorm = Array.isArray(next) ? next.map((v) => String(v).trim()) : next ?? null;
        if (JSON.stringify(prevNorm) !== JSON.stringify(nextNorm)) {
          changedUpdates[key] = (next as string | string[] | null) ?? null;
        }
      };
      pushIfChanged('core_problem_statement', existingPT.core_problem_statement ?? null, result.core_problem_statement);
      pushIfChanged('pain_symptoms', existingPT.pain_symptoms ?? [], result.pain_symptoms);
      pushIfChanged('awareness_gap', existingPT.awareness_gap ?? null, result.awareness_gap);
      pushIfChanged('problem_impact', existingPT.problem_impact ?? null, result.problem_impact);
      pushIfChanged('life_with_problem', existingPT.life_with_problem ?? null, result.life_with_problem);
      pushIfChanged('life_after_solution', existingPT.life_after_solution ?? null, result.life_after_solution);
      pushIfChanged('desired_transformation', existingPT.desired_transformation ?? null, result.desired_transformation);
      pushIfChanged('transformation_mechanism', existingPT.transformation_mechanism ?? null, result.transformation_mechanism);
      pushIfChanged('authority_domains', existingPT.authority_domains ?? [], result.authority_domains);
      const targetField = detectTargetField(latestUserMessage ?? '');
      if (targetField) {
        Object.keys(changedUpdates).forEach((k) => {
          if (k !== targetField) delete changedUpdates[k];
        });
      }
      if (Object.keys(changedUpdates).length === 0) {
        const fallbackUpdates = deterministicRefineFallback(existingPT, latestUserMessage ?? '');
        Object.entries(fallbackUpdates).forEach(([key, value]) => {
          const prev = (existingPT as Record<string, unknown>)[key];
          const prevNorm = Array.isArray(prev) ? prev.map((v) => String(v).trim()) : prev ?? null;
          const nextNorm = Array.isArray(value) ? value.map((v) => String(v).trim()) : value ?? null;
          if (JSON.stringify(prevNorm) !== JSON.stringify(nextNorm)) {
            changedUpdates[key] = value;
          }
        });
      }
      const hasAny =
        result.core_problem_statement ||
        result.pain_symptoms?.length ||
        result.authority_domains?.length ||
        result.awareness_gap ||
        result.problem_impact ||
        result.life_with_problem ||
        result.life_after_solution ||
        result.desired_transformation ||
        result.transformation_mechanism;
      if (!hasAny) {
        return res.status(200).json({
          done: true,
          structuredFields: {
            core_problem_statement: existingPT.core_problem_statement ?? null,
            pain_symptoms: existingPT.pain_symptoms ?? [],
            awareness_gap: existingPT.awareness_gap ?? null,
            problem_impact: existingPT.problem_impact ?? null,
            life_with_problem: existingPT.life_with_problem ?? null,
            life_after_solution: existingPT.life_after_solution ?? null,
            desired_transformation: existingPT.desired_transformation ?? null,
            transformation_mechanism: existingPT.transformation_mechanism ?? null,
            authority_domains: existingPT.authority_domains ?? [],
          },
        });
      }
      const previewUpdates =
        Object.keys(changedUpdates).length > 0 ? changedUpdates : (result as Record<string, string | string[] | null>);
      const nextQuestion =
        parsed.one_next_question ??
        parsed.nextQuestion ??
        'I proposed strategic refinements above. Should I apply these updates, or adjust one angle before applying?';
      return res.status(200).json({
        done: false,
        nextQuestion,
        previewUpdates,
        strategic_insights: parsed.strategic_insights ?? [],
        diamond_opportunities: parsed.diamond_opportunities ?? [],
        reasoning_summary: parsed.reasoning_summary ?? '',
      });
    }
    return res.status(200).json({
      nextQuestion: parsed.one_next_question || parsed.nextQuestion || null,
      previewUpdates: {
        core_problem_statement: existingPT.core_problem_statement ?? null,
        pain_symptoms: existingPT.pain_symptoms ?? [],
        awareness_gap: existingPT.awareness_gap ?? null,
        problem_impact: existingPT.problem_impact ?? null,
        life_with_problem: existingPT.life_with_problem ?? null,
        life_after_solution: existingPT.life_after_solution ?? null,
        desired_transformation: existingPT.desired_transformation ?? null,
        transformation_mechanism: existingPT.transformation_mechanism ?? null,
        authority_domains: existingPT.authority_domains ?? [],
      },
      strategic_insights: parsed.strategic_insights ?? [],
      diamond_opportunities: parsed.diamond_opportunities ?? [],
      reasoning_summary: parsed.reasoning_summary ?? '',
    });
  } catch (err: unknown) {
    console.error('Define problem transformation failed:', err);
    return res.status(500).json({
      error: 'Failed to refine problem transformation',
      details: err instanceof Error ? err.message : null,
    });
  }
}
