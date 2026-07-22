/**
 * PLATFORM EVIDENCE COLLECTORS for the PB-008 capability drift verifier (TEST LAYER).
 *
 * The verifier (`providerCapabilityDrift.ts`) is deliberately pure and injected — it
 * knows nothing about the gateway. THIS module is the adapter that observes Platform
 * reality and hands the verifier an evidence model. It imports the runtime modules
 * READ-ONLY (tables, registries and the transport seams) and never mutates them.
 *
 * THREE evidence methods, in descending strength:
 *
 *   1. BEHAVIORAL PROBE (`probeTransportEvidence`) — the REAL transport seam is
 *      executed against a stubbed `fetch`, and its request body / return value /
 *      streaming callbacks are observed. This is the only method that observes the
 *      implementation itself rather than a description of it. Available for
 *      gemini · perplexity · copilot (the seams in `aiGatewayTransports`).
 *
 *   2. DESCRIPTOR TABLE — `GATEWAY_PROVIDER_CAPABILITIES` (dispatcher; covers all five
 *      providers) and `GATEWAY_TRANSPORT_CAPABILITIES` (transports; covers the three
 *      seam providers). HONEST CAVEAT: these are hand-declared Platform tables, not
 *      the implementation. They are strong evidence because they are the canonical
 *      thing a provider change updates — and because PB-004's own evidence strings
 *      cite them — but a table and a registry can in principle rot together. For
 *      openai/anthropic this is the ONLY method available here: their transports live
 *      in `aiGatewayCore` behind the OpenAI SDK and are not safely probe-able from a
 *      unit test.
 *
 *   3. METADATA REGISTRY — `listProviderMetadataDescriptors()`. Provider extras only
 *      survive normalization through a registered descriptor, so the presence/absence
 *      of a `citations` descriptor is genuine machine evidence for that capability.
 *
 * No network: `global.fetch` is stubbed for the probes and restored afterwards.
 */
import fs from 'fs';
import path from 'path';

import {
  GATEWAY_PROVIDER_CAPABILITIES,
  GATEWAY_PROVIDER_IDS,
  type GatewayProviderId,
} from '../../services/aiGatewayDispatcher';
import {
  GATEWAY_TRANSPORT_CAPABILITIES,
  GatewayTransportNotImplementedError,
  callCopilot,
  callGemini,
  callPerplexity,
  type GatewayTransportParams,
} from '../../services/aiGatewayTransports';
import {
  PERPLEXITY_CITATIONS_V1,
  listProviderMetadataDescriptors,
  readProviderMetadata,
} from '../../services/aiGatewayMetadata';
import {
  listCapabilityProviders,
  listProviderCapabilities,
} from '../../services/aiGatewayCapabilities';
import type {
  CapabilityEvidenceModel,
  CapabilityRegistrySnapshot,
  EvidenceAnchorResolver,
  EvidenceObservation,
  ProviderEvidence,
} from './providerCapabilityDrift';

/**
 * Capability names as LITERALS, not as `PROVIDER_CAPABILITIES.*`. Re-using the
 * registry's own constants would let a rename slide through unnoticed on both sides;
 * literals pin the vocabulary independently (a companion test asserts the Platform
 * still knows every one of them).
 */
export const CAPABILITY = {
  TEXT_COMPLETION: 'textCompletion',
  STREAMING: 'streaming',
  SEED: 'seed',
  SYSTEM_PROMPT: 'systemPrompt',
  STRUCTURED_OUTPUT: 'structuredOutput',
  CITATIONS: 'citations',
  SEARCH: 'search',
} as const;

/**
 * The capabilities every provider MUST take a position on: exactly the four fields
 * the canonical per-provider descriptor table carries for ALL providers. Silence here
 * is an omission (the Platform has the answer); silence anywhere else is a legitimate
 * non-claim under PB-004's three-valued model.
 */
export const REQUIRED_CLAIMS: readonly string[] = [
  CAPABILITY.TEXT_COMPLETION,
  CAPABILITY.STREAMING,
  CAPABILITY.SEED,
  CAPABILITY.SYSTEM_PROMPT,
];

// ── 1. Registry snapshot (the subject under verification) ─────────────────────

/** Project the LIVE capability registry into the verifier's plain snapshot shape. */
export function snapshotCapabilityRegistry(): CapabilityRegistrySnapshot {
  return {
    providers: listCapabilityProviders().map((provider) => ({
      provider,
      declarations: listProviderCapabilities(provider).map((d) => ({
        capability: String(d.capability),
        supported: d.supported,
        evidence: d.evidence,
      })),
    })),
  };
}

// ── 2. Descriptor-table evidence ──────────────────────────────────────────────

/**
 * Observations derived from the canonical descriptor tables. `GATEWAY_PROVIDER_CAPABILITIES`
 * covers all five providers; the three seam providers additionally contribute the
 * `GATEWAY_TRANSPORT_CAPABILITIES` row, so a divergence BETWEEN the two Platform tables
 * surfaces as an `evidence_conflict` instead of being averaged away.
 */
export function descriptorTableObservations(provider: GatewayProviderId): EvidenceObservation[] {
  const out: EvidenceObservation[] = [];
  const table = GATEWAY_PROVIDER_CAPABILITIES[provider];
  if (table) {
    const src = `GATEWAY_PROVIDER_CAPABILITIES.${provider}`;
    out.push(
      {
        capability: CAPABILITY.TEXT_COMPLETION,
        supported: table.implemented,
        source: `${src}.implemented (aiGatewayDispatcher)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.STREAMING,
        supported: table.supportsStreaming,
        source: `${src}.supportsStreaming (aiGatewayDispatcher)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.SEED,
        supported: table.supportsSeed,
        source: `${src}.supportsSeed (aiGatewayDispatcher)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.SYSTEM_PROMPT,
        supported: table.supportsSystemPrompt,
        source: `${src}.supportsSystemPrompt (aiGatewayDispatcher)`,
        method: 'descriptor-table',
      },
    );
  }
  const transport = (GATEWAY_TRANSPORT_CAPABILITIES as Record<string, typeof GATEWAY_TRANSPORT_CAPABILITIES.gemini>)[
    provider
  ];
  if (transport) {
    const src = `GATEWAY_TRANSPORT_CAPABILITIES.${provider}`;
    out.push(
      {
        capability: CAPABILITY.TEXT_COMPLETION,
        supported: transport.implemented,
        source: `${src}.implemented (aiGatewayTransports)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.STREAMING,
        supported: transport.supportsStreaming,
        source: `${src}.supportsStreaming (aiGatewayTransports)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.SEED,
        supported: transport.supportsSeed,
        source: `${src}.supportsSeed (aiGatewayTransports)`,
        method: 'descriptor-table',
      },
      {
        capability: CAPABILITY.SYSTEM_PROMPT,
        supported: transport.supportsSystemPrompt,
        source: `${src}.supportsSystemPrompt (aiGatewayTransports)`,
        method: 'descriptor-table',
      },
    );
  }
  return out;
}

// ── 3. Metadata-registry evidence ─────────────────────────────────────────────

/**
 * A provider's grounded extras reach a consumer ONLY through a registered
 * (provider, kind, version) descriptor — anything else is dropped by normalization.
 * So "is a `citations` descriptor registered for this provider?" is a real, machine-
 * readable answer to "does this provider return citations on this platform?".
 */
export function metadataRegistryObservations(provider: string): EvidenceObservation[] {
  const descriptors = listProviderMetadataDescriptors(provider);
  const citations = descriptors.filter((d) => d.kind === CAPABILITY.CITATIONS);
  return [
    {
      capability: CAPABILITY.CITATIONS,
      supported: citations.length > 0,
      source: `aiGatewayMetadata.listProviderMetadataDescriptors('${provider}') → ${
        citations.length > 0
          ? citations.map((d) => `${d.provider}/${d.kind}/v${d.version}`).join(', ')
          : 'no citations descriptor registered'
      }`,
      method: 'metadata-registry',
    },
  ];
}

// ── 4. Behavioral probes (the real seams, stubbed transport) ──────────────────

type ProbeCall = { url: string; body: Record<string, unknown> };

/** Install a canned JSON `fetch`, run `fn`, restore the original. Captures requests. */
async function withStubbedFetch<T>(
  payload: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T | undefined; error: unknown; calls: ProbeCall[] }> {
  const globalRef = global as unknown as { fetch?: unknown };
  const original = globalRef.fetch;
  const calls: ProbeCall[] = [];
  globalRef.fetch = async (url: string, init: { body?: string }) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    } catch {
      body = {};
    }
    calls.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  try {
    return { result: await fn(), error: undefined, calls };
  } catch (error) {
    return { result: undefined, error, calls };
  } finally {
    globalRef.fetch = original;
  }
}

const probeParams = (over: Partial<GatewayTransportParams> = {}): GatewayTransportParams => ({
  apiKey: 'pb008-probe-key',
  model: 'pb008-probe-model',
  temperature: 0.1,
  messages: [
    { role: 'system', content: 'PB-008 capability probe system channel' },
    { role: 'user', content: 'PB-008 capability probe' },
  ],
  max_tokens: 64,
  operation: 'pb008.capability.probe',
  // Passed deliberately: a provider that does NOT support seed/streaming must be
  // observed IGNORING them, which is what makes `supported: false` evidenced.
  seed: 4242,
  stream: true,
  ...over,
});

/**
 * Execute the three transport seams and observe what they actually do. Every
 * observation below is a statement about executed code, not about a table.
 */
export async function probeTransportEvidence(): Promise<ProviderEvidence[]> {
  const out: ProviderEvidence[] = [];

  // ── gemini ───────────────────────────────────────────────────────────────
  {
    const chunks: string[] = [];
    const { result, calls } = await withStubbedFetch(
      {
        candidates: [
          {
            content: { parts: [{ text: 'probe answer' }] },
            finishReason: 'STOP',
            // Deliberately present: proves the seam neither requests NOR reads
            // grounding/citation payloads.
            groundingMetadata: { webSearchQueries: ['probe'] },
            citationMetadata: { citationSources: [{ uri: 'https://example.test/a' }] },
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      },
      () => callGemini(probeParams({ onChunk: (delta) => chunks.push(delta) })),
    );
    const body = calls[0]?.body ?? {};
    const generationConfig = (body.generationConfig ?? {}) as Record<string, unknown>;
    out.push({
      provider: 'gemini',
      observations: [
        probe(CAPABILITY.TEXT_COMPLETION, (result?.content ?? '').length > 0,
          'callGemini executed against a stubbed transport and returned normalized content'),
        probe(CAPABILITY.SYSTEM_PROMPT, 'systemInstruction' in body,
          'callGemini request body carries `systemInstruction` built from the system message'),
        probe(CAPABILITY.STREAMING, chunks.length > 0,
          'callGemini called with stream:true + onChunk emitted ' + chunks.length + ' chunk(s)'),
        probe(CAPABILITY.SEED, 'seed' in body || 'seed' in generationConfig,
          'callGemini request body inspected for a `seed` field after seed:4242 was supplied'),
        probe(
          CAPABILITY.STRUCTURED_OUTPUT,
          'response_format' in body ||
            'responseMimeType' in generationConfig ||
            'responseSchema' in generationConfig,
          'callGemini request body inspected for responseMimeType / responseSchema / response_format',
        ),
        probe(CAPABILITY.SEARCH, 'tools' in body,
          'callGemini request body inspected for a `tools` / googleSearch retrieval directive'),
        probe(
          CAPABILITY.CITATIONS,
          result?.providerMetadata !== undefined,
          'callGemini returned no providerMetadata even though the stubbed response carried ' +
            'groundingMetadata + citationMetadata',
        ),
      ],
    });
  }

  // ── perplexity ───────────────────────────────────────────────────────────
  {
    const chunks: string[] = [];
    const { result, calls } = await withStubbedFetch(
      {
        choices: [{ message: { content: 'probe answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        citations: ['https://example.test/a', 'https://example.test/b'],
      },
      () => callPerplexity(probeParams({ onChunk: (delta) => chunks.push(delta) })),
    );
    const body = calls[0]?.body ?? {};
    const messages = (body.messages ?? []) as Array<{ role?: string }>;
    const citations = result
      ? readProviderMetadata(result, PERPLEXITY_CITATIONS_V1)?.citations ?? []
      : [];
    out.push({
      provider: 'perplexity',
      observations: [
        probe(CAPABILITY.TEXT_COMPLETION, (result?.content ?? '').length > 0,
          'callPerplexity executed against a stubbed transport and returned normalized content'),
        probe(CAPABILITY.SYSTEM_PROMPT, messages.some((m) => m.role === 'system'),
          'callPerplexity forwarded the system-role message verbatim in the request body'),
        probe(CAPABILITY.STREAMING, chunks.length > 0,
          'callPerplexity called with stream:true + onChunk emitted ' + chunks.length + ' chunk(s)'),
        probe(CAPABILITY.SEED, 'seed' in body,
          'callPerplexity request body inspected for a `seed` field after seed:4242 was supplied'),
        probe(CAPABILITY.STRUCTURED_OUTPUT, 'response_format' in body,
          'callPerplexity request body inspected for a `response_format` directive'),
        probe(
          CAPABILITY.CITATIONS,
          citations.length > 0,
          'callPerplexity attached grounded citations that survive normalization and decode ' +
            `through PERPLEXITY_CITATIONS_V1 (${citations.length} url(s))`,
        ),
        // NOTE: `search` is deliberately NOT observed for perplexity. Perplexity searches
        // server-side, so the absence of a request-side directive would be a FALSE
        // negative — and PB-004 makes no `search` claim for this provider.
      ],
    });
  }

  // ── copilot (stub seam) ──────────────────────────────────────────────────
  {
    const { error } = await withStubbedFetch({}, () => callCopilot(probeParams()));
    out.push({
      provider: 'copilot',
      observations: [
        probe(
          CAPABILITY.TEXT_COMPLETION,
          !(error instanceof GatewayTransportNotImplementedError),
          'callCopilot invoked directly: ' +
            (error instanceof GatewayTransportNotImplementedError
              ? 'threw GatewayTransportNotImplementedError (no transport exists)'
              : 'returned a completion'),
        ),
        // streaming / seed / systemPrompt are NOT probe-able for a stub seam — there is
        // no request to inspect. They fall back to descriptor-table evidence.
      ],
    });
  }

  return out;
}

function probe(capability: string, supported: boolean, detail: string): EvidenceObservation {
  return {
    capability,
    supported,
    source: `behavioral probe — ${detail}`,
    method: 'behavioral-probe',
    detail,
  };
}

// ── 5. Evidence-string anchors ────────────────────────────────────────────────

const SERVICES_DIR = path.resolve(__dirname, '..', '..', 'services');

const ANCHOR_CORPUS_FILES: readonly string[] = [
  'aiGatewayCore.ts',
  'aiGatewayTransports.ts',
  'aiGatewayDispatcher.ts',
  'aiGatewayMetadata.ts',
  'creatorAssetRendererMedia.ts',
];

/**
 * Resolver for the in-tree symbols an `evidence` string cites. This is what stops an
 * UNVERIFIABLE declaration from being a free pass: even when no evidence source can
 * confirm the capability itself, the citation must still point at code that exists.
 * A rename or deletion of a cited symbol is therefore detected.
 *
 * Deliberately NOT included in the corpus: `aiGatewayCapabilities.ts` itself — evidence
 * must never be able to satisfy itself.
 */
export function buildEvidenceAnchorResolver(): EvidenceAnchorResolver {
  const corpus = ANCHOR_CORPUS_FILES.map((file) => {
    const full = path.join(SERVICES_DIR, file);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  }).join('\n');

  const moduleExists = (base: string): boolean =>
    fs.existsSync(path.join(SERVICES_DIR, base.endsWith('.ts') ? base : `${base}.ts`));

  return {
    describe: `anchor corpus: backend/services/{${ANCHOR_CORPUS_FILES.join(', ')}} + backend/services module resolution`,
    resolves: (token: string) => {
      if (token.endsWith('.ts')) return moduleExists(token) || corpus.includes(token);
      if (/^ai[A-Z]/.test(token)) return moduleExists(token) || corpus.includes(token);
      return corpus.includes(token);
    },
  };
}

// ── 6. The assembled Platform evidence model ──────────────────────────────────

/**
 * Every evidence source, merged per provider. Probe observations are appended
 * alongside table observations (never replacing them) so the verifier sees — and can
 * report — any disagreement between what the Platform SAYS and what it DOES.
 */
export async function buildPlatformEvidenceModel(options: {
  readonly knownCapabilities: readonly string[];
  readonly requireEvidenceSource?: boolean;
} ): Promise<CapabilityEvidenceModel> {
  const probes = await probeTransportEvidence();
  const probeByProvider = new Map(probes.map((p) => [p.provider, p.observations]));

  const providers: ProviderEvidence[] = GATEWAY_PROVIDER_IDS.map((provider) => ({
    provider,
    observations: [
      ...descriptorTableObservations(provider),
      ...metadataRegistryObservations(provider),
      ...(probeByProvider.get(provider) ?? []),
    ],
  }));

  return {
    canonicalProviders: [...GATEWAY_PROVIDER_IDS],
    knownCapabilities: options.knownCapabilities,
    requiredClaims: REQUIRED_CLAIMS,
    providers,
    evidenceAnchors: buildEvidenceAnchorResolver(),
    ...(options.requireEvidenceSource === undefined
      ? {}
      : { requireEvidenceSource: options.requireEvidenceSource }),
  };
}
