import React from 'react';

interface PolicyConfirmModalProps {
  pendingPolicyLabel: string;
  isSavingPolicy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function PolicyConfirmModal({ pendingPolicyLabel, isSavingPolicy, onConfirm, onClose }: PolicyConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Global Policy Change</h3>
          <p className="text-sm text-gray-600 mb-4">
            This will affect ALL tenants and ALL Engagement Center actions.
          </p>
          <div className="text-sm text-gray-700 mb-6">
            Toggle: <span className="font-medium">{pendingPolicyLabel}</span>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { if (!isSavingPolicy) onClose(); }}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isSavingPolicy}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
            >
              {isSavingPolicy ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
