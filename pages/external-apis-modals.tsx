import React from 'react';
import type { ProviderAccount, ExternalApiPreset } from './external-apis.types';

type AccountModalState = {
  apiId: string;
  apiName: string;
  authType: string;
  mode: 'add' | 'edit';
  account?: ProviderAccount;
} | null;

type AccountForm = {
  account_name: string;
  api_key_env_name: string;
  api_key_value: string;
  oauth_client_id: string;
  oauth_client_secret: string;
  rate_limit_per_min: string;
  rate_limit_per_day: string;
  priority: string;
  is_active: boolean;
};

interface AccountModalProps {
  accountModal: AccountModalState;
  onClose: () => void;
  accountForm: AccountForm;
  setAccountForm: React.Dispatch<React.SetStateAction<AccountForm>>;
  accountError: string | null;
  isSavingAccount: boolean;
  onSave: () => void;
}

export function AccountModal({
  accountModal,
  onClose,
  accountForm,
  setAccountForm,
  accountError,
  isSavingAccount,
  onSave,
}: AccountModalProps) {
  if (!accountModal) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {accountModal.mode === 'add' ? 'Add Account' : 'Edit Account'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{accountModal.apiName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {accountError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{accountError}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Account Name *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Primary Account, Account #2"
              value={accountForm.account_name}
              onChange={(e) => setAccountForm((p) => ({ ...p, account_name: e.target.value }))}
            />
          </div>
          {(accountModal.authType === 'bearer' || accountModal.authType === 'api_key' || accountModal.authType === 'query_param') && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  API Key Env Var Name
                  <span className="ml-1 font-normal text-gray-400">— name of .env variable</span>
                </label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="e.g. YOUTUBE_API_KEY_2"
                  value={accountForm.api_key_env_name}
                  onChange={(e) => setAccountForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  API Key Value
                  <span className="ml-1 font-normal text-gray-400">— stored encrypted</span>
                </label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder={accountModal.mode === 'edit' ? '(unchanged)' : 'Enter API key'}
                  value={accountForm.api_key_value}
                  onChange={(e) => setAccountForm((p) => ({ ...p, api_key_value: e.target.value }))}
                />
              </div>
            </>
          )}
          {accountModal.authType === 'oauth2' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">OAuth Client ID</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="OAuth2 Client ID"
                  value={accountForm.oauth_client_id}
                  onChange={(e) => setAccountForm((p) => ({ ...p, oauth_client_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">OAuth Client Secret</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder={accountModal.mode === 'edit' ? '(unchanged)' : 'OAuth2 Client Secret'}
                  value={accountForm.oauth_client_secret}
                  onChange={(e) => setAccountForm((p) => ({ ...p, oauth_client_secret: e.target.value }))}
                />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <input
                type="number"
                min="1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="1"
                value={accountForm.priority}
                onChange={(e) => setAccountForm((p) => ({ ...p, priority: e.target.value }))}
              />
              <p className="text-[10px] text-gray-400 mt-1">Lower = tried first</p>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="acct-modal-active"
                checked={accountForm.is_active}
                onChange={(e) => setAccountForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <label htmlFor="acct-modal-active" className="text-xs text-gray-700">Active</label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit / min</label>
              <input
                type="number"
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. 60"
                value={accountForm.rate_limit_per_min}
                onChange={(e) => setAccountForm((p) => ({ ...p, rate_limit_per_min: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit / day</label>
              <input
                type="number"
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. 10000"
                value={accountForm.rate_limit_per_day}
                onChange={(e) => setAccountForm((p) => ({ ...p, rate_limit_per_day: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSavingAccount}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSavingAccount ? 'Saving…' : accountModal.mode === 'add' ? 'Add Account' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PresetModalProps {
  open: boolean;
  onClose: () => void;
  canManagePresets: boolean;
  canManageExternalApis: boolean;
  isLoadingPresets: boolean;
  presets: (ExternalApiPreset & { id?: string })[];
  presetSelection: Set<string>;
  togglePresetSelection: (id: string, checked: boolean) => void;
  savePresetSelection: () => void;
  isSavingPresetSelection: boolean;
}

export function PresetModal({
  open,
  onClose,
  canManagePresets,
  canManageExternalApis,
  isLoadingPresets,
  presets,
  presetSelection,
  togglePresetSelection,
  savePresetSelection,
  isSavingPresetSelection,
}: PresetModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Select Global Presets</h3>
            <p className="text-xs text-gray-500">
              Choose which global APIs this company can use. You can select none.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Selected APIs will be available to your company&apos;s users.
            </p>
            {!canManagePresets && (
              <p className="text-xs text-gray-500 mt-1">
                Configured by company admin.
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-sm text-gray-600">Close</button>
        </div>
        <div className="max-h-[60vh] overflow-auto space-y-2">
          {isLoadingPresets && (
            <div className="text-sm text-gray-500">Loading presets...</div>
          )}
          {!isLoadingPresets && presets.length === 0 && (
            <div className="text-sm text-gray-500">No presets available.</div>
          )}
          {!isLoadingPresets && presets.map((preset) => {
            const disabled = !preset.id;
            const checked = preset.id ? presetSelection.has(preset.id) : false;
            return (
              <label
                key={`${preset.name}-${preset.id || 'inline'}`}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                  disabled ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-800'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={disabled || !canManageExternalApis}
                  checked={checked}
                  onChange={(e) => {
                    if (preset.id && canManageExternalApis) {
                      togglePresetSelection(preset.id, e.target.checked);
                    }
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="font-semibold">{preset.name}</div>
                  <div className="text-xs text-gray-500">{preset.description}</div>
                  {!preset.id && (
                    <div className="text-xs text-gray-400 mt-1">
                      Ask a super admin to add this preset to the global catalog.
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
          <button
            onClick={savePresetSelection}
            disabled={isSavingPresetSelection || !canManageExternalApis}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {isSavingPresetSelection ? 'Saving...' : 'Save Selection'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default function ExternalApisModalsPage() {
  return null;
}
