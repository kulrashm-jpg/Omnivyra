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

const CREATOR_GENERATION_API_TIMEOUT_MS = 120_000;

function withCreatorTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = CREATOR_GENERATION_API_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(Object.assign(
        new Error(`${label} timed out. Please try again in a moment.`),
        { statusCode: 504 },
      ));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

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

function humanize(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveBetaAssetType(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  if (['carousel', 'pdf', 'slider'].includes(normalized)) return 'carousel';
  return 'image';
}

function buildBetaCreatorFallback(input: {
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard?: Record<string, unknown>;
  fallbackReason?: string;
}) {
  const assetType = resolveBetaAssetType(input.contentType);
  const platform = input.targetPlatforms[0] || 'linkedin';
  const audience = input.audience || String(input.creatorCard?.audience || '').trim() || 'the target audience';
  const objective = input.objective || String(input.creatorCard?.objective || '').trim() || 'clarity';
  const overlayText = safeObject(input.creatorCard?.overlay_text);
  const cta = String(overlayText.cta || input.creatorCard?.cta || input.creatorCard?.CTA || '').trim() || 'Learn more';
  const visualIntent = String(input.creatorCard?.visual_intent || input.creatorCard?.constraints || input.summary || '').trim();
  const hook = String(overlayText.hook || '').trim() || `${humanize(platform)} ${humanize(input.contentType)}: ${input.topic}`;
  const headline = String(overlayText.headline || '').trim() || hook;
  const body = `Frame the idea for ${audience} with ${objective} as the primary goal. ${visualIntent ? `Use this direction: ${visualIntent}` : 'Keep the message concrete, useful, and platform-native.'}`;
  const slides = assetType === 'carousel'
    ? [
        { slide_number: 1, role: 'hook', headline: hook, body_text: `Open with the most urgent audience problem behind ${input.topic}.` },
        { slide_number: 2, role: 'context', headline: 'Why it matters now', body_text: body },
        { slide_number: 3, role: 'insight', headline: 'The practical shift', body_text: 'Show the before-and-after behavior or decision the audience should understand.' },
        { slide_number: 4, role: 'proof', headline: 'Make it credible', body_text: 'Add a concrete signal, example, or operational detail that makes the point feel earned.' },
        { slide_number: 5, role: 'cta', headline: cta, body_text: 'Close with one specific next step.' },
      ]
    : [];

  return {
    intent_type: 'creator',
    asset_type: assetType,
    asset_instruction: {
      blueprint: {
        headline: hook,
        body,
        cta,
        slides,
      },
      structure: assetType === 'carousel' ? 'slide_series' : 'single_visual',
      visual_style: String(input.creatorCard?.tone || input.creatorCard?.brand_generation_mode || 'creator-led'),
      template_id: `beta-fallback-${assetType}`,
    },
    asset_payload: {
      asset_kind: assetType,
      visual_descriptor: {
        headline,
        visual_description: body,
      },
      overlay_text: overlayText,
      ...(slides.length ? { slides, slide_count: slides.length } : {}),
      media_bundle: {
        metadata: {
          generated_by: 'creator-beta-fallback',
          placeholder: true,
          overlay_text: overlayText,
          platform,
        },
      },
    },
    packaging: {
      caption: `${hook}\n\n${body}\n\n${cta}`,
      hashtags: ['#CreatorContent', `#${humanize(platform).replace(/\s+/g, '')}`, '#Authority'],
      cta,
      meta_description: `${input.topic} creator direction for ${audience}.`.slice(0, 160),
      keywords: [input.topic, input.contentType, platform].filter(Boolean),
      platform_variants: {},
    },
    generation_prompt: `creator-fallback:${assetType}:${input.topic}`,
    metadata: {
      beta_fallback: true,
      fallback_reason: input.fallbackReason ? input.fallbackReason.slice(0, 220) : 'unknown',
      content_type: input.contentType,
      target_platforms: input.targetPlatforms,
    },
  };
}

function shouldUseCreatorFallback(error: unknown): boolean {
  const anyError = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  const code = String(anyError?.code || '').toUpperCase();
  const message = String(anyError?.message || (error instanceof Error ? error.message : '') || '').toLowerCase();
  const status = Number(anyError?.statusCode ?? anyError?.status ?? 0);

  if (code === 'PLAN_LIMIT_EXCEEDED' || code === 'COST_BLOCKED') return false;
  if (status === 401 || status === 403 || status === 402) return false;
  if (
    message.includes('pricingservice') ||
    message.includes('credit_rate_usd') ||
    message.includes('monthly llm token limit') ||
    message.includes('cost_blocked') ||
    message.includes('plan_limit_exceeded') ||
    message.includes('missing openai_api_key')
  ) {
    return false;
  }

  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const intelligenceBrief = null;
    const creatorEngine = createCreatorExecutionEngine();
    const primaryPlatform = targetPlatforms[0];
    const output = await withCreatorTimeout((async () => {
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
        enrichedIntent: intelligenceBrief ? {
          analytics_intelligence: {
            content_type: intelligenceBrief.content_type,
            readiness: intelligenceBrief.readiness,
            prompt_block: intelligenceBrief.prompt_block,
            low_confidence_note: intelligenceBrief.low_confidence_note,
            primitives: intelligenceBrief.primitives,
            recommended_uses: intelligenceBrief.recommended_uses,
          },
        } : undefined,
      });

      const adapted = await creatorEngine.adaptForPlatform(generated, primaryPlatform);
      const rendered = await renderAsset(safeObject(adapted.asset_payload), {
        campaignId: null,
        userId: user?.userId ?? null,
        companyId,
      });
      return mergeRenderedMedia(adapted, rendered);
    })(), 'Creator generation').catch((error) => {
      if (!shouldUseCreatorFallback(error)) {
        throw error;
      }
      console.warn('[creator-content][fallback-output-used]', {
        company_id: companyId,
        content_type: contentType,
        message: error instanceof Error ? error.message : String(error),
      });
      return buildBetaCreatorFallback({
        topic,
        contentType,
        targetPlatforms,
        audience: String(body.audience || '').trim() || undefined,
        objective: String(body.objective || '').trim() || undefined,
        summary: String(body.summary || '').trim() || undefined,
        creatorCard: safeObject(body.creator_card),
        fallbackReason: error instanceof Error ? error.message : String(error),
      });
    });

    return res.status(200).json({
      success: true,
      primary_platform: primaryPlatform,
      intelligence_brief: intelligenceBrief,
      output,
    });
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Failed to generate creator content',
    });
  }
}
