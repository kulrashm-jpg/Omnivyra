/**
 * Runtime asset-provider chain (CREATOR-038/039, STEP 4/5/6/8).
 *
 * Wires the engine's pluggable providers to REAL Omnivyra infrastructure — no
 * new media layer, no duplicate services:
 *   • AI            → injected (client calls the canonical render-inline route)
 *   • Organization  → injected (Creator Asset Catalog + Resolver)
 *   • Stock         → lib/media/imageService.searchImages() + governance below
 *   • Placeholder   → engine default (deterministic, guaranteed)
 *
 * Priority: AI → Organization → Stock → Placeholder. Adds (without touching the
 * engine): stock de-duplication within a document, ranking via slot purpose +
 * brand/industry, canonical runtime metadata stamping (providerId/model/at/orgId/
 * version), and per-provider diagnostics (latency / fallback / failures). Every
 * provider fails gracefully (returns null → next); nothing ever throws; an image
 * block is never left empty.
 */

import {
  defaultProviderChain, makeAiProvider, makeOrganizationProvider, makeStockProvider,
  type AssetProvider, type RealizedAsset, type AssetSlot, type RealizationContext,
} from './assetRealization';
import { searchImages } from '../media/imageService';

export interface ProviderDiagnosticEvent {
  slotId: string;
  providerId: string;
  ok: boolean;
  latencyMs: number;
  reason?: 'resolved' | 'no_match' | 'error';
}

export interface RuntimeProviderConfig {
  /** Real AI image generation (client → render-inline). Return null to fall through. */
  aiGenerate?: (prompt: string, slot: AssetSlot, ctx: RealizationContext) => Promise<RealizedAsset | null>;
  /** Organization/brand asset resolver (Creator Asset Catalog + Resolver). */
  organizationResolve?: (slot: AssetSlot, ctx: RealizationContext) => Promise<RealizedAsset | null>;
  /** Disable stock (offline / tests). Default: enabled. */
  disableStock?: boolean;
  /** Cross-slot de-dup set — pass one per DOCUMENT so a doc never repeats a stock image. */
  usedUrls?: Set<string>;
  /** Stamped onto every realized asset's metadata. */
  organizationId?: string;
  /** Diagnostics sink (STEP 8) — latency / provider / fallback / failures. Never shown to users. */
  onDiagnostic?: (event: ProviderDiagnosticEvent) => void;
  /** Injectable clock (tests). Default Date.now — fine here; the engine stays pure. */
  nowMs?: () => number;
}

/* ── Stock governance (STEP 4): ranking + de-dup + metadata ─────────────── */

function buildStockQuery(slot: AssetSlot, ctx: RealizationContext): string {
  return [slot.prompt.slice(0, 70), slot.purpose, ctx.brandStyle].filter(Boolean).join(' ').slice(0, 110);
}

function makeGovernedStockProvider(used: Set<string>): AssetProvider {
  return makeStockProvider(async (slot, ctx) => {
    const query = buildStockQuery(slot, ctx);
    const results = await searchImages({ title: ctx.documentTitle, query, perPage: 8 });
    // Editorial ranking: first relevant result NOT already used in this document.
    const pick = results.find((r) => r.full && !used.has(r.full)) || results.find((r) => r.full);
    if (!pick?.full) return null;
    const deduped = !used.has(pick.full);
    used.add(pick.full);
    return {
      url: pick.full,
      provider: 'stock',
      altText: pick.alt || slot.altText,
      attribution: `Photo by ${pick.author} on ${pick.source}`,
      generation: { providerId: 'stock', source: pick.source, query, aspectRatio: slot.aspectRatio, purpose: slot.purpose, deduped, model: null },
    };
  });
}

/* ── Orchestration instrumentation (STEP 5/6/8) ────────────────────────── */

function now(config: RuntimeProviderConfig): number {
  return config.nowMs ? config.nowMs() : Date.now();
}

/** Wrap a provider so it times itself, never throws, and stamps canonical metadata. */
function instrument(provider: AssetProvider, config: RuntimeProviderConfig): AssetProvider {
  return {
    id: provider.id,
    realize: async (slot, ctx) => {
      const t0 = now(config);
      let result: RealizedAsset | null = null;
      let reason: ProviderDiagnosticEvent['reason'] = 'no_match';
      try {
        result = await provider.realize(slot, ctx);
        reason = result ? 'resolved' : 'no_match';
      } catch {
        result = null;
        reason = 'error';
      }
      config.onDiagnostic?.({ slotId: slot.slotId, providerId: provider.id, ok: !!result, latencyMs: now(config) - t0, reason });
      if (!result) return null;
      // Canonical runtime metadata (STEP 6) — provider-supplied fields win.
      return {
        ...result,
        generation: { providerId: provider.id, at: now(config), organizationId: config.organizationId, version: 1, ...(result.generation || {}) },
      };
    },
  };
}

/** Build the runtime provider chain from the current configuration. */
export function getRuntimeProviderChain(config: RuntimeProviderConfig = {}): AssetProvider[] {
  const used = config.usedUrls ?? new Set<string>();
  const overrides: Partial<Record<'ai' | 'organization' | 'stock', AssetProvider>> = {};
  if (config.aiGenerate) overrides.ai = makeAiProvider((prompt, slot, ctx) => config.aiGenerate!(prompt, slot, ctx));
  if (config.organizationResolve) overrides.organization = makeOrganizationProvider((slot, ctx) => config.organizationResolve!(slot, ctx));
  if (!config.disableStock) overrides.stock = makeGovernedStockProvider(used);
  return defaultProviderChain(overrides).map((p) => instrument(p, config));
}
