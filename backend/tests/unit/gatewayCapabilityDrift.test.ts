/**
 * PROVIDER CAPABILITY REGISTRY DRIFT VERIFICATION (PB-008 · Program B · Platform).
 *
 * PB-004 built a hand-maintained capability registry. PB-005 added a Product-side
 * drift ALARM — it observes drift, it cannot prevent it. NOTHING verified that the
 * registry's declarations still match Platform implementation. This suite is that
 * verification, and it runs in the ordinary jest suite so CI fails on drift for free.
 *
 * WHAT IS PROVEN HERE
 *   1. NEGATIVE CONTROLS FIRST. A drift detector that cannot be proven to fire is
 *      worthless, so every drift class is exercised against an INJECTED SYNTHETIC
 *      registry fixture and asserted on the CONTENT of the diagnostic — provider,
 *      capability, declared value, observed evidence, evidence source, remedy — not
 *      merely on "something failed".
 *   2. THE REAL REGISTRY PASSES TODAY, against the same verifier.
 *   3. HONEST COVERAGE. Every declaration is classified machine-verified (naming the
 *      evidence source) or unverifiable (naming the reason), and the exact set of
 *      unverifiable declarations is pinned — a new unverifiable claim cannot be
 *      added silently under an "all green" checkmark.
 *   4. RUNTIME DECOUPLING PRESERVED. `aiGatewayCapabilities.ts` still has exactly one
 *      import and it is type-only. The comparison happens in the TEST, which imports
 *      both sides; no runtime coupling is introduced by verifying.
 *
 * TEST LAYER ONLY: no runtime file is modified, no flag, no schema, no network
 * (transport probes run against a stubbed `fetch`).
 */
import fs from 'fs';
import path from 'path';

import {
  PROVIDER_CAPABILITY_NAMES,
  isKnownCapability,
} from '../../services/aiGatewayCapabilities';
import { GATEWAY_PROVIDER_IDS } from '../../services/aiGatewayDispatcher';
import {
  verifyProviderCapabilityRegistry,
  unverifiableDeclarations,
  extractEvidenceAnchors,
  type CapabilityDeclarationSnapshot,
  type CapabilityEvidenceModel,
  type CapabilityRegistrySnapshot,
  type DriftFinding,
  type DriftKind,
  type ProviderEvidence,
} from '../helpers/providerCapabilityDrift';
import {
  CAPABILITY,
  REQUIRED_CLAIMS,
  buildPlatformEvidenceModel,
  snapshotCapabilityRegistry,
} from '../helpers/providerCapabilityEvidence';

// ── Fixture plumbing (pure, never touches the live registry) ──────────────────

/** Mutable mirrors of the (readonly) snapshot types, so fixtures can edit freely. */
type MutableDeclaration = { capability: string; supported: boolean; evidence: string };
type MutableProfile = { provider: string; declarations: MutableDeclaration[] };
type MutableSnapshot = { providers: MutableProfile[] };

function cloneSnapshot(snapshot: CapabilityRegistrySnapshot): MutableSnapshot {
  return {
    providers: snapshot.providers.map((p) => ({
      provider: p.provider,
      declarations: p.declarations.map((d) => ({ ...d })),
    })),
  };
}

function profileOf(snapshot: MutableSnapshot, provider: string): MutableProfile {
  const profile = snapshot.providers.find((p) => p.provider === provider);
  if (!profile) throw new Error(`fixture error: no profile for '${provider}'`);
  return profile;
}

/** Fixture: flip a declaration's `supported` value (stale-declaration drift). */
function withFlippedDeclaration(
  snapshot: CapabilityRegistrySnapshot,
  provider: string,
  capability: string,
): MutableSnapshot {
  const next = cloneSnapshot(snapshot);
  const profile = profileOf(next, provider);
  const declaration = profile.declarations.find((d) => d.capability === capability);
  if (!declaration) throw new Error(`fixture error: '${provider}' does not declare '${capability}'`);
  declaration.supported = !declaration.supported;
  return next;
}

/** Fixture: delete a declaration entirely (missing-declaration drift). */
function withoutDeclaration(
  snapshot: CapabilityRegistrySnapshot,
  provider: string,
  capability: string,
): MutableSnapshot {
  const next = cloneSnapshot(snapshot);
  const profile = profileOf(next, provider);
  profile.declarations = profile.declarations.filter((d) => d.capability !== capability);
  return next;
}

/** Fixture: add a declaration (unsupported-declaration drift). */
function withExtraDeclaration(
  snapshot: CapabilityRegistrySnapshot,
  provider: string,
  declaration: CapabilityDeclarationSnapshot,
): MutableSnapshot {
  const next = cloneSnapshot(snapshot);
  profileOf(next, provider).declarations.push(declaration);
  return next;
}

/** Fixture: rewrite a declaration's evidence string (stale-evidence drift). */
function withEvidence(
  snapshot: CapabilityRegistrySnapshot,
  provider: string,
  capability: string,
  evidence: string,
): MutableSnapshot {
  const next = cloneSnapshot(snapshot);
  const declaration = profileOf(next, provider).declarations.find(
    (d) => d.capability === capability,
  );
  if (!declaration) throw new Error(`fixture error: '${provider}' does not declare '${capability}'`);
  declaration.evidence = evidence;
  return next;
}

/** Fixture: drop a whole provider profile (registry-completeness drift). */
function withoutProfile(snapshot: CapabilityRegistrySnapshot, provider: string): MutableSnapshot {
  const next = cloneSnapshot(snapshot);
  next.providers = next.providers.filter((p) => p.provider !== provider);
  return next;
}

/** Fixture: a NEW provider appears in the dispatcher with no registry profile. */
function withExtraCanonicalProvider(
  model: CapabilityEvidenceModel,
  provider: string,
): CapabilityEvidenceModel {
  return { ...model, canonicalProviders: [...model.canonicalProviders, provider] };
}

/** Fixture: two Platform evidence sources contradict each other. */
function withContradictoryEvidence(
  model: CapabilityEvidenceModel,
  provider: string,
  capability: string,
  supported: boolean,
  source: string,
): CapabilityEvidenceModel {
  const providers: ProviderEvidence[] = model.providers.map((p) =>
    p.provider === provider
      ? {
          provider: p.provider,
          observations: [
            ...p.observations,
            { capability, supported, source, method: 'descriptor-table' as const },
          ],
        }
      : p,
  );
  return { ...model, providers };
}

function findingsOfKind(findings: readonly DriftFinding[], kind: DriftKind): DriftFinding[] {
  return findings.filter((f) => f.kind === kind);
}

// ── Shared, real inputs ───────────────────────────────────────────────────────

let realSnapshot: CapabilityRegistrySnapshot;
let realModel: CapabilityEvidenceModel;

beforeAll(async () => {
  realSnapshot = snapshotCapabilityRegistry();
  realModel = await buildPlatformEvidenceModel({
    knownCapabilities: PROVIDER_CAPABILITY_NAMES.map(String),
  });
});

// ── 0. Preconditions (the verifier is wired to the real Platform) ─────────────

describe('PB-008 · preconditions', () => {
  it('pins the capability vocabulary independently of the registry constants', () => {
    // The evidence collectors use LITERAL capability names so a rename on the registry
    // side cannot silently follow through into the verifier. This asserts the Platform
    // still knows each literal.
    for (const capability of Object.values(CAPABILITY)) {
      expect(isKnownCapability(capability)).toBe(true);
    }
  });

  it('measures registry completeness against the dispatcher provider set', () => {
    expect([...realModel.canonicalProviders].sort()).toEqual([...GATEWAY_PROVIDER_IDS].sort());
  });

  it('snapshots every registered provider profile with its declarations', () => {
    expect(realSnapshot.providers.length).toBe(GATEWAY_PROVIDER_IDS.length);
    for (const profile of realSnapshot.providers) {
      expect(profile.declarations.length).toBeGreaterThan(0);
    }
  });

  it('collected behavioral-probe evidence from the real transport seams', () => {
    const probed = realModel.providers
      .filter((p) => p.observations.some((o) => o.method === 'behavioral-probe'))
      .map((p) => p.provider)
      .sort();
    expect(probed).toEqual(['copilot', 'gemini', 'perplexity']);
  });
});

// ── 1. NEGATIVE CONTROLS — proof the verifier actually fires ──────────────────

describe('PB-008 · negative controls (each drift class is provably detected)', () => {
  it('DRIFT CLASS: stale_declaration — registry says true, evidence says false', () => {
    // gemini.streaming is declared false and observed false. Flip the declaration.
    const drifted = withFlippedDeclaration(realSnapshot, 'gemini', CAPABILITY.STREAMING);
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    expect(report.ok).toBe(false);
    const stale = findingsOfKind(report.findings, 'stale_declaration');
    expect(stale).toHaveLength(1);
    expect(stale[0].provider).toBe('gemini');
    expect(stale[0].capability).toBe('streaming');
    expect(stale[0].declared).toBe(true);
    expect(stale[0].observed).toBe(false);
    // The diagnostic must be actionable on its own.
    expect(stale[0].message).toContain("provider 'gemini' capability 'streaming'");
    expect(stale[0].message).toContain('registry declares true, evidence observes false');
    expect(stale[0].message).toContain('behavioral-probe');
    expect(stale[0].message).toContain('onChunk emitted 0 chunk(s)');
    expect(stale[0].message).toContain('backend/services/aiGatewayCapabilities.ts');
    expect(report.formatted).toContain('stale_declaration');
  });

  it('DRIFT CLASS: stale_declaration — a positive claim that stopped being true', () => {
    // perplexity.citations is the registry's only `true` grounded-output claim.
    const drifted = withFlippedDeclaration(realSnapshot, 'perplexity', CAPABILITY.CITATIONS);
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    const stale = findingsOfKind(report.findings, 'stale_declaration');
    expect(stale).toHaveLength(1);
    expect(stale[0].provider).toBe('perplexity');
    expect(stale[0].capability).toBe('citations');
    expect(stale[0].message).toContain('registry declares false, evidence observes true');
    expect(stale[0].message).toContain('PERPLEXITY_CITATIONS_V1');
    expect(stale[0].remedy).toContain('set supported: true');
  });

  it('DRIFT CLASS: missing_declaration — implementation evidence exists, registry silent', () => {
    const drifted = withoutDeclaration(realSnapshot, 'perplexity', CAPABILITY.SYSTEM_PROMPT);
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    expect(report.ok).toBe(false);
    const missing = findingsOfKind(report.findings, 'missing_declaration');
    expect(missing).toHaveLength(1);
    expect(missing[0].provider).toBe('perplexity');
    expect(missing[0].capability).toBe('systemPrompt');
    expect(missing[0].declared).toBe('undeclared');
    expect(missing[0].observed).toBe(true);
    expect(missing[0].message).toContain('registry declares undeclared, evidence observes true');
    expect(missing[0].message).toContain('GATEWAY_PROVIDER_CAPABILITIES.perplexity.supportsSystemPrompt');
    expect(missing[0].remedy).toContain("declare 'systemPrompt' for 'perplexity'");
  });

  it('DRIFT CLASS: unsupported_declaration — a claim with no possible evidence source', () => {
    const drifted = withExtraDeclaration(realSnapshot, 'openai', {
      capability: 'telepathy',
      supported: true,
      evidence: 'aiGatewayCore.callOpenAi reads the user’s mind.',
    });
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    expect(report.ok).toBe(false);
    const unsupported = findingsOfKind(report.findings, 'unsupported_declaration');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].provider).toBe('openai');
    expect(unsupported[0].capability).toBe('telepathy');
    expect(unsupported[0].message).toContain('PROVIDER_CAPABILITY_NAMES');
    expect(unsupported[0].remedy).toContain('an undefined capability cannot be evidenced');
    // …and it is also reported as unverifiable rather than quietly counted as checked.
    const check = report.checks.find(
      (c) => c.provider === 'openai' && c.capability === 'telepathy',
    );
    expect(check?.status).toBe('unverifiable');
    expect(check?.reason).toContain('not in the Platform capability vocabulary');
  });

  it('DRIFT CLASS: unsupported_declaration — strict mode escalates unevidenced claims', () => {
    // Strict mode is the ratchet: it turns every declaration with NO machine-readable
    // evidence source into a hard failure. The real registry does not run in strict
    // mode today (PB-004 legitimately carries structurally-evidenced declarations),
    // so this control both proves the class fires AND documents exactly what would
    // have to be evidenced to enable it.
    const strict: CapabilityEvidenceModel = { ...realModel, requireEvidenceSource: true };
    const report = verifyProviderCapabilityRegistry(realSnapshot, strict);

    expect(report.ok).toBe(false);
    const unsupported = findingsOfKind(report.findings, 'unsupported_declaration');
    expect(unsupported.map((f) => `${f.provider}.${f.capability}`).sort()).toEqual([
      'anthropic.structuredOutput',
      'openai.imageGeneration',
      'openai.search',
      'openai.structuredOutput',
    ]);
    expect(unsupported[0].message).toContain(
      'no machine-readable evidence source is wired for this capability',
    );
    expect(unsupported[0].remedy).toContain('wire a machine-readable evidence source');
  });

  it('DRIFT CLASS: new provider in GATEWAY_PROVIDER_IDS with no registry profile', () => {
    const model = withExtraCanonicalProvider(realModel, 'mistral');
    const report = verifyProviderCapabilityRegistry(realSnapshot, model);

    expect(report.ok).toBe(false);
    const missing = findingsOfKind(report.findings, 'missing_profile');
    expect(missing).toHaveLength(1);
    expect(missing[0].provider).toBe('mistral');
    expect(missing[0].capability).toBeNull();
    expect(missing[0].message).toContain('GATEWAY_PROVIDER_IDS');
    expect(missing[0].remedy).toContain('BUILT_IN_PROVIDER_CAPABILITIES');
  });

  it('DRIFT CLASS: registry completeness — an existing provider loses its profile', () => {
    const drifted = withoutProfile(realSnapshot, 'copilot');
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    const missing = findingsOfKind(report.findings, 'missing_profile');
    expect(missing).toHaveLength(1);
    expect(missing[0].provider).toBe('copilot');
    expect(missing[0].message).toContain("add a 'copilot' profile");
  });

  it('DRIFT CLASS: unregistered_provider — registry profiles a provider the dispatcher lacks', () => {
    const drifted = cloneSnapshot(realSnapshot);
    drifted.providers.push({
      provider: 'ghost',
      declarations: [
        { capability: CAPABILITY.TEXT_COMPLETION, supported: true, evidence: 'aiGatewayCore' },
      ],
    });
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    const rogue = findingsOfKind(report.findings, 'unregistered_provider');
    expect(rogue).toHaveLength(1);
    expect(rogue[0].provider).toBe('ghost');
    expect(rogue[0].remedy).toContain('GATEWAY_PROVIDER_IDS');
  });

  it('DRIFT CLASS: evidence_conflict — two Platform sources disagree', () => {
    const model = withContradictoryEvidence(
      realModel,
      'gemini',
      CAPABILITY.SYSTEM_PROMPT,
      false,
      'SYNTHETIC_TABLE.gemini.supportsSystemPrompt',
    );
    const report = verifyProviderCapabilityRegistry(realSnapshot, model);

    const conflicts = findingsOfKind(report.findings, 'evidence_conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].provider).toBe('gemini');
    expect(conflicts[0].capability).toBe('systemPrompt');
    expect(conflicts[0].message).toContain('SYNTHETIC_TABLE.gemini.supportsSystemPrompt');
    expect(conflicts[0].remedy).toContain('they contradict each other');
    // A conflict must NOT be silently resolved into a pass/fail on the declaration.
    expect(findingsOfKind(report.findings, 'stale_declaration')).toHaveLength(0);
  });

  it('DRIFT CLASS: stale_evidence_reference — the citation itself has rotted', () => {
    const drifted = withEvidence(
      realSnapshot,
      'perplexity',
      CAPABILITY.CITATIONS,
      'callPerplexityLegacy attaches citations via PERPLEXITY_CITATIONS_V0.',
    );
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    expect(report.ok).toBe(false);
    const stale = findingsOfKind(report.findings, 'stale_evidence_reference');
    expect(stale).toHaveLength(1);
    expect(stale[0].provider).toBe('perplexity');
    expect(stale[0].capability).toBe('citations');
    expect(stale[0].message).toContain('callPerplexityLegacy');
    expect(stale[0].message).toContain('PERPLEXITY_CITATIONS_V0');
    expect(stale[0].message).toContain('no longer exists in-tree');
  });

  it('reports MULTIPLE simultaneous drifts rather than stopping at the first', () => {
    let drifted: CapabilityRegistrySnapshot = withFlippedDeclaration(
      realSnapshot,
      'gemini',
      CAPABILITY.SEED,
    );
    drifted = withoutDeclaration(drifted, 'copilot', CAPABILITY.STREAMING);
    drifted = withoutProfile(drifted, 'anthropic');
    const report = verifyProviderCapabilityRegistry(drifted, realModel);

    expect(report.findings.map((f) => f.kind).sort()).toEqual([
      'missing_declaration',
      'missing_profile',
      'stale_declaration',
    ]);
    expect(report.formatted.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT fire on legitimate non-claims (the three-valued model is respected)', () => {
    // grounding · reasoning · provenance · safetyMetadata · toolCalling are claimed by
    // NOBODY by design. Silence must never be reported as drift.
    const undeclaredByDesign = ['grounding', 'reasoning', 'provenance', 'safetyMetadata', 'toolCalling'];
    for (const capability of undeclaredByDesign) {
      expect(REQUIRED_CLAIMS).not.toContain(capability);
      for (const profile of realSnapshot.providers) {
        expect(profile.declarations.some((d) => d.capability === capability)).toBe(false);
      }
    }
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    for (const capability of undeclaredByDesign) {
      expect(report.findings.some((f) => f.capability === capability)).toBe(false);
    }
    // copilot legitimately makes no citations claim — also not drift.
    expect(
      report.findings.some((f) => f.provider === 'copilot' && f.capability === 'citations'),
    ).toBe(false);
  });
});

// ── 2. THE REAL REGISTRY, verified ────────────────────────────────────────────

describe('PB-008 · the shipped capability registry matches Platform implementation', () => {
  it('has ZERO drift findings today', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    // On failure this message is the whole diagnostic — provider, capability, declared,
    // observed, source and remedy for every finding.
    expect(report.formatted).toBe('');
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('every provider declares the REQUIRED capabilities (no silent omissions)', () => {
    for (const profile of realSnapshot.providers) {
      const declared = profile.declarations.map((d) => d.capability);
      for (const capability of REQUIRED_CLAIMS) {
        expect(declared).toContain(capability);
      }
    }
  });

  it('cross-checks perplexity citations end-to-end (the load-bearing `true`)', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    const check = report.checks.find(
      (c) => c.provider === 'perplexity' && c.capability === 'citations',
    );
    expect(check).toBeDefined();
    expect(check?.declared).toBe(true);
    expect(check?.observed).toBe(true);
    expect(check?.status).toBe('machine-verified');
    expect(check?.method).toBe('behavioral-probe');
    expect(check?.evidenceSource).toContain('PERPLEXITY_CITATIONS_V1');
  });

  it('cross-checks the copilot stub (declared unreachable, observed unreachable)', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    const check = report.checks.find(
      (c) => c.provider === 'copilot' && c.capability === CAPABILITY.TEXT_COMPLETION,
    );
    expect(check?.declared).toBe(false);
    expect(check?.observed).toBe(false);
    expect(check?.method).toBe('behavioral-probe');
    expect(check?.evidenceSource).toContain('GatewayTransportNotImplementedError');
  });

  it('every evidence string still cites code that exists in-tree', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    expect(findingsOfKind(report.findings, 'stale_evidence_reference')).toEqual([]);
    // …and the anchor check is not vacuous: every declaration cites at least one symbol.
    for (const profile of realSnapshot.providers) {
      for (const declaration of profile.declarations) {
        expect(extractEvidenceAnchors(declaration.evidence).length).toBeGreaterThan(0);
      }
    }
  });
});

// ── 3. HONEST COVERAGE — what is checked vs merely present ────────────────────

describe('PB-008 · verification coverage is reported honestly', () => {
  it('classifies EVERY declaration as machine-verified or unverifiable', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    const totalDeclarations = realSnapshot.providers.reduce(
      (n, p) => n + p.declarations.length,
      0,
    );
    expect(report.checks).toHaveLength(totalDeclarations);
    expect(report.coverage.declarations).toBe(totalDeclarations);
    expect(report.coverage.machineVerified + report.coverage.unverifiable).toBe(totalDeclarations);
  });

  it('names the evidence source for every machine-verified declaration', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    for (const check of report.checks.filter((c) => c.status === 'machine-verified')) {
      expect(check.evidenceSource).toBeTruthy();
      expect(check.method).not.toBeNull();
      expect(check.observed).toBe(check.declared);
    }
  });

  it('names the REASON for every unverifiable declaration (no silent skips)', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    for (const check of unverifiableDeclarations(report)) {
      expect(check.reason).toBeTruthy();
      expect(check.reason).toContain('no machine-readable evidence source');
      expect(check.evidenceSource).toBeNull();
    }
  });

  it('pins the EXACT set of declarations that cannot be machine-verified', () => {
    // A new unverifiable declaration must be an explicit, reviewed decision — it can
    // never be added under cover of a green suite. Each entry here rests on a
    // structural reading of the implementation, not on a machine-readable source.
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    expect(
      unverifiableDeclarations(report)
        .map((c) => `${c.provider}.${c.capability}`)
        .sort(),
    ).toEqual([
      // No structured-output directive is described by any table, registry or probe
      // for the SDK-backed core providers.
      'anthropic.structuredOutput',
      // The OpenAI image path lives outside the gateway text transport entirely.
      'openai.imageGeneration',
      'openai.search',
      'openai.structuredOutput',
    ]);
  });

  it('holds a coverage RATCHET (verified fraction may not regress)', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    expect(report.coverage.machineVerified).toBeGreaterThanOrEqual(27);
    expect(report.coverage.ratio).toBeGreaterThanOrEqual(0.87);
  });

  it('machine-verifies every declaration of every transport-seam provider', () => {
    const report = verifyProviderCapabilityRegistry(realSnapshot, realModel);
    for (const provider of ['gemini', 'perplexity', 'copilot']) {
      const checks = report.checks.filter((c) => c.provider === provider);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((c) => c.status === 'machine-verified')).toBe(true);
    }
  });

  it('surfaces the coverage ledger in the failure diagnostic', () => {
    const drifted = withFlippedDeclaration(realSnapshot, 'gemini', CAPABILITY.SEED);
    const report = verifyProviderCapabilityRegistry(drifted, realModel);
    expect(report.formatted).toContain('declarations machine-verified');
    expect(report.formatted).toMatch(/coverage: \d+\/\d+ declarations machine-verified \(\d+\.\d%\)/);
  });
});

// ── 4. RUNTIME DECOUPLING — the property this whole package must not break ─────

describe('PB-008 · the capability registry stays runtime-decoupled', () => {
  const REGISTRY_PATH = path.resolve(__dirname, '..', '..', 'services', 'aiGatewayCapabilities.ts');

  /**
   * CODE ONLY: comments and string literals removed. This matters here — the registry's
   * `evidence` strings legitimately NAME runtime symbols (that is the whole point of an
   * evidence string). Naming a symbol in prose is not coupling; REFERENCING it is. Only
   * a real scanner can tell those apart, so this is a small state machine rather than a
   * regex.
   */
  function codeOnly(source: string): string {
    let out = '';
    let i = 0;
    while (i < source.length) {
      const two = source.slice(i, i + 2);
      if (two === '//') {
        while (i < source.length && source[i] !== '\n') i += 1;
        continue;
      }
      if (two === '/*') {
        i += 2;
        while (i < source.length && source.slice(i, i + 2) !== '*/') i += 1;
        i += 2;
        continue;
      }
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i += 1;
        while (i < source.length && source[i] !== ch) {
          if (source[i] === '\\') i += 1;
          i += 1;
        }
        i += 1;
        out += '""';
        continue;
      }
      out += ch;
      i += 1;
    }
    return out;
  }

  it('has exactly one import, and it is TYPE-ONLY', () => {
    const source = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const statements = [...source.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';/gm)];
    expect(statements).toHaveLength(1);
    expect(statements[0][1]).toBe('./aiGatewayDispatcher');
    expect(statements[0][0].startsWith('import type')).toBe(true);
  });

  it('pulls in NO runtime values (no require, no dynamic import, no side-effect import)', () => {
    const code = codeOnly(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/^\s*import\s+""/m);
    // Every runtime symbol the transports/dispatcher export must be absent from the
    // registry's CODE — the test, not the registry, is what reads them. (They may, and
    // do, appear inside evidence strings; the scanner above removes those.)
    for (const symbol of [
      'GATEWAY_TRANSPORT_CAPABILITIES',
      'GATEWAY_PROVIDER_CAPABILITIES',
      'GATEWAY_TRANSPORTS',
      'GATEWAY_PROVIDER_IDS',
      'dispatchTransport',
      'resolveTransport',
      'callPerplexity',
    ]) {
      expect(code).not.toContain(symbol);
    }
  });

  it('the scanner is not vacuous (it would see a real runtime reference)', () => {
    // Guards the guard: if `codeOnly` silently stripped everything, the assertion above
    // would pass for a registry that HAD been coupled.
    const code = codeOnly(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    expect(code).toContain('export function supportsCapability');
    expect(code).toContain("import type { GatewayProviderId } from ");
    expect(codeOnly("const x = GATEWAY_TRANSPORTS; // ok")).toContain('GATEWAY_TRANSPORTS');
    expect(codeOnly("const e = 'GATEWAY_TRANSPORTS is cited';")).not.toContain('GATEWAY_TRANSPORTS');
  });

  it('verification introduced no coupling: the drift verifier itself imports no runtime module', () => {
    const verifierPath = path.resolve(__dirname, '..', 'helpers', 'providerCapabilityDrift.ts');
    const source = fs.readFileSync(verifierPath, 'utf8');
    const statements = [...source.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';/gm)];
    // The verifier is pure and injected — the evidence adapter (a test helper) is the
    // only thing that touches Platform modules, and only read-only.
    expect(statements).toHaveLength(0);
  });
});
