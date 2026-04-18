import React, { useState } from 'react';
import { CheckCircle2, Copy, Download, Loader2, Share2 } from 'lucide-react';

type MarkUsedOption = {
  label: string;
  value?: string;
};

type Props = {
  saved: boolean;
  copyText: string;
  exportText: string;
  exportFileName: string;
  markUsedOptions: MarkUsedOption[];
  onMarkUsed: (platform?: string) => Promise<void>;
  onPostToSocial: () => void;
};

export default function EditorShareActions({
  saved,
  copyText,
  exportText,
  exportFileName,
  markUsedOptions,
  onMarkUsed,
  onPostToSocial,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showUseMenu, setShowUseMenu] = useState(false);
  const [markingUsed, setMarkingUsed] = useState(false);

  const handleCopy = async () => {
    if (!copyText.trim()) return;
    await navigator.clipboard.writeText(copyText).catch(() => null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleExport = () => {
    if (!exportText.trim()) return;
    const blob = new Blob([exportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleMarkUsed = async (platform?: string) => {
    setMarkingUsed(true);
    try {
      await onMarkUsed(platform);
      setShowUseMenu(false);
    } finally {
      setMarkingUsed(false);
    }
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Use / Share</h3>
        {saved ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Saved</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy Content'}
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <button
          type="button"
          onClick={onPostToSocial}
          className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
        >
          <Share2 className="h-3.5 w-3.5" />
          Post to social
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUseMenu((current) => !current)}
            disabled={markingUsed}
            className="flex items-center gap-1.5 rounded-lg bg-[#0B5ED7] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {markingUsed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Mark as Used
          </button>
          {showUseMenu ? (
            <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {markUsedOptions.map((option) => (
                <button
                  key={option.value || 'general'}
                  type="button"
                  onClick={() => void handleMarkUsed(option.value)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
