import type { NextApiRequest, NextApiResponse } from 'next';
import {
  listTemplatesForFamily,
  listCategoriesForFamily,
  familyForCreatorType,
  type CreatorTemplate,
  type TemplateAssetFamily,
} from '../../../lib/creator-templates';

/**
 * GET /api/creator-templates?asset_type=image|carousel|infographic
 *
 * Read-only template gallery feed. Returns the system templates + categories
 * for one asset family. Additive route — does not touch the generation
 * pipeline. User/AI templates (DB-backed) slot in behind the same response
 * shape in the persistence phase.
 *
 * Optional: omit `asset_type` to receive all three families keyed by family.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawType = typeof req.query.asset_type === 'string' ? req.query.asset_type : '';
  const family = familyForCreatorType(rawType);

  if (rawType && !family) {
    return res.status(400).json({ error: `Unsupported asset_type "${rawType}". Expected image | carousel | infographic.` });
  }

  if (family) {
    return res.status(200).json({
      asset_type: family,
      categories: listCategoriesForFamily(family),
      templates: listTemplatesForFamily(family).map(toSummary),
    });
  }

  // No asset_type → return all families.
  const families: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
  return res.status(200).json({
    families: families.map((f) => ({
      asset_type: f,
      categories: listCategoriesForFamily(f),
      templates: listTemplatesForFamily(f).map(toSummary),
    })),
  });
}

/** Gallery-card projection (drops nothing material — templates are small). */
function toSummary(t: CreatorTemplate) {
  return {
    id: t.id,
    asset_family: t.assetFamily,
    name: t.name,
    category: t.category,
    description: t.description,
    preview: t.preview,
    visual_language: t.visualLanguage,
    form_definition: t.formDefinition,
    rendering_contract: t.renderingContract,
    version: t.version,
    status: t.status,
    ownership: t.ownership,
    tags: t.tags,
  };
}
