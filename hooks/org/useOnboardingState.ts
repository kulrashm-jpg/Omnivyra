import { useMemo } from 'react';
import { UserState } from '../../lib/userLifecycle';

export function useOnboardingState(state?: string | null) {
  const normalizedState = useMemo(
    () => String(state || UserState.PENDING).toLowerCase(),
    [state],
  );

  return {
    state: normalizedState,
    isInvited: normalizedState === UserState.INVITED,
    isPending: normalizedState === UserState.PENDING,
    isActive: normalizedState === UserState.ACTIVE,
    isSuspended: normalizedState === UserState.SUSPENDED,
    isDeleted: normalizedState === UserState.DELETED,
  };
}
