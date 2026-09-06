/**
 * WS-4 — the enrichment coverage WS-4 is willing to offer the planner.
 *
 * The WS-2 seam takes `coverage` from its caller on purpose: only the caller
 * knows which sources it is willing and able to consult. This module is WS-4's
 * answer, and it is DERIVED rather than declared, so it cannot drift from what
 * the platform can actually do.
 *
 * ─── WHY IT IS CURRENTLY EMPTY, AND WHY THAT IS CORRECT ───────────────────
 * `dataSourceCatalogue`'s `enrichment` group holds exactly three sources —
 * `rapidapi`, `apollo_enrichment`, `zoominfo_enrichment` — and every one is
 * `available: false`. So there is no enrichment source to offer, and the
 * planner correctly answers `no_available_source` for every gap.
 *
 * `manual`, `crm` and `csv` are deliberately NOT offered. They are available,
 * but they belong to `prospect_discovery` / `crm_import`: they are INTAKE
 * sources that deliver a record, not enrichment sources you can call back into
 * for a missing attribute. `crmIngestionService` is a batch importer, not a
 * per-prospect lookup API. Listing them here would claim a capability the
 * platform does not have — the planner would select `crm` for a missing
 * industry, and nothing could ever execute it.
 *
 * ─── DERIVED, SO IT OPENS BY ITSELF ───────────────────────────────────────
 * Because this filters the catalogue rather than hardcoding a verdict, the
 * moment an enrichment source becomes `available: true` it appears here without
 * WS-4 being edited. What still would NOT appear is which ATTRIBUTES it can
 * answer: no attribute-coverage map exists anywhere in the repository, and
 * inventing one would be exactly the buried product policy the seam contract
 * forbids. That map is an open product decision, recorded in the report rather
 * than guessed here.
 */

import { listDataSourcesByGroup } from '../integrations/dataSourceCatalogue';
import { marketPulseAttributeCoverage } from '../marketPulse/prospectIntelligence';
import type { SourceCoverage } from '../enrichment/planner';
import { evaluateSource } from '../enrichment/providers/selection';
import type { SourceStatus } from '../enrichment/providers/sources';

/**
 * A3Z — what the caller knows about the tenant's PI acquisition sources.
 *
 * `statuses` comes from `listSourceStatus(hasAdapter, credentialPresent)`, and
 * ABSENT MEANS NONE. That default is the safety property: a caller that has
 * not resolved this tenant's provider credentials cannot accidentally publish
 * a global capability as a tenant one. A provider being installed, registered
 * or configured for Omnivyra makes it executable for nobody until a tenant's
 * own credential says so — the A3V defect, refused by construction here.
 */
export interface EnrichmentCoverageOptions {
  readonly statuses?: readonly SourceStatus[];
}

/**
 * Enrichment sources the platform can actually use today.
 *
 * Exported so a test can assert the derivation rather than a hardcoded answer:
 * an empty list must be a CONSEQUENCE of the catalogue, not a literal.
 */
export function availableEnrichmentSources(): string[] {
  return listDataSourcesByGroup('enrichment')
    .filter((d) => d.available)
    .map((d) => d.key);
}

/**
 * The coverage WS-4 offers the planner.
 *
 * `internal` is deliberately absent: attributes the source itself supplied are
 * already applied by LI-2 during this same ingestion, so offering them as an
 * enrichment source would plan work to re-learn what was just written.
 *
 * `marketPulse` is ASKED rather than assumed. WS-3 owns read-only consumption
 * of `market_pulse_*` (C-1) and is the only module entitled to answer what it
 * covers; the frozen decision order puts it ahead of any external provider, so
 * WS-4 must consult it instead of skipping to one. Its answer is empty today —
 * MarketPulse is intelligence about the tenant's market, not about a specific
 * external company — and calling the function rather than hardcoding that keeps
 * the decision with its owner.
 */
export function ingestionEnrichmentCoverage(
  options: EnrichmentCoverageOptions = {},
): SourceCoverage {
  const marketPulse = marketPulseAttributeCoverage();

  // ── the catalogue's declared enrichment sources ──────────────────────────
  // Kept, because a declared-but-unusable source is still worth naming: the
  // planner's reason then says WHICH source could not serve the attribute
  // rather than staying silent. It contributes no executable coverage.
  const declared = Object.fromEntries(
    availableEnrichmentSources().map((key) => [key, [] as string[]]),
  ) as Record<string, string[]>;

  // ── A3Z: the executable ones, from the registry that actually knows ──────
  const external: Record<string, string[]> = { ...declared };
  const verifiedExternal: string[] = [];

  for (const source of options.statuses ?? []) {
    // Ask A3's OWN eligibility function, per attribute and per entity, rather
    // than re-implementing any part of it here. Whatever it accepts is exactly
    // what `selectAcquisitionSource` will accept later, so coverage can never
    // promise the planner work that selection would then refuse.
    const attributes = source.capabilities.attributes.filter((attribute) =>
      source.capabilities.entities.some((subject) =>
        evaluateSource(source, source.connectionState, source.stateReason,
          { subject, attributes: [attribute], mode: source.id }).eligible));

    if (attributes.length === 0) continue;
    external[source.id] = attributes;
    verifiedExternal.push(source.id);
  }

  return { marketPulse, external, verifiedExternal };
}
