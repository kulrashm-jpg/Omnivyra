import React, { useEffect, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import PlaybookList from '../../components/community-ai/PlaybookList';
import PlaybookEditor, { defaultPlaybook } from '../../components/community-ai/PlaybookEditor';
import type { EngagementPlaybook } from '../../backend/services/playbooks/playbookTypes';

export default function CommunityAiPlaybooks() {
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [playbooks, setPlaybooks] = useState<EngagementPlaybook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingPlaybook, setEditingPlaybook] = useState<EngagementPlaybook | null>(null);

  const loadPlaybooks = async () => {
    if (!tenantId) {
      setPlaybooks([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/community-ai/playbooks?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}`
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load playbooks');
      }
      const data = await response.json();
      setPlaybooks(data?.playbooks || []);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load playbooks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlaybooks();
  }, [tenantId]);

  const handleCreate = () => {
    if (!tenantId) return;
    setEditingPlaybook(defaultPlaybook(tenantId, tenantId));
  };

  const handleSave = async (playbook: EngagementPlaybook) => {
    if (!tenantId) return;
    setErrorMessage(null);
    try {
      const isUpdate = Boolean(playbook.id);
      const response = await fetchWithAuth('/api/community-ai/playbooks', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...playbook,
          tenant_id: tenantId,
          organization_id: tenantId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save playbook');
      }
      setEditingPlaybook(null);
      await loadPlaybooks();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save playbook');
    }
  };

  const handleToggleStatus = async (playbook: EngagementPlaybook) => {
    if (!tenantId || !playbook.id) return;
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/community-ai/playbooks', {
        method: playbook.status === 'active' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: playbook.id,
          status: playbook.status === 'active' ? 'inactive' : 'active',
          tenant_id: tenantId,
          organization_id: tenantId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update playbook');
      }
      await loadPlaybooks();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update playbook');
    }
  };

  return (
    <CommunityAiLayout title="Playbook Settings" context={{ tenant_id: tenantId, organization_id: tenantId }}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Playbooks" subtitle="Manage engagement playbooks and automation rules.">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-600">{isLoading ? 'Loading...' : ''}</div>
          <button
            className="px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
            onClick={handleCreate}
          >
            New Playbook
          </button>
        </div>
        <PlaybookList
          playbooks={playbooks}
          onEdit={(playbook) => setEditingPlaybook(playbook)}
          onToggleStatus={handleToggleStatus}
        />
      </SectionCard>

      {editingPlaybook && (
        <SectionCard title="Edit Playbook">
          <PlaybookEditor
            playbook={editingPlaybook}
            onSave={handleSave}
            onCancel={() => setEditingPlaybook(null)}
          />
        </SectionCard>
      )}
    </CommunityAiLayout>
  );
}
