import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { getProfile } from '../../../backend/services/companyProfileService';

/**
 * Product-first competitor suggestions grounded in the company's OWN profile/website.
 * Direct competitors = same-category PRODUCTS/software a buyer would consider instead.
 * Explicitly excludes newsletters, individual creators, agencies, and off-category
 * (e.g. wellness) noise — the failure modes the earlier refinement produced.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    if (!profile) return res.status(404).json({ error: 'Company profile not found' });

    const p = profile as unknown as Record<string, unknown>;
    const str = (v: unknown) => String(v ?? '').trim();
    const website = str(p.website) || str(p.canonical_website) || str(p.domain);
    const grounding = [
      `Company: ${str(p.name) || companyId}`,
      website ? `Website: ${website}` : '',
      `Industry/Category: ${[str(p.industry), str(p.category)].filter(Boolean).join(' / ') || 'Not set'}`,
      `What it sells (products/services): ${str(p.products_services) || 'Not set'}`,
      `Unique value: ${str(p.unique_value) || 'Not set'}`,
      `Target customer: ${str(p.target_audience) || str(p.ideal_customer_profile) || 'Not set'}`,
    ].filter(Boolean).join('\n');

    const systemPrompt =
      'You identify DIRECT competitors for a company, grounded strictly in what THIS company sells. ' +
      'Direct competitors are real, named companies offering a SAME-CATEGORY PRODUCT or software that a buyer ' +
      'would seriously evaluate INSTEAD of this company (i.e. they rent/sell a substitutable product). ' +
      'Hard rules:\n' +
      '- Same product category only. Ground every pick in the company\'s own products/website above.\n' +
      '- NEVER return: newsletters, media publications, individual creators/influencers, agencies/consultancies, ' +
      'communities, or any company in a different category (e.g. wellness/health if this is a marketing product).\n' +
      '- Only well-known, real companies. Do not invent names. If you are unsure a name is a real same-category ' +
      'product, omit it.\n' +
      '- 4 to 6 competitors, most-substitutable first.\n' +
      'Return JSON ONLY: { "competitors": [ { "name": string, "why": string (max 12 words, why it is a same-category substitute) } ] }.';

    const completion = await runCompletion({
      companyId,
      operation: 'suggestCompetitors',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Company profile:\n${grounding}\n\nList this company's direct, same-category product competitors.` },
      ],
    });

    const raw = (completion.output ?? '').trim() || '{}';
    let competitors: Array<{ name: string; why?: string }> = [];
    try {
      const parsed = JSON.parse(raw) as { competitors?: Array<{ name?: unknown; why?: unknown }> };
      competitors = (Array.isArray(parsed.competitors) ? parsed.competitors : [])
        .map((c) => ({ name: str(c?.name), why: str(c?.why) || undefined }))
        .filter((c) => c.name)
        .slice(0, 6);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    return res.status(200).json({ competitors });
  } catch (err: unknown) {
    console.error('Suggest competitors failed:', err);
    return res.status(500).json({
      error: 'Failed to suggest competitors',
      details: err instanceof Error ? err.message : null,
    });
  }
}
