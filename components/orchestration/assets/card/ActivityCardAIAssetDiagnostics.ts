/**
 * ActivityCardAIAssetDiagnostics — Phase-2 Step-21 (client, read-only).
 *
 * Observability for AI-asset hydration INTO legacy activity cards.
 * Distinct tag namespace from Step-20 overlay logs (AI_PREVIEW_*).
 * Never throws.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const activityCardAiDiagnostics = {
  preview: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_PREVIEW', p),
  state: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_STATE', p),
  fallback: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_FALLBACK', p),
  replace: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_REPLACE', p),
  restore: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_RESTORE', p),
  failsoft: (p: Record<string, unknown>) => log('ACTIVITY_CARD_AI_FAILSOFT', p),
};
