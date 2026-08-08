/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 5 — adoption readiness.
 *
 * Four properties in separate groups so a mutation to one cannot be reported by another:
 *
 *   RUNTIME CONTRACTS   — the frozen descriptor and its conformance validator
 *   PRODUCER FAÇADE     — the surface Platform consumes, and that creating it activates nothing
 *   READINESS EVALUATION— consumer / capability / activation assessment, kept distinct
 *   COMPATIBILITY       — version gating
 */

import {
  CONTACT_CANONICAL_CONTRACT,
  CONTACT_CONTRACT_VERSION,
  CONTACT_GOVERNANCE_RULES,
  CONTACT_MIGRATION_PROHIBITIONS,
  validateContactContract,
  assessContactConsumerReadiness,
  assessContactCapabilityReadiness,
  validateContactActivation,
  checkContactRuntimeCompatibility,
  createContactProductionFacade,
  runContactProductionParity,
  assembleContactUnderstanding,
  writeInputsFromContactRow,
  CONTACT_MODEL_VERSION,
  CONTACT_FACET_NAMES,
  CONTACT_SCORE_DIMENSIONS,
  type ContactEvidenceInput,
  type ContactShadowPersistDeps,
  type ContactRowLike,
} from '../../services/contactIntelligence';

const ASOF = '2026-08-08T00:00:00.000Z';
const SEEN = '2026-08-01T00:00:00.000Z';

const evidence = (over: Partial<ContactEvidenceInput> = {}): ContactEvidenceInput => ({
  companyId: 'co-1', contactId: 'ct-1', asOf: ASOF, source: 'contacts_row',
  unifiedPersonId: 'up-1',
  identity: { platform: 'x', platformUserId: '12345', contactKey: 'x:12345', observedAt: SEEN },
  profile: { displayName: 'Alice', profileUrl: 'https://x.com/alice', observedAt: SEEN },
  ...over,
});

const row = (over: Partial<ContactRowLike> = {}): ContactRowLike => ({
  id: 'ct-1', organization_id: 'co-1', platform: 'x', platform_user_id: '12345',
  contact_key: 'x:12345', display_name: 'Alice', profile_url: 'https://x.com/alice',
  unified_person_id: 'up-1', updated_at: SEEN, ...over,
});

const savedEnv = { ...process.env };
const enable = () => { process.env.CONTACT_UNDERSTANDING_ENABLED = 'true'; };
afterEach(() => { process.env = { ...savedEnv }; });

const stubDeps = (): ContactShadowPersistDeps => ({ readShadow: async () => null, writeShadow: async () => {} });

// ── RUNTIME CONTRACTS ──────────────────────────────────────────────────────────────────────────────
describe('Contact contract — frozen descriptor', () => {
  it('is frozen and self-consistent with the model it describes', () => {
    expect(Object.isFrozen(CONTACT_CANONICAL_CONTRACT)).toBe(true);
    expect(CONTACT_CANONICAL_CONTRACT.contractVersion).toBe(CONTACT_CONTRACT_VERSION);
    expect(CONTACT_CANONICAL_CONTRACT.modelVersion).toBe(CONTACT_MODEL_VERSION);
    expect([...CONTACT_CANONICAL_CONTRACT.facets]).toEqual([...CONTACT_FACET_NAMES]);
    expect([...CONTACT_CANONICAL_CONTRACT.scoreDimensions]).toEqual([...CONTACT_SCORE_DIMENSIONS]);
  });

  it('encodes the frozen identity decision rather than leaving it in a document', () => {
    expect(CONTACT_CANONICAL_CONTRACT.tenantScoped).toBe(true);
    expect([...CONTACT_CANONICAL_CONTRACT.identityKeyFields]).toEqual(['companyId', 'contactId']);
    expect(CONTACT_CANONICAL_CONTRACT.canonicalPerson).toBe('unified_persons');
    expect(CONTACT_CANONICAL_CONTRACT.canonicalPlatformPerson).toBe('contacts');
    expect(CONTACT_MIGRATION_PROHIBITIONS).toContain('global (non-tenant-scoped) contact identity');
    expect(CONTACT_GOVERNANCE_RULES.some((r) => r.includes('engagement_authors is a projection'))).toBe(true);
  });

  it('publishes only contact_of and works_at', () => {
    expect([...CONTACT_CANONICAL_CONTRACT.publishedEdgeTypes]).toEqual(['contact_of', 'works_at']);
  });

  it('a produced understanding conforms', () => {
    const { understanding } = assembleContactUnderstanding(evidence());
    expect(validateContactContract(understanding)).toEqual({ conforms: true, issues: [] });
  });

  it('rejects a model-version mismatch', () => {
    const { understanding } = assembleContactUnderstanding(evidence());
    const r = validateContactContract({ ...understanding, version: 99 });
    expect(r.conforms).toBe(false);
    expect(r.issues.join(' ')).toContain('model version 99');
  });

  it('rejects an untenanted key — tenancy is conformance, not convention', () => {
    const { understanding } = assembleContactUnderstanding(evidence());
    const r = validateContactContract({ ...understanding, key: { companyId: '', contactId: 'ct-1' } });
    expect(r.conforms).toBe(false);
    expect(r.issues).toContain('identity key missing companyId');
  });

  it('rejects a foreign graph root and an unpublished edge type', () => {
    const { understanding } = assembleContactUnderstanding(evidence());
    const foreignRoot = validateContactContract({ ...understanding, graph: { ...understanding.graph, root: { type: 'lead', id: 'ct-1' } } });
    expect(foreignRoot.conforms).toBe(false);

    const badEdge = validateContactContract({
      ...understanding,
      graph: { root: understanding.graph.root, edges: [{ ...understanding.graph.edges[0], type: 'influences' as never }] },
    });
    expect(badEdge.conforms).toBe(false);
    expect(badEdge.issues.join(' ')).toContain('unpublished edge type');
  });
});

// ── READINESS EVALUATION ───────────────────────────────────────────────────────────────────────────
describe('Contact readiness — consumer (structural)', () => {
  it('is ready today: shape, determinism, references-only, tenancy, conformance', () => {
    const r = assessContactConsumerReadiness(evidence());
    expect(r).toMatchObject({
      exposesCanonicalSurface: true, referencesOnly: true, deterministic: true,
      projectable: true, graphCitizen: true, tenantScoped: true, contractConformant: true, ready: true,
    });
  });

  it('gates every downstream consumer on the same structural result', () => {
    const r = assessContactConsumerReadiness(evidence());
    expect(Object.values(r.consumers).every(Boolean)).toBe(true);
    expect(Object.keys(r.consumers).sort()).toEqual(['crm', 'intent', 'journey', 'lead', 'outreach', 'qualification']);
  });

  it('is NOT ready without a tenant', () => {
    const r = assessContactConsumerReadiness(evidence({ companyId: '' }));
    expect(r.tenantScoped).toBe(false);
    expect(r.ready).toBe(false);
  });
});

describe('Contact readiness — capability (what the evidence can ground)', () => {
  it('reports abstentions BEFORE anything is built', () => {
    const r = assessContactCapabilityReadiness(evidence());
    const by = Object.fromEntries(r.rows.map((x) => [x.capability, x]));
    expect(by.identity.grounded).toBe(true);
    expect(by.profile.grounded).toBe(true);
    expect(by.channels.grounded).toBe(false);
    expect(by.channels.reason).toContain('no channel observations');
    expect(by.affiliation.grounded).toBe(false);
    expect(r.groundedCount).toBe(2);
    expect(r.abstainingCount).toBe(4);
  });

  it('a grounded capability carries no reason', () => {
    const r = assessContactCapabilityReadiness(evidence({ channels: [{ channel: 'dm', observedAt: SEEN }] }));
    expect(r.rows.find((x) => x.capability === 'channels')).toEqual({ capability: 'channels', grounded: true, reason: null });
  });
});

describe('Contact readiness — activation (deployment)', () => {
  it('is blocked in every way today, and says which', () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    const v = validateContactActivation();
    expect(v.canActivate).toBe(false);
    expect(v.blockers.sort()).toEqual(['flag_disabled', 'no_persistence_binding', 'no_producer_registration', 'projection_not_authoritative']);
  });

  it('the flag alone is not enough — an unbound store still blocks', () => {
    enable();
    const v = validateContactActivation();
    expect(v.understandingEnabled).toBe(true);
    expect(v.canActivate).toBe(false);
    expect(v.blockers).toContain('no_persistence_binding');
  });

  it('activates once flag + store + producer are all present', () => {
    enable();
    const v = validateContactActivation({ persist: stubDeps(), producerRegistered: true });
    expect(v.persistenceBound).toBe(true);
    expect(v.canActivate).toBe(true);
  });

  it('authoritative projection is reported but does NOT gate activation — shadow is a valid state', () => {
    enable();
    const v = validateContactActivation({ persist: stubDeps(), producerRegistered: true });
    expect(v.projectionAuthoritative).toBe(false);
    expect(v.blockers).toContain('projection_not_authoritative');
    expect(v.canActivate).toBe(true);
  });

  it('a half-bound store does not count as bound', () => {
    enable();
    const half = { readShadow: async () => null } as unknown as ContactShadowPersistDeps;
    expect(validateContactActivation({ persist: half, producerRegistered: true }).persistenceBound).toBe(false);
  });
});

// ── COMPATIBILITY ──────────────────────────────────────────────────────────────────────────────────
describe('Contact runtime compatibility', () => {
  it('accepts a consumer pinned to the published contract version', () => {
    expect(checkContactRuntimeCompatibility(CONTACT_CONTRACT_VERSION)).toEqual({
      contractVersion: CONTACT_CONTRACT_VERSION, modelVersion: CONTACT_MODEL_VERSION, compatible: true, reason: null,
    });
  });

  it('refuses a consumer pinned to a different contract version', () => {
    const r = checkContactRuntimeCompatibility(CONTACT_CONTRACT_VERSION + 1);
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain('consumer expects contract v2');
  });

  it('refuses a model-version mismatch when the consumer pins one', () => {
    expect(checkContactRuntimeCompatibility(CONTACT_CONTRACT_VERSION, 99).compatible).toBe(false);
    expect(checkContactRuntimeCompatibility(CONTACT_CONTRACT_VERSION, CONTACT_MODEL_VERSION).compatible).toBe(true);
  });
});

// ── PRODUCER FAÇADE ────────────────────────────────────────────────────────────────────────────────
describe('Contact production façade', () => {
  it('creating one activates nothing — no store, no registration', () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    const f = createContactProductionFacade();
    expect(f.activation().canActivate).toBe(false);
    expect(f.activation().persistenceBound).toBe(false);
  });

  it('exposes producer and consumer ports that delegate to the certified seams', () => {
    const f = createContactProductionFacade();
    const inputs = f.producer.fromRow(row(), ASOF);
    expect(inputs.companyId).toBe('co-1');

    const produced = f.producer.produce(inputs);
    expect(produced.record.contact_id).toBe('ct-1');

    const projection = f.consumer.project(evidence());
    expect(JSON.stringify(projection)).toBe(JSON.stringify(assembleContactUnderstanding(evidence()).projection));

    expect(f.consumer.validate(produced.understanding).conforms).toBe(true);
  });

  it('the consumer shadow port stays dark by default', () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    expect(createContactProductionFacade().consumer.shadow(evidence())).toBeNull();
  });

  it('persist reports DISABLED when no store is bound — same shape as a dark flag', async () => {
    enable();
    const f = createContactProductionFacade();
    const res = await f.persist(writeInputsFromContactRow(row(), ASOF));
    expect(res).toMatchObject({ executed: false, wrote: false, reason: 'DISABLED' });
  });

  it('persist writes through the injected store once bound and enabled', async () => {
    enable();
    let wrote = 0;
    const f = createContactProductionFacade({ persist: { readShadow: async () => null, writeShadow: async () => { wrote += 1; } } });
    const res = await f.persist(writeInputsFromContactRow(row(), ASOF));
    expect(res).toMatchObject({ executed: true, wrote: true, reason: 'INITIAL' });
    expect(wrote).toBe(1);
  });

  it('persist stays dark when the store is bound but the flag is off', async () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    let wrote = 0;
    const f = createContactProductionFacade({ persist: { readShadow: async () => null, writeShadow: async () => { wrote += 1; } } });
    const res = await f.persist(writeInputsFromContactRow(row(), ASOF));
    expect(res.executed).toBe(false);
    expect(wrote).toBe(0);
  });

  it('surfaces readiness, activation and compatibility from one object', () => {
    const f = createContactProductionFacade();
    expect(f.consumerReadiness(evidence()).ready).toBe(true);
    expect(f.capabilityReadiness(evidence()).groundedCount).toBe(2);
    expect(f.compatibility(CONTACT_CONTRACT_VERSION).compatible).toBe(true);
  });
});

describe('Contact production parity helper', () => {
  it('certifies a fully-grounded set at parity 1.0', () => {
    const r = runContactProductionParity([
      { inputs: writeInputsFromContactRow(row(), ASOF) },
      { inputs: writeInputsFromContactRow(row({ id: 'ct-2', platform_user_id: '999' }), ASOF) },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.overallParity).toBe(1);
    expect(r.totalDivergences).toBe(0);
    expect(r.certifiable).toBe(true);
  });

  it('an empty case set is vacuously certifiable at parity 1', () => {
    expect(runContactProductionParity([])).toMatchObject({ overallParity: 1, totalDivergences: 0, certifiable: true });
  });
});
