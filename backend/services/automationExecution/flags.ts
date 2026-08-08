/**
 * Automation Runtime activation flags — BOTH DEFAULT OFF. Mirrors the
 * Visitor/Journey/Company/Offering Tier-2 convention; consumed by nothing in
 * production until an operator flips them.
 *
 * WHY THESE EXIST SEPARATELY FROM `AUTOMATION_EXECUTE`.
 * `AUTOMATION_EXECUTE` and `AUTOMATION_EXECUTE_PROD` are RBAC CAPABILITY strings
 * (shared/contracts/security/SecurityCapabilities.ts:54-55, with a parent/child
 * grant at line 217). They gate WHO may execute automation, not WHETHER the
 * asynchronous runtime is active. Reusing them as an activation switch would
 * conflate authorization with rollout — a caller holding the capability would
 * silently activate the runtime.
 *
 * SHADOW / AUTHORITATIVE PAIRING, as used across the Understanding subsystems:
 *   *_ENABLED       — the async runtime may enqueue; execution is observable but
 *                     the synchronous path remains the source of truth.
 *   *_AUTHORITATIVE — the async runtime becomes the execution path.
 *
 * Nothing in this module reads a queue, a worker or the orchestrator. It is a
 * pure predicate pair, so importing it cannot change runtime behaviour.
 */
export function isAutomationRuntimeEnabled(): boolean {
  return process.env.AUTOMATION_RUNTIME_ENABLED === 'true';
}

export function isAutomationRuntimeAuthoritative(): boolean {
  return process.env.AUTOMATION_RUNTIME_AUTHORITATIVE === 'true';
}
