import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  getCompanyContextIntelligence,
  type CompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';

function summarizeContext(context: CompanyContextIntelligence | null): string {
  if (!context) return 'No context intelligence is saved yet.';
  return JSON.stringify({
    revenue_segments: context.revenue_segments ?? [],
    geographic_exposures: context.geographic_exposures ?? [],
    dependencies: context.dependencies ?? [],
    workforce_profile: context.workforce_profile ?? null,
    regulatory_exposures: context.regulatory_exposures ?? [],
    technology_dependencies: context.technology_dependencies ?? [],
  }).slice(0, 6000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];

  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const [profile, currentContext] = await Promise.all([
      getProfile(companyId, { autoRefine: false, languageRefine: false }),
      getCompanyContextIntelligence(companyId),
    ]);

    const companyContext = profile
      ? [
          `Company: ${profile.name || companyId}`,
          `Industry: ${profile.industry || 'Not set'}`,
          `Category: ${profile.category || 'Not set'}`,
          `Products: ${profile.products_services || 'Not set'}`,
          `Audience: ${profile.target_audience || profile.ideal_customer_profile || 'Not set'}`,
          `Geography: ${profile.geography || 'Not set'}`,
        ].join('\n')
      : 'Company profile is not available.';

    const sectionState: Record<string, boolean> = {
      revenue_segments: (currentContext?.revenue_segments?.length ?? 0) > 0,
      geographic_exposures: (currentContext?.geographic_exposures?.length ?? 0) > 0,
      dependencies: (currentContext?.dependencies?.length ?? 0) > 0,
      workforce_profile: Boolean(currentContext?.workforce_profile),
      regulatory_exposures: (currentContext?.regulatory_exposures?.length ?? 0) > 0,
      technology_dependencies: (currentContext?.technology_dependencies?.length ?? 0) > 0,
    };
    const capturedSections = Object.entries(sectionState).filter(([, filled]) => filled).map(([name]) => name);
    const missingSections = Object.entries(sectionState).filter(([, filled]) => !filled).map(([name]) => name);

    const companyName = profile?.name || 'the company';
    // Deterministic question flow: the SERVER decides the next question from which
    // section is still uncovered, so the model can never loop or repeat. Each user
    // answer advances to the next uncovered section. `missingSections` is already
    // in canonical section order.
    const SECTION_QUESTIONS: Record<string, string> = {
      revenue_segments: `What are the main revenue segments for ${companyName}? (e.g. subscriptions, services, one-time)`,
      geographic_exposures: `Which geographic markets does ${companyName} depend on for revenue, customers, or operations?`,
      dependencies: `What key operational dependencies could disrupt ${companyName} — vendors, suppliers, logistics, channels, or partners?`,
      workforce_profile: `What does ${companyName}'s workforce look like — hiring markets, contractor/immigration reliance, or key skills?`,
      regulatory_exposures: `Which regulations or jurisdictions materially affect ${companyName} (e.g. data privacy, financial, industry rules)?`,
      technology_dependencies: `Which technology providers is ${companyName} dependent on — cloud, AI/model, payments, analytics, or security?`,
    };
    const answersGiven = conversation.filter((m: { role?: string }) => m.role === 'user').length;
    if (missingSections.length > 0 && answersGiven < missingSections.length) {
      const nextSection = missingSections[answersGiven];
      return res.status(200).json({
        nextQuestion:
          SECTION_QUESTIONS[nextSection] ??
          `Tell me about ${nextSection.replace(/_/g, ' ')} for ${companyName}.`,
      });
    }

    // Every uncovered section now has an answer (or none were missing). Because we
    // asked ONE question per missing section in order, we know exactly which answer
    // belongs to which section — so we label them for the model rather than making
    // it guess. That is what makes structured sections (workforce, technology, etc.)
    // capture reliably instead of only the obvious ones.
    const userAnswers = conversation
      .filter((m: { role?: string }) => m.role === 'user')
      .map((m: { content?: string }) => String(m.content ?? '').trim());
    const labeledAnswers = missingSections
      .map((section, i) => ({ section, answer: userAnswers[i] ?? '' }))
      .filter((entry) => entry.answer);

    const systemPrompt =
      'You convert a company\'s answers into structured context intelligence. You are given, per section, the exact user answer. ' +
      'For EVERY section that has a non-empty answer, produce structured rows — NEVER leave an answered section empty. ' +
      'Split list-style answers (comma / "and"-separated) into separate rows.\n' +
      'Section schemas:\n' +
      '- revenue_segments: array of { "customer_segment": string, "customer_industry"?: string, "geography"?: string, "strategic_priority"?: "low"|"medium"|"high"|"critical" }\n' +
      '- geographic_exposures: array of { "geography": string, "exposure_type": "revenue"|"operations"|"workforce"|"customers"|"vendors" }\n' +
      '- dependencies: array of { "dependency_type": "cloud"|"vendor"|"supplier"|"logistics"|"labor"|"platform"|"channel"|"regulatory"|"technology"|"other", "dependency_name": string, "criticality"?: "low"|"medium"|"high"|"critical" }\n' +
      '- workforce_profile: a SINGLE object { "workforce_model"?: string, "hiring_markets"?: string[], "key_skill_dependencies"?: string[], "contractor_dependency_level"?: "none"|"low"|"medium"|"high" } (use null only if there is no workforce answer)\n' +
      '- regulatory_exposures: array of { "jurisdiction": string, "regulation_type": string, "severity"?: "low"|"medium"|"high"|"critical" }\n' +
      '- technology_dependencies: array of { "provider_name": string, "provider_category": string, "criticality"?: "low"|"medium"|"high"|"critical" }\n' +
      'Add "review_status": "inferred" and "entity_state": "inferred" to EVERY row (and to the workforce_profile object).\n' +
      'Return JSON ONLY: { "done": true, "structuredContext": { "revenue_segments": [], "geographic_exposures": [], "dependencies": [], "workforce_profile": null, "regulatory_exposures": [], "technology_dependencies": [] } }.';

    const completion = await runCompletion({
      companyId,
      operation: 'defineContextIntelligence',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            `Company: ${companyName}\n\nAnswers by section (structure each into its section — do not skip any):\n` +
            (labeledAnswers.length
              ? labeledAnswers.map((entry) => `- ${entry.section}: ${entry.answer}`).join('\n')
              : 'none'),
        },
      ],
    });

    const raw = (completion.output ?? '').trim() || '{}';
    let structuredContext: Partial<CompanyContextIntelligence> = {};
    try {
      const parsed = JSON.parse(raw) as { structuredContext?: Partial<CompanyContextIntelligence> } & Partial<CompanyContextIntelligence>;
      structuredContext = (parsed.structuredContext ?? parsed) as Partial<CompanyContextIntelligence>;
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    // Deterministic safety net: if the model left an ANSWERED section empty,
    // capture the raw answer so nothing the user typed is lost (this is what made
    // workforce / technology appear "not saved").
    const inferredMeta = { review_status: 'inferred' as const, entity_state: 'inferred' as const };
    const splitList = (s: string) => String(s).split(/[,;]|\band\b/i).map((x) => x.trim()).filter(Boolean);
    const sc = structuredContext as Record<string, unknown>;
    for (const { section, answer } of labeledAnswers) {
      if (section === 'workforce_profile') {
        const w = sc.workforce_profile as Record<string, unknown> | null | undefined;
        const hasContent = Boolean(
          w && (
            (typeof w.workforce_model === 'string' && w.workforce_model.trim()) ||
            (Array.isArray(w.hiring_markets) && w.hiring_markets.length) ||
            (Array.isArray(w.key_skill_dependencies) && w.key_skill_dependencies.length)
          ),
        );
        if (!hasContent) sc.workforce_profile = { workforce_model: answer, ...inferredMeta };
        continue;
      }
      const current = sc[section];
      if (Array.isArray(current) && current.length > 0) continue;
      const parts = splitList(answer);
      if (parts.length === 0) continue;
      if (section === 'revenue_segments') sc.revenue_segments = parts.map((v) => ({ customer_segment: v, ...inferredMeta }));
      else if (section === 'geographic_exposures') sc.geographic_exposures = parts.map((v) => ({ geography: v, exposure_type: 'revenue', ...inferredMeta }));
      else if (section === 'dependencies') sc.dependencies = parts.map((v) => ({ dependency_type: 'other', dependency_name: v, ...inferredMeta }));
      else if (section === 'regulatory_exposures') sc.regulatory_exposures = parts.map((v) => ({ regulation_type: v, jurisdiction: '', ...inferredMeta }));
      else if (section === 'technology_dependencies') sc.technology_dependencies = parts.map((v) => ({ provider_name: v, provider_category: 'other', ...inferredMeta }));
    }

    return res.status(200).json({ done: true, structuredContext });
  } catch (err: any) {
    console.error('Define context intelligence failed:', err);
    return res.status(500).json({
      error: 'Failed to run context intelligence capture',
      details: err?.message || null,
    });
  }
}
