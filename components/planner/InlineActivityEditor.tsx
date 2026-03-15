/**
 * Inline Activity Editor
 * Edits Title, Angle, CTA for a calendar activity. Updates plannerSessionStore.calendar_plan.
 */

import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity } from './plannerSessionStore';

export interface InlineActivityEditorProps {
  activity: CalendarPlanActivity;
  onSave: (updates: Partial<CalendarPlanActivity & { angle?: string; cta?: string }>) => void;
  onCancel: () => void;
  compact?: boolean;
}

export function InlineActivityEditor({
  activity,
  onSave,
  onCancel,
  compact = false,
}: InlineActivityEditorProps) {
  const [title, setTitle] = useState(activity.title ?? activity.theme ?? '');
  const [angle, setAngle] = useState((activity as CalendarPlanActivity & { angle?: string }).angle ?? '');
  const [cta, setCta] = useState(
    (activity as CalendarPlanActivity & { cta?: string }).cta ??
      (activity as CalendarPlanActivity & { objective?: string }).objective ??
      ''
  );

  useEffect(() => {
    setTitle(activity.title ?? activity.theme ?? '');
    setAngle((activity as CalendarPlanActivity & { angle?: string }).angle ?? '');
    setCta(
      (activity as CalendarPlanActivity & { cta?: string }).cta ??
        (activity as CalendarPlanActivity & { objective?: string }).objective ??
        ''
    );
  }, [activity.execution_id, activity.title, activity.theme]);

  const handleSave = () => {
    onSave({
      title: title.trim() || undefined,
      theme: title.trim() || undefined,
      ...(angle !== undefined && { angle } as { angle?: string }),
      ...(cta !== undefined && { objective: cta, cta } as { objective?: string; cta?: string }),
    } as Partial<CalendarPlanActivity & { angle?: string; cta?: string }>);
  };

  const baseInput =
    'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500';
  const compactInput = compact ? 'px-1.5 py-1 text-xs' : '';

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-indigo-700">Edit activity</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleSave}
            className="p-1.5 rounded hover:bg-indigo-200 text-indigo-700"
            title="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-indigo-200 text-indigo-700"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Activity title / topic"
          className={`${baseInput} ${compactInput}`}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Angle</label>
        <input
          type="text"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder="Content angle or focus"
          className={`${baseInput} ${compactInput}`}
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-600 mb-0.5">CTA</label>
        <input
          type="text"
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          placeholder="Call-to-action or objective"
          className={`${baseInput} ${compactInput}`}
        />
      </div>
    </div>
  );
}
