/**
 * @jest-environment jsdom
 *
 * PI-LDB — `/prospects/import` wizard DOM tests.
 *
 * Follows the repository's `.dom.test.tsx` convention (see
 * `prospectListPage.dom.test.tsx`): RTL scoped to one surface, jsdom via the
 * pragma, collaborators mocked at the module boundary.
 *
 * THE LOAD-BEARING TEST is "a mapping is corrected without re-uploading": it
 * changes a destination and asserts the preview changes while the file is
 * never read again and the drop step is never re-mounted. Everything else here
 * is secondary to that property.
 *
 * The other assertions are the ones a careless implementation would fail:
 *   - claiming AI-assisted mapping when the gateway was dark;
 *   - presenting a closed feature gate as an error;
 *   - reporting an import as fully successful when the lead projection
 *     fail-open left records invisible in the Lead Database.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── module mocks ───────────────────────────────────────────────────────────*/

const requestMappingProposal = jest.fn();
const approveMappingProfile = jest.fn();
const submitChunks = jest.fn();

jest.mock('@/lib/apiFetch', () => ({ apiFetch: jest.fn() }));

jest.mock('@/components/prospects/import/importClient', () => {
  class ImportApiError extends Error {
    constructor(
      message: string,
      readonly code: string | null,
      readonly status: number,
    ) {
      super(message);
    }
    get isGateClosed() {
      return this.code === 'LEAD_INGESTION_DISABLED';
    }
    get isProfileStoreUnavailable() {
      return this.code === 'MAPPING_PROFILE_STORE_UNAVAILABLE';
    }
  }
  return {
    ImportApiError,
    requestMappingProposal: (...a: unknown[]) => requestMappingProposal(...a),
    approveMappingProfile: (...a: unknown[]) => approveMappingProfile(...a),
    newRunId: () => 'run-test',
    // The real one is exercised in its own describe block below, against the
    // unmocked module.
    mappingApprovalKey: (...a: unknown[]) => `key:${JSON.stringify(a.slice(0, 2))}`,
  };
});

jest.mock('@/lib/prospects/import/submitChunks', () => {
  const actual = jest.requireActual('@/lib/prospects/import/submitChunks');
  return {
    ...actual,
    submitChunks: (...a: unknown[]) => submitChunks(...a),
  };
});

jest.mock('@/components/lead-intelligence/leadIntelligenceClient', () => ({
  invalidateLeadIntelligenceReads: jest.fn(),
}));

jest.mock('swr', () => ({ useSWRConfig: () => ({ mutate: jest.fn() }) }));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImportWizard = require('../../../components/prospects/import/ImportWizard').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ImportApiError } = require('@/components/prospects/import/importClient');

/* ── fixtures ───────────────────────────────────────────────────────────────*/

const COMPANY = '00000000-0000-4000-8000-0000000000aa';

const FILE_TEXT = [
  'Email,Full Name,Company',
  'ADA@Example.COM,Ada Lovelace,Analytical Ltd',
  'grace@navy.mil,Grace Hopper,US Navy',
].join('\n');

/**
 * A File whose `text()` is counted, so "was the file read again?" is a
 * measurable fact rather than an assumption. jsdom's File has no usable
 * `text()`, so it is supplied here.
 */
function countingFile(): { file: File; reads: () => number } {
  let reads = 0;
  const file = {
    name: 'prospects.csv',
    type: 'text/csv',
    text: async () => {
      reads += 1;
      return FILE_TEXT;
    },
  } as unknown as File;
  return { file, reads: () => reads };
}

const target = (key: string, label: string, entity: 'contact' | 'company', dataType: string) => ({
  key,
  entity,
  label,
  description: `${label} description`,
  dataType,
  submittable: true,
});

const ALLOWED = [
  target('email', 'Email address', 'contact', 'email'),
  target('fullName', 'Full name', 'contact', 'text'),
  target('referenceId', 'Your reference', 'contact', 'text'),
  target('companyName', 'Company name', 'company', 'text'),
  target('companyExternalId', 'Company reference', 'company', 'text'),
  { ...target('description', 'Company description', 'company', 'text'), submittable: false, blockedReason: 'Company description cannot be imported yet.' },
];

const proposal = (over: Record<string, unknown> = {}) => ({
  version: 'pi-ldb.mapping.1',
  sourceSchemaFingerprint: 'a'.repeat(64),
  proposals: [
    {
      sourceField: 'Email',
      status: 'high_confidence_suggestion',
      candidate: { target: 'email', entity: 'contact', score: 0.95, evidence: [], dataTypeCompatibility: 'compatible', transformation: 'lowercase_email' },
      alternatives: [],
      ambiguity: null,
      reasoning: 'The heading and the values both look like email addresses.',
      requiresTenantApproval: false,
      provenance: 'deterministic',
      validation: null,
      model: null,
    },
    {
      sourceField: 'Full Name',
      status: 'high_confidence_suggestion',
      candidate: { target: 'fullName', entity: 'contact', score: 0.9, evidence: [], dataTypeCompatibility: 'compatible', transformation: 'trim' },
      alternatives: [],
      ambiguity: null,
      reasoning: 'The heading names a person.',
      requiresTenantApproval: false,
      provenance: 'deterministic',
      validation: null,
      model: null,
    },
    {
      sourceField: 'Company',
      status: 'high_confidence_suggestion',
      candidate: { target: 'companyName', entity: 'company', score: 0.8, evidence: [], dataTypeCompatibility: 'compatible', transformation: 'trim' },
      alternatives: [
        { target: 'companyExternalId', entity: 'company', score: 0.4, evidence: [], dataTypeCompatibility: 'compatible', transformation: 'trim' },
      ],
      ambiguity: null,
      reasoning: 'The heading names an employer.',
      requiresTenantApproval: false,
      provenance: 'deterministic',
      validation: null,
      model: null,
    },
  ],
  requiresReview: false,
  profile: null,
  degraded: [],
  allowedTargets: ALLOWED,
  aiAssisted: false,
  ...over,
});

/** Drives the wizard to the mapping step with a counted file. */
async function uploadAndMap() {
  const { file, reads } = countingFile();
  const view = render(<ImportWizard companyId={COMPANY} />);

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await waitFor(() => expect(screen.getByText(/Check the destinations/i)).toBeInTheDocument());

  return { view, reads, input };
}

beforeEach(() => {
  jest.clearAllMocks();
  requestMappingProposal.mockResolvedValue(proposal());
  approveMappingProfile.mockRejectedValue(
    new ImportApiError('not available', 'MAPPING_PROFILE_STORE_UNAVAILABLE', 501),
  );
  submitChunks.mockResolvedValue({
    outcomes: [
      { externalId: 'csv:0', ok: true, prospectId: 'p-1', leadProjection: { status: 'persisted', leadId: 'lead-1', reason: null, warnings: [], error: null } },
      { externalId: 'csv:1', ok: true, prospectId: 'p-2', leadProjection: { status: 'persisted', leadId: 'lead-1', reason: null, warnings: [], error: null } },
    ],
    succeeded: 2,
    failed: 0,
    recordsSent: 2,
    transportError: null,
    aborted: false,
  });
});

/* ── tests ──────────────────────────────────────────────────────────────────*/

describe('parsing happens in the browser', () => {
  it('reads the file once and asks the server about the headings only', async () => {
    const { reads } = await uploadAndMap();

    expect(reads()).toBe(1);
    expect(requestMappingProposal).toHaveBeenCalledTimes(1);

    const args = requestMappingProposal.mock.calls[0][0];
    expect(args.headers).toEqual(['Email', 'Full Name', 'Company']);

    // No ROWS, ever — there is no parameter for them. This is what keeps the
    // file in the tab and makes a correction a recomputation.
    expect(args).not.toHaveProperty('rows');
    expect(args).not.toHaveProperty('records');

    // Be precise about what DOES travel: a bounded number of representative
    // values per column, which is `columnSamples`' purpose — the scorer needs
    // type evidence and a heading alone does not provide it. Those values are
    // raw at this boundary and are redacted SERVER-side by the mapping engine
    // before anything reaches a model provider, which is the contract
    // `columnSamples` states ("MUST be passed through redactSamples before
    // they go anywhere near a model provider"). So this asserts the real
    // guarantee — bounded samples, no rows — rather than the stronger and
    // false claim that no cell value leaves the browser.
    expect(Object.keys(args.samples)).toEqual(['Email', 'Full Name', 'Company']);
    for (const values of Object.values(args.samples as Record<string, string[]>)) {
      // `columnSamples` caps at five per column; this file has two rows.
      expect(values.length).toBeLessThanOrEqual(5);
    }
    // And the whole file is demonstrably not in the payload: every row's worth
    // of values would mean three columns x N rows, not a capped sample.
    expect(JSON.stringify(args).length).toBeLessThan(600);
  });

  it('refuses a spreadsheet with an explanation instead of failing confusingly', async () => {
    render(<ImportWizard companyId={COMPANY} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const xlsx = { name: 'book.xlsx', text: async () => '' } as unknown as File;

    await act(async () => {
      fireEvent.change(input, { target: { files: [xlsx] } });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/Save As → CSV/i);
    expect(requestMappingProposal).not.toHaveBeenCalled();
  });
});

describe('ACCEPTANCE — a mapping is corrected without re-uploading the file', () => {
  it('changing a destination updates the preview, re-reads nothing and asks nothing', async () => {
    const { reads } = await uploadAndMap();

    // The preview shows the employer's NAME, as first proposed.
    expect(screen.getByRole('columnheader', { name: /Company name/i })).toBeInTheDocument();

    const select = screen.getByLabelText('Destination for Company') as HTMLSelectElement;
    expect(select.value).toBe('companyName');

    // The correction: it is actually the employer's reference in their CRM.
    await act(async () => {
      fireEvent.change(select, { target: { value: 'companyExternalId' } });
    });

    // The preview followed the correction...
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Company reference/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('columnheader', { name: /Company name/i })).not.toBeInTheDocument();

    // ...and THE POINT: no re-read, no re-upload, no request.
    expect(reads()).toBe(1);
    expect(requestMappingProposal).toHaveBeenCalledTimes(1);
    // The file input is still the same element — the drop step never remounted.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('a column can be corrected repeatedly, still without re-reading', async () => {
    const { reads } = await uploadAndMap();
    const select = screen.getByLabelText('Destination for Company') as HTMLSelectElement;

    for (const value of ['companyExternalId', 'companyName', '__ignore__', 'companyName']) {
      await act(async () => {
        fireEvent.change(select, { target: { value } });
      });
    }

    expect(select.value).toBe('companyName');
    expect(reads()).toBe(1);
    expect(requestMappingProposal).toHaveBeenCalledTimes(1);
  });

  it('a correction survives a round trip to the confirmation step and back', async () => {
    const { reads } = await uploadAndMap();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Destination for Company'), {
        target: { value: 'companyExternalId' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    });
    await waitFor(() => expect(screen.getByText(/Ready to import/i)).toBeInTheDocument());

    // The confirmation lists the corrected destination, not the original.
    expect(screen.getByText(/Company reference/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Change the mapping/i }));
    });
    await waitFor(() => expect(screen.getByText(/Check the destinations/i)).toBeInTheDocument());

    // Back on the mapping step the correction is still there — the retained
    // parse and the decisions both survived the navigation.
    expect((screen.getByLabelText('Destination for Company') as HTMLSelectElement).value).toBe(
      'companyExternalId',
    );
    expect(reads()).toBe(1);
  });

  it('ignoring a column removes it from the preview with no request', async () => {
    const { reads } = await uploadAndMap();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Destination for Full Name'), {
        target: { value: '__ignore__' },
      });
    });

    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: /Full name/i })).not.toBeInTheDocument(),
    );
    expect(reads()).toBe(1);
    expect(requestMappingProposal).toHaveBeenCalledTimes(1);
  });
});

describe('a destination the contract cannot carry', () => {
  it('is offered as disabled, with its reason, rather than hidden', async () => {
    await uploadAndMap();
    const select = screen.getByLabelText('Destination for Company');
    const option = within(select).getByRole('option', {
      name: /Company description — not importable yet/i,
    }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });
});

describe('AI assistance is never claimed falsely', () => {
  it('says "mapped from column names only" when the proposer was unavailable', async () => {
    requestMappingProposal.mockResolvedValue(
      proposal({
        aiAssisted: false,
        degraded: [{ sourceField: '*', cause: 'proposer_unavailable:GatewayProposerError' }],
      }),
    );
    await uploadAndMap();

    expect(screen.getByText(/Mapped from column names only/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI-assisted mapping/i)).not.toBeInTheDocument();
    // And it explains itself where the tenant is reading the outcome.
    expect(screen.getByText(/AI assistance was unavailable for this file/i)).toBeInTheDocument();
  });

  it('claims AI assistance only when the server reports it', async () => {
    requestMappingProposal.mockResolvedValue(proposal({ aiAssisted: true }));
    await uploadAndMap();

    expect(screen.getByText(/AI-assisted mapping/i)).toBeInTheDocument();
    expect(screen.queryByText(/Mapped from column names only/i)).not.toBeInTheDocument();
  });
});

describe('saved mappings are described honestly', () => {
  it('says there is no saved mapping for this layout yet when the server found none', async () => {
    await uploadAndMap();
    expect(screen.getByText(/No saved mapping for this file layout yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('saved-mapping-unavailable')).not.toBeInTheDocument();
  });

  it('a profile READ FAILURE is never described as "no saved mapping"', async () => {
    requestMappingProposal.mockResolvedValue(proposal({ profileRead: 'unavailable' }));
    await uploadAndMap();
    expect(screen.getByTestId('saved-mapping-unavailable')).toHaveTextContent(/could not be checked/i);
    expect(screen.queryByText(/No saved mapping for this file layout yet/i)).not.toBeInTheDocument();
  });
});

describe('an ambiguity must be answered before continuing', () => {
  const ambiguous = () =>
    proposal({
      requiresReview: true,
      proposals: [
        proposal().proposals[0],
        proposal().proposals[1],
        {
          ...proposal().proposals[2],
          status: 'review_required',
          candidate: null,
          requiresTenantApproval: true,
          ambiguity: {
            reason: 'entity_ambiguous',
            question: '"Company" could be the employer\'s name or your own reference for them.',
            options: [
              { target: 'companyName', label: "The employer's name", rationale: 'Most exports mean this.' },
              { target: 'companyExternalId', label: 'Your reference for them', rationale: 'Use this for a CRM id.' },
              { target: null, label: 'Ignore this column', rationale: 'Nothing will be stored from it.' },
            ],
          },
        },
      ],
    });

  it('blocks Continue until the question is answered', async () => {
    requestMappingProposal.mockResolvedValue(ambiguous());
    await uploadAndMap();

    expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled();
    expect(screen.getByText(/1 question still to answer/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Your reference for them/i }));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  });

  it('offers "ignore" as a real answer that also unblocks Continue', async () => {
    requestMappingProposal.mockResolvedValue(ambiguous());
    await uploadAndMap();

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Ignore this column/i }));
    });

    // A tenant is never forced to invent a destination for a column they do
    // not care about.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  });

  it('re-checking keeps the answer the tenant already gave', async () => {
    requestMappingProposal.mockResolvedValue(ambiguous());
    const { reads } = await uploadAndMap();

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Your reference for them/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Re-check the other columns/i }));
    });

    await waitFor(() => expect(requestMappingProposal).toHaveBeenCalledTimes(2));
    // A re-check must not discard the answer — that is the whole point of asking.
    expect((screen.getByLabelText('Destination for Company') as HTMLSelectElement).value).toBe(
      'companyExternalId',
    );
    // And it still does not touch the file.
    expect(reads()).toBe(1);
  });
});

describe('the feature gate is a state, not an error', () => {
  it('explains that importing is not enabled for this company', async () => {
    requestMappingProposal.mockRejectedValue(
      new ImportApiError('Lead ingestion is not enabled.', 'LEAD_INGESTION_DISABLED', 404),
    );
    const { file } = countingFile();
    render(<ImportWizard companyId={COMPANY} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(screen.getByText(/Importing is not enabled for this company/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Nothing is wrong with your file/i)).toBeInTheDocument();
    // Not rendered as a failure the tenant should retry.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('importing', () => {
  async function runImport() {
    await uploadAndMap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    });
    await waitFor(() => expect(screen.getByText(/Ready to import/i)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Import 2 records$/ }));
    });
    // Waits for the RESULTS SCREEN, not for a specific verdict. It used to wait
    // on /Import complete/, which quietly made the helper assert success — so a
    // test whose whole point was an unsuccessful import could not use it. The
    // headline is now the thing under test in several cases, so it cannot also
    // be the gate that lets the test start.
    await waitFor(() =>
      expect(screen.getByText(/Import complete|Import finished with problems/i)).toBeInTheDocument(),
    );
  }

  it('submits transformed records under one run id', async () => {
    await runImport();

    const args = submitChunks.mock.calls[0][0];
    expect(args.companyId).toBe(COMPANY);
    expect(args.ingestionRunId).toBe('run-test');
    expect(args.records).toEqual([
      { email: 'ada@example.com', fullName: 'Ada Lovelace', companyName: 'Analytical Ltd' },
      { email: 'grace@navy.mil', fullName: 'Grace Hopper', companyName: 'US Navy' },
    ]);
    // The tenant is a query parameter on the route, never a record field.
    for (const record of args.records) {
      expect(record).not.toHaveProperty('organizationId');
    }
  });

  it('states plainly that duplicates are checked after import, not before', async () => {
    await uploadAndMap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    });
    await waitFor(() => expect(screen.getByText(/Ready to import/i)).toBeInTheDocument());

    // No invented pre-import duplicate count.
    expect(screen.getByText(/Duplicates are not checked before importing/i)).toBeInTheDocument();
  });

  it('reports the results and links to the Lead Database', async () => {
    await runImport();

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View your Lead Database/i })).toHaveAttribute(
      'href',
      '/lead-intelligence?tab=leads',
    );
    expect(screen.getAllByRole('link', { name: /Open prospect/i })[0]).toHaveAttribute(
      'href',
      '/prospects/p-1',
    );
  });

  it('says the mapping could not be saved for reuse without calling it an import failure', async () => {
    await uploadAndMap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    });
    await waitFor(() => expect(screen.getByText(/Ready to import/i)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Remember this mapping/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Import 2 records$/ }));
    });

    await waitFor(() => expect(screen.getByText(/Import complete/i)).toBeInTheDocument());
    expect(screen.getByText(/Your import was not affected/i)).toBeInTheDocument();
  });

  it('surfaces the fail-open projection gap rather than reporting clean success', async () => {
    // The orchestrator's lead projection is fail-open: the prospect is durable
    // but may not be listed. An import that reports success while the Lead
    // Database shows nothing is the failure this callout exists to prevent.
    submitChunks.mockResolvedValue({
      outcomes: [
        { externalId: 'csv:0', ok: true, prospectId: 'p-1', leadProjection: { status: 'failed', leadId: null, reason: 'write_failed', warnings: [], error: 'sink unavailable' } },
        { externalId: 'csv:1', ok: true, prospectId: 'p-2', leadProjection: { status: 'persisted', leadId: 'lead-1', reason: null, warnings: [], error: null } },
      ],
      succeeded: 2,
      failed: 0,
      recordsSent: 2,
      transportError: null,
      aborted: false,
    });
    await runImport();

    expect(
      screen.getByText(/1 imported record will be missing details in your Lead Database/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/so nothing was lost/i)).toBeInTheDocument();
    // The headline must NOT read "complete" while a row is missing from the
    // database. This is the assertion the P0 was really about: `failed === 0`
    // used to be enough to print clean success.
    expect(screen.queryByText(/Import complete/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Import finished with problems/i)).toBeInTheDocument();
  });

  it('offers a retry for failures and reports duplicates found during import', async () => {
    submitChunks.mockResolvedValue({
      outcomes: [
        { externalId: 'csv:0', ok: true, prospectId: 'p-1', duplicatesParked: 1, leadProjection: { status: 'persisted', leadId: 'lead-1', reason: null, warnings: [], error: null } },
        { externalId: 'csv:1', ok: false, rejection: 'validation_failed', error: 'email is not usable' },
      ],
      succeeded: 1,
      failed: 1,
      recordsSent: 2,
      transportError: null,
      aborted: false,
    });

    await uploadAndMap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    });
    await waitFor(() => expect(screen.getByText(/Ready to import/i)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Import 2 records$/ }));
    });
    await waitFor(() =>
      expect(screen.getByText(/Import finished with problems/i)).toBeInTheDocument(),
    );

    expect(screen.getByText(/1 possible duplicate .* parked for review/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was merged automatically/i)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /Retry 1 record/i });
    await act(async () => {
      fireEvent.click(retry);
    });

    // A retry is a new unit of work over the records still in memory — no
    // re-upload, and only the record that did not land.
    await waitFor(() => expect(submitChunks).toHaveBeenCalledTimes(2));
    expect(submitChunks.mock.calls[1][0].records).toEqual([
      { email: 'grace@navy.mil', fullName: 'Grace Hopper', companyName: 'US Navy' },
    ]);
  });
});
