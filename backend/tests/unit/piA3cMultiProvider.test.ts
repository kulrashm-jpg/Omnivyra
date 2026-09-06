/**
 * A3C — multi-provider acquisition architecture.
 *
 * Proves the model treats unlike mechanisms uniformly WITHOUT pretending they
 * are alike, and that selection is deterministic and explainable.
 *
 * The load-bearing assertions are negative: an explicitly chosen source is
 * never substituted, `auto` never picks a source that cannot be charged, and no
 * source claims an attribute it has no observed contract for.
 */

import {
  ACQUISITION_SOURCES, SOURCE_TYPES, CONNECTION_STATES, USABLE_STATES,
  getSource, listSourceStatus, resolveConnectionState, supportsRequest,
  selectAcquisitionSource, evaluateSource, AUTO_SELECTION,
  type AcquisitionSourceDescriptor, type SelectionOutcome, type SourceStatus, type SelectionRequest,
} from '../../services/enrichment/providers';

const PERSON_REQUEST: SelectionRequest = {
  subject: 'person', attributes: ['job_title', 'department'], mode: AUTO_SELECTION,
};

/** No adapter registered for anything — the real state of the platform. */
const noAdapters = () => false;
const noCredentials = () => false;

const statuses = (over: Partial<Record<string, Partial<SourceStatus>>> = {}): readonly SourceStatus[] =>
  listSourceStatus(noAdapters, noCredentials).map((s) => ({ ...s, ...(over[s.id] ?? {}) }));

/**
 * The root tsconfig sets `strict: false`, so `if (!out.selected)` leaves the
 * union wide. The `in` operator narrows regardless.
 */
type Rejected = Extract<SelectionOutcome, { selected: false }>;
const rejected = (o: SelectionOutcome): Rejected => {
  if (!('ineligibility' in o)) throw new Error('expected no source to be selected, but one was');
  return o;
};

/** Promote one source to fully usable, for selection tests. */
const usable = (
  id: string, attributes: string[], creditAction: string | null = 'prospect_enrichment',
): Partial<SourceStatus> => ({
  connectionState: 'connected',
  usable: true,
  stateReason: 'test: connected',
  creditAction,
  capabilities: { entities: ['person'], attributes },
});

describe('A3C — the source model describes unlike mechanisms uniformly', () => {
  it('registers all four source types, with no provider at the centre', () => {
    const types = new Set(ACQUISITION_SOURCES.map((s) => s.sourceType));
    expect(types.has('external_api')).toBe(true);
    expect(types.has('gateway_api')).toBe(true);
    expect(types.has('browser_extension')).toBe(true);
    expect(types.has('manual')).toBe(true);
    for (const s of ACQUISITION_SOURCES) expect(SOURCE_TYPES).toContain(s.sourceType);
    // Apollo is one entry among several, not the model's shape.
    expect(ACQUISITION_SOURCES.filter((s) => s.id === 'apollo')).toHaveLength(1);
  });

  it('gives every source a distinct priority, so auto can never tie', () => {
    const priorities = ACQUISITION_SOURCES.map((s) => s.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('claims NO attribute for a source with no observed API contract', () => {
    for (const id of ['apollo', 'zoominfo', 'crunchbase', 'rapidapi']) {
      const s = getSource(id)!;
      expect(s.capabilities.attributes).toEqual([]);
      expect(s.capabilities.entities).toEqual([]);
    }
  });

  it('models RapidAPI as a GATEWAY with an unselected sub-provider, not one dataset', () => {
    const rapid = getSource('rapidapi')!;
    expect(rapid.sourceType).toBe('gateway_api');
    expect(rapid.gatewayProviders).toBeDefined();
    expect(rapid.gatewayProviders!.some((p) => p.selected)).toBe(false);
    expect(rapid.authorizationRequirements).toContain('sub_provider_selected');
  });

  it('gives each external source its OWN credential variable', () => {
    const external = ACQUISITION_SOURCES.filter((s) => s.sourceType === 'external_api' || s.sourceType === 'gateway_api');
    const vars = external.map((s) => s.credentialEnvVar);
    expect(new Set(vars).size).toBe(vars.length);      // never shared
    for (const v of vars) expect(v).toBeTruthy();
  });
});

describe('A3C — connection state distinguishes "not connected" from "no data"', () => {
  it('exposes all seven states', () => {
    expect(CONNECTION_STATES).toHaveLength(7);
    expect(USABLE_STATES).toEqual(['connected']);      // exactly one is usable
  });

  it('reports a declared external source as unsupported, not as an empty result', () => {
    const { state, reason } = resolveConnectionState(getSource('apollo')!, false, false);
    expect(state).toBe('unsupported');
    expect(reason).toContain('no adapter');
  });

  it('distinguishes credential_missing from unsupported once an adapter exists', () => {
    const apollo = getSource('apollo')!;
    expect(resolveConnectionState(apollo, true, false).state).toBe('credential_missing');
    expect(resolveConnectionState(apollo, true, true).state).toBe('connected');
  });

  it('reports the gateway as unsupported while no sub-provider is selected', () => {
    // Even with an adapter and a credential — the gateway is not a dataset.
    expect(resolveConnectionState(getSource('rapidapi')!, true, true).state).toBe('unsupported');
  });

  it('reports the extension as AVAILABLE, naming the wiring gap rather than a failure', () => {
    const { state, reason } = resolveConnectionState(getSource('omnivyra_extension')!, false, false);
    expect(state).toBe('available');
    expect(state).not.toBe('not_connected');
    expect(reason).toContain('engagement');
    expect(reason).toContain('source_records');
  });

  it('reports manual entry as connected — it contacts nobody', () => {
    expect(resolveConnectionState(getSource('manual')!, false, false).state).toBe('connected');
  });

  it('no source is usable in the current environment', () => {
    const live = listSourceStatus(noAdapters, noCredentials);
    // Manual is connected but supplies no PAID acquisition; everything external
    // is unsupported. Nothing external can be called.
    expect(live.filter((s) => s.usable && s.sourceType !== 'manual')).toHaveLength(0);
  });
});

describe('A3C — explicit selection is never substituted', () => {
  it('selects Apollo when Apollo is explicitly chosen and eligible', () => {
    const out = selectAcquisitionSource(
      { ...PERSON_REQUEST, mode: 'apollo' },
      statuses({ apollo: usable('apollo', ['job_title']) }));
    expect(out.selected).toBe(true);
    if (out.selected) expect(out.sourceId).toBe('apollo');
  });

  it('FAILS CLEARLY when the explicitly chosen source is not connected — and picks nothing else', () => {
    const out = selectAcquisitionSource(
      { ...PERSON_REQUEST, mode: 'apollo' },
      statuses({ zoominfo: usable('zoominfo', ['job_title']) }));   // another source IS eligible

    expect(out.selected).toBe(false);
    {
      const r = rejected(out);
      expect(r.ineligibility).toBe('not_connected');
      expect(r.reason).toContain('Apollo');
      // The decisive assertion: no substitution.
      expect(r.reason).not.toContain('ZoomInfo');
      expect(r.considered.map((c) => c.sourceId)).toEqual(['apollo']);
    }
  });

  it('reports an unknown source as unknown, not as unavailable', () => {
    const out = selectAcquisitionSource({ ...PERSON_REQUEST, mode: 'not_a_source' }, statuses());
    expect(out.selected).toBe(false);
    expect(rejected(out).ineligibility).toBe('unknown_source');
  });

  it('selects the extension when explicitly chosen and eligible', () => {
    const out = selectAcquisitionSource(
      { ...PERSON_REQUEST, mode: 'omnivyra_extension' },
      statuses({ omnivyra_extension: usable('omnivyra_extension', ['job_title']) }));
    expect(out.selected).toBe(true);
    if (out.selected) expect(out.sourceId).toBe('omnivyra_extension');
  });

  it('explains the extension wiring gap when it is chosen today', () => {
    const out = selectAcquisitionSource({ ...PERSON_REQUEST, mode: 'omnivyra_extension' }, statuses());
    expect(out.selected).toBe(false);
    {
      const r = rejected(out);
      expect(r.ineligibility).toBe('not_connected');
      expect(r.reason).toContain('source_records');
    }
  });

  it('selects a specific gateway sub-provider by its own id, not the gateway', () => {
    // The gateway itself is never selectable as a dataset.
    const out = selectAcquisitionSource({ ...PERSON_REQUEST, mode: 'rapidapi' }, statuses());
    expect(out.selected).toBe(false);
    expect(rejected(out).reason).toContain('sub-provider');
  });
});

describe('A3C — auto selection is deterministic and explainable', () => {
  it('picks the lowest-priority-number eligible source', () => {
    const out = selectAcquisitionSource(PERSON_REQUEST, statuses({
      apollo: usable('apollo', ['job_title']),            // priority 20
      zoominfo: usable('zoominfo', ['job_title']),        // priority 40
    }));
    expect(out.selected).toBe(true);
    if (out.selected) {
      expect(out.sourceId).toBe('apollo');
      expect(out.reason).toContain('auto:');
    }
  });

  it('is deterministic — the same inputs always give the same answer', () => {
    const s = statuses({ apollo: usable('apollo', ['job_title']), zoominfo: usable('zoominfo', ['job_title']) });
    const a = selectAcquisitionSource(PERSON_REQUEST, s);
    const b = selectAcquisitionSource(PERSON_REQUEST, s);
    expect(a).toEqual(b);
  });

  it('never selects a source that does not support the requested entity', () => {
    const out = selectAcquisitionSource(
      { subject: 'account', attributes: ['industry'], mode: AUTO_SELECTION },
      statuses({ apollo: { ...usable('apollo', ['industry']), capabilities: { entities: ['person'], attributes: ['industry'] } } }));
    expect(out.selected).toBe(false);
    expect(rejected(out).considered.find((c) => c.sourceId === 'apollo')?.ineligibility).toBe('entity_unsupported');
  });

  it('never selects a source that supplies none of the requested attributes', () => {
    const out = selectAcquisitionSource(PERSON_REQUEST, statuses({
      apollo: usable('apollo', ['annual_revenue']),
    }));
    expect(out.selected).toBe(false);
    expect(rejected(out).considered.find((c) => c.sourceId === 'apollo')?.ineligibility).toBe('attributes_unsupported');
  });

  it('never selects an UNPRICED source — auto cannot bypass the cost gate', () => {
    const out = selectAcquisitionSource(PERSON_REQUEST, statuses({
      apollo: usable('apollo', ['job_title'], null),
    }));
    expect(out.selected).toBe(false);
    expect(rejected(out).considered.find((c) => c.sourceId === 'apollo')?.ineligibility).toBe('unpriced');
  });

  it('reports no eligible source rather than inventing one', () => {
    const out = selectAcquisitionSource(PERSON_REQUEST, statuses());
    expect(out.selected).toBe(false);
    {
      const r = rejected(out);
      expect(r.ineligibility).toBe('no_eligible_source');
      expect(r.reason).toContain('job_title');
    }
  });

  it('explains every source it considered, so a user can see why', () => {
    const out = selectAcquisitionSource(PERSON_REQUEST, statuses());
    const r = rejected(out);
    expect(r.considered.length).toBe(ACQUISITION_SOURCES.length);
    for (const c of r.considered) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.ineligibility).toBeDefined();
    }
  });

  it('reports connection failure BEFORE capability — the more useful reason first', () => {
    // Apollo is disconnected AND claims no attributes. The user needs to hear
    // "not connected", not "does not support job_title".
    const candidate = evaluateSource(
      getSource('apollo') as AcquisitionSourceDescriptor, 'unsupported', 'declared only', PERSON_REQUEST);
    expect(candidate.ineligibility).toBe('not_connected');
  });
});

describe('A3C — capability predicate', () => {
  it('requires both the entity and at least one attribute', () => {
    const s = { capabilities: { entities: ['person'], attributes: ['job_title'] } } as unknown as AcquisitionSourceDescriptor;
    expect(supportsRequest(s, 'person', ['job_title', 'city'])).toBe(true);
    expect(supportsRequest(s, 'person', ['city'])).toBe(false);
    expect(supportsRequest(s, 'account', ['job_title'])).toBe(false);
  });
});

describe('A3C — GAP-3 stays closed to every source', () => {
  it.each(['seniority', 'authority', 'influence', 'buying_role'])(
    'no source claims %s', (attribute) => {
      for (const s of ACQUISITION_SOURCES) {
        expect(s.capabilities.attributes).not.toContain(attribute);
      }
      const out = selectAcquisitionSource(
        { subject: 'person', attributes: [attribute], mode: AUTO_SELECTION },
        statuses());
      expect(out.selected).toBe(false);
    });
});
