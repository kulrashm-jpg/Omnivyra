/**
 * WS-1c-3b (PMO-ADR-09) — TASK-PROFILE REGISTRY + SELECTOR.
 *
 * The single lookup for the ADDITIVE non-master profiles. `selectTaskProfile`
 * inspects a GenerationRequest and returns a registered profile key ONLY when the
 * caller explicitly asked for one; otherwise it returns null and the runtime runs
 * the DEFAULT master body byte-identically. Existing callers never set
 * `req.taskProfile`, so this selector is inert for the master / post / thread /
 * #7 / BOLT paths.
 *
 * The registry does NOT contain a 'master' entry — the master path stays inline in
 * generationRuntime.generate() to guarantee byte-parity (see taskProfiles/types.ts).
 */

import type { GenerationRequest } from '../contracts';
import type { TaskProfile } from './types';
import { dayContentProfile } from './dayContentProfile';
import { blueprintProfile } from './blueprintProfile';

/** All registered NON-master profiles, keyed by selector. */
const REGISTRY: ReadonlyMap<string, TaskProfile> = new Map<string, TaskProfile>([
  [dayContentProfile.key, dayContentProfile as TaskProfile],
  [blueprintProfile.key, blueprintProfile as TaskProfile],
]);

/** Reserved default key — never routes to the registry (master stays inline). */
export const MASTER_PROFILE_KEY = 'master';

/** Look up a registered profile, or undefined. */
export function getTaskProfile(key: string): TaskProfile | undefined {
  return REGISTRY.get(key);
}

/** Every registered non-master profile key (for tooling/tests). */
export function registeredTaskProfileKeys(): string[] {
  return [...REGISTRY.keys()];
}

/**
 * Decide whether a request routes through a task profile. Returns the registered
 * key, or null for the default master path (absent / empty / 'master' / unknown).
 * NOTHING here can throw — an unrecognized value falls through to master.
 */
export function selectTaskProfile(req: GenerationRequest): string | null {
  const raw = typeof req.taskProfile === 'string' ? req.taskProfile.trim() : '';
  if (!raw || raw === MASTER_PROFILE_KEY) return null;
  return REGISTRY.has(raw) ? raw : null;
}
