/**
 * Canonical platform manifest (CREATOR-137) — the machine-readable Architecture v1.0.
 * Declares every canonical module, its single responsibility, and the DIRECTIONAL
 * dependency rule (RULE 4). A test (or an import-lint rule) checks real imports
 * against `ALLOWED_DEPENDENCIES`: no reverse deps, no cycles, no bridges. The
 * Rendering Contract is the ONLY convergence point (RULE 5).
 */

export const CANONICAL_MODULES = [
  'communication-strategy',
  'information-planner',   // canonical: Editorial Planner
  'content',
  'asset-plan',
  'blueprint',
  'design-system',
  'brand',
  'component-library',
  'rendering-contract',
  'renderer',
  'campaign',
  'marketplace',
  'governance',
] as const;
export type CanonicalModuleName = typeof CANONICAL_MODULES[number];

/** Single responsibility per module (frozen, from CREATOR-135/136). */
export const MODULE_RESPONSIBILITY: Record<CanonicalModuleName, string> = {
  'communication-strategy': 'WHY — communicative intent',
  'information-planner': 'WHAT-TO-SAY — editorial plan (no words)',
  'content': 'THE WORDS — realized copy/data/media',
  'asset-plan': 'WHICH ASSETS — sequenced, medium-mapped delivery plan',
  'blueprint': 'STRUCTURE — component arrangement (visually blind)',
  'design-system': 'STYLE — visual identity (structurally blind)',
  'brand': 'WHOSE — tenant identity',
  'rendering-contract': 'BINDING — Blueprint × Design System × Brand × Content',
  'renderer': 'DRAWING — composes Components only',
  'component-library': 'global Components + Variants (drawn once)',
  'campaign': 'ORCHESTRATION — references the axes, owns none',
  'marketplace': 'TRADE — packs of reusable canonical objects',
  'governance': 'identity/ownership/version/approval/scope/audit (shared foundation)',
};

/**
 * Directional dependency rule (RULE 4/5). Key may import ONLY from its listed
 * values (+ 'governance', which is the universal leaf). No reverse, no cycle.
 */
export const ALLOWED_DEPENDENCIES: Record<CanonicalModuleName, CanonicalModuleName[]> = {
  'governance': [],
  'component-library': ['governance'],
  'communication-strategy': ['governance'],
  'information-planner': ['governance', 'communication-strategy'],
  'content': ['governance', 'information-planner'],
  'asset-plan': ['governance', 'communication-strategy'],
  'blueprint': ['governance', 'component-library'],
  'design-system': ['governance', 'component-library'],
  'brand': ['governance'],
  'rendering-contract': ['governance', 'blueprint', 'design-system', 'brand', 'content'],
  'renderer': ['governance', 'rendering-contract', 'component-library'],
  'campaign': ['governance', 'communication-strategy', 'information-planner', 'asset-plan', 'blueprint', 'design-system', 'brand'],
  'marketplace': ['governance', 'communication-strategy', 'information-planner', 'asset-plan', 'blueprint', 'design-system', 'brand', 'component-library'],
};

/** True iff `from` may import `to` under the frozen rule. */
export function mayDependOn(from: CanonicalModuleName, to: CanonicalModuleName): boolean {
  return from === to || ALLOWED_DEPENDENCIES[from].includes(to);
}

/** Detects any cycle in ALLOWED_DEPENDENCIES (must always be empty). */
export function findDependencyCycles(): string[] {
  const cycles: string[] = [];
  const state = new Map<CanonicalModuleName, 0 | 1 | 2>();
  const stack: CanonicalModuleName[] = [];
  const visit = (n: CanonicalModuleName): void => {
    state.set(n, 1); stack.push(n);
    for (const m of ALLOWED_DEPENDENCIES[n]) {
      if (state.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m].join(' → '));
      else if (!state.get(m)) visit(m);
    }
    state.set(n, 2); stack.pop();
  };
  for (const n of CANONICAL_MODULES) if (!state.get(n)) visit(n);
  return cycles;
}
