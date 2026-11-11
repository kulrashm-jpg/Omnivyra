/**
 * The creator_render_attempt / job_execution_registry execution hash for attempt N of a render job.
 *
 * TENANT-SCOPED: deterministic_input_hash is computed from the CONTENT alone, and both tables are
 * UNIQUE (execution_hash) GLOBALLY, so a bare content hash lets a second tenant with identical content
 * collide with the first. Attempt 1 keeps the unsuffixed shape the sync path already wrote; attempt
 * N >= 2 gets `:a<N>`. The sync executor and the async worker share attempt numbers through
 * creator_render_job_state.retry_count, so one job never writes the same attempt key twice.
 */
export function renderAttemptExecutionHash(organizationId: string, specHash: string, attemptNumber: number): string {
  const base = `${organizationId}:${specHash}`;
  return attemptNumber > 1 ? `${base}:a${attemptNumber}` : base;
}
