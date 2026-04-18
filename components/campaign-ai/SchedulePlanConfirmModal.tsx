import React from 'react';

type SchedulePlanConfirmModalProps = {
  isOpen: boolean;
  isSchedulingPlan: boolean;
  governanceLocked?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SchedulePlanConfirmModal({
  isOpen,
  isSchedulingPlan,
  governanceLocked,
  onCancel,
  onConfirm,
}: SchedulePlanConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Schedule This Plan</h3>
          <p className="text-gray-600">
            This will create scheduled posts for each day and platform in your plan.
          </p>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onCancel}
            disabled={isSchedulingPlan}
            className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSchedulingPlan || governanceLocked}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {isSchedulingPlan ? 'Scheduling...' : 'Confirm & Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
