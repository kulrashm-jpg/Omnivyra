import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  getCompanyContextIntelligence,
  type CompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';
import { getProfile } from '../../../backend/services/companyProfileService';

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

    const systemPrompt =
      'You are a company context intelligence assistant. Through a short guided conversation, capture these six sections, asking ONE simple question at a time:\n' +
      'revenue_segments, geographic_exposures, dependencies, workforce_profile, regulatory_exposures, technology_dependencies.\n' +
      '- A section is COVERED if it appears under ALREADY CAPTURED (saved data) OR the user has already answered it anywhere in the conversation below.\n' +
      '- NEVER ask about a COVERED section. NEVER repeat or rephrase a question the user already answered — move on to the next UNCOVERED section.\n' +
      '- The "no saved data yet" list reflects SAVED data only; if the user answered one of those topics in the conversation, treat it as COVERED and skip it.\n' +
      '- When every section is covered, immediately return done.\n' +
      'Response format (JSON only, no markdown):\n' +
      '- If a section is still uncovered: { "nextQuestion": "..." }\n' +
      '- When all sections are covered: { "done": true, "structuredContext": { "revenue_segments": [], "geographic_exposures": [], "dependencies": [], "workforce_profile": null, "regulatory_exposures": [], "technology_dependencies": [] } } built from the conversation + saved data.\n' +
      'Use arrays of plain objects with obvious keys matching the section names. Include review_status: "inferred" and entity_state: "inferred" on inferred rows. Keep values concise.';

    const completion = await runCompletion({
      companyId,
      operation: 'defineContextIntelligence',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `Company profile:\n${companyContext}`,
            `Current context intelligence:\n${summarizeContext(currentContext)}`,
            `ALREADY CAPTURED (saved) sections — do NOT ask about these: ${capturedSections.length ? capturedSections.join(', ') : 'none'}`,
            `Sections with no saved data yet: ${missingSections.length ? missingSections.join(', ') : 'none — return done'}. Ask about one of these ONLY if the user has not already answered that topic in the conversation below; a topic answered in the conversation is COVERED — do not re-ask it.`,
            conversation.length === 0
              ? missingSections.length === 0
                ? 'All sections are already captured. Return done immediately.'
                : 'Start the guided capture. Ask the simplest question about an uncovered section only.'
              : 'Conversation so far (treat every topic the user has answered here as COVERED — ask only about a section that is neither saved nor answered here, or return done):\n' +
                conversation
                  .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
                  .join('\n'),
          ].join('\n\n'),
        },
      ],
    });

    const raw = (completion.output ?? '').trim() || '{}';
    let parsed: { nextQuestion?: string; done?: boolean; structuredContext?: Partial<CompanyContextIntelligence> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.structuredContext) {
      return res.status(200).json({ done: true, structuredContext: parsed.structuredContext });
    }

    return res.status(200).json({
      nextQuestion:
        parsed.nextQuestion ||
        'Which customer segment, market, dependency, workforce constraint, or regulation should we capture first?',
    });
  } catch (err: any) {
    console.error('Define context intelligence failed:', err);
    return res.status(500).json({
      error: 'Failed to run context intelligence capture',
      details: err?.message || null,
    });
  }
}
