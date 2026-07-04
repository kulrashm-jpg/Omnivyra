import { backlinkEvidenceAdapter, BACKLINK_EVIDENCE_KEYS, type BacklinkEvidenceInput } from '../../services/evidencePlatform/providers/backlink/backlinkEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isBacklinkProviderConfigured, registerBacklinkProvider, isBacklinkProviderAvailable,
  backlinkProviderReliability, fetchBacklinkEvidence,
} from '../../services/backlinkAuthorityProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';

const fixture: BacklinkEvidenceInput = {
  domain: 'example.com',
  referringDomains: 320, totalBacklinks: 4100, domainAuthority: 58, spamScore: 10,
  dofollowCount: 3000, nofollowCount: 1100,
  uniqueAnchors: null, uniqueDomains: null, newLinks30d: 45, lostLinks30d: 12,
  observedAt: '2026-01-01T00:00:00.000Z', providerReliability: 0.9,
};

describe('Backlink Provider — canonical adapter (BETA-PROVIDER-001)', () => {
  it('converts a provider payload to canonical Evidence, per-field MEASURED/CALCULATED', () => {
    const ev = backlinkEvidenceAdapter.toEvidence(fixture, { observedAt: fixture.observedAt });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['referring_domains'].value).toBe(320);
    expect(byKey['referring_domains'].maturity).toBe('MEASURED');
    expect(byKey['domain_authority'].value).toBe(58);
    expect(byKey['dofollow_ratio'].value).toBe(0.73); // 3000/4100
    expect(byKey['dofollow_ratio'].maturity).toBe('CALCULATED');
    expect(byKey['link_quality'].value).toBe(52.2); // 58*(1-0.10)
    expect(byKey['new_links'].value).toBe(45);
    expect(byKey['lost_links'].value).toBe(12);
    // sourceType is external_api throughout
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('never fabricates: omits missing metrics, and every value traces to the input', () => {
    const ev = backlinkEvidenceAdapter.toEvidence(fixture, { observedAt: fixture.observedAt });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).not.toContain('anchor_diversity'); // uniqueAnchors was null → omitted
    expect(keys).not.toContain('domain_diversity');
    const allowed = new Set([320, 4100, 58, 0.73, 52.2, 45, 12]);
    for (const e of ev) if (typeof e.value === 'number') expect(allowed.has(e.value)).toBe(true);
  });

  it('is deterministic', () => {
    expect(backlinkEvidenceAdapter.toEvidence(fixture, {})).toEqual(backlinkEvidenceAdapter.toEvidence(fixture, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = backlinkEvidenceAdapter.onFailure({
      providerId: 'backlink.authority', state: PROVIDER_FAILURE.UNAUTHORIZED,
      reason: 'bad key', evidenceKey: 'domain_authority', observedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_UNAUTHORIZED');
  });
});

describe('Backlink Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('is UNAVAILABLE without credentials (backward compatible)', () => {
    delete process.env.AHREFS_API_KEY; delete process.env.MOZ_API_KEY; delete process.env.MAJESTIC_API_KEY;
    expect(isBacklinkProviderConfigured()).toBe(false);
    const d = registerBacklinkProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isBacklinkProviderAvailable()).toBe(false);
  });

  it('flips to authenticated/connected when a credential is present', () => {
    process.env.AHREFS_API_KEY = 'test-key';
    const d = registerBacklinkProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isBacklinkProviderAvailable()).toBe(true);
    expect(backlinkProviderReliability()).toBe(0.9);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no HTTP, no fabrication)', async () => {
    delete process.env.AHREFS_API_KEY; delete process.env.MOZ_API_KEY; delete process.env.MAJESTIC_API_KEY;
    const ev = await fetchBacklinkEvidence('example.com', '2026-01-01T00:00:00.000Z');
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('exposes exactly the declared backlink evidence keys', () => {
    expect(backlinkEvidenceAdapter.supportedEvidence).toEqual([...BACKLINK_EVIDENCE_KEYS]);
  });
});
