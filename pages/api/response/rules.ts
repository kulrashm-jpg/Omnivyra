import { seamDenial } from '../../../backend/db/seamDenial';
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Response Rules API
 * GET: List rules for organization
 * POST: Create rule
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { tenantTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

/** A platform filter value is interpolated into a PostgREST or-filter, so only plain tokens are accepted. */
const PLATFORM_TOKEN = /^[a-z0-9_-]{1,40}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId =
      (req.query.organization_id ?? req.query.organizationId ?? req.body?.organization_id ?? user?.defaultCompanyId) as
        | string
        | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // S2 tenant seam (two-id sweep UNBOUND-READ, 2026-11-13). response_rules AND response_templates are scoped by
    // organization_id = the company enforceCompanyAccess just authorized.
    let rulesTable: ReturnType<typeof tenantTable>;
    let templatesTable: ReturnType<typeof tenantTable>;
    try {
      const tenant = tenantContextFor(access, organizationId);
      rulesTable = tenantTable('response_rules', tenant);
      templatesTable = tenantTable('response_templates', tenant);
    } catch (err) {
      if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Not found' });
      throw err;
    }

    if (req.method === 'GET') {
      const platform = (req.query.platform as string)?.trim() || undefined;
      const intent = (req.query.intent_type as string)?.trim() || undefined;
      if (platform && !PLATFORM_TOKEN.test(platform)) {
        return res.status(400).json({ error: 'invalid platform' });
      }

      // The old embed response_templates(template_name) followed template_id with NO organization predicate, so a
      // rule holding another company's template id returned THAT company's template name. Names now come from a
      // tenant-scoped read: a foreign (or missing) template resolves to null.
      let query = rulesTable
        .select('id, platform, intent_type, template_id, auto_reply, priority, created_at')
        .order('priority', { ascending: false });

      if (platform) query = query.or(`platform.eq.${platform},platform.is.null`);
      if (intent) query = query.eq('intent_type', intent);

      const { data, error } = await query;

      if (error) {
        console.error('[response/rules]', error.message);
        return res.status(500).json({ error: error.message });
      }
      const rules = (data ?? []) as Array<Record<string, unknown> & { template_id?: string | null }>;
      const templateIds = Array.from(new Set(rules.map((r) => r.template_id).filter((id): id is string => typeof id === 'string')));
      const names = new Map<string, string | null>();
      if (templateIds.length > 0) {
        const { data: templates, error: tplError } = await templatesTable.select('id, template_name').in('id', templateIds);
        if (tplError) {
          console.error('[response/rules]', tplError.message);
          return res.status(500).json({ error: tplError.message });
        }
        for (const t of (templates ?? []) as Array<{ id: string; template_name: string | null }>) names.set(t.id, t.template_name);
      }
      return res.status(200).json({
        rules: rules.map((r) => ({
          ...r,
          // Same shape as the old embed (object or null) for compatibility.
          response_templates: r.template_id && names.has(r.template_id) ? { template_name: names.get(r.template_id) ?? null } : null,
        })),
      });
    }

    const body = req.body || {};
    const platform = (body.platform ?? '').toString().trim() || null;
    const intent_type = (body.intent_type ?? '').toString().trim();
    const template_id = body.template_id;

    if (!intent_type || !template_id) {
      return res.status(400).json({ error: 'intent_type and template_id required' });
    }
    if (typeof template_id !== 'string' || !UUID_RE.test(template_id)) {
      return res.status(400).json({ error: 'template_id must be a uuid' });
    }

    // The FK response_rules_template_id_fkey accepts ANY company's template, so the template must be proven to belong
    // to the authorized company before the rule references it. Another company's template answers exactly like a
    // missing one, and nothing is inserted.
    const { data: ownTemplate, error: tplError } = await templatesTable.select('id').eq('id', template_id).maybeSingle();
    if (tplError) {
      console.error('[response/rules]', tplError.message);
      return res.status(500).json({ error: tplError.message });
    }
    if (!ownTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const { data, error } = await rulesTable
      .insert({
        platform,
        intent_type,
        template_id,
        auto_reply: Boolean(body.auto_reply),
        priority: Number(body.priority) || 0,
      })
      .select('id, platform, intent_type, template_id, auto_reply, priority, created_at')
      .single();

    if (error) {
      console.error('[response/rules]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/rules]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/response/rules' });
