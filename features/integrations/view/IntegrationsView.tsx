import {
  ArrowRight,
  CheckCircle,
  Plus,
  X,
  XCircle,
} from 'lucide-react';
import type { useIntegrations } from '@/features/integrations/hooks/useIntegrations';
import type { FocusArea, Integration } from '@/features/integrations/types';
import { buildCategoryCards } from '@/features/integrations/config/categoryCards';
import IntegrationModal from '@/features/integrations/components/IntegrationModal';
import ConnectionCard from '@/features/integrations/components/ConnectionCard';
import EmptyConnections from '@/features/integrations/components/EmptyConnections';
import CategoryAction from '@/features/integrations/components/CategoryAction';
import GoogleAnalyticsGridCard from '@/features/integrations/components/GoogleAnalyticsGridCard';
import GoogleAnalyticsHelperPanel from '@/features/integrations/components/GoogleAnalyticsHelperPanel';

interface IntegrationsViewProps {
  state: ReturnType<typeof useIntegrations>['state'];
  actions: ReturnType<typeof useIntegrations>['actions'];
  companyId: string;
  isAdmin: boolean;
  focus: FocusArea;
  highlightedIds: Set<string>;
}

export default function IntegrationsView({
  state,
  actions,
  companyId,
  isAdmin,
  focus,
  highlightedIds,
}: IntegrationsViewProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Integrations</h1>
            <p className="mt-1 text-sm text-gray-500">
              Build the input layer for publishing, lead capture, CRM context, analytics, and imported business data.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => actions.openModal({ mode: 'create' })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Add Integration
            </button>
          )}
        </div>

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{focus === 'website' ? 'Website & Lead Capture' : 'Data & CRM Sources'}</h2>
              <p className="text-sm text-gray-500">{focus === 'website' ? 'These are the website-side setup cards for publishing, forms, and lead capture.' : 'These are the business data setup cards for CRM, analytics, and imported files.'}</p>
            </div>
          </div>

          <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {buildCategoryCards(isAdmin, actions.openModal).filter((card) => card.focus === focus).map((card) => {
              if (card.id === 'google-analytics') {
                return (
                  <GoogleAnalyticsGridCard
                    key={card.id}
                    isAdmin={isAdmin}
                    gaStatus={state.gaStatus}
                    gaLoading={state.gaLoading}
                    gaError={state.gaError}
                    gaNotice={state.gaNotice}
                    gaConnecting={state.gaConnecting}
                    gaSyncing={state.gaSyncing}
                    onConnect={actions.handleGAConnect}
                    onForceSync={actions.handleGASync}
                  />
                );
              }
              const isHighlighted = highlightedIds.has(card.id);
              return (
                <div
                  key={card.id}
                  className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${isHighlighted ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md' : 'border-gray-200'}`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${card.badgeClassName}`}>
                      {card.icon}
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${card.badgeClassName}`}>
                      {card.badge}
                    </span>
                  </div>

                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-gray-600">{card.description}</p>
                  </div>

                  <div className="mb-5 space-y-2">
                    {card.items.map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm text-gray-600">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  {card.actions.length > 0 ? (
                    <div className="mt-auto flex flex-wrap gap-2">
                      {card.actions.map((action) => (
                        <CategoryAction key={action.label} action={action} />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-auto rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                      This source group is intentionally shown as a planned foundation area until a real setup surface exists.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {!companyId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Select a company to manage integrations.
          </div>
        )}

        {state.error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</div>}

        {state.testResult && (
          <div
            className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              state.testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {state.testResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{state.testResult.message}</span>
            <button onClick={actions.dismissTestResult} className="ml-auto shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {state.loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading integrations...</div>
        ) : (
          <div className="space-y-8">
            {focus === 'website' && (
              <>
                <section id="website-publishing-section">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Website Integrations</h2>
                      <p className="text-xs text-gray-500">Connect the website or blog destination that published content should flow into.</p>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => actions.openModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add WordPress
                        </button>
                        <button
                          onClick={() => actions.openModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Blog API
                        </button>
                      </div>
                    )}
                  </div>

                  {state.blogIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No website integrations yet."
                      actions={
                        isAdmin
                          ? [
                              { label: 'Add WordPress', onClick: () => actions.openModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }) },
                              { label: 'Add Blog API', onClick: () => actions.openModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration }) },
                            ]
                          : []
                      }
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {state.blogIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => actions.openModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={actions.handleDeleteIntegration}
                          onTest={actions.handleTestIntegration}
                          testing={state.testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section id="lead-capture-section" className="space-y-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Lead Capture Integrations</h2>
                      <p className="text-xs text-gray-500">Use forms in the lead workspace and connect webhook delivery for captured leads.</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => actions.openModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration })}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Webhook
                      </button>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-950">Forms, hosted pages, and embed code already live in Lead Capture</h3>
                        <p className="mt-1 text-sm text-emerald-800">
                          Use the Lead Capture workspace for website forms, hosted links, HTML downloads, and embed snippets. Webhooks below handle where those submissions go next.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a href="/leads?tab=forms" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                          Open forms
                          <ArrowRight className="h-4 w-4" />
                        </a>
                        <a href="/leads?tab=connections" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                          Open webhooks
                        </a>
                      </div>
                    </div>
                  </div>

                  {state.leadIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No lead capture webhooks yet."
                      actions={isAdmin ? [{ label: 'Add Webhook', onClick: () => actions.openModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration }) }] : []}
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {state.leadIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => actions.openModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={actions.handleDeleteIntegration}
                          onTest={actions.handleTestIntegration}
                          testing={state.testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {focus === 'data' && (
              <GoogleAnalyticsHelperPanel
                gaStatus={state.gaStatus}
                gaSelectingProperty={state.gaSelectingProperty}
                selectedPropertyId={state.selectedPropertyId}
                scriptAssistOpen={state.scriptAssistOpen}
                scriptAssistLoading={state.scriptAssistLoading}
                scriptAssistError={state.scriptAssistError}
                scriptAssistForm={state.scriptAssistForm}
                scriptAssistResult={state.scriptAssistResult}
                onSelectedPropertyChange={actions.setSelectedPropertyId}
                onSelectProperty={actions.handleGAPropertySelect}
                onToggleScriptAssist={() => actions.setScriptAssistOpen((current) => !current)}
                onScriptAssistInput={(key, value) => actions.setScriptAssistForm((current) => ({ ...current, [key]: value }))}
                onGenerateScriptAssist={actions.handleTrackingAssist}
              />
            )}
          </div>
        )}
      </div>

      {state.modal && (
        <IntegrationModal
          mode={state.modal.mode}
          initial={state.modal.integration}
          onClose={actions.closeModal}
          onSave={async (payload) => {
            if (state.modal?.mode === 'create') {
              await actions.handleCreateIntegration(payload);
            } else if (state.modal?.integration) {
              await actions.handleUpdateIntegration(state.modal.integration.id, payload);
            }
          }}
        />
      )}
    </div>
  );
}
