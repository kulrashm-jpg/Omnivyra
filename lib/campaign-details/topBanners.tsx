export function RecommendationOriginBanner({
  fromRecommendation,
  recommendationId,
}: {
  fromRecommendation: boolean;
  recommendationId: string | null;
}) {
  if (!fromRecommendation || !recommendationId) return null;
  return (
    <div className="bg-indigo-50 border-b border-indigo-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 text-sm text-indigo-800">
        Created from Recommendation {recommendationId}
      </div>
    </div>
  );
}

export function CampaignNoticeBanner({
  notice,
}: {
  notice: { type: 'success' | 'error' | 'info'; message: string } | null;
}) {
  if (!notice) return null;
  const noticeClassName =
    notice.type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : notice.type === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-indigo-200 bg-indigo-50 text-indigo-800';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
      <div className={`rounded-lg border px-3 py-2 text-sm ${noticeClassName}`} role="status" aria-live="polite">
        {notice.message}
      </div>
    </div>
  );
}
