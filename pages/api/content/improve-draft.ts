import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { improveBlogDraft, type ImprovementArea } from '../../../lib/content/contentImprovementEngine';
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

    if (contentType !== 'blog') {
      return res.status(400).json({ error: 'Only blog contentType is supported in this version' });
    }

    const draftObj = draft as {
      title?: string;
      excerpt?: string;
      seo_meta_title?: string;
      seo_meta_description?: string;
      tags?: string[];
      content_blocks?: ContentBlock[];
    };

    const result = await improveBlogDraft({
      companyId: company_id,
      area: area as ImprovementArea,
      draft: {
        title: draftObj.title || '',
        excerpt: draftObj.excerpt || '',
        seo_meta_title: draftObj.seo_meta_title || '',
        seo_meta_description: draftObj.seo_meta_description || '',
        tags: Array.isArray(draftObj.tags) ? draftObj.tags : [],
        content_blocks: Array.isArray(draftObj.content_blocks) ? draftObj.content_blocks : [],
      },
      context: {
        contentType,
        socialPlatform: typeof socialPlatform === 'string' ? socialPlatform : undefined,
        campaignContext: typeof campaignContext === 'string' ? campaignContext : undefined,
        trendContext: typeof trendContext === 'string' ? trendContext : undefined,
      },
      companyProfile: profile,
    });

    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI improvement failed';
    return res.status(500).json({ error: msg });
  }
}
