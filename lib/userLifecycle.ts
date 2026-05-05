export enum UserState {
  INVITED = 'invited',
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export type UserLifecycleTransition = {
  from: UserState;
  to: UserState;
  trigger: string;
  auditActorId?: string | null;
};

const VALID_TRANSITIONS: Record<UserState, UserState[]> = {
  [UserState.INVITED]: [UserState.PENDING, UserState.DELETED],
  [UserState.PENDING]: [UserState.ACTIVE],
  [UserState.ACTIVE]: [UserState.SUSPENDED, UserState.DELETED],
  [UserState.SUSPENDED]: [UserState.ACTIVE],
  [UserState.DELETED]: [UserState.ACTIVE],
};

export class InvalidUserLifecycleTransitionError extends Error {
  constructor(from: UserState, to: UserState) {
    super(`Invalid user lifecycle transition: ${from} -> ${to}`);
    this.name = 'InvalidUserLifecycleTransitionError';
  }
}

export function normalizeUserState(value: unknown): UserState {
  const normalized = String(value ?? '').trim().toLowerCase();
  if ((Object.values(UserState) as string[]).includes(normalized)) {
    return normalized as UserState;
  }
  throw new Error(`Unknown user state: ${String(value)}`);
}

export function assertValidTransition(from: UserState, to: UserState): void {
  if (from === to && from !== UserState.PENDING) return;
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidUserLifecycleTransitionError(from, to);
  }
}

export function buildLifecycleAudit(transition: UserLifecycleTransition) {
  assertValidTransition(transition.from, transition.to);
  return {
    previous_state: transition.from,
    next_state: transition.to,
    trigger: transition.trigger,
    actor_user_id: transition.auditActorId ?? null,
    changed_at: new Date().toISOString(),
  };
}
