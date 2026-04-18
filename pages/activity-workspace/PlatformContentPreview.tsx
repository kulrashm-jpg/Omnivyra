import React from 'react';

type PlatformContentPreviewProps = {
  platform: string;
  contentType: string;
  content: string;
  hashtags?: string[];
  imageUrl?: string;
};

export default function PlatformContentPreview({
  platform,
  contentType,
  content,
  hashtags,
  imageUrl,
}: PlatformContentPreviewProps) {
  const plat = platform.toLowerCase();
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  const firstLine = lines[0] ?? '';
  const rest = lines.slice(1);
  const hashtagStr = hashtags && hashtags.length > 0 ? hashtags.join(' ') : '';
  const charCount = content.length;

  const imgEl = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="attached" className="mt-2 max-h-48 w-full rounded-lg object-cover" />
  ) : null;

  if (plat === 'twitter' || plat === 'x') {
    const limit = 280;
    const over = charCount > limit;
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm font-sans shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <div className="h-8 w-8 shrink-0 rounded-full bg-gray-200" />
          <div>
            <div className="text-xs font-bold text-gray-900">Your Account</div>
            <div className="text-[10px] text-gray-400">@handle · now</div>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-snug text-gray-900">{content}</p>
        {hashtagStr && <p className="mt-1 text-[12px] text-sky-500">{hashtagStr}</p>}
        {imgEl}
        <div className={`mt-2 text-right text-[10px] ${over ? 'font-semibold text-red-500' : 'text-gray-400'}`}>
          {charCount}/{limit}
        </div>
      </div>
    );
  }

  if (plat === 'linkedin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm font-sans shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-9 w-9 shrink-0 rounded-full bg-blue-100" />
          <div>
            <div className="text-xs font-semibold text-gray-900">Your Name</div>
            <div className="text-[10px] text-gray-400">Your Title · 1st · now</div>
          </div>
        </div>
        {firstLine && <p className="mb-1.5 text-[13px] font-semibold leading-snug text-gray-900">{firstLine}</p>}
        {rest.map((line, index) => (
          <p key={index} className="mb-1 text-[13px] leading-relaxed text-gray-700">
            {line}
          </p>
        ))}
        {hashtagStr && <p className="mt-2 text-[12px] text-blue-600">{hashtagStr}</p>}
        {imgEl}
        <div className="mt-2 text-[10px] text-gray-400">{charCount} chars</div>
      </div>
    );
  }

  if (plat === 'youtube') {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white text-sm font-sans shadow-sm">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="thumbnail" className="max-h-36 w-full object-cover" />
        ) : (
          <div className="flex h-28 items-center justify-center bg-gray-100 text-xs text-gray-400">[Thumbnail]</div>
        )}
        <div className="p-3">
          <div className="mb-1 text-[13px] font-bold leading-snug text-gray-900">{firstLine || contentType}</div>
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-600">{rest.join('\n') || content}</div>
          {hashtagStr && <p className="mt-2 text-[11px] text-blue-500">{hashtagStr}</p>}
        </div>
      </div>
    );
  }

  if (plat === 'instagram' || plat === 'tiktok') {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white text-sm font-sans shadow-sm">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="visual" className="max-h-40 w-full object-cover" />
        ) : (
          <div className="flex h-24 items-center justify-center bg-gray-100 text-xs text-gray-400">[{contentType} visual]</div>
        )}
        <div className="p-3">
          <span className="mr-1 text-[12px] font-semibold text-gray-900">yourhandle</span>
          <span className="whitespace-pre-wrap text-[12px] text-gray-700">{firstLine}</span>
          {rest.length > 0 && <p className="mt-1 text-[12px] text-gray-600">{rest.join(' ')}</p>}
          {hashtagStr && <p className="mt-1 text-[11px] text-blue-500">{hashtagStr}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm font-sans shadow-sm">
      {firstLine && <p className="mb-1.5 text-[13px] font-semibold leading-snug text-gray-900">{firstLine}</p>}
      {rest.map((line, index) => (
        <p key={index} className="mb-1 text-[13px] leading-relaxed text-gray-700">
          {line}
        </p>
      ))}
      {hashtagStr && <p className="mt-2 text-[12px] text-blue-500">{hashtagStr}</p>}
      {imgEl}
      <div className="mt-2 text-[10px] text-gray-400">{charCount} chars</div>
    </div>
  );
}
