import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export type OrganizationMember = {
  user_id: string;
  email: string | null;
  role: string | null;
  status?: string | null;
  state?: string | null;
};

export function useOrganizationMembers(organization_id: string) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!organization_id) {
      setMembers([]);
      return;
    }

    setIsLoadingMembers(true);
    setMembersError(null);
    try {
      const response = await apiFetch(
        `/api/users?organization_id=${encodeURIComponent(organization_id)}`,
        { cache: 'no-store' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load organization members');
      }
      setMembers(data.users || []);
    } catch (error) {
      setMembers([]);
      setMembersError(error instanceof Error ? error.message : 'Failed to load organization members');
    } finally {
      setIsLoadingMembers(false);
    }
  }, [organization_id]);

  const updateMemberRole = useCallback(async (userId: string, role: string) => {
    const response = await apiFetch(`/api/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id, role }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Failed to update member role');
  }, [organization_id]);

  const removeMember = useCallback(async (userId: string) => {
    const response = await apiFetch(
      `/api/users/${encodeURIComponent(userId)}?organization_id=${encodeURIComponent(organization_id)}`,
      { method: 'DELETE' },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Failed to remove member');
  }, [organization_id]);

  const restoreMember = useCallback(async (userId: string) => {
    const response = await apiFetch('/api/users/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id, userId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Failed to restore member');
  }, [organization_id]);

  return {
    members,
    setMembers,
    isLoadingMembers,
    membersError,
    loadMembers,
    updateMemberRole,
    removeMember,
    restoreMember,
  };
}
