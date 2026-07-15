import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { enrichSingleBlock, isEnrichableType } from '../../../backend/services/blockEnrichEngine';
import type { ContentBlock, BlockType } from '../../../lib/blog/blockTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id, block, context_blocks, blog_meta } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!block || typeof block !== 'object' || !block.type) {
    return res.status(400).json({ error: 'block required' });
  }
  if (!isEnrichableType(block.type as BlockType)) {
    return res.status(400).json({ error: `Block type "${block.type}" is not enrichable` });
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
    let writingStyle: string | undefined;
    try {
      const profile = await getProfile(company_id, { autoRefine: false, languageRefine: false });
      if (profile?.brand_voice) {
        writingStyle = Array.isArray(profile.brand_voice) ? profile.brand_voice.join(', ') : String(profile.brand_voice);
      }
    } catch {}

    const meta = blog_meta && typeof blog_meta === 'object'
      ? {
          title: typeof blog_meta.title === 'string' ? blog_meta.title : '',
          excerpt: typeof blog_meta.excerpt === 'string' ? blog_meta.excerpt : '',
          tags: Array.isArray(blog_meta.tags) ? blog_meta.tags.filter((t: unknown) => typeof t === 'string') : [],
        }
      : { title: '', excerpt: '', tags: [] as string[] };

    const result = await enrichSingleBlock({
      companyId: company_id,
      block: block as ContentBlock,
      contextBlocks: Array.isArray(context_blocks) ? context_blocks : [],
      blogMeta: meta,
      writingStyle,
    });

    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI enrichment failed';
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/blogs/enrich-block' });
