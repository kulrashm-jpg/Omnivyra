export const REQUIRED_EXECUTION_LOG_EVENTS = [
  'job_started',
  'job_skipped_locked',
  'job_completed',
  'job_failed',
  'job_dlq',
  'job_replayed',
  'campaign_state_transition',
] as const;

const IMPLEMENTED_EXECUTION_LOG_EVENTS = new Set<string>(REQUIRED_EXECUTION_LOG_EVENTS);

export function assertExecutionObservabilityReady(): void {
  const missing = REQUIRED_EXECUTION_LOG_EVENTS.filter((event) => !IMPLEMENTED_EXECUTION_LOG_EVENTS.has(event));
  if (missing.length > 0) {
    throw new Error(`EXECUTION_OBSERVABILITY_MISSING:${missing.join(',')}`);
  }
}
