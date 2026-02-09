import { supabase } from '../../db/supabaseClient';
import type { EngagementPlaybook } from './playbookTypes';

export const createPlaybook = async (playbook: EngagementPlaybook) => {
  const { data, error } = await supabase
    .from('community_ai_playbooks')
    .insert({
      ...playbook,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .limit(1);
  if (error) {
    throw new Error(`Failed to create playbook: ${error.message}`);
  }
  return data?.[0] || null;
};

export const updatePlaybook = async (
  id: string,
  playbook: Partial<EngagementPlaybook> & { tenant_id: string; organization_id: string }
) => {
  const { data, error } = await supabase
    .from('community_ai_playbooks')
    .update({ ...playbook, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', playbook.tenant_id)
    .eq('organization_id', playbook.organization_id)
    .select('*')
    .limit(1);
  if (error) {
    throw new Error(`Failed to update playbook: ${error.message}`);
  }
  return data?.[0] || null;
};

export const listPlaybooks = async (tenant_id: string, organization_id: string) => {
  const { data, error } = await supabase
    .from('community_ai_playbooks')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list playbooks: ${error.message}`);
  }
  return data || [];
};

export const getPlaybookById = async (
  id: string,
  tenant_id: string,
  organization_id: string
) => {
  const { data, error } = await supabase
    .from('community_ai_playbooks')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .single();
  if (error) {
    throw new Error(`Failed to get playbook: ${error.message}`);
  }
  return data || null;
};

export const deactivatePlaybook = async (
  id: string,
  tenant_id: string,
  organization_id: string
) => {
  const { data, error } = await supabase
    .from('community_ai_playbooks')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .select('*')
    .limit(1);
  if (error) {
    throw new Error(`Failed to deactivate playbook: ${error.message}`);
  }
  return data?.[0] || null;
};
