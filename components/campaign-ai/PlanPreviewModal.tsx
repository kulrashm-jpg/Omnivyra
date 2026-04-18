import React from 'react';
import { X } from 'lucide-react';

type PlanPreviewModalProps = {
  isOpen: boolean;
  selectedPlan: string;
  onClose: () => void;
  onSubmit: (selectedPlan: string) => void;
  onSaveForLater: (selectedPlan: string) => void;
};

export function PlanPreviewModal({
  isOpen,
  selectedPlan,
  onClose,
  onSubmit,
  onSaveForLater,
}: PlanPreviewModalProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] mx-4 flex flex-col">
        <div className="bg-indigo-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">Content Plan Preview</h3>
            <p className="text-purple-100 text-sm">Review your campaign plan before committing</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose max-w-none">
            <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
              {selectedPlan}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-2xl">
          <div className="flex justify-between items-center">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => onSubmit(selectedPlan)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
              >
                Submit This Plan
              </button>
              <button
                onClick={() => onSaveForLater(selectedPlan)}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium"
              >
                Save for Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
