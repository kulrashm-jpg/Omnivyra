export type CreatorVisualReviewVerdict = 'unreviewed' | 'approved' | 'revise' | 'weak';

export type CreatorVisualReviewItem = {
  id: string;
  createdAt: string;
  assetType: string;
  platform: string;
  title: string;
  mediaUrl: string;
  caption?: string;
  metadata?: Record<string, unknown>;
  overlayText?: Record<string, unknown>;
  verdict: CreatorVisualReviewVerdict;
  score?: number | null;
  notes?: string;
};

const REVIEW_QUEUE_KEY = 'creator_visual_review_queue_v1';
const MAX_REVIEW_ITEMS = 80;

function readRawQueue(): CreatorVisualReviewItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REVIEW_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as CreatorVisualReviewItem[] : [];
  } catch {
    return [];
  }
}

function writeRawQueue(items: CreatorVisualReviewItem[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REVIEW_QUEUE_KEY, JSON.stringify(items.slice(0, MAX_REVIEW_ITEMS)));
}

export function readCreatorVisualReviewQueue(): CreatorVisualReviewItem[] {
  return readRawQueue();
}

export function appendCreatorVisualReviewCandidate(item: Omit<CreatorVisualReviewItem, 'verdict'> & { verdict?: CreatorVisualReviewVerdict }): void {
  const current = readRawQueue();
  const deduped = current.filter((entry) => entry.id !== item.id && entry.mediaUrl !== item.mediaUrl);
  writeRawQueue([
    {
      ...item,
      verdict: item.verdict || 'unreviewed',
    },
    ...deduped,
  ]);
}

export function updateCreatorVisualReviewItem(
  id: string,
  patch: Partial<Pick<CreatorVisualReviewItem, 'verdict' | 'notes'>>,
): CreatorVisualReviewItem[] {
  const next = readRawQueue().map((item) => (
    item.id === id
      ? { ...item, ...patch }
      : item
  ));
  writeRawQueue(next);
  return next;
}

export function clearCreatorVisualReviewQueue(): void {
  writeRawQueue([]);
}
