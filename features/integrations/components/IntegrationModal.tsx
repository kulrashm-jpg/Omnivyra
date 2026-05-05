import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Integration, IntegrationType } from '../types';
import { CONFIG_FIELDS, TYPE_COLORS, TYPE_ICONS, TYPE_LABELS } from '../constants';

export interface IntegrationModalProps {
  mode: 'create' | 'edit';
  initial?: Partial<Integration>;
  onClose: () => void;
  onSave: (data: { type: IntegrationType; name: string; config: Record<string, string> }) => Promise<void>;
}

export default function IntegrationModal({ mode, initial, onClose, onSave }: IntegrationModalProps) {
  const [type, setType] = useState<IntegrationType>(initial?.type || 'lead_webhook');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, string>>(initial?.config || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = CONFIG_FIELDS[type];

  const handleTypeChange = (nextType: IntegrationType) => {
    setType(nextType);
    setConfig({});
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    const requiredField = fields.find((field) => !field.placeholder.includes('optional') && !config[field.key]);
    if (requiredField) {
      setError(`${requiredField.label} is required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ type, name: name.trim(), config });
    } catch (err: any) {
      setError(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{mode === 'create' ? 'Add Integration' : 'Edit Integration'}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {mode === 'create' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Integration Type</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((integrationType) => (
                  <button
                    key={integrationType}
                    type="button"
                    onClick={() => handleTypeChange(integrationType)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      type === integrationType
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className={`rounded p-1 ${TYPE_COLORS[integrationType]}`}>{TYPE_ICONS[integrationType]}</span>
                    <span>{TYPE_LABELS[integrationType]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`e.g. ${TYPE_LABELS[type]} - Production`}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-3">
            <div className="border-t border-gray-100 pt-3 text-sm font-medium text-gray-700">Connection Settings</div>
            {fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
                <input
                  type={field.type || 'text'}
                  value={config[field.key] || ''}
                  onChange={(event) => setConfig((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {field.hint && <p className="mt-1 text-xs text-gray-500">{field.hint}</p>}
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto">
              {saving ? 'Saving...' : mode === 'create' ? 'Add Integration' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
