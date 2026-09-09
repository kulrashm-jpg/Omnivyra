/**
 * A7P-C16 — the tenant boundary around the Lead Sources panel.
 *
 * WHY THIS EXISTS. An Apollo credential was stored against the wrong company.
 * Nothing was broken on the server: the operator was authorised for both
 * companies, `requireExternalApiAccess` verified the tenant it was given, and
 * the key was written exactly where it was told. The defect was that nobody
 * told the operator WHICH tenant that was — the panel said "this company"
 * without naming it, and the id came from a fallback chain ending in
 * `companyIds[0]`.
 *
 * So this component owns exactly one question — *which tenant are we
 * configuring?* — and refuses to render the panel until it has an answer the
 * user actually gave. It reuses `useCompanyContext`'s existing `companies`
 * list and its membership-validating `setSelectedCompanyId`; there is no
 * second company-selection system here, and no company id is invented.
 *
 * It is separate from `LeadSourcesPanel` on purpose. The panel keeps taking
 * the tenant as an explicit prop, which is what makes it testable against a
 * named company rather than against whatever ambient state a test happens to
 * produce.
 */
import React from 'react';
import { Building2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import LeadSourcesPanel from './LeadSourcesPanel';

export default function LeadSourcesSection() {
  const {
    companies,
    selectedCompanyId,
    selectedCompanyName,
    companySelectionAmbiguous,
    setSelectedCompanyId,
    isLoading,
  } = useCompanyContext();

  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-50" data-testid="lead-sources-section-loading" />
    );
  }

  // More than one membership and no choice made. The panel is NOT rendered:
  // with no tenant it could not issue a credential request anyway, and showing
  // it would invite the reader to assume one had been picked for them.
  if (!selectedCompanyId) {
    return (
      <div
        data-testid="lead-sources-choose-company"
        className="rounded-xl border border-amber-200 bg-amber-50 p-5"
      >
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-amber-900">Choose a company</h3>
            <p className="mt-1 text-xs text-amber-800">
              {companySelectionAmbiguous
                ? 'You administer more than one company. Provider keys are stored against one company only, so pick the one you want to configure — Omnivyra will not choose for you.'
                : 'Select a company to manage its lead sources.'}
            </p>
          </div>
        </div>

        {companies.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" data-testid="lead-sources-company-choices">
            {companies.map((c) => (
              <button
                key={c.company_id}
                type="button"
                onClick={() => setSelectedCompanyId(c.company_id)}
                data-testid={`choose-company-${c.company_id}`}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        A switcher is offered even once a tenant is resolved, so correcting a
        wrong company is a click rather than a hunt through another screen.
        `setSelectedCompanyId` re-validates membership, so this cannot select a
        company the user does not administer.
      */}
      {companies.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="lead-sources-company-switcher">
          <span className="text-xs text-gray-500">Company:</span>
          {companies.map((c) => {
            const active = c.company_id === selectedCompanyId;
            return (
              <button
                key={c.company_id}
                type="button"
                onClick={() => setSelectedCompanyId(c.company_id)}
                aria-pressed={active}
                data-testid={`switch-company-${c.company_id}`}
                className={
                  active
                    ? 'rounded-lg border border-indigo-300 bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-indigo-900'
                    : 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50'
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/*
        `key` on the tenant id: a company change REMOUNTS the panel, so no
        piece of the previous tenant's state — provider statuses, an open edit
        field, a pending revoke confirmation — can survive the switch.
      */}
      <LeadSourcesPanel
        key={selectedCompanyId}
        companyId={selectedCompanyId}
        companyName={selectedCompanyName}
      />
    </div>
  );
}
