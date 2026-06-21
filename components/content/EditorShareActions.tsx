import React, { useState } from 'react';
import { CheckCircle2, Copy, Download, FileText, Loader2, PenTool, Share2 } from 'lucide-react';

type MarkUsedOption = {
  label: string;
  value?: string;
};

type Props = {
  saved: boolean;
  copyText: string;
  exportText: string;
  exportFileName: string;
  downloads?: Array<{
    label: string;
    fileName: string;
    content: string;
    mimeType: string;
  }>;
  shareDisabledReason?: string | null;
  publishDestinations?: Array<{ key: string; label: string; detail?: string; onClick: () => void | Promise<void> }>;
  repurposeDestinations?: Array<{ key: string; label: string; detail?: string; onClick: () => void | Promise<void> }>;
  assetDestinations?: Array<{ key: string; label: string; detail?: string; onClick: () => void | Promise<void> }>;
  markUsedOptions: MarkUsedOption[];
  onMarkUsed: (platform?: string) => Promise<void>;
  onPostToSocial?: () => void;
};

export default function EditorShareActions({
  saved,
  copyText,
  exportText,
  exportFileName,
  downloads = [],
  shareDisabledReason = null,
  publishDestinations = [],
  repurposeDestinations = [],
  assetDestinations = [],
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

  const handleDownload = (content: string, fileName: string, mimeType: string) => {
    if (!content.trim()) return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
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

  const actionDisabled = Boolean(shareDisabledReason);

  const renderDestinationGroup = (
    title: string,
    icon: React.ReactNode,
    destinations: Array<{ key: string; label: string; detail?: string; onClick: () => void | Promise<void> }>,
    description?: string,
  ) => {
    if (destinations.length === 0) return null;
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
          {icon}
          {title}
        </div>
        {description ? (
          <p className="mb-2 text-[11px] font-normal leading-snug text-gray-500">{description}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {destinations.map((destination) => (
            <button
              key={destination.key}
              type="button"
              disabled={actionDisabled}
              title={actionDisabled ? shareDisabledReason || undefined : destination.detail}
              onClick={() => void destination.onClick()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block leading-tight">{destination.label}</span>
              {destination.detail ? <span className="block text-[11px] font-normal text-gray-500">{destination.detail}</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
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
        {downloads.map((item) => (
          <button
            key={item.fileName}
            type="button"
            onClick={() => handleDownload(item.content, item.fileName, item.mimeType)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
        {onPostToSocial ? (
          <button
            type="button"
            onClick={onPostToSocial}
            disabled={actionDisabled}
            title={actionDisabled ? shareDisabledReason || undefined : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            Promote on social
          </button>
        ) : null}
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
      {shareDisabledReason ? (
        <p className="mt-3 text-xs font-medium text-amber-700">{shareDisabledReason}</p>
      ) : null}
      {renderDestinationGroup('Publish Blog', <FileText className="h-3.5 w-3.5" />, publishDestinations)}
      {renderDestinationGroup(
        'Promote on social',
        <Share2 className="h-3.5 w-3.5" />,
        repurposeDestinations,
        'Auto-adapt this content into a short, platform-native post that links back — one per connected platform. (Not a re-published article; LinkedIn Articles are manual.)',
      )}
      {renderDestinationGroup(
        'Promote with social assets',
        <PenTool className="h-3.5 w-3.5" />,
        assetDestinations,
        'Turn this content into a standalone visual asset for your connected Instagram / TikTok / Pinterest / YouTube.',
      )}
    </div>
  );
}
