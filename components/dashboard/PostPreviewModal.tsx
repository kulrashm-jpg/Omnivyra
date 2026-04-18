import React, { useState } from 'react';
import { Calendar, ExternalLink, Send } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import ContentRenderer from '../ContentRenderer';

export type ActivityEvent = {
  type: 'activity';
  date: string;
  platform: string;
  content?: string | null;
  title: string;
  repurpose_index: number;
  repurpose_total: number;
  campaign_id: string;
  content_type: string;
  execution_id?: string;
  scheduled_post_id?: string;
  status?: string;
  scheduled_for?: string | null;
  is_overdue?: boolean;
};

const PLATFORM_CONFIG: Record<string, {
  headerBg: string;
  avatarBg: string;
  cardBg: string;
  highlightCls: string;
  linkCls: string;
  engagements: string[];
  charLimit?: number;
  fontCls: string;
}> = {
  linkedin: {
    headerBg: 'bg-[#0A66C2] text-white',
    avatarBg: 'bg-[#0A66C2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#0A66C2] font-medium',
    linkCls: 'text-[#0A66C2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Repost', '✉ Send'],
    fontCls: 'font-sans',
  },
  x: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  twitter: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  instagram: {
    headerBg: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white',
    avatarBg: 'bg-gradient-to-br from-purple-500 to-orange-400',
    cardBg: 'bg-white',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['❤ Like', '💬 Comment', '📤 Share', '🔖 Save'],
    fontCls: 'font-sans',
  },
  facebook: {
    headerBg: 'bg-[#1877F2] text-white',
    avatarBg: 'bg-[#1877F2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#1877F2] font-medium',
    linkCls: 'text-[#1877F2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans',
  },
  youtube: {
    headerBg: 'bg-[#FF0000] text-white',
    avatarBg: 'bg-[#FF0000]',
    cardBg: 'bg-[#F9F9F9]',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['👍 Like', '👎 Dislike', '↩ Share', '💾 Save'],
    fontCls: 'font-sans text-[13px]',
  },
  tiktok: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-black',
    highlightCls: 'text-[#FE2C55] font-medium',
    linkCls: 'text-[#FE2C55]',
    engagements: ['❤ Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans text-white',
  },
  pinterest: {
    headerBg: 'bg-[#E60023] text-white',
    avatarBg: 'bg-[#E60023]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#E60023] font-medium',
    linkCls: 'text-[#E60023]',
    engagements: ['❤ Save', '💬 Comment', '↩ Send'],
    fontCls: 'font-sans',
  },
};

const DEFAULT_PLATFORM_CONFIG: typeof PLATFORM_CONFIG[string] = {
  headerBg: 'bg-indigo-600 text-white',
  avatarBg: 'bg-indigo-600',
  cardBg: 'bg-gray-50',
  highlightCls: 'text-indigo-600 font-medium',
  linkCls: 'text-indigo-600',
  engagements: ['❤ Like', '💬 Comment', '↩ Share'],
  fontCls: 'font-sans',
};

interface PostPreviewModalProps {
  event: ActivityEvent;
  onClose: () => void;
  onOpenWorkspace: (evt: ActivityEvent) => void;
  onPublish?: (postId: string) => Promise<{ success: boolean; error?: string }>;
  onReschedule?: (postId: string, newDate: string) => Promise<{ success: boolean; error?: string }>;
}

export default function PostPreviewModal({
  event,
  onClose,
  onOpenWorkspace,
  onPublish,
  onReschedule,
}: PostPreviewModalProps) {
  const [publishState, setPublishState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [publishError, setPublishError] = useState('');
  const [currentStatus, setCurrentStatus] = useState(event.status);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(event.date || '');
  const [rescheduleState, setRescheduleState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [rescheduleError, setRescheduleError] = useState('');

  const canPublish = !!event.scheduled_post_id && !!onPublish && currentStatus !== 'published';
  const canReschedule = !!event.scheduled_post_id && !!onReschedule && currentStatus !== 'published';

  const handlePublish = async () => {
    if (!event.scheduled_post_id || !onPublish) return;
    setPublishState('loading');
    setPublishError('');
    const result = await onPublish(event.scheduled_post_id);
    if (result.success) { setPublishState('success'); setCurrentStatus('published'); }
    else { setPublishState('error'); setPublishError(result.error || 'Failed to publish'); }
  };

  const handleRescheduleConfirm = async () => {
    if (!event.scheduled_post_id || !onReschedule || !rescheduleDate) return;
    setRescheduleState('loading');
    setRescheduleError('');
    const result = await onReschedule(event.scheduled_post_id, rescheduleDate);
    if (result.success) { setRescheduleState('success'); setShowReschedule(false); }
    else { setRescheduleState('error'); setRescheduleError(result.error || 'Failed to reschedule'); }
  };

  const platform = (event.platform || '').toLowerCase().trim();
  const contentType = (event.content_type || 'post').toLowerCase().replace(/[\s-]/g, '_');
  const cfg = PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG;
  const content = event.content?.trim() || null;
  const platformLabel = platform === 'x' ? 'X (Twitter)' : platform.charAt(0).toUpperCase() + platform.slice(1);
  const scheduledDate = event.scheduled_for
    ? new Date(event.scheduled_for).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : event.date || '';
  const showCharCount = cfg.charLimit != null;

  const isLinkedIn = platform === 'linkedin';
  const isX = platform === 'x' || platform === 'twitter';
  const isInstagram = platform === 'instagram';
  const isTikTok = platform === 'tiktok';
  const isYouTube = platform === 'youtube';
  const isFacebook = platform === 'facebook';
  const isPinterest = platform === 'pinterest';
  const isLinkedInArticle = isLinkedIn && contentType === 'article';
  const isVisualMedia = ['reel', 'short', 'video', 'story', 'image', 'carousel'].includes(contentType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={onClose}
    >
      <div
        className={`w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ${
          isTikTok ? 'max-w-xs bg-black rounded-3xl' : 'max-w-md bg-white rounded-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className={`flex items-center justify-between px-4 py-2.5 shrink-0 ${cfg.headerBg}`}>
          <div className="flex items-center gap-2">
            <PlatformIcon platform={platform} size={16} />
            <span className="font-semibold text-sm">{platformLabel}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 capitalize">
              {event.content_type?.replace(/_/g, ' ') || 'post'}
            </span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-base leading-none p-1">✕</button>
        </div>

        {/* Platform Preview */}
        <div className="flex-1 overflow-y-auto">
          {isTikTok && (
            <div className="bg-black relative">
              <div className="relative bg-gradient-to-b from-gray-900 to-black" style={{ aspectRatio: '9/16', maxHeight: '52vh' }}>
                <div className="absolute inset-0 flex flex-col justify-end p-3">
                  <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white border-2 border-white ${cfg.avatarBg}`}>
                      <PlatformIcon platform="tiktok" size={14} />
                    </div>
                    {[['❤', '0'], ['💬', '0'], ['↩', '0'], ['⊕', '']].map(([icon, count], i) => (
                      <div key={i} className="flex flex-col items-center">
                        <span className="text-white text-xl">{icon}</span>
                        {count && <span className="text-white text-[10px]">{count}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="pr-12">
                    <p className="text-white font-semibold text-sm mb-1">@yourbrand</p>
                    <p className="text-white text-xs leading-relaxed line-clamp-3">{content || event.title}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-white text-[10px] opacity-70">♫ Original sound · yourbrand</span>
                    </div>
                  </div>
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20">
                  <PlatformIcon platform="tiktok" size={40} />
                </div>
              </div>
            </div>
          )}

          {isInstagram && (
            <div className="bg-white">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-orange-400 flex items-center justify-center text-white shrink-0">
                    <PlatformIcon platform="instagram" size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-900 leading-none">yourbrand</p>
                    <p className="text-[10px] text-gray-500">{scheduledDate || 'Scheduled'}</p>
                  </div>
                </div>
                <span className="text-gray-400 text-lg">•••</span>
              </div>
              {(isVisualMedia || contentType === 'post') && (
                <div className={`w-full bg-gradient-to-br from-purple-100 via-pink-100 to-orange-100 flex items-center justify-center ${
                  contentType === 'story' ? 'aspect-[9/16] max-h-52' : 'aspect-square'
                }`}>
                  <div className="text-center opacity-40">
                    <PlatformIcon platform="instagram" size={32} />
                    <p className="text-xs text-gray-500 mt-1">
                      {contentType === 'reel' ? 'Reel' : contentType === 'story' ? 'Story' : contentType === 'carousel' ? 'Carousel' : 'Photo'}
                    </p>
                  </div>
                </div>
              )}
              <div className="px-3 pt-2 flex items-center gap-3 text-gray-800">
                <span>❤</span><span>💬</span><span>📤</span>
                <span className="ml-auto">🔖</span>
              </div>
              <div className="px-3 py-2">
                <p className="text-xs text-gray-900"><span className="font-semibold">yourbrand</span> {content ? <span className="line-clamp-3">{content}</span> : <span className="text-gray-400 italic">Write a short caption to preview how this post will read.</span>}</p>
              </div>
            </div>
          )}

          {isX && (
            <div className="bg-white px-4 py-3">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white shrink-0">
                  <PlatformIcon platform="x" size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-sm font-bold text-gray-900">Your Brand</span>
                    <span className="text-sm text-gray-500">@yourbrand</span>
                    <span className="text-gray-400 text-xs ml-auto">{scheduledDate || 'Scheduled'}</span>
                  </div>
                  <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={showCharCount} emptyText="Write the first draft in Workspace to preview how this post will read." className="text-[15px] text-gray-900 leading-relaxed" />
                  {isVisualMedia && (
                    <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 aspect-video flex items-center justify-center">
                      <div className="text-center opacity-40">
                        <PlatformIcon platform="x" size={28} />
                        <p className="text-xs text-gray-500 mt-1">{contentType === 'video' ? 'Video' : 'Media'}</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-5 text-gray-400 text-xs">
                    {['💬 0', '🔁 0', '❤ 0', '🔖', '📤'].map((a, i) => <span key={i}>{a}</span>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLinkedIn && (
            <div className="bg-white">
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${cfg.avatarBg}`}>
                    <PlatformIcon platform="linkedin" size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">Your Brand</p>
                    <p className="text-[11px] text-gray-500 leading-tight">Company · {scheduledDate || 'Scheduled'}</p>
                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5">🌐 Anyone</span>
                  </div>
                  <span className="ml-auto text-gray-400 text-sm shrink-0">•••</span>
                </div>
                {isLinkedInArticle && (
                  <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-5">
                      <p className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide mb-1">Article</p>
                      <p className="text-base font-bold text-gray-900 leading-snug">{event.title}</p>
                      <p className="text-xs text-gray-500 mt-1">Your Brand · LinkedIn Article</p>
                    </div>
                  </div>
                )}
                <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={showCharCount} emptyText="Write the first draft in Workspace to preview how this post will read." className="text-sm text-gray-800 leading-relaxed" />
                {isVisualMedia && !isLinkedInArticle && (
                  <div className="mt-3 rounded-lg overflow-hidden bg-gray-100 aspect-video flex items-center justify-center border border-gray-200">
                    <div className="text-center opacity-40">
                      <PlatformIcon platform="linkedin" size={28} />
                      <p className="text-xs text-gray-500 mt-1">{contentType === 'video' ? 'Video' : contentType === 'carousel' ? 'Carousel' : 'Image'}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t border-gray-100">
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  {cfg.engagements.map((a, i) => <span key={i} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50 rounded">{a}</span>)}
                </div>
              </div>
            </div>
          )}

          {isFacebook && (
            <div className="bg-white">
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#1877F2] flex items-center justify-center text-white shrink-0">
                    <PlatformIcon platform="facebook" size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Your Brand</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1">{scheduledDate || 'Scheduled'} · <span>🌐</span></p>
                  </div>
                  <span className="ml-auto text-gray-400">•••</span>
                </div>
                <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={showCharCount} emptyText="Write the first draft in Workspace to preview how this post will read." className="text-sm text-gray-800 leading-relaxed" />
                {isVisualMedia && (
                  <div className="mt-3 -mx-4 bg-gray-100 aspect-video flex items-center justify-center">
                    <div className="text-center opacity-40">
                      <PlatformIcon platform="facebook" size={32} />
                      <p className="text-xs text-gray-500 mt-1">Photo / Video</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-1 text-xs text-gray-600">
                {cfg.engagements.map((a, i) => <span key={i} className="flex-1 flex items-center justify-center gap-1 py-1 hover:bg-gray-50 rounded font-medium">{a}</span>)}
              </div>
            </div>
          )}

          {isYouTube && (
            <div className="bg-[#F9F9F9]">
              <div className="aspect-video bg-gray-800 flex items-center justify-center relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-14 h-14 bg-[#FF0000] rounded-full flex items-center justify-center opacity-80">
                    <span className="text-white text-xl">▶</span>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 p-3">
                  <p className="text-white text-xs font-medium line-clamp-2">{event.title}</p>
                </div>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-gray-900 leading-snug mb-2 line-clamp-2">{event.title}</p>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#FF0000] flex items-center justify-center text-white shrink-0">
                    <PlatformIcon platform="youtube" size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-900">Your Brand</p>
                    <p className="text-[10px] text-gray-500">Scheduled · {scheduledDate}</p>
                  </div>
                </div>
                <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={false} emptyText="Add a short description in Workspace to preview how viewers will discover this video." className="text-xs text-gray-600 leading-relaxed" />
              </div>
            </div>
          )}

          {isPinterest && (
            <div className="bg-white">
              <div className="aspect-[2/3] max-h-64 bg-gradient-to-br from-rose-100 to-orange-100 flex items-center justify-center rounded-2xl mx-3 mt-3 overflow-hidden">
                <div className="text-center opacity-40">
                  <PlatformIcon platform="pinterest" size={36} />
                  <p className="text-xs text-gray-500 mt-1">Pin Image</p>
                </div>
              </div>
              <div className="px-4 py-3">
                <p className="text-base font-bold text-gray-900 mb-1">{event.title}</p>
                <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={false} emptyText="Add a helpful description in Workspace so this pin is ready to publish." className="text-sm text-gray-600 leading-relaxed" />
              </div>
            </div>
          )}

          {!isTikTok && !isInstagram && !isX && !isLinkedIn && !isFacebook && !isYouTube && !isPinterest && (
            <div className="bg-white p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${cfg.avatarBg}`}>
                  <PlatformIcon platform={platform} size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Your Brand</p>
                  <p className="text-xs text-gray-500">{scheduledDate || 'Scheduled'}</p>
                </div>
              </div>
              <ContentRenderer content={content ?? ''} platform={platform} contentType={contentType} accentBg={cfg.avatarBg} showCharCount={showCharCount} emptyText="Write the first draft in Workspace to preview how this post will read." className={cfg.fontCls} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-4 py-3 border-t border-gray-200 bg-white shrink-0">
          {showReschedule && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none text-gray-800"
                min={new Date().toISOString().slice(0, 10)}
              />
              <button
                onClick={handleRescheduleConfirm}
                disabled={rescheduleState === 'loading' || !rescheduleDate}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50"
              >
                {rescheduleState === 'loading' ? '…' : 'Move'}
              </button>
              <button onClick={() => { setShowReschedule(false); setRescheduleState('idle'); setRescheduleError(''); }} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>
          )}
          {rescheduleState === 'error' && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{rescheduleError}</p>
          )}
          {rescheduleState === 'success' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 font-medium">✓ Post moved to {rescheduleDate}</p>
          )}
          {publishState === 'error' && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{publishError}</p>
          )}
          {publishState === 'success' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 font-medium">✓ Post published successfully!</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap min-w-0">
              {event.repurpose_total > 1 && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                  {event.repurpose_index}/{event.repurpose_total}
                </span>
              )}
              {currentStatus && (
                <span className={`px-2 py-0.5 rounded-full capitalize shrink-0 ${
                  currentStatus === 'published' ? 'bg-emerald-100 text-emerald-700'
                    : event.is_overdue ? 'bg-red-100 text-red-700'
                    : currentStatus === 'scheduled' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {event.is_overdue && currentStatus !== 'published' ? 'overdue' : currentStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {canReschedule && publishState !== 'success' && (
                <button
                  onClick={() => { setShowReschedule((v) => !v); setRescheduleState('idle'); setRescheduleError(''); }}
                  className={`px-2.5 py-1.5 text-sm rounded-lg flex items-center gap-1 transition-colors ${
                    showReschedule ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  title="Reschedule"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Reschedule</span>
                </button>
              )}
              {canPublish && publishState !== 'success' && (
                <button
                  onClick={handlePublish}
                  disabled={publishState === 'loading'}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60 ${
                    event.is_overdue ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {publishState === 'loading'
                    ? <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>Posting...</>
                    : <><Send className="w-3.5 h-3.5" />Post Now</>}
                </button>
              )}
              {publishState !== 'success' && (
                <button
                  onClick={() => onOpenWorkspace(event)}
                  className="px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Workspace</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
