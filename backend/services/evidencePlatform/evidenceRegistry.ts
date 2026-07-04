/**
 * Evidence Registry  (BETA-ARCH-001, Phase 5)
 *
 * A centralized, in-memory catalogue every intelligence engine registers itself with. It is pure
 * metadata — registering an engine performs no calculation and has zero effect on that engine's
 * output. The registry is the platform's single source of truth for "what engines exist, what
 * evidence they produce, what they depend on, and who consumes them."
 */
import type { EvidenceMaturity } from './evidenceMaturity';

/** Descriptor for one kind of evidence an engine can emit. */
export interface SupportedEvidenceDescriptor {
  /** Stable key, e.g. 'technical_score', 'indexability', 'backlink_authority'. */
  key: string;
  /** Human label. */
  label: string;
  /** The maturity this evidence is typically produced at (its honest default classification). */
  typicalMaturity: EvidenceMaturity;
  /** Unit, e.g. 'score_0_100', 'count', 'ratio'. */
  unit?: string;
}

/** A registered engine's full descriptor. */
export interface EngineRegistration {
  /** Stable engine id, e.g. 'website.technical', 'seo', 'authority.backlink'. */
  engineId: string;
  /** Human name. */
  engineName: string;
  /** Semantic version of the engine's evidence contract. */
  version: string;
  /** The evidence kinds this engine can emit. */
  supportedEvidence: SupportedEvidenceDescriptor[];
  /** Free-form capability tags, e.g. ['deterministic', 'crawl_based', 'honest_null']. */
  capabilities: string[];
  /** Engine ids / data sources this engine depends on. */
  dependencies: string[];
  /** Known consumers (engine ids / surfaces) — best-effort documentation. */
  consumers: string[];
}

const REGISTRY = new Map<string, EngineRegistration>();

/**
 * Register (or replace) an engine. Idempotent by engineId. Returns the registration.
 * Pure metadata — does not touch the engine or its output.
 */
export function registerEngine(reg: EngineRegistration): EngineRegistration {
  REGISTRY.set(reg.engineId, reg);
  return reg;
}

export function getEngine(engineId: string): EngineRegistration | undefined {
  return REGISTRY.get(engineId);
}

export function listEngines(): EngineRegistration[] {
  return [...REGISTRY.values()].sort((a, b) => a.engineId.localeCompare(b.engineId));
}

export function isRegistered(engineId: string): boolean {
  return REGISTRY.has(engineId);
}

/** Test/util: clear the registry (used only by unit tests). */
export function __clearRegistry(): void {
  REGISTRY.clear();
}
