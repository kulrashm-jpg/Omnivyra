/**
 * Typed fixture builder for `ResolvedReportInput['resolved']`.
 *
 * `resolved.companyContext` is REQUIRED on ResolvedReportInput: the only
 * production producer (reportInputResolver.resolveReportInput) always sets
 * it. Fixtures built as bare object literals used to omit it; tests are not
 * type-checked by jest, so that drift went unnoticed and made "absent
 * companyContext" look like a real runtime state.
 *
 * Use this builder for every fixture's `resolved` block. It always produces a
 * complete companyContext (all-empty unless overridden). A test that
 * deliberately exercises an absent companyContext should build that state
 * explicitly and say so.
 */
import type { ReportCompanyContext, ResolvedReportInput } from '../../services/reportInputResolver';

type Resolved = ResolvedReportInput['resolved'];

export const EMPTY_REPORT_COMPANY_CONTEXT: ReportCompanyContext = {
  marketFocus: null,
  productServices: [],
  targetCustomer: null,
  idealCustomerProfile: null,
  brandPositioning: null,
  competitiveAdvantages: null,
  teamSize: null,
  foundedYear: null,
  revenueRange: null,
};

export function buildResolvedReportFields(
  fields: Omit<Resolved, 'companyContext'> & { companyContext?: Partial<ReportCompanyContext> },
): Resolved {
  const { companyContext, ...rest } = fields;
  return {
    ...rest,
    companyContext: { ...EMPTY_REPORT_COMPANY_CONTEXT, ...companyContext },
  };
}
