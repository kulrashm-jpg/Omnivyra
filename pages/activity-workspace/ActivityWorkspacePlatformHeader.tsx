import React from 'react';
import { Plus } from 'lucide-react';
import type { ScheduleItem, WorkspacePayload } from './types';

type Props = {
  schedules: ScheduleItem[];
  payload: WorkspacePayload;
  isGeneratingMaster: boolean;
  repurposingByScheduleId: Record<string, boolean>;
  handleRepurposeAll: () => void;
  showAddVariantForm: boolean;
  setShowAddVariantForm: React.Dispatch<React.SetStateAction<boolean>>;
  addVariantContentType: string;
  setAddVariantContentType: React.Dispatch<React.SetStateAction<string>>;
  addVariantPlatform: string;
  setAddVariantPlatform: React.Dispatch<React.SetStateAction<string>>;
  allContentTypesForAdd: string[];
  labelize: (value: string) => string;
  getAddablePlatformsForContentType: (contentType: string) => string[];
  setSchedules: React.Dispatch<React.SetStateAction<ScheduleItem[]>>;
  isHydratingContext: boolean;
};

export default function ActivityWorkspacePlatformHeader({
  schedules,
  payload,
  isGeneratingMaster,
  repurposingByScheduleId,
  handleRepurposeAll,
  showAddVariantForm,
  setShowAddVariantForm,
  addVariantContentType,
  setAddVariantContentType,
  addVariantPlatform,
  setAddVariantPlatform,
  allContentTypesForAdd,
  labelize,
  getAddablePlatformsForContentType,
  setSchedules,
  isHydratingContext,
}: Props) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Platform Content</h2>
          <p className="mt-0.5 text-sm text-gray-500">Click Repurpose to generate rich content for each platform.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {schedules.length > 1 && (
            <button
              type="button"
              onClick={handleRepurposeAll}
              disabled={isGeneratingMaster || schedules.some((schedule) => !!repurposingByScheduleId[schedule.id])}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isGeneratingMaster || schedules.some((schedule) => !!repurposingByScheduleId[schedule.id]) ? 'Generating...' : 'Repurpose All'}
            </button>
          )}
          {!showAddVariantForm ? (
            <button
              type="button"
              onClick={() => {
                setShowAddVariantForm(true);
                setAddVariantContentType(allContentTypesForAdd[0] || '');
                setAddVariantPlatform('');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Platform
            </button>
          ) : (
            <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
              <span className="text-xs text-gray-600">Content type:</span>
              <select
                value={addVariantContentType}
                onChange={(e) => {
                  setAddVariantContentType(e.target.value);
                  setAddVariantPlatform('');
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
              >
                {allContentTypesForAdd.map((contentType) => (
                  <option key={contentType} value={contentType}>{labelize(contentType)}</option>
                ))}
              </select>
              <span className="text-xs text-gray-600">Platform:</span>
              <select
                value={addVariantPlatform}
                onChange={(e) => setAddVariantPlatform(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
              >
                <option value="">Select platform</option>
                {getAddablePlatformsForContentType(addVariantContentType).map((platform) => (
                  <option key={platform} value={platform}>{labelize(platform)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!addVariantPlatform) return;
                  const first = schedules[0];
                  const row: ScheduleItem = {
                    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    platform: addVariantPlatform,
                    contentType: addVariantContentType,
                    date: first?.date || '',
                    time: first?.time || '09:00',
                    status: 'planned',
                    title: payload?.title,
                    description: payload?.description,
                  };
                  setSchedules((prev) => [...prev, row]);
                  setShowAddVariantForm(false);
                  setAddVariantContentType('');
                  setAddVariantPlatform('');
                }}
                disabled={!addVariantPlatform}
                className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddVariantForm(false);
                  setAddVariantContentType('');
                  setAddVariantPlatform('');
                }}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {isHydratingContext && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Syncing context for this activity...
        </div>
      )}

      {schedules.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-sm text-gray-500">
            No platforms yet. Click <strong className="text-gray-700">Add Platform</strong> to get started.
          </p>
        </div>
      )}
    </>
  );
}
