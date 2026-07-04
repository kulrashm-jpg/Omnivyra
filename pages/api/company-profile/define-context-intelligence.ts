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

    const systemPrompt =
      'You are a company context intelligence assistant. Capture structured business context through a short guided conversation.\n' +
      'Ask ONE concise question at a time. Prioritize missing or weak sections: revenue_segments, geographic_exposures, dependencies, workforce_profile, regulatory_exposures, technology_dependencies.\n' +
      'When enough information is available, return JSON only in this shape:\n' +
      '{ "done": true, "structuredContext": { "revenue_segments": [], "geographic_exposures": [], "dependencies": [], "workforce_profile": null, "regulatory_exposures": [], "technology_dependencies": [] } }\n' +
      'Use arrays of plain objects with obvious keys matching the section names. Include review_status: "inferred" and entity_state: "inferred" on inferred rows. Keep values concise. If more information is needed, return { "nextQuestion": "..." }.';

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
            conversation.length === 0
              ? 'Start the guided capture. Ask the highest-value first question.'
              : 'Conversation so far:\n' +
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
