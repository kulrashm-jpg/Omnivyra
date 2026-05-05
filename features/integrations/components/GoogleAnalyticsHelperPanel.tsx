import type { GoogleAnalyticsStatusResponse, TrackingAssistResponse } from '../types';

export interface GoogleAnalyticsHelperPanelProps {
  gaStatus: GoogleAnalyticsStatusResponse | null;
  gaSelectingProperty: boolean;
  selectedPropertyId: string;
  scriptAssistOpen: boolean;
  scriptAssistLoading: boolean;
  scriptAssistError: string | null;
  scriptAssistForm: { website_url: string; platform: string };
  scriptAssistResult: TrackingAssistResponse | null;
  onSelectedPropertyChange: (value: string) => void;
  onSelectProperty: () => Promise<void>;
  onToggleScriptAssist: () => void;
  onScriptAssistInput: (key: 'website_url' | 'platform', value: string) => void;
  onGenerateScriptAssist: () => Promise<void>;
}

export default function GoogleAnalyticsHelperPanel({
  gaStatus,
  gaSelectingProperty,
  selectedPropertyId,
  scriptAssistOpen,
  scriptAssistLoading,
  scriptAssistError,
  scriptAssistForm,
  scriptAssistResult,
  onSelectedPropertyChange,
  onSelectProperty,
  onToggleScriptAssist,
  onScriptAssistInput,
  onGenerateScriptAssist,
}: GoogleAnalyticsHelperPanelProps) {
  const properties = gaStatus?.properties || [];
  const showPropertySelection = gaStatus?.status === 'property_selection';

  // Hide the helper panel entirely when there's nothing for the user to do.
  if (!showPropertySelection && !scriptAssistOpen && !scriptAssistResult) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Need Help Setting Up Tracking?</h3>
            <p className="text-sm text-gray-600">Optional. Use this when Google Analytics is connected but your site is not yet sending data.</p>
          </div>
          <button
            type="button"
            onClick={onToggleScriptAssist}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open setup help
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showPropertySelection && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Choose the Google Analytics property to sync</h3>
            <p className="text-sm text-gray-600">No manual configuration is needed beyond selecting the property you want Omnivyra to use.</p>
          </div>
          {properties.length === 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              No GA properties found
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={selectedPropertyId}
                onChange={(event) => onSelectedPropertyChange(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="">Select a property</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}{property.account_id ? ` · Account ${property.account_id}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onSelectProperty()}
                disabled={!selectedPropertyId || gaSelectingProperty}
                className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {gaSelectingProperty ? 'Saving...' : 'Use this property'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Need Help Setting Up Tracking?</h3>
            <p className="text-sm text-gray-600">Optional. Use this when Google Analytics is connected but your site is not yet sending data.</p>
          </div>
          <button
            type="button"
            onClick={onToggleScriptAssist}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {scriptAssistOpen ? 'Hide setup help' : 'Open setup help'}
          </button>
        </div>

        {scriptAssistOpen && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="url"
                value={scriptAssistForm.website_url}
                onChange={(event) => onScriptAssistInput('website_url', event.target.value)}
                placeholder="https://yourwebsite.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <select
                value={scriptAssistForm.platform}
                onChange={(event) => onScriptAssistInput('platform', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="wordpress">WordPress</option>
                <option value="shopify">Shopify</option>
                <option value="custom">Custom</option>
                <option value="webflow">Webflow</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void onGenerateScriptAssist()}
              disabled={scriptAssistLoading}
              className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {scriptAssistLoading ? 'Generating...' : 'Generate setup help'}
            </button>

            {scriptAssistError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{scriptAssistError}</div>
            )}

            {scriptAssistResult && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 lg:col-span-2">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Suggested GA Script</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-gray-700">{scriptAssistResult.script}</pre>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Placement</div>
                    <div className="space-y-2 text-sm text-gray-600">
                      {scriptAssistResult.placement_instructions.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Validation</div>
                    <div className="space-y-2 text-sm text-gray-600">
                      {scriptAssistResult.validation_steps.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
