/**
 * PI-LDB — the client-side mapping applier.
 *
 * The load-bearing assertions are the ones a careless applier would fail:
 *   - re-applying a CHANGED mapping to the SAME retained parse produces a
 *     different result with no re-parse — the mechanism behind "correct an
 *     ambiguous field without re-uploading";
 *   - a destination outside the submittable set is REFUSED and reported, never
 *     passed through hoping the server copes;
 *   - a row that fails one column still imports its other columns;
 *   - no record ever carries a tenant key, because the route refuses one.
 */

import { parseDelimitedText } from '../../../lib/leadIngestion/csvParser';
import {
  applyMapping,
  type ResolvedColumn,
} from '../../../lib/prospects/import/applyMapping';

const FILE = [
  'Email,Full Name,Work Phone,Company,Website,Headcount,Tech,Notes',
  'ADA@Example.COM ,Ada Lovelace,+44 (20) 7946 0958,Analytical Ltd,https://www.analytical.co.uk/about,250,"Rust, Haskell",VIP',
  'grace@navy.mil,Grace Hopper,(555) 123-4567,US Navy,navy.mil,5000,COBOL,',
  'not-an-email,Alan Turing,123,Bletchley,http://bletchley.org,abc,,',
].join('\n');

const parsed = parseDelimitedText(FILE);

const column = (over: Partial<ResolvedColumn> & { sourceField: string }): ResolvedColumn => ({
  target: null,
  transformation: 'trim',
  dataType: null,
  ...over,
});

/** The mapping a tenant would end up with for this file. */
const baseColumns: ResolvedColumn[] = [
  column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
  column({ sourceField: 'Full Name', target: 'fullName', transformation: 'trim', dataType: 'text' }),
  column({ sourceField: 'Work Phone', target: 'phone', transformation: 'digits_only_phone', dataType: 'phone' }),
  column({ sourceField: 'Company', target: 'companyName', transformation: 'trim', dataType: 'text' }),
  column({ sourceField: 'Website', target: 'companyDomain', transformation: 'url_to_domain', dataType: 'domain' }),
  column({ sourceField: 'Headcount', target: 'employeeCount', transformation: 'parse_integer', dataType: 'integer' }),
  column({ sourceField: 'Tech', target: 'technologies', transformation: 'split_delimited_list', dataType: 'text[]' }),
  column({ sourceField: 'Notes', target: null, transformation: 'none', dataType: null }),
];

describe('the file parses as expected before anything is applied', () => {
  it('reads three records and eight headings', () => {
    expect(parsed.headers).toHaveLength(8);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.importable).toBe(true);
  });
});

describe('transformations', () => {
  const result = applyMapping(parsed, { columns: baseColumns });

  it('lower-cases and trims an email', () => {
    expect(result.records[0].email).toBe('ada@example.com');
  });

  it('reduces a phone number to digits, keeping a leading plus', () => {
    expect(result.records[0].phone).toBe('+442079460958');
    expect(result.records[1].phone).toBe('5551234567');
  });

  it('extracts a domain from a URL and strips www', () => {
    expect(result.records[0].companyDomain).toBe('analytical.co.uk');
  });

  it('accepts a bare domain that is not a URL', () => {
    expect(result.records[1].companyDomain).toBe('navy.mil');
  });

  it('parses an integer', () => {
    expect(result.records[0].employeeCount).toBe(250);
  });

  it('splits a delimited list', () => {
    expect(result.records[0].technologies).toEqual(['Rust', 'Haskell']);
  });

  it('never assigns a tenant key — the route refuses one in the body', () => {
    for (const record of result.records) {
      expect(record).not.toHaveProperty('organizationId');
      expect(record).not.toHaveProperty('organization_id');
      expect(record).not.toHaveProperty('companyId');
      expect(record).not.toHaveProperty('company_id');
    }
  });

  it('omits an ignored column entirely rather than storing a blank', () => {
    for (const record of result.records) {
      expect(record).not.toHaveProperty('Notes');
    }
  });
});

describe('a bad value fails its own column and nothing else', () => {
  const result = applyMapping(parsed, { columns: baseColumns });

  it('reports the unusable email without discarding the row', () => {
    const emailColumn = result.columns.find((c) => c.sourceField === 'Email')!;
    expect(emailColumn.populated).toBe(3);
    expect(emailColumn.failed).toBe(1);
    expect(emailColumn.failureKind).toBe('email_shape');

    // Turing's row still imported its other fields.
    const turing = result.records[2];
    expect(turing.email).toBeUndefined();
    expect(turing.fullName).toBe('Alan Turing');
    expect(turing.companyName).toBe('Bletchley');
  });

  it('reports a too-short phone number by rule name, never by value', () => {
    const phoneColumn = result.columns.find((c) => c.sourceField === 'Work Phone')!;
    expect(phoneColumn.failed).toBe(1);
    expect(phoneColumn.failureKind).toBe('phone_digits');
    // The failing value must not travel with the diagnosis.
    expect(JSON.stringify(result.columns)).not.toContain('123');
  });

  it('reports a non-numeric headcount', () => {
    const headcount = result.columns.find((c) => c.sourceField === 'Headcount')!;
    expect(headcount.failed).toBe(1);
    expect(headcount.failureKind).toBe('not_transformable');
  });

  it('still produces a record for every row', () => {
    expect(result.records).toHaveLength(3);
    expect(result.emptyRows).toBe(0);
  });
});

describe('a destination the ingestion contract cannot carry is refused', () => {
  // Re-pointed off `description`, which the sprint made submittable end to end
  // (field on `ManualLeadInput`, read by the adapter, persisted to
  // `prospect_accounts.description`). Every registry key is carryable now, so
  // the only way left to exercise the refusal is a target that is not a
  // registry key at all — which takes the GENERIC fallback message in
  // `applyMapping`, not a `NON_SUBMITTABLE_TARGETS` reason. The assertion
  // follows the code rather than keeping the old string alive.
  const result = applyMapping(parsed, {
    columns: [
      column({ sourceField: 'Notes', target: 'notADestination', transformation: 'trim', dataType: 'text' }),
      column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
    ],
  });

  it('reports it rather than silently dropping the column', () => {
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ sourceField: 'Notes', target: 'notADestination' });
    expect(result.blocked[0].reason).toContain('not a destination this import can write to');
  });

  it('writes nothing for it', () => {
    for (const record of result.records) {
      expect(record).not.toHaveProperty('notADestination');
    }
  });

  it('leaves the other columns working', () => {
    expect(result.records[0].email).toBe('ada@example.com');
  });
});

describe('description now flows through instead of being blocked', () => {
  // The positive half of the same change. Without this the suite would only
  // say what no longer happens, and a regression that re-blocked the column
  // would pass everything above.
  const result = applyMapping(parsed, {
    columns: [
      column({ sourceField: 'Notes', target: 'description', transformation: 'trim', dataType: 'text' }),
      column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
    ],
  });

  it('is not blocked', () => {
    expect(result.blocked).toEqual([]);
  });

  it('is written where the source cell has a value', () => {
    // Only row 1 has a `Notes` value; rows 2 and 3 are blank there, and row 3's
    // email is unusable, so two records survive. Asserted against the fixture
    // rather than a round number — the first draft of this test said three and
    // failed, which is the fixture telling the truth about blank cells.
    expect(result.records).toHaveLength(2);
    expect(result.records[0].description).toBe('VIP');
  });

  it('writes no description for a blank cell, rather than an empty string', () => {
    expect(result.records[1]).not.toHaveProperty('description');
    expect(result.records[1].email).toBe('grace@navy.mil');
  });
});

describe('a heading the mapping names but the file lacks', () => {
  const result = applyMapping(parsed, {
    columns: [
      column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
      column({ sourceField: 'LinkedIn URL', target: 'companyDomain', transformation: 'url_to_domain', dataType: 'domain' }),
    ],
  });

  it('is reported, not thrown', () => {
    const missing = result.columns.find((c) => c.sourceField === 'LinkedIn URL')!;
    expect(missing.blockedReason).toContain('not in the uploaded file');
  });

  it('does not stop the other columns importing', () => {
    // Two, not three: `Email` is the only usable destination in this mapping,
    // and the third row's email is invalid, so that row yields no field at all
    // and is skipped rather than submitted empty. The missing heading did not
    // cause that — it cost nothing.
    expect(result.records).toHaveLength(2);
    expect(result.records.map((r) => r.email)).toEqual(['ada@example.com', 'grace@navy.mil']);
    expect(result.emptyRows).toBe(1);
  });
});

describe('split_full_name', () => {
  const single = parseDelimitedText('Name\nAda Lovelace\nGrace Brewster Murray Hopper\nPlato\n');

  it('takes the first token as the given name', () => {
    const result = applyMapping(single, {
      columns: [column({ sourceField: 'Name', target: 'firstName', transformation: 'split_full_name', dataType: 'text' })],
    });
    expect(result.records.map((r) => r.firstName)).toEqual(['Ada', 'Grace', 'Plato']);
  });

  it('takes the remainder as the family name, and omits it when there is none', () => {
    const result = applyMapping(single, {
      columns: [column({ sourceField: 'Name', target: 'lastName', transformation: 'split_full_name', dataType: 'text' })],
    });
    // Plato has no remainder, so the row yields nothing and is skipped rather
    // than storing an empty family name.
    expect(result.records.map((r) => r.lastName)).toEqual(['Lovelace', 'Brewster Murray Hopper']);
    expect(result.emptyRows).toBe(1);
  });
});

describe('keeping an ignored column as a note', () => {
  const result = applyMapping(parsed, {
    columns: [
      column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
      column({ sourceField: 'Notes', target: null, keepAsNote: true }),
    ],
  });

  it('packs the value into metadata, not into a canonical field', () => {
    expect(result.records[0].metadata).toEqual({ Notes: 'VIP' });
    expect(result.notedFields).toEqual(['Notes']);
  });

  it('omits metadata entirely when the row has no note', () => {
    expect(result.records[1].metadata).toBeUndefined();
  });
});

describe('metadata respects the ingestion contract ceiling', () => {
  it('trims to fit rather than letting every record fail validation', () => {
    const long = 'x'.repeat(3_000);
    const file = parseDelimitedText(`Email,Blob\na@b.co,${long}\n`);
    const result = applyMapping(file, {
      columns: [
        column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
        column({ sourceField: 'Blob', target: null, keepAsNote: true }),
      ],
    });

    expect(result.metadataTruncated).toBe(true);
    // The record survives, which is the point: a 2 048-byte cap must not cost
    // the prospect.
    expect(result.records).toHaveLength(1);
    expect(result.records[0].email).toBe('a@b.co');
    const metadata = result.records[0].metadata;
    if (metadata) {
      expect(new TextEncoder().encode(JSON.stringify(metadata)).length).toBeLessThanOrEqual(2_048);
    }
  });
});

describe('a row with nothing usable is skipped, not sent', () => {
  it('counts it instead of submitting an empty record', () => {
    const file = parseDelimitedText('Email,Name\n,\na@b.co,Ada\n');
    const result = applyMapping(file, {
      columns: [
        column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' }),
        column({ sourceField: 'Name', target: 'fullName', transformation: 'trim', dataType: 'text' }),
      ],
    });
    expect(result.records).toHaveLength(1);
    expect(result.emptyRows).toBe(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * THE ACCEPTANCE PROPERTY
 * ────────────────────────────────────────────────────────────────────────*/

describe('ACCEPTANCE — a mapping is corrected without re-reading the file', () => {
  // Parse ONCE. Everything below reuses this exact object, which is what the
  // wizard holds in a ref for the whole session.
  const retained = parseDelimitedText(FILE);
  const parseCountBefore = retained.rows.length;

  it('an ambiguous column can be re-pointed and the output changes', () => {
    // First answer: the tenant reads "Company" as the employer's name.
    const first = applyMapping(retained, {
      columns: [column({ sourceField: 'Company', target: 'companyName', transformation: 'trim', dataType: 'text' })],
    });
    expect(first.records[0]).toEqual({ companyName: 'Analytical Ltd' });

    // Correction: actually it is the employer's external id in their CRM.
    // Same retained parse — no new parse call, no file, no upload.
    const corrected = applyMapping(retained, {
      columns: [column({ sourceField: 'Company', target: 'companyExternalId', transformation: 'trim', dataType: 'text' })],
    });
    expect(corrected.records[0]).toEqual({ companyExternalId: 'Analytical Ltd' });

    // And again, to "ignore" — still no re-read.
    const ignored = applyMapping(retained, {
      columns: [column({ sourceField: 'Company', target: null, transformation: 'none' })],
    });
    expect(ignored.records).toHaveLength(0);
    expect(ignored.emptyRows).toBe(3);
  });

  it('the retained parse is never mutated by applying a mapping', () => {
    // If the applier mutated its input, the second correction above would have
    // operated on degraded data and this is where it would show.
    expect(retained.rows).toHaveLength(parseCountBefore);
    expect(retained.headers).toEqual([
      'Email',
      'Full Name',
      'Work Phone',
      'Company',
      'Website',
      'Headcount',
      'Tech',
      'Notes',
    ]);
    expect(retained.rows[0][0]).toBe('ADA@Example.COM ');
  });

  it('applying the same mapping twice is deterministic', () => {
    const a = applyMapping(retained, { columns: baseColumns });
    const b = applyMapping(retained, { columns: baseColumns });
    expect(b.records).toEqual(a.records);
    expect(b.columns).toEqual(a.columns);
  });

  it('a correction changes the validation forecast too, not just the records', () => {
    // Pointing a bad-email column at a free-text destination removes the
    // failures — the forecast must follow the mapping, or a tenant correcting
    // a column would see a stale warning.
    const asEmail = applyMapping(retained, {
      columns: [column({ sourceField: 'Email', target: 'email', transformation: 'lowercase_email', dataType: 'email' })],
    });
    expect(asEmail.columns[0].failed).toBe(1);

    const asText = applyMapping(retained, {
      columns: [column({ sourceField: 'Email', target: 'referenceId', transformation: 'trim', dataType: 'text' })],
    });
    expect(asText.columns[0].failed).toBe(0);
  });
});
