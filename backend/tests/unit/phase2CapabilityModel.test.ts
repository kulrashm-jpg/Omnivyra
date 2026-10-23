/**
 * PHASE 2 — the four-layer capability model.
 *
 * WHAT THESE TESTS DEFEND. The model's whole value is that its layers are
 * INDEPENDENT, and independence is the kind of property that decays silently: the
 * first convenient `implemented ?? executable` would restore exactly the
 * confusion the model was built to remove. So the prohibitions are pinned
 * directly, not merely documented.
 *
 * Nothing here calls a provider, touches a credential or reaches a database — the
 * module under test has no imports at all.
 */
import {
  CAPABILITY_KINDS,
  PROVIDER_CAPABILITIES,
  OPERATIONAL_VERIFICATIONS,
  PRESENTATION_STATUSES,
  getProviderCapabilities,
  getCapability,
  providersWithCapability,
  isOperationallyVerified,
  derivePresentationStatus,
  mayOfferCredentialForm,
  credentialFormProviderIds,
} from '../../services/integrations/providerCapabilityModel';

describe('Phase 2 — the model is well-formed', () => {
  it('every provider has a unique id and at least one capability', () => {
    const ids = PROVIDER_CAPABILITIES.map((p) => p.providerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDER_CAPABILITIES) {
      expect(p.registered).toBe(true);
      expect(Object.keys(p.capabilities).length).toBeGreaterThan(0);
    }
  });

  it('every declared capability kind is a known kind', () => {
    for (const p of PROVIDER_CAPABILITIES) {
      for (const kind of Object.keys(p.capabilities)) {
        expect(CAPABILITY_KINDS).toContain(kind);
      }
    }
  });

  it('an unknown provider or capability answers null, never a guess', () => {
    expect(getProviderCapabilities('peopledatalabs')).toBeNull();
    expect(getProviderCapabilities('hunter')).toBeNull();
    expect(getProviderCapabilities('builtwith')).toBeNull();
    expect(getCapability('apollo', 'engagement')).toBeNull();
  });

  it('providers mentioned only in past discussions are ABSENT', () => {
    const ids = PROVIDER_CAPABILITIES.map((p) => p.providerId);
    for (const absent of ['peopledatalabs', 'hunter', 'builtwith', 'marketpulse']) {
      expect(ids).not.toContain(absent);
    }
  });
});

describe('Phase 2 — the layers are INDEPENDENT', () => {
  it('registered ≠ operational', () => {
    // Every provider is registered; almost none is operational.
    expect(PROVIDER_CAPABILITIES.every((p) => p.registered)).toBe(true);
    expect(isOperationallyVerified('apollo', 'enrichment')).toBe(false);
    expect(isOperationallyVerified('clearbit', 'enrichment')).toBe(false);
  });

  it('implemented ≠ operationally verified', () => {
    const apollo = getCapability('apollo', 'enrichment')!;
    expect(apollo.implemented).toBe(true);
    expect(apollo.executable).toBe(true);
    // The distinction this whole phase exists for.
    expect(isOperationallyVerified('apollo', 'enrichment')).toBe(false);
    expect(derivePresentationStatus('apollo', 'enrichment')).toBe('not_operational');
  });

  it('configurable ≠ executable — ZoomInfo is the case that proves it', () => {
    const zoominfo = getProviderCapabilities('zoominfo')!;
    // Layer C says yes: the platform accepts the credential.
    expect(zoominfo.tenantConfigurable).toBe(true);
    // Layer B says no: nothing can use it.
    expect(getCapability('zoominfo', 'enrichment')!.implemented).toBe(false);
    expect(getCapability('zoominfo', 'enrichment')!.executable).toBe(false);
    // So no connect form may be offered.
    expect(mayOfferCredentialForm('zoominfo')).toBe(false);
  });

  it('enrichment-capable ≠ discovery-capable — they are separate facts per provider', () => {
    // Apollo no longer demonstrates this by CONTRASTING values: Phase 4
    // implemented discovery, so both of its capabilities are now implemented.
    // The independence is structural rather than incidental — each capability is
    // its own state object and a provider may declare one without the other.
    const apolloEnrich = getCapability('apollo', 'enrichment')!;
    const apolloDiscover = getCapability('apollo', 'discovery')!;
    expect(apolloEnrich).not.toBe(apolloDiscover);

    // Crunchbase is the current proof that the kinds are independent: it declares
    // discovery and NO enrichment at all.
    expect(getCapability('crunchbase', 'discovery')).not.toBeNull();
    expect(getCapability('crunchbase', 'enrichment')).toBeNull();
    // And Clearbit the mirror image: enrichment only, no discovery.
    expect(getCapability('clearbit', 'enrichment')).not.toBeNull();
    expect(getCapability('clearbit', 'discovery')).toBeNull();
  });

  it('no capability claims to be executable without being implemented', () => {
    // The one combination that would be incoherent rather than merely unusual.
    for (const p of PROVIDER_CAPABILITIES) {
      for (const [kind, state] of Object.entries(p.capabilities)) {
        if (state.executable) {
          expect(state.implemented).toBe(true);
        }
        void kind;
      }
    }
  });

  it('nothing is operationally verified without being executable', () => {
    for (const v of OPERATIONAL_VERIFICATIONS) {
      const state = getCapability(v.providerId, v.capability)!;
      expect(state.executable).toBe(true);
      // And the basis is recorded, never implied.
      expect(typeof v.basis).toBe('string');
      expect(v.basis.length).toBeGreaterThan(0);
    }
  });

  it('NO external provider is operationally verified', () => {
    // Only Omnivyra's own released routes are, and their basis says so.
    expect(OPERATIONAL_VERIFICATIONS.map((v) => v.providerId).sort())
      .toEqual(['crm', 'csv', 'manual']);
    for (const v of OPERATIONAL_VERIFICATIONS) expect(v.basis).toBe('released_route');
  });
});

describe('Phase 2 — presentation derivation', () => {
  it('returns a known status for every declared capability', () => {
    for (const p of PROVIDER_CAPABILITIES) {
      for (const kind of Object.keys(p.capabilities)) {
        expect(PRESENTATION_STATUSES).toContain(
          derivePresentationStatus(p.providerId, kind as never),
        );
      }
    }
  });

  it('the three released acquisition sources are operational', () => {
    for (const id of ['manual', 'csv', 'crm']) {
      expect(derivePresentationStatus(id, 'acquisition')).toBe('operational');
    }
  });

  it('Apollo discovery is NOT_OPERATIONAL since Phase 4 implemented it', () => {
    // It read `planned` until Phase 4. Implemented and callable, never verified
    // against the provider — which is a different answer from both `planned` and
    // `operational`, and the reason five statuses exist.
    expect(derivePresentationStatus('apollo', 'discovery')).toBe('not_operational');
    expect(derivePresentationStatus('apollo', 'discovery')).not.toBe('planned');
    expect(derivePresentationStatus('apollo', 'discovery')).not.toBe('operational');
  });

  it('a capability with no adapter still reads PLANNED', () => {
    // The `planned` branch is still exercised — by the providers that have not
    // been implemented, which is what it is for.
    expect(derivePresentationStatus('zoominfo', 'discovery')).toBe('planned');
    expect(derivePresentationStatus('crunchbase', 'discovery')).toBe('planned');
    expect(derivePresentationStatus('rapidapi', 'enrichment')).toBe('planned');
  });

  it('Sales Navigator is BLOCKED, which is a different answer from planned', () => {
    expect(derivePresentationStatus('linkedin_sales_navigator', 'discovery')).toBe('blocked');
    expect(getCapability('linkedin_sales_navigator', 'discovery')!.blocked)
      .toBe('provider_terms_review');
  });

  it('an undeclared pair is not_implemented, never silently operational', () => {
    expect(derivePresentationStatus('apollo', 'engagement')).toBe('not_implemented');
    expect(derivePresentationStatus('nonexistent', 'discovery')).toBe('not_implemented');
  });
});

describe('Phase 2 — O-2, encoded once', () => {
  it('only providers with an implemented AND executable capability may be offered', () => {
    expect(credentialFormProviderIds().sort()).toEqual(['apollo', 'clearbit']);
  });

  it('credential-storable but unusable providers are excluded', () => {
    for (const id of ['zoominfo', 'crunchbase', 'rapidapi']) {
      expect(getProviderCapabilities(id)!.tenantConfigurable).toBe(true);
      expect(mayOfferCredentialForm(id)).toBe(false);
    }
  });

  it('a provider the platform cannot take a credential for is excluded', () => {
    // Sales Navigator authenticates by OAuth; the A3P path takes an API key.
    expect(getProviderCapabilities('linkedin_sales_navigator')!.tenantConfigurable).toBe(false);
    expect(mayOfferCredentialForm('linkedin_sales_navigator')).toBe(false);
  });

  it('operator-supplied sources are never offered a credential form', () => {
    for (const id of ['manual', 'csv', 'crm']) {
      expect(getProviderCapabilities(id)!.credentialMode).toBe('not_applicable');
      expect(mayOfferCredentialForm(id)).toBe(false);
    }
  });

  it('the allowlist does NOT consult layer D — verification cannot be a precondition', () => {
    // Requiring verification before configuration would make the first
    // verification impossible: you cannot prove a provider works without a key.
    expect(isOperationallyVerified('apollo', 'enrichment')).toBe(false);
    expect(mayOfferCredentialForm('apollo')).toBe(true);
  });
});

describe('Phase 2 — the model holds no tenant state and no secret', () => {
  it('nothing in the model names a company, tenant or credential value', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/integrations/providerCapabilityModel.ts'),
      'utf8',
    );
    // Layer C's static half is "may a credential be stored", never "is one stored".
    expect(src).not.toMatch(/\bcompany_id\b|\borganization_id\b/);
    // CODE, not prose. The header explains that a credential is held per provider
    // as one row in `integration_credentials`; that sentence must not be what
    // satisfies the assertion, so these match accesses and calls instead.
    expect(src).not.toMatch(/ownedDbTable\s*\(/);
    expect(src).not.toMatch(/from '[^']*supabase/);
    expect(src).not.toMatch(/\.from\('integration_credentials'\)/);
    expect(src).not.toMatch(/process\.env\s*[.[]/);
    // PHASE 3 — `credentialed` now appears as a CALLER-SUPPLIED parameter on
    // `buildCapabilityCard`, which is the opposite of storing it: the model still
    // cannot know a tenant's credential state and must be told. What must stay
    // impossible is a provider DEFINITION carrying it, so that is what is asserted.
    for (const provider of PROVIDER_CAPABILITIES) {
      expect(Object.keys(provider)).not.toContain('credentialed');
      expect(Object.keys(provider)).not.toContain('credentialState');
    }
  });

  it('the module imports nothing, so it is safe on either side of the boundary', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/integrations/providerCapabilityModel.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/require\(/);
  });

  it('gives Drishiq Labs — or any named company — no path at all', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/integrations/providerCapabilityModel.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/drishiq/i);
    // The model is keyed by provider only; there is no per-company branch to take.
    expect(providersWithCapability('enrichment').map((p) => p.providerId))
      .toEqual(['apollo', 'clearbit', 'zoominfo', 'rapidapi']);
  });
});

describe('Phase 2 — MarketPulse cannot become a source through this model', () => {
  it('has no provider entry, so no capability can be derived for it', () => {
    expect(getProviderCapabilities('marketpulse')).toBeNull();
    expect(getProviderCapabilities('market_pulse')).toBeNull();
    for (const kind of CAPABILITY_KINDS) {
      expect(derivePresentationStatus('marketpulse', kind)).toBe('not_implemented');
    }
    expect(mayOfferCredentialForm('marketpulse')).toBe(false);
  });

  it('is absent from every capability listing', () => {
    for (const kind of CAPABILITY_KINDS) {
      expect(providersWithCapability(kind).map((p) => p.providerId)).not.toContain('marketpulse');
    }
  });
});
