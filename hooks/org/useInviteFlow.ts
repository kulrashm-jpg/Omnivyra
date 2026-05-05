import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export function useInviteFlow(organization_id: string) {
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const inviteMember = useCallback(async (input: { email: string; role: string }) => {
    setIsInviting(true);
    setInviteError(null);
    try {
      const response = await apiFetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id,
          email: input.email,
          role: input.role,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to invite member');
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to invite member';
      setInviteError(message);
      throw error;
    } finally {
      setIsInviting(false);
    }
  }, [organization_id]);

  return {
    isInviting,
    inviteError,
    inviteMember,
  };
}
