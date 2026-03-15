/**
 * Refine user-facing response utility.
 * Recursively scans objects and refines string fields via languageRefinementService.
 * Does not integrate globally — use explicitly where needed.
 *
 * Enforces: all user-visible text passes through the Language Module before API response.
 */

import { refineLanguageOutput } from '../services/languageRefinementService';

/** Single enforcement wrapper: standardizes tone, clarity, and narrative structure for user output. */
export async function formatForUserOutput<T>(data: T): Promise<T> {
  return refineUserFacingResponse(data);
}

/** Check if array contains only strings (enables batch refinement). */
function isStringArray(arr: unknown[]): arr is string[] {
  return arr.length > 0 && arr.every((x) => typeof x === 'string');
}

export async function refineUserFacingResponse<T>(data: T): Promise<T> {
  if (data == null) {
    return data;
  }

  if (typeof data === 'string') {
    if (!data.trim()) return data;
    const r = await refineLanguageOutput({ content: data, card_type: 'general' });
    return (r.refined as string) as T;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    if (isStringArray(data)) {
      const r = await refineLanguageOutput({ content: data, card_type: 'general' });
      return (Array.isArray(r.refined) ? r.refined : [r.refined as string]) as T;
    }
    const refined = await Promise.all(data.map((item) => refineUserFacingResponse(item)));
    return refined as T;
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    const refined = await Promise.all(
      entries.map(async ([key, value]) => [key, await refineUserFacingResponse(value)] as const)
    );
    return Object.fromEntries(refined) as T;
  }

  return data;
}
