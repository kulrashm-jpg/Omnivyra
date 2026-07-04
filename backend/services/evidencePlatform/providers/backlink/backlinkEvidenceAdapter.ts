/**
 * Backlink Evidence Adapter  (BETA-PROVIDER-001, Phase 3-4) — REFERENCE IMPLEMENTATION
 *
 * Converts a backlink provider's response into canonical Evidence via the BETA-ENGINE-004
 * `ProviderEvidenceAdapter` contract. It is the ONLY bridge from a backlink payload to the canonical
 * Evidence model — no engine consumes the payload directly. Deterministic; emits ONLY the metrics the
 * provider actually returned (missing metrics are omitted or emitted as UNAVAILABLE — never fabricated).
 *
 * This reference is provider-agnostic: it consumes a normalised `BacklinkEvidenceInput` that the real
 * Ahrefs adapter (reused, not rewritten) maps into. A future Moz/Majestic provider reuses this adapter.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:backlink.authority';

/** Normalised, provider-agnostic backlink metrics. Every field nullable — only measured values pass. */
export interface BacklinkEvidenceInput {
  domain: string;
  referringDomains: number | null;
  totalBacklinks: number | null;
  domainAuthority: number | null; // provider 0-100 (e.g. Ahrefs Domain Rating)
  spamScore: number | null; // 0-100, lower is better
  dofollowCount: number | null;
  nofollowCount: number | null;
  uniqueAnchors: number | null;
  uniqueDomains: number | null;
  newLinks30d: number | null;
  lostLinks30d: number | null;
  observedAt: string | null;
  /** 0..1 provider reliability, from the provider descriptor. */
  providerReliability: number | null;
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry). */
export const BACKLINK_EVIDENCE_KEYS = [
  'referring_domains',
  'total_backlinks',
  'domain_authority',
  'link_quality',
  'dofollow_ratio',
  'anchor_diversity',
  'domain_diversity',
  'new_links',
  'lost_links',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;

export class BacklinkEvidenceAdapter implements ProviderEvidenceAdapter<BacklinkEvidenceInput> {
  readonly providerId = 'backlink.authority';
  readonly supportedEvidence = [...BACKLINK_EVIDENCE_KEYS];

  toEvidence(raw: BacklinkEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const prov = (steps: { op: string; detail?: string }[] = []) =>
      buildProvenance({
        origin: 'provider:backlink.authority',
        collector: 'backlink_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: steps,
      });

    // Every emit is a MEASURED (or CALCULATED) value the provider actually returned. Missing → skipped.
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'backlink_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));

    if (raw.referringDomains != null) measured('referring_domains', raw.referringDomains, 'count', 'count');
    if (raw.totalBacklinks != null) measured('total_backlinks', raw.totalBacklinks, 'count', 'count');
    if (raw.domainAuthority != null) measured('domain_authority', round(raw.domainAuthority), 'score_0_100', 'score');
    if (raw.uniqueAnchors != null) measured('anchor_diversity', raw.uniqueAnchors, 'count', 'count');
    if (raw.uniqueDomains != null) measured('domain_diversity', raw.uniqueDomains, 'count', 'count');
    if (raw.newLinks30d != null) measured('new_links', raw.newLinks30d, 'count', 'count');
    if (raw.lostLinks30d != null) measured('lost_links', raw.lostLinks30d, 'count', 'count');

    // Derived (CALCULATED) — only when both inputs are present, else omitted (never fabricated).
    if (raw.dofollowCount != null && raw.nofollowCount != null) {
      const total = raw.dofollowCount + raw.nofollowCount;
      if (total > 0) {
        out.push(createEvidence({
          engineId: PROVIDER_ENGINE_ID, key: 'dofollow_ratio', value: round(raw.dofollowCount / total),
          maturity: 'CALCULATED', sourceSystem: 'backlink_api', sourceType: 'external_api', measurementType: 'ratio',
          unit: 'ratio', observedAt: ts, collectedAt: ts, confidence: conf,
          provenance: prov([{ op: 'ratio', detail: 'dofollow/(dofollow+nofollow)' }]),
          validationStatus: 'validated',
        }));
      }
    }
    if (raw.domainAuthority != null) {
      // link_quality = DA scaled by (1 - spam), only when spam is measured; else just DA-derived.
      const quality = raw.spamScore != null ? round(raw.domainAuthority * (1 - Math.min(1, raw.spamScore / 100))) : round(raw.domainAuthority);
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key: 'link_quality', value: quality, maturity: 'CALCULATED',
        sourceSystem: 'backlink_api', sourceType: 'external_api', measurementType: 'score', unit: 'score_0_100',
        observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov([{ op: 'quality', detail: raw.spamScore != null ? 'DA*(1-spam)' : 'DA' }]),
        validationStatus: 'validated',
      }));
    }
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const backlinkEvidenceAdapter = new BacklinkEvidenceAdapter();
