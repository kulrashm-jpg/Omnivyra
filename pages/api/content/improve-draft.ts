import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getProfile } from '../../../backend/services/companyProfileService';
import type { ImprovementArea } from '../../../lib/content/contentImprovementEngine';
import { runOwnedImprovement } from '../../../lib/content/runOwnedImprovement';
import type { ContentBlock } from '../../../lib/blog/blockTypes';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    area,
    contentType = 'blog',
    draft,
    socialPlatform,
    campaignContext,
    trendContext,
    issue_message,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!area || typeof area !== 'string') {
    return res.status(400).json({ error: 'area required' });
  }
  if (!draft || typeof draft !== 'object') {
    return res.status(400).json({ error: 'draft required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId: company_id,
    allowedRoles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_REVIEWER, Role.CONTENT_PUBLISHER],
  });
  if (!roleGate) return;

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: false });

    const draftObj = draft as {
      title?: string;
      excerpt?: string;
      seo_meta_title?: string;
      seo_meta_description?: string;
      tags?: string[];
      content_blocks?: ContentBlock[];
      target_word_count?: number;
      format_type?: string;
    };

    const baseInput = {
      companyId: company_id,
      area: area as ImprovementArea,
      draft: {
        title: draftObj.title || '',
        excerpt: draftObj.excerpt || '',
        seo_meta_title: draftObj.seo_meta_title || '',
        seo_meta_description: draftObj.seo_meta_description || '',
        tags: Array.isArray(draftObj.tags) ? draftObj.tags : [],
        content_blocks: Array.isArray(draftObj.content_blocks) ? draftObj.content_blocks : [],
        target_word_count: typeof draftObj.target_word_count === 'number' ? draftObj.target_word_count : undefined,
        format_type: typeof draftObj.format_type === 'string' ? draftObj.format_type : undefined,
      },
      context: {
        contentType,
        socialPlatform: typeof socialPlatform === 'string' ? socialPlatform : undefined,
        campaignContext: typeof campaignContext === 'string' ? campaignContext : undefined,
        trendContext: typeof trendContext === 'string' ? trendContext : undefined,
        issueMessage: typeof issue_message === 'string' && issue_message.trim() ? issue_message.trim() : undefined,
      },
      companyProfile: profile,
    } as const;

    const result = await runOwnedImprovement(baseInput);

    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI improvement failed';
    return res.status(500).json({ error: msg });
  }
}
