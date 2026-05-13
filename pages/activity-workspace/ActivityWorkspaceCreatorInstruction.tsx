import React from 'react';

export default function ActivityWorkspaceCreatorInstruction({
  creatorInstruction,
}: {
  creatorInstruction: Record<string, unknown>;
}) {
  const checklist = Array.isArray(creatorInstruction.executionChecklist)
    ? (creatorInstruction.executionChecklist as string[])
    : [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        {creatorInstruction.objective != null && (
          <div>
            <div className="text-gray-500">Objective</div>
            <div className="text-gray-900">{String(creatorInstruction.objective ?? '-')}</div>
          </div>
        )}
        {creatorInstruction.targetAudience != null && (
          <div>
            <div className="text-gray-500">Audience</div>
            <div className="text-gray-900">{String(creatorInstruction.targetAudience ?? '-')}</div>
          </div>
        )}
        {creatorInstruction.keyMessage != null && (
          <div className="md:col-span-2">
            <div className="text-gray-500">Key message</div>
            <div className="text-gray-900">{String(creatorInstruction.keyMessage ?? '-')}</div>
          </div>
        )}
        {creatorInstruction.expectedOutcome != null && (
          <div className="md:col-span-2">
            <div className="text-gray-500">Expected outcome</div>
            <div className="text-gray-900">{String(creatorInstruction.expectedOutcome ?? '-')}</div>
          </div>
        )}
        {creatorInstruction.formatHint != null && (
          <div className="md:col-span-2">
            <div className="text-gray-500">Format hint</div>
            <div className="text-gray-900">{String(creatorInstruction.formatHint ?? '-')}</div>
          </div>
        )}
        {checklist.length > 0 && (
          <div className="space-y-1 md:col-span-2">
            <div className="text-gray-500">Execution Checklist</div>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-gray-600">
              {checklist.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
