/**
 * Stage 18 — Deterministic Scheduler Integrity Layer.
 * Guard to ensure campaigns meet requirements before scheduler execution.
 */

export class SchedulerIntegrityError extends Error {
  code:
    | 'SCHEDULER_NOT_ACTIVE'
    | 'SCHEDULER_BLUEPRINT_INACTIVE'
    | 'SCHEDULER_DURATION_UNLOCKED'
    | 'SCHEDULER_PREEMPTED'
    | 'SCHEDULER_IMMUTABLE';

  constructor(code: SchedulerIntegrityError['code']) {
    super(code);
    this.name = 'SchedulerIntegrityError';
    this.code = code;
  }
}

/**
 * Assert campaign is executable by the scheduler.
 * @throws SchedulerIntegrityError when campaign does not meet scheduler requirements.
 */
export function assertSchedulerExecutable(campaign: {
  execution_status: string | null;
  blueprint_status: string | null;
  duration_locked: boolean | null;
}): void {
  const exec = String(campaign.execution_status ?? '').toUpperCase();
  const bp = String(campaign.blueprint_status ?? '').toUpperCase();

  if (exec === 'PREEMPTED') {
    throw new SchedulerIntegrityError('SCHEDULER_PREEMPTED');
  }

  if (exec !== 'ACTIVE') {
    throw new SchedulerIntegrityError('SCHEDULER_NOT_ACTIVE');
  }

  if (bp !== 'ACTIVE') {
    throw new SchedulerIntegrityError('SCHEDULER_BLUEPRINT_INACTIVE');
  }

  if (!campaign.duration_locked) {
    throw new SchedulerIntegrityError('SCHEDULER_DURATION_UNLOCKED');
  }
}
