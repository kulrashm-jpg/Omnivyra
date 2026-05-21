/**
 * LOCALHOST-ONLY: real-attribution reconciliation soak.
 *
 * Builds manifests in-memory (NOT JSON files — keeps the existing fixtures
 * untouched) that use fresh providerInvoiceId values so the matcher actually
 * runs and produces attributed adjustments against the seeded usage_events.
 *
 * Pre-condition: usage_events must contain rows for org-1 / org-2 covering
 * the (provider_name, model_name, day) buckets in the invoice payloads.
 * Seed externally via psql before running.
 */

import {
  validateManifest,
  dispatchReconciliation,
  assertLocalhostOnly,
  type DispatchOrchestrators,
  type ReconciliationManifest,
} from '../backend/services/billing/reconciliation/runnerDispatch';

async function main() {
  const guard = assertLocalhostOnly();
  if (!guard.ok) {
    console.error(JSON.stringify({ ok: false, error: (guard as { ok: false; error: string }).error }));
    process.exitCode = 3;
    return;
  }

  const { ingestOpenAiInvoice }    = await import('../backend/services/billing/reconciliation/openaiReconciler');
  const { ingestAnthropicInvoice } = await import('../backend/services/billing/reconciliation/anthropicReconciler');
  const { ingestAudioInvoice }     = await import('../backend/services/billing/reconciliation/audioReconciler');
  const { ingestImageInvoice }     = await import('../backend/services/billing/reconciliation/imageReconciler');
  const { ingestGeminiInvoice }    = await import('../backend/services/billing/reconciliation/geminiReconciler');
  const { ingestStripeInvoice }    = await import('../backend/services/billing/reconciliation/stripeReconciler');

  const orchestrators: DispatchOrchestrators = {
    openai: ingestOpenAiInvoice, anthropic: ingestAnthropicInvoice,
    gemini: ingestGeminiInvoice, audio: ingestAudioInvoice,
    image: ingestImageInvoice, stripe: ingestStripeInvoice,
  };

  const tokenRates = { 'gpt-4o-mini': { in_per_1k: 0.00015, out_per_1k: 0.0006 } };
  const claudeRates = { 'claude-3-5-sonnet-20240620': { in_per_1k: 0.003, out_per_1k: 0.015 } };

  const manifests: ReconciliationManifest[] = [
    // OpenAI: invoice gross $0.004 — usage_events have org-1 $0.003 + org-2 $0.001 = $0.004 ✓ exact match
    {
      provider: 'openai',
      providerInvoiceId: 'openai_attribution_v1',
      periodStart: '2026-05-19T00:00:00Z',
      periodEnd:   '2026-05-20T00:00:00Z',
      rates: { tokens: tokenRates, defaultToken: { in_per_1k: 0.0002, out_per_1k: 0.0008 } },
      payload: { data: [
        { aggregation_timestamp: Math.floor(Date.UTC(2026,4,19,12)/1000), snapshot_id: 'gpt-4o-mini',
          n_requests: 10, n_context_tokens_total: 20000, n_generated_tokens_total: 0, operation: 'completion' },
      ]},
    },
    // Anthropic: invoice $0.0105 — usage events org-1 $0.007 + org-2 $0.0035 = $0.0105 ✓ exact
    {
      provider: 'anthropic',
      providerInvoiceId: 'anthropic_attribution_v1',
      periodStart: '2026-05-19T00:00:00Z',
      periodEnd:   '2026-05-20T00:00:00Z',
      kind: 'billing',
      rates: { tokens: claudeRates, defaultToken: { in_per_1k: 0.001, out_per_1k: 0.004 } },
      payload: { line_items: [
        { period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620',
          input_tokens: 1500, output_tokens: 750, amount_usd: 0.0105 },
      ]},
    },
    // Audio (Whisper): invoice $0.009 — usage events $0.006 + $0.003 = $0.009 ✓ exact
    {
      provider: 'audio',
      providerInvoiceId: 'audio_attribution_v1',
      periodStart: '2026-05-19T00:00:00Z',
      periodEnd:   '2026-05-20T00:00:00Z',
      providerTag: 'openai_audio',
      kind: 'whisper_usage',
      rates: { audio: { 'whisper-1': { per_minute: 0.006 } }, defaultAudio: { per_minute: 0.006 } },
      payload: { whisper_api_data: [
        { timestamp: Math.floor(Date.UTC(2026,4,19,12)/1000), model_id: 'whisper-1', num_seconds: 90, num_requests: 2 },
      ]},
    },
    // Image (DALL·E): invoice $0.40 — usage events $0.20 + $0.12 = $0.32 → 25% variance
    {
      provider: 'image',
      providerInvoiceId: 'image_attribution_v1',
      periodStart: '2026-05-19T00:00:00Z',
      periodEnd:   '2026-05-20T00:00:00Z',
      providerTag: 'openai_image',
      kind: 'dalle_usage',
      rates: { images: { 'dall-e-3': { per_image: 0.04 } }, defaultImage: { per_image: 0.04 } },
      payload: { dalle_api_data: [
        { timestamp: Math.floor(Date.UTC(2026,4,19,12)/1000), image_models: 'dall-e-3', num_images: 10, num_requests: 10 },
      ]},
    },
  ];

  for (const m of manifests) {
    const v = validateManifest(m);
    if (!v.ok) {
      console.log(JSON.stringify({ provider: m.provider, ok: false, error: (v as { ok: false; error: string }).error }));
      continue;
    }
    const r = await dispatchReconciliation(v.manifest, orchestrators);
    console.log(JSON.stringify({ provider: m.provider, providerInvoiceId: m.providerInvoiceId, outcome: r }));
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
