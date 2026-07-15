import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { generateTemplateIntent } from '../../../backend/services/creator/aiTemplateIntentService';
import { createUserTemplateFromSeed } from '../../../backend/services/creator/userTemplateService';
import { compileTemplateIntent } from '../../../lib/creator-templates/aiTemplateCompiler';
import { familyForCreatorType } from '../../../lib/creator-templates';

/**
 * POST /api/creator-templates/ai-generate  { prompt, company_id, family? }
 *
 * AI Template Creator: natural language → Template INTENT (AI) → deterministic
 * compiler → CreatorTemplate → existing create pipeline (preview + validation +
 * Quality Inspector). The AI never produces a CreatorTemplate. Returns the
 * created draft so the client can open it in the existing editor.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const family = typeof body.family === 'string' ? (familyForCreatorType(body.family) ?? undefined) : undefined;

  // 1) AI → validated Template Intent (deterministic fallback inside).
  const { intent, source } = await generateTemplateIntent({ prompt, companyId, family: family ?? null });

  // 2) Deterministic compiler → CreatorTemplate, persisted via the existing
  //    create path (which enqueues the durable preview + diagnostic pipeline).
  const created = await createUserTemplateFromSeed({
    companyId,
    ownerUserId: user.userId,
    build: (id) => compileTemplateIntent(intent, { id, ownerUserId: user.userId }),
  });
  if (!created) return res.status(503).json({ error: 'Could not create template (user template storage unavailable).' });

  return res.status(201).json({ template: created, intent, intentSource: source });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/ai-generate' });
