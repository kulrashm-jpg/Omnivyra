import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { ORGANIZATION_MANAGE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Playbook ID is required' });
  }

  const { data: playbook, error: playbookError } = await supabase
    .from('virality_playbooks')
    .select('*')
    .eq('id', id)
    .single();

  if (playbookError || !playbook) {
    return res.status(404).json({ error: 'Playbook not found' });
  }

  if (req.method === 'PUT') {
    // Wave 2C-B: capability-based gate with org scope. organization.manage
    // is granted to COMPANY_ADMIN + SUPER_ADMIN. No step-up required for
    // playbook updates (medium-risk; not in STEP_UP_REQUIRED_CAPABILITIES).
    const guard = await requireCapability(req, res, {
      capability: ORGANIZATION_MANAGE,
      organizationId: playbook.company_id,
      reason: 'update virality playbook',
      resourceId: id,
    });
    if (guard.ok !== true) return;
    const {
      name,
      objective,
      platforms,
      content_types,
      api_inputs,
      tone_guidelines,
      cadence_guidelines,
      success_metrics,
      status,
    } = req.body || {};
    const payload = {
      name: name ?? playbook.name,
      objective: objective ?? playbook.objective,
      platforms: platforms ?? playbook.platforms,
      content_types: content_types ?? playbook.content_types,
      api_inputs: api_inputs ?? playbook.api_inputs ?? [],
      tone_guidelines: tone_guidelines ?? playbook.tone_guidelines ?? null,
      cadence_guidelines: cadence_guidelines ?? playbook.cadence_guidelines ?? null,
      success_metrics: success_metrics ?? playbook.success_metrics ?? {},
      status: status ?? playbook.status ?? 'draft',
      updated_at: new Date().toISOString(),
    };
    const { data, error: updateError } = await supabase
      .from('virality_playbooks')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) {
      return res.status(500).json({ error: 'Failed to update playbook' });
    }
    return res.status(200).json({ playbook: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/virality/playbooks/:id' });
