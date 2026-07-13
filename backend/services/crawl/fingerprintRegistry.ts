/**
 * fingerprintRegistry.ts — canonical fingerprint registry + dependency graph
 * (CKRE-001R §1/§2).
 *
 * ONE central definition of every website-fingerprint type. Nothing else in
 * the codebase hardcodes fingerprint identifiers, hash algorithms, storage
 * keys, or dependencies — they all reference this registry. This is metadata
 * ABOUT fingerprints; the actual (unchanged) computation lives in
 * websiteFingerprintService.ts. No new compute engine, no duplicate storage.
 *
 * The registry is pure and deterministic (a frozen literal + pure graph
 * helpers), so future CKRE phases can traverse it to skip unnecessary
 * calculations (§2) without any runtime state.
 */

export type FingerprintTypeId =
  | 'HTTP_METADATA'
  | 'HTML'
  | 'NAVIGATION'
  | 'LOGO'
  | 'FAVICON'
  | 'OPENGRAPH'
  | 'SITEMAP'
  | 'ROBOTS'
  | 'SEO'
  | 'SOCIAL'
  | 'BUSINESS'
  | 'STRUCTURED_DATA'
  | 'CMS';

/** Which section a fingerprint belongs to (matches the Level 0/1/2 hierarchy). */
export type FingerprintSection = 'http' | 'structural' | 'business';

export interface FingerprintFreshnessPolicy {
  /** Recompute when older than this many days (deterministic ceiling). */
  maxAgeDays: number;
  /** Deterministic triggers that also warrant recomputation. */
  refreshOn: Array<'dependency_changed' | 'schema_version_bump' | 'manual'>;
}

export interface FingerprintDefinition {
  id: FingerprintTypeId;
  section: FingerprintSection;
  /** Per-type schema version — bump when the type's derivation changes. */
  schemaVersion: string;
  hashAlgorithm: 'sha256' | 'none';
  /** The service/stage that produces this fingerprint. */
  producer: string;
  /** Other fingerprint types this one is derived from (dependency graph, §2). */
  dependencies: FingerprintTypeId[];
  freshnessPolicy: FingerprintFreshnessPolicy;
  /** Path within the stored WebsiteFingerprint bundle (dot notation). */
  storageKey: string;
  /**
   * False when the type is DEFINED for the registry/graph but not yet produced
   * by the current compute engine (future CKRE surface, e.g. SEO/CMS). Keeps
   * the graph complete without pretending a value exists.
   */
  produced: boolean;
}

const REGISTRY_INTERNAL: Record<FingerprintTypeId, FingerprintDefinition> = {
  HTTP_METADATA: {
    id: 'HTTP_METADATA', section: 'http', schemaVersion: '1', hashAlgorithm: 'none',
    producer: 'crawlResultCache', dependencies: [],
    freshnessPolicy: { maxAgeDays: 1, refreshOn: ['manual'] },
    storageKey: 'level0', produced: true,
  },
  HTML: {
    id: 'HTML', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: [],
    freshnessPolicy: { maxAgeDays: 7, refreshOn: ['manual'] },
    storageKey: 'level1.htmlHash', produced: true,
  },
  NAVIGATION: {
    id: 'NAVIGATION', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 7, refreshOn: ['dependency_changed'] },
    storageKey: 'level1.navHash', produced: true,
  },
  LOGO: {
    id: 'LOGO', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 30, refreshOn: ['dependency_changed'] },
    storageKey: 'level1.logoHash', produced: true,
  },
  FAVICON: {
    id: 'FAVICON', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 30, refreshOn: ['dependency_changed'] },
    storageKey: 'level1.faviconHash', produced: true,
  },
  OPENGRAPH: {
    id: 'OPENGRAPH', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 14, refreshOn: ['dependency_changed'] },
    storageKey: 'level1.ogHash', produced: true,
  },
  SITEMAP: {
    id: 'SITEMAP', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'crawlerService', dependencies: [],
    freshnessPolicy: { maxAgeDays: 7, refreshOn: ['manual'] },
    storageKey: 'level1.sitemapHash', produced: true,
  },
  ROBOTS: {
    id: 'ROBOTS', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'crawlerService', dependencies: [],
    freshnessPolicy: { maxAgeDays: 30, refreshOn: ['manual'] },
    storageKey: 'level1.robotsHash', produced: true,
  },
  STRUCTURED_DATA: {
    id: 'STRUCTURED_DATA', section: 'business', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 14, refreshOn: ['dependency_changed'] },
    storageKey: 'level2.structuredData', produced: true,
  },
  SOCIAL: {
    id: 'SOCIAL', section: 'business', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML'],
    freshnessPolicy: { maxAgeDays: 14, refreshOn: ['dependency_changed'] },
    storageKey: 'level2.socialLinks', produced: true,
  },
  SEO: {
    // Defined for the graph/future CKRE; not yet produced as a standalone hash.
    id: 'SEO', section: 'structural', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService', dependencies: ['HTML', 'OPENGRAPH'],
    freshnessPolicy: { maxAgeDays: 14, refreshOn: ['dependency_changed'] },
    storageKey: 'level2.seo', produced: false,
  },
  CMS: {
    // Defined for the graph/future CKRE; produced by the CMS integration layer,
    // not the crawl. No crawl HTML dependency.
    id: 'CMS', section: 'business', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'cmsIntegration', dependencies: [],
    freshnessPolicy: { maxAgeDays: 1, refreshOn: ['manual'] },
    storageKey: 'level2.cms', produced: false,
  },
  BUSINESS: {
    // The aggregate business identity — derives from the structural + social
    // + structured-data signals (audit example: BUSINESS depends on HTML,
    // NAVIGATION, METADATA, SOCIAL).
    id: 'BUSINESS', section: 'business', schemaVersion: '1', hashAlgorithm: 'sha256',
    producer: 'websiteFingerprintService',
    dependencies: ['HTML', 'NAVIGATION', 'HTTP_METADATA', 'SOCIAL', 'STRUCTURED_DATA'],
    freshnessPolicy: { maxAgeDays: 7, refreshOn: ['dependency_changed'] },
    storageKey: 'level2', produced: true,
  },
};

export const FINGERPRINT_REGISTRY: Readonly<Record<FingerprintTypeId, FingerprintDefinition>> = REGISTRY_INTERNAL;
export const FINGERPRINT_TYPE_IDS = Object.keys(REGISTRY_INTERNAL) as FingerprintTypeId[];

/** Definition lookup (throws on an unknown id — registry is the single authority). */
export function getFingerprintDefinition(id: FingerprintTypeId): FingerprintDefinition {
  const def = REGISTRY_INTERNAL[id];
  if (!def) throw new Error(`UNKNOWN_FINGERPRINT_TYPE:${id}`);
  return def;
}

// ── §2 Dependency graph (pure, deterministic) ────────────────────────────────

/** Direct dependencies of a type. */
export function dependenciesOf(id: FingerprintTypeId): FingerprintTypeId[] {
  return [...getFingerprintDefinition(id).dependencies];
}

/** Types that directly depend on `id` (its dependents). */
export function dependentsOf(id: FingerprintTypeId): FingerprintTypeId[] {
  return FINGERPRINT_TYPE_IDS.filter((t) => REGISTRY_INTERNAL[t].dependencies.includes(id));
}

/** Transitive closure of dependents — everything that must be re-evaluated when
 *  `id` changes. Deterministic (sorted). Enables future skip-calculation. */
export function downstreamOf(id: FingerprintTypeId): FingerprintTypeId[] {
  const out = new Set<FingerprintTypeId>();
  const walk = (t: FingerprintTypeId) => {
    for (const d of dependentsOf(t)) {
      if (!out.has(d)) { out.add(d); walk(d); }
    }
  };
  walk(id);
  return Array.from(out).sort();
}

/** Transitive dependencies of `id`. Deterministic (sorted). */
export function upstreamOf(id: FingerprintTypeId): FingerprintTypeId[] {
  const out = new Set<FingerprintTypeId>();
  const walk = (t: FingerprintTypeId) => {
    for (const d of dependenciesOf(t)) {
      if (!out.has(d)) { out.add(d); walk(d); }
    }
  };
  walk(id);
  return Array.from(out).sort();
}

/** Deterministic topological order (dependencies before dependents). Detects cycles. */
export function topologicalOrder(): FingerprintTypeId[] {
  const visited = new Set<FingerprintTypeId>();
  const temp = new Set<FingerprintTypeId>();
  const order: FingerprintTypeId[] = [];
  const visit = (t: FingerprintTypeId) => {
    if (visited.has(t)) return;
    if (temp.has(t)) throw new Error(`FINGERPRINT_DEPENDENCY_CYCLE:${t}`);
    temp.add(t);
    for (const d of dependenciesOf(t).sort()) visit(d);
    temp.delete(t);
    visited.add(t);
    order.push(t);
  };
  for (const t of [...FINGERPRINT_TYPE_IDS].sort()) visit(t);
  return order;
}

/**
 * Given the set of types whose value changed, return every type that must be
 * re-evaluated (the changed types plus their transitive dependents), sorted.
 * Future CKRE phases use this to skip untouched calculations (§2).
 */
export function affectedByChanges(changed: FingerprintTypeId[]): FingerprintTypeId[] {
  const out = new Set<FingerprintTypeId>(changed);
  for (const c of changed) for (const d of downstreamOf(c)) out.add(d);
  return Array.from(out).sort();
}
