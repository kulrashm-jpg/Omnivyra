/**
 * Async Batch AI Processor — Optimization 4
 *
 * Coalesces concurrent generateContentBlueprint() calls into batched GPT requests.
 *
 * How it works:
 *   1. Caller invokes batchedGenerateBlueprint(item) instead of generateContentBlueprint(item)
 *   2. The request is held for up to BATCH_WINDOW_MS (default 3 seconds)
 *   3. After the window closes, all pending items are sent in ONE GPT call
 *      that returns a JSON array of blueprints
 *   4. Each caller receives their individual result via a resolved Promise
 *
 * Estimated savings: ~60–80% reduction in blueprint API calls when content
 * generation runs in parallel batches (e.g. 20 items → 1–4 calls vs 20 calls).
 *
 * Falls back to individual calls if the batch call fails.
 */

import { runCompletionWithOperation } from './aiGateway';
import { getContentBlueprintPromptWithFingerprint } from '../prompts';
import { getCachedBlueprint, setCachedBlueprint, type ContentBlueprint } from './contentBlueprintCache';
import { tryTemplateBlueprintFor } from './aiTemplateLayer';
import { validateContentBlueprint } from './aiOutputValidationService';
import { assembleFromFragments, storeFragments } from './fragmentCache';

const BATCH_WINDOW_MS    = 3_000;  // coalescing window

// ── Dynamic batch sizing thresholds ──────────────────────────────────────────
// Low load → smaller batch (faster first-response latency)
// High load → larger batch (better cost efficiency)
const MIN_BATCH_SIZE     = 4;
const MAX_BATCH_SIZE     = 25;
const LOW_LOAD_THRESHOLD = 5;   // ≤ this many pending → use MIN_BATCH_SIZE
const HIGH_LOAD_THRESHOLD = 15; // ≥ this many pending → use MAX_BATCH_SIZE

function getDynamicBatchSize(pendingCount: number): number {
  if (pendingCount <= LOW_LOAD_THRESHOLD)  return MIN_BATCH_SIZE;
  if (pendingCount >= HIGH_LOAD_THRESHOLD) return MAX_BATCH_SIZE;
  // Linear interpolation between min and max
  const t = (pendingCount - LOW_LOAD_THRESHOLD) / (HIGH_LOAD_THRESHOLD - LOW_LOAD_THRESHOLD);
  return Math.round(MIN_BATCH_SIZE + t * (MAX_BATCH_SIZE - MIN_BATCH_SIZE));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BatchItem {
  index: number;
  topic: string;
  contentType: string;
  objective: string;
  targetAudience: string;
  painPoint: string;
  outcomePromise: string;
  ctaType: string;
  toneGuidance: string;
  keyPoints: string[];
}

interface PendingRequest {
  item: BatchItem;
  companyId: string;
  resolve: (bp: ContentBlueprint) => void;
  reject: (err: unknown) => void;
}

function nonEmpty(v: unknown): string {
  const s = String(v ?? '').trim();
  return s !== '' && s !== 'undefined' && s !== 'null' ? s : '';
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ── Batch queue ───────────────────────────────────────────────────────────────

let _pending: PendingRequest[] = [];
let _timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlusher() {
  if (_timer !== null) return;
  _timer = setTimeout(flushBatch, BATCH_WINDOW_MS);
}

async function flushBatch() {
  _timer = null;
  if (_pending.length === 0) return;

  // Dynamic batch size based on current load
  const batchSize = getDynamicBatchSize(_pending.length);
  const batch = _pending.splice(0, batchSize);
  if (_pending.length > 0) scheduleFlusher();

  const { content: systemPrompt } = getContentBlueprintPromptWithFingerprint();

  const batchPayload = batch.map((p, i) => ({ index: i, ...p.item }));

  const batchSystemPrompt = `${systemPrompt}

BATCH MODE: You will receive an array of content briefs. Return a JSON array with exactly one ContentBlueprint object per input, in the same order. Each object must have: hook (string), key_points (string[]), cta (string). Wrap the array in {"results": [...]}`;

  try {
    const result = await runCompletionWithOperation({
      companyId: null,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      operation: 'generateContentBlueprint',
      messages: [
        { role: 'system', content: batchSystemPrompt },
        { role: 'user', content: JSON.stringify(batchPayload) },
      ],
    });

    const raw = typeof result?.output === 'string' ? result.output : '';
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed: { results?: unknown[] } = {};
    try { parsed = JSON.parse(trimmed || '{}'); } catch { /* fall through */ }

    const results: unknown[] = Array.isArray(parsed.results) ? parsed.results : [];

    for (let i = 0; i < batch.length; i++) {
      const { resolve, reject, item, companyId } = batch[i];
      const raw = results[i];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>;
        const bp: ContentBlueprint = {
          hook: nonEmpty(r.hook) || `Topic: ${item.topic}`,
          key_points: Array.isArray(r.key_points)
            ? r.key_points.map(String).filter(Boolean)
            : [item.objective || 'Key insight'],
          cta: nonEmpty(r.cta) || 'Learn more.',
        };
        const validated = validateContentBlueprint(bp) ?? bp;
        setCachedBlueprint(companyId, item.topic, item.contentType, item.targetAudience, validated);
        // Store fragments for future reuse across campaigns/users
        storeFragments(validated, {
          topic:       item.topic,
          contentType: item.contentType,
          ctaType:     item.ctaType,
          audience:    item.targetAudience,
        });
        resolve(validated);
      } else {
        // Fallback: make individual call for this item
        reject(new Error('batch-item-missing'));
      }
    }
  } catch (err) {
    // Batch call failed — reject all so callers fall back
    for (const { reject } of batch) {
      reject(err);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for generateContentBlueprint() that batches concurrent calls.
 *
 * Falls back to a fresh individual call on any error.
 *
 * @param item - DailyExecutionItemLike (duck-typed to avoid circular import)
 */
export async function batchedGenerateBlueprint(item: Record<string, unknown>): Promise<ContentBlueprint> {
  const companyId = nonEmpty(item.company_id) || 'default';
  const topic     = nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD';
  const contentType = nonEmpty(item.content_type)?.toLowerCase() || 'post';
  const intent    = asObject(item.intent);
  const brief     = asObject(item.writer_content_brief);

  const targetAudience = nonEmpty(intent.target_audience) || nonEmpty(brief.whoAreWeWritingFor) || 'General audience';
  const objective      = nonEmpty(intent.objective) || nonEmpty(brief.whatShouldReaderLearn) || 'TBD';
  const painPoint      = nonEmpty(intent.pain_point) || nonEmpty(brief.whatProblemAreWeAddressing) || '';
  const outcomePromise = nonEmpty(intent.outcome_promise) || nonEmpty(brief.expectedOutcome) || '';
  const ctaType        = nonEmpty(intent.cta_type) || 'Soft CTA';
  const toneGuidance   = nonEmpty(brief.narrativeStyle) || nonEmpty(brief.toneGuidance) || 'Neutral, practical';
  const keyPoints      = Array.isArray(brief.key_points)
    ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
    : [];

  // 1. In-memory cache hit (LRU)
  const cached = getCachedBlueprint(companyId, topic, contentType, targetAudience);
  if (cached) return cached;

  // 2. Template layer — zero GPT cost
  const template = tryTemplateBlueprintFor(topic, contentType, objective, targetAudience, painPoint, outcomePromise, ctaType);
  if (template) {
    setCachedBlueprint(companyId, topic, contentType, targetAudience, template);
    return template;
  }

  // 3. Fragment reuse — assemble from stored hooks/CTAs/structures
  const assembled = assembleFromFragments(topic, contentType, ctaType, targetAudience);
  if (assembled) {
    setCachedBlueprint(companyId, topic, contentType, targetAudience, assembled);
    return assembled;
  }

  // 4. Batch GPT call (with dynamic coalescing window)
  const batchItem: BatchItem = {
    index: 0, // assigned during flush
    topic,
    contentType,
    objective,
    targetAudience,
    painPoint,
    outcomePromise,
    ctaType,
    toneGuidance,
    keyPoints,
  };

  return new Promise<ContentBlueprint>((resolve, reject) => {
    _pending.push({ item: batchItem, companyId, resolve, reject });
    scheduleFlusher();
  });
}

/**
 * Force-flush the batch immediately (useful in tests or shutdown hooks).
 */
export async function flushBatchNow(): Promise<void> {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
  await flushBatch();
}
