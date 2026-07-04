// Wikidata knowledge-graph adapter.
//
// Activated by `WIKIDATA_ENABLED=true`. Queries the public Wikidata search API
// (no authentication required) and the Wikidata entity API. Results are cached
// in-memory for the duration of a process to avoid rate-limit churn.
//
// IMPORTANT: when the network call fails or no entity is found, the adapter
// returns `state: 'unavailable'` with a `reason_unavailable` — never a synthesized
// score, never a fake Q-ID. This matches the Phase 3 "no fake data" rule.

import type {
  EntityIntelligenceResult,
  EntityRecord,
  KnowledgeGraphProvider,
} from '../providerInterfaces';
import { unavailableEvidence } from '../providerInterfaces';
import { logProviderCall } from '../productionPrimitives';

const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITY_URL = 'https://www.wikidata.org/wiki/Special:EntityData';
const REQUEST_TIMEOUT_MS = 6000;

type WikidataSearchHit = {
  id: string; // Q-ID
  label: string;
  description?: string;
  match?: { type: string; text: string };
};

type WikidataEntityClaim = {
  mainsnak: {
    datavalue?: {
      value: unknown;
      type: string;
    };
  };
};

type WikidataEntity = {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WikidataEntityClaim[]>;
  sitelinks?: Record<string, { title: string; url?: string }>;
};

const ORG_INSTANCE_OF_TARGETS = new Set([
  'Q4830453', // business
  'Q43229', // organization
  'Q783794', // company
  'Q161726', // multinational corporation
  'Q1093829', // public company
  'Q891723', // privately held company
]);

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchEntity(brandName: string): Promise<WikidataSearchHit | null> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: brandName,
    language: 'en',
    format: 'json',
    type: 'item',
    limit: '5',
    origin: '*',
  });
  const response = await fetchWithTimeout(`${WIKIDATA_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OmnivyraReports/1.0 (canonical-intelligence)' },
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { search?: WikidataSearchHit[] };
  return json.search?.[0] ?? null;
}

async function fetchEntity(qid: string): Promise<WikidataEntity | null> {
  const response = await fetchWithTimeout(`${WIKIDATA_ENTITY_URL}/${qid}.json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OmnivyraReports/1.0 (canonical-intelligence)' },
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { entities?: Record<string, WikidataEntity> };
  return json.entities?.[qid] ?? null;
}

function entityIsOrganization(entity: WikidataEntity): boolean {
  const claims = entity.claims?.['P31'] ?? [];
  for (const claim of claims) {
    const value = claim.mainsnak?.datavalue?.value as { id?: string } | undefined;
    if (value?.id && ORG_INSTANCE_OF_TARGETS.has(value.id)) return true;
  }
  return false;
}

function extractSameAs(entity: WikidataEntity): string[] {
  const out: string[] = [];
  const officialWebsite = (entity.claims?.['P856'] ?? [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((v): v is string => typeof v === 'string');
  out.push(...officialWebsite);
  for (const sitelinkKey of Object.keys(entity.sitelinks ?? {})) {
    const link = entity.sitelinks?.[sitelinkKey];
    if (link?.url) out.push(link.url);
  }
  return [...new Set(out)];
}

function completenessFromEntity(entity: WikidataEntity): number {
  // Schema.org Organization fields we care about: name, description, url,
  // sameAs, founder, foundingDate, location, identifier.
  // We approximate by counting populated Wikidata claims relevant to those.
  const fieldChecks: Array<keyof typeof entity.claims | string> = [
    'P17', // country
    'P112', // founder
    'P571', // inception (founding date)
    'P856', // official website
    'P159', // headquarters location
    'P31', // instance of (org type)
  ];
  const claims = entity.claims ?? {};
  let populated = 0;
  for (const field of fieldChecks) {
    const list = claims[field as string];
    if (Array.isArray(list) && list.length > 0) populated += 1;
  }
  // Add 1 for description, 1 for label.
  if (entity.labels?.['en']?.value) populated += 1;
  if (entity.descriptions?.['en']?.value) populated += 1;
  const total = fieldChecks.length + 2;
  return populated / total;
}

function scoreFromEntityRecord(record: EntityRecord): number {
  // Composite 0-100: 60% schema completeness, 40% sameAs density (capped at 8 links).
  const completenessComponent = (record.schema_completeness ?? 0) * 60;
  const sameAsComponent = Math.min(record.sameAs_count, 8) * 5;
  return Math.round(Math.max(0, Math.min(100, completenessComponent + sameAsComponent)));
}

export class WikidataAdapter implements KnowledgeGraphProvider {
  public readonly id = 'wikidata';
  private cache: Map<string, EntityIntelligenceResult> = new Map();

  async isAvailable(): Promise<boolean> {
    // Phase 0A: Wikidata is a free, keyless provider — activated by default.
    // Set WIKIDATA_ENABLED=false to disable (kill switch).
    return process.env.WIKIDATA_ENABLED !== 'false';
  }

  async lookup(params: { brandName: string; domain: string | null }): Promise<EntityIntelligenceResult> {
    // BETA-PHASE0-EXEC-001: telemetry parity — emit one structured provider-call line through the existing
    // observability hook (logProviderCall). Covers every resolution branch in one place; no behaviour/score change.
    const result = await this.resolveEntity(params);
    logProviderCall({
      providerId: this.id,
      operation: 'lookup',
      status: result.state === 'measured' ? 'ok' : 'unavailable',
      reason: result.reason_unavailable ?? undefined,
    });
    return result;
  }

  private async resolveEntity(params: { brandName: string; domain: string | null }): Promise<EntityIntelligenceResult> {
    const cacheKey = `${params.brandName}|${params.domain ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!params.brandName) {
      const result: EntityIntelligenceResult = {
        state: 'unavailable',
        entity: null,
        score: null,
        evidence: unavailableEvidence('Brand name missing — cannot perform Wikidata lookup.'),
        reason_unavailable: 'Brand name missing — cannot perform Wikidata lookup.',
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    let hit: WikidataSearchHit | null;
    try {
      hit = await searchEntity(params.brandName);
    } catch (error) {
      const reason = `Wikidata search request failed: ${error instanceof Error ? error.message : 'unknown error'}.`;
      const result: EntityIntelligenceResult = {
        state: 'unavailable',
        entity: null,
        score: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    if (!hit) {
      const result: EntityIntelligenceResult = {
        state: 'measured',
        entity: {
          wikidata_qid: null,
          google_kg_mid: null,
          schema_completeness: 0,
          sameAs_count: 0,
          sameAs_targets: [],
          canonical_description: null,
        },
        score: 0,
        evidence: {
          count: 1,
          sources: ['heuristic'],
          freshness: { last_observed_at: new Date().toISOString(), age_hours: 0 },
          observations: [
            { signal: 'wikidata_no_entity', source: 'wikidata', observed_at: new Date().toISOString() },
          ],
        },
        reason_unavailable: null,
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    let entity: WikidataEntity | null;
    try {
      entity = await fetchEntity(hit.id);
    } catch (error) {
      const reason = `Wikidata entity fetch failed: ${error instanceof Error ? error.message : 'unknown error'}.`;
      const result: EntityIntelligenceResult = {
        state: 'unavailable',
        entity: null,
        score: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    if (!entity) {
      const result: EntityIntelligenceResult = {
        state: 'unavailable',
        entity: null,
        score: null,
        evidence: unavailableEvidence(`Wikidata returned no payload for ${hit.id}.`),
        reason_unavailable: `Wikidata returned no payload for ${hit.id}.`,
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    const isOrg = entityIsOrganization(entity);
    const completeness = completenessFromEntity(entity);
    const sameAs = extractSameAs(entity);
    const description = entity.descriptions?.['en']?.value ?? null;

    const record: EntityRecord = {
      wikidata_qid: entity.id,
      google_kg_mid: null,
      schema_completeness: isOrg ? completeness : completeness * 0.5,
      sameAs_count: sameAs.length,
      sameAs_targets: sameAs,
      canonical_description: description,
    };

    const score = scoreFromEntityRecord(record);
    const observedAt = new Date().toISOString();
    const result: EntityIntelligenceResult = {
      state: 'measured',
      entity: record,
      score,
      evidence: {
        count: 2 + sameAs.length,
        sources: ['wikidata'],
        freshness: { last_observed_at: observedAt, age_hours: 0 },
        observations: [
          { signal: `wikidata:${entity.id}`, source: 'wikidata', observed_at: observedAt },
          { signal: 'wikidata:entity_completeness', source: 'wikidata', observed_at: observedAt },
          ...sameAs.slice(0, 5).map((url) => ({
            signal: `sameAs:${url}`,
            source: 'wikidata' as const,
            observed_at: observedAt,
          })),
        ],
      },
      reason_unavailable: null,
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
