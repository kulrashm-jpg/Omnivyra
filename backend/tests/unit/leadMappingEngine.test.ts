/**
 * PI-LDB-01 — mapping engine tests.
 *
 * The brief's §C.11 is explicit that a suite which only checks successful
 * mappings is insufficient, so most of what follows asserts REFUSAL: that an
 * ambiguous header produces a question, that a confident-sounding model
 * cannot move a score, that a mislabelled column is reported as mislabelled
 * rather than silently dropped, and that a real email address can never
 * reach a model provider.
 *
 * No network, no database, no API key, no spend: the proposer is injected.
 */

import {
  proposeFieldMappings,
  fingerprintSchema,
} from '../../services/leadMapping/mappingEngine';
import { AUTO_APPLY_FLOOR, scoreCandidate, compatibility, fold } from '../../services/leadMapping/mappingScorer';
import { canonicalField, CANONICAL_FIELDS } from '../../services/leadMapping/canonicalFieldRegistry';
import { detectShape, redactSample, redactSamples, assertRedacted } from '../../services/leadMapping/sampleRedaction';
import type {
  MappingEngineInput,
  MappingProposer,
  FieldMappingProposal,
  StoredMappingProfile,
} from '../../services/leadMapping/mappingTypes';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function input(
  samples: Record<string, string[]>,
  extra: Partial<MappingEngineInput> = {},
): MappingEngineInput {
  return {
    sourceType: 'csv',
    tenantId: TENANT,
    headers: Object.keys(samples),
    samples,
    ...extra,
  };
}

function byField(result: { proposals: readonly FieldMappingProposal[] }, header: string): FieldMappingProposal {
  const found = result.proposals.find((p) => p.sourceField === header);
  if (!found) throw new Error(`no proposal for "${header}"`);
  return found;
}

/** A proposer that votes for whatever it is told to. */
function fakeProposer(votes: Record<string, string>, opts: { confidence?: number } = {}): MappingProposer {
  return async () =>
    Object.entries(votes).map(([sourceField, target]) => ({
      sourceField,
      target,
      selfReportedConfidence: opts.confidence,
      reasoning: 'because it looks like that',
    }));
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The mandated synonym cases
// ───────────────────────────────────────────────────────────────────────────
describe('synonym interpretation', () => {
  const titleSamples = ['VP of Sales', 'Head of Marketing', 'Regional Director'];

  it.each([
    ['Designation', 'jobTitle'],
    ['Job Title', 'jobTitle'],
    ['Position', 'jobTitle'],
    ['Job Function', 'jobTitle'],
    ['designation', 'jobTitle'],
    ['  JOB   TITLE  ', 'jobTitle'],
    ['job_title', 'jobTitle'],
  ])('maps %j to %s without asking', async (header, target) => {
    const result = await proposeFieldMappings(input({ [header]: titleSamples }));
    const proposal = byField(result, header);
    expect(proposal.candidate?.target).toBe(target);
    expect(proposal.status).toBe('high_confidence_suggestion');
    expect(proposal.requiresTenantApproval).toBe(false);
  });

  it('maps Organization to the EMPLOYER name, never to a tenant column', async () => {
    const result = await proposeFieldMappings(input({ Organization: ['Acme Corp', 'Globex SA'] }));
    const proposal = byField(result, 'Organization');
    expect(proposal.candidate?.target).toBe('companyName');
    expect(canonicalField('companyName')!.column).toBe('name');
    // No registry entry may point at the tenant columns.
    for (const field of CANONICAL_FIELDS) {
      expect(['organization_id', 'company_id']).not.toContain(field.column);
    }
  });

  it('maps Annual Turnover to annual revenue', async () => {
    const result = await proposeFieldMappings(input({ 'Annual Turnover': ['5000000', '750000'] }));
    expect(byField(result, 'Annual Turnover').candidate?.target).toBe('annualRevenue');
  });

  it('folds plural and spelling variants: Descriptions matches description', () => {
    expect(fold('descriptions')).toBe(fold('description'));
    expect(fold('organisation')).toBe(fold('organization'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Ambiguity MUST escalate — the heart of the brief
// ───────────────────────────────────────────────────────────────────────────
describe('ambiguity escalation', () => {
  it.each([
    ['Title', ['VP of Sales', 'Head of Ops']],
    ['Role', ['Decision Maker', 'Influencer']],
    ['Description', ['A fintech lender', 'A logistics platform']],
    ['Descriptions', ['A fintech lender', 'A logistics platform']],
    ['Value', ['120000', '95000']],
    ['Location', ['Berlin', 'Lisbon']],
  ])('refuses to guess %j and asks a real question', async (header, samples) => {
    const result = await proposeFieldMappings(input({ [header]: samples }));
    const proposal = byField(result, header);
    expect(proposal.status).toBe('review_required');
    expect(proposal.requiresTenantApproval).toBe(true);
    expect(proposal.ambiguity).not.toBeNull();
    expect(proposal.ambiguity!.question).toContain(header);
    // A question with one option is not a question.
    expect(proposal.ambiguity!.options.length).toBeGreaterThanOrEqual(2);
    // Every question offers a way out.
    expect(proposal.ambiguity!.options.some((o) => o.target === null)).toBe(true);
    expect(result.requiresReview).toBe(true);
  });

  it('asks whether a bare Country is the person or the company', async () => {
    const result = await proposeFieldMappings(input({ Country: ['DE', 'PT'] }));
    const proposal = byField(result, 'Country');
    expect(proposal.status).toBe('review_required');
    const targets = proposal.ambiguity!.options.map((o) => o.target);
    expect(targets).toContain('countryCode');
    expect(targets).toContain('companyCountryCode');
  });

  it('does NOT ask when the header disambiguates the entity itself', async () => {
    const result = await proposeFieldMappings(input({ 'Company Country': ['DE', 'PT'] }));
    const proposal = byField(result, 'Company Country');
    expect(proposal.candidate?.target).toBe('companyCountryCode');
    expect(proposal.ambiguity?.reason).not.toBe('entity_ambiguous');
  });

  it('escalates when two columns claim the same canonical field', async () => {
    const result = await proposeFieldMappings(
      input({
        Organization: ['Acme Corp', 'Globex SA'],
        'Company Name': ['Acme Corporation', 'Globex'],
      }),
    );
    for (const header of ['Organization', 'Company Name']) {
      const proposal = byField(result, header);
      expect(proposal.status).toBe('review_required');
      expect(['competing_source_fields', 'identity_critical']).toContain(proposal.ambiguity!.reason);
    }
  });

  it('escalates every identity-critical field even on a perfect name match', async () => {
    const result = await proposeFieldMappings(
      input({
        'E-mail': ['jane@acme.com', 'bob@globex.com'],
        'Phone Number': ['+49 30 1234567', '+351 21 7654321'],
        'Company Name': ['Acme Corp', 'Globex SA'],
      }),
    );
    for (const header of ['E-mail', 'Phone Number', 'Company Name']) {
      const proposal = byField(result, header);
      expect(proposal.requiresTenantApproval).toBe(true);
      expect(proposal.status).toBe('review_required');
    }
  });

  it('flags a column that carries two facts per row', async () => {
    const result = await proposeFieldMappings(
      input({ 'City, Country': ['Berlin, Germany', 'Lisbon, Portugal'] }),
    );
    const proposal = byField(result, 'City, Country');
    expect(proposal.status).toBe('review_required');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Unknown columns are preserved, never discarded, never invented
// ───────────────────────────────────────────────────────────────────────────
describe('unknown and unmappable columns', () => {
  it.each([
    ['LinkedIn', ['https://linkedin.com/in/jane']],
    ['Professional Profile', ['https://linkedin.com/in/bob']],
    ['Favourite Colour', ['blue', 'green']],
    ['Internal Scoring Bucket', ['A2', 'B1']],
  ])('reports %j as unmapped rather than forcing a destination', async (header, samples) => {
    const result = await proposeFieldMappings(input({ [header]: samples }));
    const proposal = byField(result, header);
    expect(proposal.status).toBe('unmapped');
    expect(proposal.candidate).toBeNull();
    expect(proposal.reasoning).toMatch(/kept with the original record/i);
  });

  it('never auto-applies a column it only partly recognises', async () => {
    // `Widget Count` shares the token "count" with `employeeCount`, so the
    // engine does propose it — but the invariant that matters is that a
    // partial name match can never be written without a human, and that
    // "ignore this column" is always on offer.
    const result = await proposeFieldMappings(input({ 'Widget Count': ['3', '7'] }));
    const proposal = byField(result, 'Widget Count');
    expect(proposal.status).not.toBe('high_confidence_suggestion');
    expect(proposal.status).not.toBe('approved_profile_match');
    if (proposal.status === 'review_required') {
      expect(proposal.requiresTenantApproval).toBe(true);
      expect(proposal.ambiguity!.options.some((o) => o.target === null)).toBe(true);
    }
  });

  it('a text column is never claimed on type evidence alone', async () => {
    // `description` accepts any text. If conformance could nominate, every
    // free-text column in every file would be proposed as a company
    // description. Name evidence is required.
    const result = await proposeFieldMappings(input({ 'Favourite Colour': ['blue', 'green'] }));
    expect(byField(result, 'Favourite Colour').status).toBe('unmapped');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Type mismatch is reported as mismatch, not as "nothing found"
// ───────────────────────────────────────────────────────────────────────────
describe('deterministic validation', () => {
  it('reports a mislabelled Email column as validation_failed', async () => {
    const result = await proposeFieldMappings(input({ Email: ['Acme Corp', 'Globex SA'] }));
    const proposal = byField(result, 'Email');
    expect(proposal.status).toBe('validation_failed');
    expect(proposal.candidate).toBeNull();
    expect(proposal.validation!.failureKind).toBe('expected_email');
    expect(proposal.validation!.samplesFailed).toBe(2);
  });

  it('never puts a failing VALUE in the validation summary', async () => {
    const result = await proposeFieldMappings(input({ Email: ['definitely-not-an-email'] }));
    const serialised = JSON.stringify(byField(result, 'Email'));
    expect(serialised).not.toContain('definitely-not-an-email');
  });

  it('treats an all-empty column as unknown, not incompatible', () => {
    expect(compatibility('integer', [])).toBe('unknown');
    expect(compatibility('email', [{ value: '', shape: 'empty', redacted: false }])).toBe('unknown');
  });

  it('refuses to let a text field claim a column of emails', () => {
    const emails = [{ value: '•••@•••.com', shape: 'email' as const, redacted: true }];
    expect(compatibility('text', emails)).toBe('incompatible');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. The model is an untrusted input
// ───────────────────────────────────────────────────────────────────────────
describe('model containment', () => {
  it('discards a target that is not in the registry', async () => {
    const hostile = fakeProposer({ Designation: 'DROP TABLE unified_persons' });
    const result = await proposeFieldMappings(input({ Designation: ['VP of Sales'] }), hostile);
    const proposal = byField(result, 'Designation');
    // Falls back to the deterministic answer, unaffected.
    expect(proposal.candidate?.target).toBe('jobTitle');
    expect(proposal.provenance).toBe('deterministic');
    expect(JSON.stringify(result)).not.toContain('DROP TABLE');
  });

  it('a maximally confident model cannot raise a score', async () => {
    const samples = { 'Mystery Column': ['alpha', 'beta'] };
    const certain = fakeProposer({ 'Mystery Column': 'jobTitle' }, { confidence: 1 });
    const unsure = fakeProposer({ 'Mystery Column': 'jobTitle' }, { confidence: 0.01 });

    const a = await proposeFieldMappings(input(samples), certain);
    const b = await proposeFieldMappings(input(samples), unsure);

    const sa = byField(a, 'Mystery Column').candidate?.score;
    const sb = byField(b, 'Mystery Column').candidate?.score;
    expect(sa).toBe(sb);
  });

  it('records the model self-report without acting on it', async () => {
    const result = await proposeFieldMappings(
      input({ Designation: ['VP of Sales'] }),
      fakeProposer({ Designation: 'jobTitle' }, { confidence: 0.99 }),
    );
    expect(byField(result, 'Designation').model!.selfReportedConfidence).toBe(0.99);
  });

  it('a model vote alone cannot clear the auto-apply floor', async () => {
    const result = await proposeFieldMappings(
      input({ Zzzz: ['alpha', 'beta'] }),
      fakeProposer({ Zzzz: 'department' }, { confidence: 1 }),
    );
    const proposal = byField(result, 'Zzzz');
    expect(proposal.status).not.toBe('high_confidence_suggestion');
  });

  it('degrades to deterministic mapping when the proposer throws', async () => {
    const broken: MappingProposer = async () => {
      throw new Error('gateway down');
    };
    const result = await proposeFieldMappings(input({ Designation: ['VP of Sales'] }), broken);
    expect(byField(result, 'Designation').candidate?.target).toBe('jobTitle');
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0].cause).toMatch(/proposer_unavailable/);
  });

  it('one bad field does not void the others', async () => {
    const partial: MappingProposer = async () => [
      { sourceField: 'Designation', target: 'jobTitle' },
      // Malformed entries that must be skipped silently.
      { sourceField: '', target: 'email' },
      null as never,
    ];
    const result = await proposeFieldMappings(
      input({ Designation: ['VP of Sales'], Industry: ['Fintech'] }),
      partial,
    );
    expect(result.proposals).toHaveLength(2);
    expect(byField(result, 'Industry').candidate?.target).toBe('industry');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Redaction — no real personal data may reach a provider
// ───────────────────────────────────────────────────────────────────────────
describe('sample redaction', () => {
  it('destroys an email address but keeps its shape', () => {
    const out = redactSample('jane.doe@acme.com');
    expect(out.redacted).toBe(true);
    expect(out.shape).toBe('email');
    expect(out.value).not.toContain('jane');
    expect(out.value).not.toContain('acme');
    expect(out.value).toContain('@');
  });

  it('destroys a phone number but keeps its digit count', () => {
    const out = redactSample('+49 30 1234567');
    expect(out.redacted).toBe(true);
    expect(out.value).not.toMatch(/\d/);
    expect(out.value.startsWith('+')).toBe(true);
  });

  it('reduces a person name to initials', () => {
    const out = redactSample('Jane Doe');
    expect(out.value).not.toContain('ane');
    expect(out.value.startsWith('J')).toBe(true);
  });

  it('passes business facts through, because the value IS the type evidence', () => {
    for (const value of ['acme.com', '5000', '2014-03-01', 'Series B', 'Fintech']) {
      expect(redactSample(value).redacted).toBe(false);
    }
  });

  it('distinguishes a founding year from a phone number', () => {
    expect(detectShape('2014')).toBe('integer');
    expect(detectShape('+49 30 1234567')).toBe('phone');
  });

  it('truncates long free text', () => {
    const long = 'x'.repeat(200);
    const out = redactSample(long);
    expect(out.redacted).toBe(true);
    expect(out.value.length).toBeLessThan(60);
  });

  it('assertRedacted refuses an unredacted email or phone', () => {
    expect(() => assertRedacted(['jane@acme.com'])).toThrow(/unredacted email/i);
    expect(() => assertRedacted(['+49 30 1234567'])).toThrow(/unredacted phone/i);
    expect(() => assertRedacted(['acme.com', '5000'])).not.toThrow();
  });

  it('no raw sample value survives into the engine result', async () => {
    const result = await proposeFieldMappings(
      input({
        'E-mail': ['jane.doe@acme.com'],
        'Phone Number': ['+49 30 1234567'],
        'Full Name': ['Jane Doe'],
      }),
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('jane.doe@acme.com');
    expect(serialised).not.toContain('1234567');
    expect(serialised).not.toContain('Jane Doe');
  });

  it('caps how many values per column are ever taken', () => {
    const many = Array.from({ length: 50 }, (_, i) => `value-${i}`);
    expect(redactSamples({ Col: many }).Col).toHaveLength(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Tenant mapping profiles, drift, and isolation
// ───────────────────────────────────────────────────────────────────────────
describe('mapping profiles', () => {
  const headers = ['Designation', 'Organization', 'Mystery Column'];
  const samples = {
    Designation: ['VP of Sales'],
    Organization: ['Acme Corp'],
    'Mystery Column': ['alpha'],
  };

  function profileFor(hdrs: readonly string[]): StoredMappingProfile {
    return {
      profileId: 'prof-1',
      scope: 'tenant',
      version: 3,
      sourceSchemaFingerprint: fingerprintSchema(hdrs),
      headers: hdrs,
      entries: [
        { sourceField: 'Mystery Column', target: 'department', transformation: 'trim', approvedBy: 'user-1', approvedAt: '2026-10-01T00:00:00.000Z' },
        { sourceField: 'Organization', target: 'companyName', transformation: 'trim', approvedBy: 'user-1', approvedAt: '2026-10-01T00:00:00.000Z' },
      ],
    };
  }

  it('replays an approved mapping without asking again', async () => {
    const result = await proposeFieldMappings(
      input(samples, { storedProfile: profileFor(headers) }),
    );
    const mystery = byField(result, 'Mystery Column');
    expect(mystery.status).toBe('approved_profile_match');
    expect(mystery.candidate?.target).toBe('department');
    expect(mystery.requiresTenantApproval).toBe(false);
    expect(mystery.provenance).toBe('approved_profile');
    expect(result.profile!.state).toBe('applied');
  });

  it('an approved decision to IGNORE a column is honoured and recorded', async () => {
    const profile = profileFor(headers);
    const result = await proposeFieldMappings(
      input(samples, {
        storedProfile: {
          ...profile,
          entries: [{ sourceField: 'Mystery Column', target: null, transformation: 'none', approvedBy: 'u', approvedAt: '2026-10-01T00:00:00.000Z' }],
        },
      }),
    );
    const mystery = byField(result, 'Mystery Column');
    expect(mystery.status).toBe('unmapped');
    expect(mystery.requiresTenantApproval).toBe(false);
    expect(mystery.provenance).toBe('approved_profile');
  });

  it('refuses to reuse a profile when the source schema has drifted', async () => {
    // The stored profile was approved for a DIFFERENT header set.
    const stale = profileFor(['Designation', 'Organization']);
    const result = await proposeFieldMappings(input(samples, { storedProfile: stale }));
    expect(result.profile!.state).toBe('drifted');
    expect(result.profile!.addedHeaders).toContain('mystery column');
    // The previously-approved mapping is NOT silently applied.
    const org = byField(result, 'Organization');
    expect(org.status).not.toBe('approved_profile_match');
    expect(org.requiresTenantApproval).toBe(true);
  });

  it('a reordered file is the same schema and does not force a re-review', () => {
    expect(fingerprintSchema(['A', 'B', 'C'])).toBe(fingerprintSchema(['C', 'A', 'B']));
  });

  it('an added column is a different schema', () => {
    expect(fingerprintSchema(['A', 'B'])).not.toBe(fingerprintSchema(['A', 'B', 'C']));
  });

  it('the fingerprint ignores case and punctuation noise', () => {
    expect(fingerprintSchema(['Job Title'])).toBe(fingerprintSchema(['job_title']));
  });

  it('never re-proposes a destination the tenant refused', async () => {
    const result = await proposeFieldMappings(
      input({ Designation: ['VP of Sales'] }, { rejectedTargets: { Designation: ['jobTitle'] } }),
    );
    const proposal = byField(result, 'Designation');
    expect(proposal.status).toBe('rejected_by_tenant');
    expect(proposal.candidate).toBeNull();
  });

  it('a profile is scoped to its own fingerprint, so another tenant cannot reuse it', async () => {
    // Cross-tenant reuse is prevented by STORAGE (tenant-scoped rows), but the
    // engine must also refuse a profile that does not match this file — which
    // is what stops a profile handed in by mistake from being applied.
    const foreign: StoredMappingProfile = {
      profileId: 'other-tenant-profile',
      scope: 'tenant',
      version: 1,
      sourceSchemaFingerprint: 'deadbeef',
      headers: ['Totally Different'],
      entries: [{ sourceField: 'Designation', target: 'email', transformation: 'trim', approvedBy: 'x', approvedAt: '2026-01-01T00:00:00.000Z' }],
    };
    const result = await proposeFieldMappings(
      { ...input({ Designation: ['VP of Sales'] }), tenantId: OTHER_TENANT, storedProfile: foreign },
    );
    expect(result.profile!.state).toBe('drifted');
    expect(byField(result, 'Designation').candidate?.target).not.toBe('email');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. The engine writes nothing and leaks nothing
// ───────────────────────────────────────────────────────────────────────────
describe('boundary', () => {
  it('emits no SQL, table name or raw column name a model chose', async () => {
    const result = await proposeFieldMappings(
      input({ Designation: ['VP of Sales'], Organization: ['Acme Corp'] }),
    );
    const serialised = JSON.stringify(result);
    for (const forbidden of ['SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ', 'unified_persons', 'prospect_accounts', 'canonical_leads']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('returns one proposal per source column, in file order', async () => {
    const headers = ['Organization', 'Full Name', 'Designation', 'E-mail'];
    const samples = Object.fromEntries(headers.map((h) => [h, ['x']]));
    const result = await proposeFieldMappings({ ...input(samples), headers });
    expect(result.proposals.map((p) => p.sourceField)).toEqual(headers);
  });

  it('every registry target resolves to a real allowlisted column', () => {
    for (const field of CANONICAL_FIELDS) {
      expect(field.column).toMatch(/^[a-z_]+$/);
      expect(canonicalField(field.key)).toBe(field);
    }
  });

  it('the auto-apply floor cannot be reached on header evidence alone', () => {
    const field = canonicalField('jobTitle')!;
    const headerOnly = scoreCandidate({
      header: 'Designation',
      field,
      samples: [],
      approvedInProfile: false,
      modelVoted: true,
    });
    expect(headerOnly.score).toBeLessThan(AUTO_APPLY_FLOOR);
  });
});
