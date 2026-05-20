/**
 * Operator reconciliation runner — pure dispatch core.
 *
 * Turns a single declarative manifest into a single orchestrator call.
 * No DB I/O; the orchestrators are injected so this layer is unit-testable
 * without `supabase`. The CLI shim (`scripts/run-reconciliation.ts`) wires the
 * real orchestrators and enforces the localhost-only env guard.
 *
 * Strict contract:
 *   - Pure validation; throws never; returns structured error on malformed input.
 *   - Provider-key dispatch is exhaustive — adding a provider requires both a
 *     ProviderKey union member and a switch case (TypeScript exhaustive check).
 *   - Each orchestrator call gets EXACTLY the keys it declares in IngestXArgs.
 *     No extra fields, no missing required fields — caller validation here
 *     so the orchestrator surface is unchanged.
 */

import type { IngestOpenAiArgs,    IngestOutcome as OpenAiOutcome    } from './openaiReconciler';
import type { IngestAnthropicArgs, IngestOutcome as AnthropicOutcome } from './anthropicReconciler';
import type { IngestGeminiArgs,    IngestOutcome as GeminiOutcome    } from './geminiReconciler';
import type { IngestAudioArgs,     IngestOutcome as AudioOutcome     } from './audioReconciler';
import type { IngestImageArgs,     IngestOutcome as ImageOutcome     } from './imageReconciler';
import type { IngestStripeArgs,    IngestOutcome as StripeOutcome    } from './stripeReconciler';
import type { RateTable } from './openaiAdapter';

export type ProviderKey = 'openai' | 'anthropic' | 'gemini' | 'audio' | 'image' | 'stripe';

const SUPPORTED_KINDS: Record<Exclude<ProviderKey, 'openai'>, string[]> = {
  anthropic: ['billing', 'messages_usage'],
  gemini:    ['gcb_export', 'usage_metadata'],
  audio:     ['billing', 'whisper_usage', 'assemblyai_usage'],
  image:     ['billing', 'dalle_usage', 'image_usage'],
  stripe:    ['balance', 'webhook'],
};

const SUPPORTED_AUDIO_TAGS = ['openai_audio', 'assemblyai'] as const;

export interface ReconciliationManifest {
  provider: ProviderKey;
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  /** Provider-specific payload kind. Required for everything EXCEPT openai. */
  kind?: string;
  /** Required for audio (openai_audio|assemblyai) and image (openai_image|image:<name>). */
  providerTag?: string;
  /** Image only, when providerTag !== 'openai_image' — filters usage_events by provider_name. */
  usageEventsProviderName?: string;
  /** Required for openai/anthropic/audio/image. Optional for gemini (only needed for usage_metadata). */
  rates?: RateTable;
  /** Gemini gcb_export only — caller-supplied project_id → customer org_id map. */
  projectOrgMap?: Record<string, string>;
  /** Raw provider payload — passed verbatim to the orchestrator. */
  payload: unknown;
}

export interface DispatchOrchestrators {
  openai:    (args: IngestOpenAiArgs)    => Promise<OpenAiOutcome>;
  anthropic: (args: IngestAnthropicArgs) => Promise<AnthropicOutcome>;
  gemini:    (args: IngestGeminiArgs)    => Promise<GeminiOutcome>;
  audio:     (args: IngestAudioArgs)     => Promise<AudioOutcome>;
  image:     (args: IngestImageArgs)     => Promise<ImageOutcome>;
  stripe:    (args: IngestStripeArgs)    => Promise<StripeOutcome>;
}

export type DispatchOutcome =
  | { ok: true;  provider: ProviderKey; result: unknown }
  | { ok: false; provider: ProviderKey | null; error: string };

export function validateManifest(input: unknown): { ok: true; manifest: ReconciliationManifest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'manifest_not_an_object' };
  const x = input as Record<string, unknown>;
  const provider = String(x.provider ?? '');
  if (!['openai','anthropic','gemini','audio','image','stripe'].includes(provider)) {
    return { ok: false, error: `unsupported_provider:${provider || '(missing)'}` };
  }
  if (typeof x.providerInvoiceId !== 'string' || !x.providerInvoiceId) return { ok: false, error: 'missing_providerInvoiceId' };
  if (typeof x.periodStart      !== 'string' || !x.periodStart)        return { ok: false, error: 'missing_periodStart' };
  if (typeof x.periodEnd        !== 'string' || !x.periodEnd)          return { ok: false, error: 'missing_periodEnd' };
  if (x.payload === undefined || x.payload === null)                   return { ok: false, error: 'missing_payload' };

  if (provider !== 'openai') {
    const allowed = SUPPORTED_KINDS[provider as Exclude<ProviderKey,'openai'>];
    if (typeof x.kind !== 'string' || !x.kind) return { ok: false, error: `missing_kind_for_${provider}` };
    if (!allowed.includes(x.kind))             return { ok: false, error: `invalid_${provider}_kind:${x.kind}` };
  }
  if (provider === 'audio') {
    if (typeof x.providerTag !== 'string' || !(SUPPORTED_AUDIO_TAGS as readonly string[]).includes(x.providerTag)) {
      return { ok: false, error: `audio_providerTag_required (openai_audio|assemblyai): ${x.providerTag ?? '(missing)'}` };
    }
  }
  if (provider === 'image') {
    if (typeof x.providerTag !== 'string' || !x.providerTag) return { ok: false, error: 'image_providerTag_required' };
    if (x.providerTag !== 'openai_image' && !x.providerTag.startsWith('image:')) {
      return { ok: false, error: `invalid_image_providerTag:${x.providerTag}` };
    }
    if (x.providerTag !== 'openai_image' && (typeof x.usageEventsProviderName !== 'string' || !x.usageEventsProviderName)) {
      return { ok: false, error: 'image_usageEventsProviderName_required_for_generic_tag' };
    }
  }
  // Rates requirement.
  const needsRates = provider === 'openai' || provider === 'anthropic' || provider === 'audio' || provider === 'image'
    || (provider === 'gemini' && x.kind === 'usage_metadata');
  if (needsRates && (!x.rates || typeof x.rates !== 'object')) {
    return { ok: false, error: `rates_required_for_${provider}${provider === 'gemini' ? '_usage_metadata' : ''}` };
  }

  return { ok: true, manifest: input as ReconciliationManifest };
}

export async function dispatchReconciliation(
  manifest: ReconciliationManifest,
  orchestrators: DispatchOrchestrators,
): Promise<DispatchOutcome> {
  try {
    switch (manifest.provider) {
      case 'openai': {
        const result = await orchestrators.openai({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          payload:     manifest.payload,
          rates:       manifest.rates!,
        });
        return { ok: true, provider: 'openai', result };
      }
      case 'anthropic': {
        const result = await orchestrators.anthropic({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          kind:        manifest.kind as IngestAnthropicArgs['kind'],
          payload:     manifest.payload,
          rates:       manifest.rates!,
        });
        return { ok: true, provider: 'anthropic', result };
      }
      case 'gemini': {
        const result = await orchestrators.gemini({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          kind:        manifest.kind as IngestGeminiArgs['kind'],
          payload:     manifest.payload,
          rates:       manifest.rates,
          projectOrgMap: manifest.projectOrgMap,
        });
        return { ok: true, provider: 'gemini', result };
      }
      case 'audio': {
        const result = await orchestrators.audio({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          providerTag: manifest.providerTag as IngestAudioArgs['providerTag'],
          kind:        manifest.kind as IngestAudioArgs['kind'],
          payload:     manifest.payload,
          rates:       manifest.rates!,
        });
        return { ok: true, provider: 'audio', result };
      }
      case 'image': {
        const result = await orchestrators.image({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          providerTag: manifest.providerTag as IngestImageArgs['providerTag'],
          usageEventsProviderName: manifest.usageEventsProviderName,
          kind:        manifest.kind as IngestImageArgs['kind'],
          payload:     manifest.payload,
          rates:       manifest.rates!,
        });
        return { ok: true, provider: 'image', result };
      }
      case 'stripe': {
        const result = await orchestrators.stripe({
          providerInvoiceId: manifest.providerInvoiceId,
          periodStart: manifest.periodStart,
          periodEnd:   manifest.periodEnd,
          kind:        manifest.kind as IngestStripeArgs['kind'],
          payload:     manifest.payload,
        });
        return { ok: true, provider: 'stripe', result };
      }
    }
  } catch (err) {
    return { ok: false, provider: manifest.provider, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Localhost-only execution guard. Refuses to run when the configured Supabase
 * URL is anywhere other than localhost, and requires an explicit opt-in env
 * flag so a stale shell can't accidentally fire it.
 */
export function assertLocalhostOnly(env: Record<string, string | undefined> = process.env): { ok: true } | { ok: false; error: string } {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!url) return { ok: false, error: 'no_supabase_url_set' };
  const localHosts = ['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal', 'kong:8000'];
  const isLocal = localHosts.some(h => url.toLowerCase().includes(h));
  if (!isLocal) {
    return { ok: false, error: `non_local_supabase_url_blocked: ${url.slice(0, 80)}` };
  }
  if (env.RECONCILE_LOCAL_RUNNER !== '1') {
    return { ok: false, error: 'RECONCILE_LOCAL_RUNNER=1 not set (refusing to write)' };
  }
  return { ok: true };
}
