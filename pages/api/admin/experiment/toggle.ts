
/**
 * POST /api/admin/experiment/toggle
 *
 * Enable or disable an A/B experiment by name.
 *
 * Body: { experiment_name: string, active: boolean, note?: string }
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { invalidateConfigCache } from '@/backend/services/configService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.cookies?.super_admin_session !== '1') {
    return res.status(403).json({ error: 'Super admin access required' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { experiment_name, active, note } = body as {
    experiment_name?: string;
    active?: boolean;
    note?: string;
  };

  if (!experiment_name || typeof active !== 'boolean') {
    return res.status(400).json({ error: 'experiment_name (string) and active (boolean) required' });
  }

  try {
    // Load current state for audit
    const { data: existing } = await supabase
      .from('experiment_config')
      .select('*')
      .eq('experiment_name', experiment_name)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: `Experiment "${experiment_name}" not found` });
    }

    // Toggle
    const { error } = await supabase
      .from('experiment_config')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('experiment_name', experiment_name);

    if (error) return res.status(500).json({ error: error.message });

    // Audit log
    await supabase.from('config_change_logs').insert({
      config_type:  'experiment_config',
      changed_by:   'super_admin',
      before_json:  existing,
      after_json:   { ...existing, active, updated_at: new Date().toISOString() },
      note:         note ?? `Experiment ${active ? 'enabled' : 'disabled'} via admin panel`,
      created_at:   new Date().toISOString(),
    });

    // Bust experiment cache so processContent picks up change immediately
    invalidateConfigCache('experiment_config');

    return res.status(200).json({
      success: true,
      experiment_name,
      active,
      message: `Experiment "${experiment_name}" ${active ? 'enabled' : 'disabled'}`,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
