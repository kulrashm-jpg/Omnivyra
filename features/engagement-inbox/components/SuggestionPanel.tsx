import { Sparkles } from 'lucide-react';

export interface SuggestionPanelProps {
  suggestion: string | null;
  suggestionModel: string | null;
  suggestionBusy: boolean;
  suggestionError: string | null;
  onGenerate: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}

export default function SuggestionPanel({
  suggestion,
  suggestionModel,
  suggestionBusy,
  suggestionError,
  onGenerate,
  onAccept,
  onDismiss,
}: SuggestionPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-700">
          AI suggestion
        </label>
        <button
          type="button"
          disabled={suggestionBusy}
          onClick={onGenerate}
          className="text-xs text-indigo-600 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Sparkles className="h-3 w-3" />
          {suggestionBusy ? 'Generating...' : suggestion ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {suggestion && (
        <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 space-y-2">
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{suggestion}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAccept}
              className="px-2 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-700"
            >
              Use suggestion
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-2 py-1 rounded border border-gray-300 text-xs hover:bg-white"
            >
              Dismiss
            </button>
            {suggestionModel && (
              <span className="text-[10px] text-gray-500 ml-auto">model: {suggestionModel}</span>
            )}
          </div>
        </div>
      )}
      {suggestionError && (
        <p className="text-xs text-red-600">{suggestionError}</p>
      )}
    </>
  );
}
