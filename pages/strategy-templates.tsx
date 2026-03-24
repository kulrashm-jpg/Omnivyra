import React, { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { getFirebaseAuth } from '../lib/firebase';

type StrategyTemplate = {
  id: string;
  name: string;
  description?: string | null;
  objective: string;
  campaign_intent?: string | null;
  target_audience: string;
  key_platforms: string[];
  content_pillars?: Record<string, any> | null;
  content_frequency?: Record<string, any> | null;
  distribution_preferences?: Record<string, any> | null;
  tags?: string[] | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

const emptyForm = {
  name: '',
  description: '',
  objective: '',
  campaign_intent: '',
  target_audience: '',
  key_platforms: '',
  content_pillars: '{}',
  content_frequency: '{}',
  distribution_preferences: '{}',
  tags: '',
  is_public: false,
};

const parseJson = (value: string) => {
  try {
    const parsed = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, error: 'Must be a JSON object.' };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
};

export default function StrategyTemplatesPage() {
  const [userId, setUserId] = useState<string>('');
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const uid = auth.currentUser?.uid || '';
    setUserId(uid);
  }, []);

  const loadTemplates = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/strategy-templates?user_id=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        throw new Error('Failed to load strategy templates');
      }
      const data = await response.json();
      setTemplates(data.data || []);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load strategy templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) loadTemplates();
  }, [userId]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
  };

  const handleEdit = (template: StrategyTemplate) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      description: template.description || '',
      objective: template.objective,
      campaign_intent: template.campaign_intent || '',
      target_audience: template.target_audience,
      key_platforms: template.key_platforms.join(', '),
      content_pillars: JSON.stringify(template.content_pillars || {}, null, 2),
      content_frequency: JSON.stringify(template.content_frequency || {}, null, 2),
      distribution_preferences: JSON.stringify(template.distribution_preferences || {}, null, 2),
      tags: (template.tags || []).join(', '),
      is_public: template.is_public,
    });
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm('Delete this strategy template?')) return;
    try {
      const response = await fetch(`/api/strategy-templates/${templateId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete strategy template');
      }
      setTemplates((prev) => prev.filter((item) => item.id !== templateId));
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to delete strategy template.');
    }
  };

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!userId) {
      setErrorMessage('Not authenticated.');
      return;
    }
    if (!form.name || !form.objective || !form.target_audience || !form.key_platforms) {
      setErrorMessage('Name, objective, target audience, and platforms are required.');
      return;
    }
    const pillarsResult = parseJson(form.content_pillars);
    const frequencyResult = parseJson(form.content_frequency);
    const distributionResult = parseJson(form.distribution_preferences);
    if (!pillarsResult.ok || !frequencyResult.ok || !distributionResult.ok) {
      setErrorMessage(
        pillarsResult.error || frequencyResult.error || distributionResult.error || 'Invalid JSON.'
      );
      return;
    }
    const payload = {
      user_id: userId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      objective: form.objective.trim(),
      campaign_intent: form.campaign_intent.trim() || null,
      target_audience: form.target_audience.trim(),
      key_platforms: form.key_platforms
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      content_pillars: pillarsResult.value,
      content_frequency: frequencyResult.value,
      distribution_preferences: distributionResult.value,
      tags: form.tags
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      is_public: form.is_public,
    };
    try {
      const response = await fetch(
        editingId ? `/api/strategy-templates/${editingId}` : '/api/strategy-templates',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save strategy template');
      }
      await loadTemplates();
      setSuccessMessage(editingId ? 'Strategy template updated.' : 'Strategy template created.');
      resetForm();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save strategy template.');
    }
  };

  const hasTemplates = useMemo(() => templates.length > 0, [templates]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900">Strategy Templates</h1>
          <p className="text-sm text-gray-600 mt-2">
            Planning-only templates for content strategy, campaign intent, and distribution
            preferences. No automation or execution.
          </p>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {editingId ? 'Edit Template' : 'Create Template'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Template name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Campaign intent"
              value={form.campaign_intent}
              onChange={(e) => setForm((prev) => ({ ...prev, campaign_intent: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Objective"
              value={form.objective}
              onChange={(e) => setForm((prev) => ({ ...prev, objective: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Target audience"
              value={form.target_audience}
              onChange={(e) => setForm((prev) => ({ ...prev, target_audience: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Key platforms (comma-separated)"
              value={form.key_platforms}
              onChange={(e) => setForm((prev) => ({ ...prev, key_platforms: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Tags (comma-separated)"
              value={form.tags}
              onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
            />
          </div>
          <textarea
            className="border rounded-lg px-3 py-2 w-full h-24 text-sm"
            placeholder="Short description"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-1">Content pillars (JSON)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                value={form.content_pillars}
                onChange={(e) => setForm((prev) => ({ ...prev, content_pillars: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Content frequency (JSON)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                value={form.content_frequency}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, content_frequency: e.target.value }))
                }
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Distribution preferences (JSON)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                value={form.distribution_preferences}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, distribution_preferences: e.target.value }))
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm((prev) => ({ ...prev, is_public: e.target.checked }))}
            />
            Share as public template
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm"
            >
              {editingId ? 'Save changes' : 'Create template'}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Your Strategy Templates</h2>
            {!loading && hasTemplates && (
              <div className="text-xs text-gray-500">{templates.length} templates</div>
            )}
          </div>
          {loading ? (
            <div className="text-sm text-gray-500">Loading templates...</div>
          ) : !hasTemplates ? (
            <div className="text-sm text-gray-500">No strategy templates yet.</div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="border rounded-lg p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-900">{template.name}</div>
                      <div className="text-xs text-gray-500">{template.description || '—'}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        Platforms: {template.key_platforms.join(', ') || '—'}
                      </div>
                      <div className="text-xs text-gray-400">
                        Objective: {template.objective}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(template)}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {template.tags && template.tags.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Tags: {template.tags.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
