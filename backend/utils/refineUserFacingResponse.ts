/**
 * Refine user-facing response utility.
 * Recursively scans objects and refines string fields via languageRefinementService.
 * Does not integrate globally — use explicitly where needed.
 */

import { refineLanguageOutput } from '../services/languageRefinementService';

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
    const refined = await Promise.all(data.map((item) => refineUserFacingResponse(item)));
    return refined as T;
  }

  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = await refineUserFacingResponse(value);
    }
    return out as T;
  }

  return data;
}
