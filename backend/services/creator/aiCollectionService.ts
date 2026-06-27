/**
 * AI Collection Service — builds a Collection (Design System) from a prompt.
 *
 * Reuses the AI Template Creator end-to-end: for each asset family it generates
 * a Template Intent (AI, deterministic fallback), forces the SHARED brand style
 * so the members form one visual system, compiles + persists each via the
 * existing create pipeline, then groups the resulting templates into a
 * Collection. No new template model, no new rendering path.
 */

import type { TemplateAssetFamily } from '../../../lib/creator-templates';
import { deriveIntentFromPrompt } from '../../../lib/creator-templates/aiTemplateIntent';
import { compileTemplateIntent } from '../../../lib/creator-templates/aiTemplateCompiler';
import { generateTemplateIntent } from './aiTemplateIntentService';
import { createUserTemplateFromSeed } from './userTemplateService';
import { createCollectionRecord } from './collectionService';
import type { TemplateCollection } from '../../../lib/creator-templates/collection';

const DEFAULT_FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

export async function createAiCollection(input: {
  prompt: string;
  companyId: string;
  ownerUserId: string;
  families?: TemplateAssetFamily[];
}): Promise<{ collection: TemplateCollection | null; templateIds: string[]; intentSource: 'ai' | 'fallback' }> {
  const prompt = (input.prompt || '').trim();
  const base = deriveIntentFromPrompt(prompt);
  const families = input.families?.length ? input.families : DEFAULT_FAMILIES;

  const templateIds: string[] = [];
  let anyAi = false;
  for (const family of families) {
    const { intent, source } = await generateTemplateIntent({ prompt, companyId: input.companyId, family });
    if (source === 'ai') anyAi = true;
    // Force the shared design language across every member.
    intent.visualStyle = base.visualStyle;
    const created = await createUserTemplateFromSeed({
      companyId: input.companyId,
      ownerUserId: input.ownerUserId,
      build: (id) => compileTemplateIntent(intent, { id, ownerUserId: input.ownerUserId }),
    });
    if (created) templateIds.push(created.id);
  }

  const collection = await createCollectionRecord({
    companyId: input.companyId,
    ownerUserId: input.ownerUserId,
    name: `${base.name} Collection`,
    description: `${base.category} design system${base.useCases[0] ? ` for ${base.useCases[0].toLowerCase()}` : ''}.`,
    category: base.category,
    brandStyle: base.visualStyle,
    templateIds,
  });

  return { collection, templateIds, intentSource: anyAi ? 'ai' : 'fallback' };
}
