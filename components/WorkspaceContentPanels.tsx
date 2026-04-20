import React from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Plus, Sparkles } from 'lucide-react';
import ContentRenderer from '@/components/ContentRenderer';
import EmptyState from '@/components/shared/EmptyState';
import ExamplePreview from '@/components/shared/ExamplePreview';
import type { ScheduleItem } from '../types/activityWorkspace';
import type { useActivityWorkspace } from '../hooks/useActivityWorkspace';
import WorkspacePlatformCard from './activity-workspace/WorkspacePlatformCard';

type WorkspaceState = ReturnType<typeof useActivityWorkspace>;

export default function WorkspaceContentPanels({ d }: { d: WorkspaceState }) {
  const {
    addVariantContentType,
    addVariantPlatform,
    allContentTypesForAdd,
    getAddablePlatformsForContentType,
    handleGenerateMasterContent,
    handleRepurposeAll,
    hasMasterGenerated,
    isGeneratingMaster,
    isHydratingContext,
    labelize,
    masterContent,
    masterContentExpanded,
    payload,
    repurposingByScheduleId,
    schedules,
    setAddVariantContentType,
    setAddVariantPlatform,
    setMasterContentExpanded,
    setSchedules,
    setShowAddVariantForm,
    showAddVariantForm,
  } = d as WorkspaceState & {
    getAddablePlatformsForContentType: (contentType: string) => string[];
  };

  const masterText =
    String((masterContent as any)?.master_content || (masterContent as any)?.content || '').trim();
  const isRepurposingAny = Object.values(repurposingByScheduleId || {}).some(Boolean);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setMasterContentExpanded(!masterContentExpanded)}
          className="flex w-full items-center justify-between border-b border-slate-100 px-5 py-4 text-left"
        >
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Master Content</h2>
              {hasMasterGenerated ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Review the core source content before you repurpose it across platforms.
            </p>
          </div>
          {masterContentExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {masterContentExpanded ? (
          <div className="space-y-4 px-5 py-5">
            {masterText ? (
              <ContentRenderer content={masterText} renderMode="rich" />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
                <p className="text-sm text-slate-500 mb-3">The master content has not been generated yet.</p>
                <button
                  type="button"
                  onClick={() => handleGenerateMasterContent?.()}
                  disabled={isGeneratingMaster}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  {isGeneratingMaster ? 'Generating...' : 'Generate Master Content'}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Platform Content</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create, review, and schedule the platform-specific versions of this activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleRepurposeAll()}
              disabled={isGeneratingMaster || isRepurposingAny || !hasMasterGenerated}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {isGeneratingMaster ? 'Creating master...' : isRepurposingAny ? 'Repurposing...' : 'Repurpose all'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddVariantForm(!showAddVariantForm)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Add platform
            </button>
          </div>
        </div>

        {showAddVariantForm ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
              <select
                value={addVariantContentType}
                onChange={(event) => {
                  setAddVariantContentType(event.target.value);
                  setAddVariantPlatform('');
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Select content type</option>
                {allContentTypesForAdd.map((contentType) => (
                  <option key={contentType} value={contentType}>
                    {labelize(contentType)}
                  </option>
                ))}
              </select>

              <select
                value={addVariantPlatform}
                onChange={(event) => setAddVariantPlatform(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Select platform</option>
                {getAddablePlatformsForContentType(addVariantContentType).map((platform) => (
                  <option key={platform} value={platform}>
                    {labelize(platform)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  if (!addVariantPlatform || !addVariantContentType) return;
                  const firstSchedule = schedules[0];
                  const row: ScheduleItem = {
                    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    platform: addVariantPlatform,
                    contentType: addVariantContentType,
                    date: firstSchedule?.date || '',
                    time: firstSchedule?.time || '09:00',
                    status: 'planned',
                    title: payload?.title,
                    description: payload?.description,
                  };
                  setSchedules((current) => [...current, row]);
                  setShowAddVariantForm(false);
                  setAddVariantContentType('');
                  setAddVariantPlatform('');
                }}
                disabled={!addVariantPlatform || !addVariantContentType}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {isHydratingContext ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Syncing workspace context so every platform card is up to date…
          </div>
        ) : null}

        {schedules.length === 0 ? (
          <EmptyState
            title="Create your first platform variant"
            description="Turn your master content into channel-ready posts so you can review, refine, and schedule each platform version from one place."
            primaryAction={{
              label: 'Add first platform',
              onClick: () => setShowAddVariantForm(true),
            }}
            secondaryAction={{
              label: 'Repurpose all from master',
              onClick: () => handleRepurposeAll(),
            }}
            examplePreview={(
              <ExamplePreview variant="insight" />
            )}
          />
        ) : (
          <div className="space-y-4">
            {schedules.map((item, index) => (
              <WorkspacePlatformCard key={item.id} d={d} item={item} idx={index} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
