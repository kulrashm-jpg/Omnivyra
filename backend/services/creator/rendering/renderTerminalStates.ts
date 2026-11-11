/**
 * Job states that are final for a tenant + content: guard_render_state_monotonic's v_terminal
 * (supabase/migrations/20260669_creator_render_domain_substrate.sql). A hand copy, so it is pinned BY
 * NAME against the live function body in backend/tests/realschema/render_terminal_states.test.ts: a
 * state added to the SQL set and missing here would be read as "in progress, retryable" and loop.
 */
export const RENDER_TERMINAL_STATES: ReadonlySet<string> = new Set([
  'scheduling_ready', 'handed_to_human',
  'failed_render', 'failed_moderation_pre', 'failed_moderation_post',
  'failed_provider_exhausted', 'failed_timeout',
  'cancelled_by_user', 'cancelled_superseded', 'cancelled_quota',
]);
