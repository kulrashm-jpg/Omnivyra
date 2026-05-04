import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { createCreatorExecutionEngine } from '../../../../backend/services/executionEngines/creatorExecutionEngine';
import { renderAsset } from '../../../../backend/services/creatorAssetRenderer';

type GenerateCreatorBody = {
  company_id?: string;
  topic?: string;
  creator_type?: string;
  content_type?: string;
  target_platforms?: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creator_card?: Record<string, unknown>;
};

function resolveRequestedContentType(input: { creatorType?: string; contentType?: string }): string {
  const creatorType = String(input.creatorType || '').trim().toLowerCase();
  const explicitContentType = String(input.contentType || '').trim().toLowerCase();
  if (explicitContentType) return explicitContentType;

  switch (creatorType) {
    case 'banner':
      return 'banner';
    case 'infographic':
      return 'infographic';
    case 'pdf':
      return 'pdf';
    case 'slider':
      return 'slider';
    case 'post-with-asset':
      return 'post';
    case 'thread-with-asset':
      return 'thread';
    default:
      return creatorType;
  }
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mergeRenderedMedia(output: any, rendered: { url?: string | null; files?: string[] | null; metadata?: Record<string, unknown> | null }) {
  const mediaBundle = safeObject(output?.asset_payload?.media_bundle);
  return {
    ...output,
    asset_payload: {
      ...safeObject(output?.asset_payload),
      media_bundle: {
        ...mediaBundle,
        ...(rendered.url ? { url: rendered.url } : {}),
        ...(Array.isArray(rendered.files) && rendered.files.length > 0 ? { files: rendered.files } : {}),
        metadata: {
          ...safeObject(mediaBundle.metadata),
          ...safeObject(rendered.metadata),
        },
      },
    },
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  const body = (req.body || {}) as GenerateCreatorBody;
  const companyId = String(body.company_id || user?.defaultCompanyId || '').trim();
  const topic = String(body.topic || '').trim();
  const contentType = resolveRequestedContentType({
    creatorType: body.creator_type,
    contentType: body.content_type,
  });
  const targetPlatforms = Array.isArray(body.target_platforms)
    ? body.target_platforms.map((platform) => String(platform || '').trim().toLowerCase()).filter(Boolean)
    : [];

  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic) {
    return res.status(400).json({ error: 'topic required' });
  }
  if (!contentType) {
    return res.status(400).json({ error: 'content_type required' });
  }
  if (targetPlatforms.length === 0) {
    return res.status(400).json({ error: 'target_platforms required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const creatorEngine = createCreatorExecutionEngine();
    const generated = await creatorEngine.generateFromIntent({
      campaignId: `creator-content-${Date.now()}`,
      companyId,
      userId: user?.userId ?? null,
      topic,
      contentType,
      targetPlatforms,
      audience: String(body.audience || '').trim() || undefined,
      objective: String(body.objective || '').trim() || undefined,
      summary: String(body.summary || '').trim() || undefined,
      creatorCard: safeObject(body.creator_card),
    });

    const primaryPlatform = targetPlatforms[0];
    const adapted = await creatorEngine.adaptForPlatform(generated, primaryPlatform);
    const rendered = await renderAsset(safeObject(adapted.asset_payload), {
      campaignId: null,
      userId: user?.userId ?? null,
    });
    const output = mergeRenderedMedia(adapted, rendered);

    return res.status(200).json({
      success: true,
      primary_platform: primaryPlatform,
      output,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate creator content',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

