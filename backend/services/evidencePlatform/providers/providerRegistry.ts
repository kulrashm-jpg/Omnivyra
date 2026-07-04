/**
 * Canonical Provider Registry  (BETA-ENGINE-004, Phase 4)
 *
 * The single catalogue of every external-evidence provider — registration, discovery, health,
 * capability lookup, availability, and versioning. Pure in-memory metadata; registering a provider
 * performs no I/O and calls no external API. This is the platform-level registry; it complements (does
 * not replace) the existing `intelligence/providerRegistry.ts` domain switchboard, which it can wrap.
 */
import { type EvidenceProviderDescriptor, isDescriptorAvailable, type ProviderHealth } from './providerContract';

const REGISTRY = new Map<string, EvidenceProviderDescriptor>();

/** Register (or replace) a provider descriptor. Idempotent by providerId. Pure metadata. */
export function registerProvider(descriptor: EvidenceProviderDescriptor): EvidenceProviderDescriptor {
  REGISTRY.set(descriptor.providerId, descriptor);
  return descriptor;
}

export function getProvider(providerId: string): EvidenceProviderDescriptor | undefined {
  return REGISTRY.get(providerId);
}

export function listProviders(): EvidenceProviderDescriptor[] {
  return [...REGISTRY.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export function hasProvider(providerId: string): boolean {
  return REGISTRY.has(providerId);
}

/** Discovery: providers exposing a given capability tag. */
export function findByCapability(capability: string): EvidenceProviderDescriptor[] {
  return listProviders().filter((p) => p.capabilities.includes(capability));
}

/** Discovery: providers that can supply a given canonical evidence key. */
export function findBySupportedEvidence(evidenceKey: string): EvidenceProviderDescriptor[] {
  return listProviders().filter((p) => p.supportedEvidence.includes(evidenceKey));
}

/** Discovery: providers a given engine will consume. */
export function findByConsumerEngine(engineId: string): EvidenceProviderDescriptor[] {
  return listProviders().filter((p) => p.consumerEngines.includes(engineId));
}

export function providerHealth(providerId: string): ProviderHealth {
  return REGISTRY.get(providerId)?.health ?? 'unknown';
}

/** Deterministic availability (authenticated + connected + healthy + no failure). */
export function isProviderAvailable(providerId: string): boolean {
  const d = REGISTRY.get(providerId);
  return d ? isDescriptorAvailable(d) : false;
}

export function providerVersion(providerId: string): string | null {
  return REGISTRY.get(providerId)?.version ?? null;
}

/** Every provider currently unavailable (the default state for all anticipated providers). */
export function listUnavailableProviders(): EvidenceProviderDescriptor[] {
  return listProviders().filter((p) => !isDescriptorAvailable(p));
}

/** Test/util: clear the registry. */
export function __clearProviderRegistry(): void {
  REGISTRY.clear();
}
