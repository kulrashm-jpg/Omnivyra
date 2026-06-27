/**
 * G10.A — Canonical asset → content conversion adapters.
 *
 * Single forward-looking surface for turning one or more CreatorAttachment
 * assets into a draft of any supported content type (post, thread, longform).
 * Reuses the existing prefill payload shapes for each target — does NOT
 * introduce new editors, new routes, new payload contracts, or new APIs.
 *
 *   buildPostPrefillFromAssets()     → ShortformPayload stub for /posts/result
 *   buildThreadPrefillFromAssets()   → ThreadSession + ThreadGenerationPayload for /threads/result
 *   buildLongformPrefillFromAssets() → BlogGenerationOutput stub for /{targetType}/new
 *   launchAssetConversion()          → entry point: builds + writes + navigates
 *
 * The Post adapter wraps `buildShortformManualStub` (G18.3) and adds the
 * asset(s) as both:
 *   - `creator_attachment_metadata` on the payload (consumed by the scheduler)
 *   - canonical Creator Assets registered in the Library + Usage Graph (so the
 *     graph-backed result page picks them up via listAssetsForConsumer → resolver)
 *
 * The Thread adapter writes a single ThreadNode (position 0) carrying the
 * assets via Phase 1A's `ThreadNode.attachments` field. Users can split into
 * more nodes inside the segments editor.
 *
 * The Longform adapter projects each asset into an `image` ContentBlock and
 * prepends them to the default editor template, then writes the
 * `BlogGenerationOutput`-shaped stub at the per-type editor's expected key.
 *
 * Creation mode:
 *   - 'manual'      → asset is the seed; user writes text in the editor / scheduler
 *   - 'ai-assisted' → routes to the AI intelligence entry with assets preserved
 *                     for re-attachment after generation. This phase does NOT
 *                     trigger AI generation — the existing intelligence/AI flow
 *                     handles that step.
 */

import type { NextRouter } from 'next/router';
import type { CreatorAttachment } from '../preview/unifiedPreviewContract';
import { buildShortformManualStub } from './shortformManualStub';
import {
  createWriterSourceId,
  type WriterAttachedAsset,
  type WriterSourceType,
} from './writerCreatorAssetLaunch';
import { registerGeneratedAsset } from './creatorAssetLibrary';
import { attachUsage, writerDraftConsumer } from './creatorAssetUsageGraph';

/**
 * Bridge converted assets onto the canonical pipeline: each becomes a canonical
 * Creator Asset (Library, with id/version dedup) and a relationship edge (Usage
 * Graph). They then appear in the Library / Resolver / Catalog / Graph with no
 * extra sync — no legacy `appendWriterAttachedAsset`, no relationship storage here.
 * Fired before navigation; the (graph-backed) result page reads after navigation,
 * so registration completes first.
 */
async function bridgeConvertedAssetsToGraph(
  sourceType: WriterSourceType,
  sourceId: string,
  assets: WriterAttachedAsset[],
): Promise<void> {
  const consumer = writerDraftConsumer(sourceType, sourceId);
  // newest-first display: attach in reverse so the first asset gets the top slot.
  for (let i = assets.length - 1; i >= 0; i -= 1) {
    const asset = assets[i];
    if (!asset?.id) continue;
    // registerGeneratedAsset dedups by id — a re-converted asset reuses the
    // canonical asset (new version), never a duplicate.
    const { ref } = await registerGeneratedAsset(asset);
    await attachUsage(ref, consumer, { role: 'attachment' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical conversion payload
// ─────────────────────────────────────────────────────────────────────────────

export type AssetConversionTargetType =
  | 'post'
  | 'thread'
  | 'article'
  | 'guide'
  | 'newsletter'
  | 'case-study'
  | 'whitepaper'
  | 'story';

export type AssetConversionCreationMode = 'manual' | 'ai-assisted';

export type AssetConversionPayload = {
  sourceAssets: CreatorAttachment[];
  targetType: AssetConversionTargetType;
  creationMode: AssetConversionCreationMode;
  /** Optional pre-existing text the user already wrote (asset + manual text). */
  prefill?: {
    text?: string;
    threadNodes?: import('../preview/unifiedPreviewContract').ThreadNode[];
    /** Default platform for the post/thread variant. */
    platform?: string;
    /** Title / topic hint */
    topic?: string;
    /** Free-form metadata passed through (e.g., format_type for longform) */
    metadata?: Record<string, unknown>;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-target builder results
// ─────────────────────────────────────────────────────────────────────────────

export type AdapterTarget = {
  /** Final navigation path */
  pathname: string;
  /** Query params (next/router-compatible) */
  query: Record<string, string>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeRandomToken(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function pickAssetPreviewUrl(asset: CreatorAttachment): string | null {
  return asset.previewUrl || asset.thumbnailUrl || null;
}

/** Project CreatorAttachment[] into the WriterAttachedAsset payload shape that
 *  `bridgeConvertedAssetsToGraph` registers as canonical Creator Assets. */
function projectToWriterAttachedAssets(assets: CreatorAttachment[]): WriterAttachedAsset[] {
  return assets.map((a) => ({
    id: a.id,
    creatorType: (a.assetType as WriterAttachedAsset['creatorType']) || 'supporting_image',
    title: a.title || 'Attached asset',
    url: pickAssetPreviewUrl(a) || undefined,
    files: [],
    previewKind: a.mediaKind,
    attachmentMode: a.attachmentMode,
    createdAt: new Date().toISOString(),
  }));
}

/** Project CreatorAttachment[] into the `creator_attachment_metadata` JSONB shape
 *  the scheduler endpoint already accepts. Conservative — only fields the
 *  scheduler validator currently reads. */
function projectToCreatorAttachmentMetadata(assets: CreatorAttachment[]): Array<Record<string, unknown>> {
  return assets.map((a) => ({
    id: a.id,
    creatorType: a.assetType || 'supporting_image',
    attachmentMode: a.attachmentMode || 'supporting_visual',
    asset_composition_intent: {
      assetType: a.assetType || 'supporting_image',
      attachmentMode: a.attachmentMode || 'supporting_visual',
    },
    render_manifest: pickAssetPreviewUrl(a) ? { previewUrl: pickAssetPreviewUrl(a) } : {},
    validation_manifest: {},
    renderer_id: null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST adapter
// ─────────────────────────────────────────────────────────────────────────────

export function buildPostPrefillFromAssets(payload: AssetConversionPayload): {
  token: string;
  target: AdapterTarget;
} {
  const platform = payload.prefill?.platform || 'linkedin';
  const topic = payload.prefill?.topic || `Post from ${payload.sourceAssets[0]?.title || 'asset'}`;
  const stub = buildShortformManualStub({
    platform,
    topic,
    formatFamily: 'authority-post',
  });

  // Extend the stub with attachment metadata. ShortformPayload type doesn't
  // declare this field but the sessionStorage payload is read-through to the
  // scheduler, which DOES consume creator_attachment_metadata.
  const extended = {
    ...stub,
    creator_attachment_metadata: projectToCreatorAttachmentMetadata(payload.sourceAssets),
    // Reuse the existing user-text prefill if provided (post + manual caption).
    output: {
      ...stub.output,
      platform_variant: {
        ...stub.output.platform_variant,
        generated_content: payload.prefill?.text || '',
      },
    },
  };

  const token = safeRandomToken('post_from_assets');

  // Register converted assets as canonical Creator Assets + Usage-Graph edges, so
  // the (graph-backed) result page picks them up automatically — no legacy store.
  if (typeof window !== 'undefined') {
    const sourceId = createWriterSourceId('post', token);
    const writerAssets = projectToWriterAttachedAssets(payload.sourceAssets);
    void bridgeConvertedAssetsToGraph('post', sourceId, writerAssets);
    try {
      window.sessionStorage.setItem(token, JSON.stringify(extended));
    } catch {
      // Non-fatal — result page will fall through to standard empty state.
    }
  }

  return {
    token,
    target: {
      pathname: '/posts/result',
      query: { prefill: token },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THREAD adapter
// ─────────────────────────────────────────────────────────────────────────────

export function buildThreadPrefillFromAssets(payload: AssetConversionPayload): {
  sessionToken: string;
  target: AdapterTarget;
} {
  const platform = (payload.prefill?.platform === 'linkedin' ? 'linkedin' : 'x') as 'x' | 'linkedin';
  const topic = payload.prefill?.topic || `Thread from ${payload.sourceAssets[0]?.title || 'asset'}`;
  const sessionToken = safeRandomToken('thread_session');
  const resultKey = `thread_result_${sessionToken}`;

  // Use Phase 1A's ThreadNode.attachments to carry assets on the first node.
  // If caller supplied threadNodes, attach assets to node 0; otherwise create
  // a single-node sequence.
  const baseNodes = payload.prefill?.threadNodes && payload.prefill.threadNodes.length > 0
    ? payload.prefill.threadNodes
    : [{ id: `${sessionToken}-seg-0`, position: 0, content: payload.prefill?.text || '', platform }];

  const nodesWithAssets = baseNodes.map((node, idx) => idx === 0
    ? { ...node, attachments: payload.sourceAssets }
    : node);

  const session = {
    createdAt: new Date().toISOString(),
    executionMode: 'manual' as const,
    topic,
    format: 'explainer-thread' as const,
    formatLabel: 'Asset-led Thread',
    intent: 'educate' as const,
    intentLabel: 'Teach something clearly',
    platform,
    platformLabel: platform === 'linkedin' ? 'LinkedIn' : 'X',
    objective: `Thread anchored by ${payload.sourceAssets.length} attached asset(s).`,
    audience: 'Audience aligned to the asset context',
    tone: 'Clear, high-signal, momentum-building',
    cta: 'Invite readers to react, reply, or follow for the next step',
    extraInstruction: '',
    companyName: 'Your company',
    anchor: 'market' as const,
    anchorLabel: 'Market',
    anchorFocus: 'Anchor the thread to the assets attached to its first post.',
    productsServices: '',
    brandVoice: '',
  };

  // Stub generation result so /threads/result skips the AI generation effect
  // (same pattern as G17 manual mode).
  const generationStub = {
    output: {
      success: true as const,
      content_type: 'thread' as const,
      template_used: 'Asset-led Thread',
      master_content: {
        content: payload.prefill?.text || '',
        decision_trace: {
          objective: session.objective,
          writing_angle: session.intentLabel,
          tone_used: session.tone,
        },
      },
      platform_variant: {
        platform,
        generated_content: nodesWithAssets.map((n) => n.content).join('\n\n'),
        discoverability_meta: { hashtags: [] },
        adaptation_trace: {
          style_strategy: 'Asset-led manual thread — written without AI generation.',
          format_family: 'asset-led',
          actual_length_used: null,
        },
      },
    },
    session,
  };

  // Register converted assets canonically (Library + Usage Graph) for the
  // graph-backed result page — no legacy attachment store.
  if (typeof window !== 'undefined') {
    const sourceId = createWriterSourceId('thread' as WriterSourceType, sessionToken);
    const writerAssets = projectToWriterAttachedAssets(payload.sourceAssets);
    void bridgeConvertedAssetsToGraph('thread' as WriterSourceType, sourceId, writerAssets);
    try {
      window.sessionStorage.setItem(sessionToken, JSON.stringify(session));
      window.sessionStorage.setItem(resultKey, JSON.stringify(generationStub));
    } catch {
      // Non-fatal — result page will fall back to its empty session state.
    }
  }

  return {
    sessionToken,
    target: {
      pathname: '/threads/result',
      query: { session: sessionToken },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LONGFORM adapter
// ─────────────────────────────────────────────────────────────────────────────

const LONGFORM_EDITOR_PATHS: Record<Exclude<AssetConversionTargetType, 'post' | 'thread'>, string> = {
  article: '/articles/new',
  guide: '/guides/new',
  newsletter: '/newsletters/new',
  'case-study': '/case-studies/new',
  whitepaper: '/whitepapers/new',
  story: '/stories/new',
};

export function buildLongformPrefillFromAssets(payload: AssetConversionPayload): {
  token: string;
  target: AdapterTarget;
} {
  if (payload.targetType === 'post' || payload.targetType === 'thread') {
    throw new Error(`buildLongformPrefillFromAssets: ${payload.targetType} is not a longform type`);
  }

  const editorPath = LONGFORM_EDITOR_PATHS[payload.targetType];
  const title = payload.prefill?.topic || `${payload.targetType.replace('-', ' ')} from attached assets`;

  // Project each asset to an ImageBlock at the top of the editor's content_blocks.
  // The editor's resolveGeneratedPrefillBlocks consumes content_blocks as-is.
  const assetImageBlocks = payload.sourceAssets
    .map((asset, idx) => {
      const url = pickAssetPreviewUrl(asset);
      if (!url) return null;
      return {
        id: `asset-image-${idx}-${Date.now()}`,
        type: 'image' as const,
        url,
        alt: asset.title || asset.assetType || 'Attached asset',
        caption: asset.title || undefined,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const stub = {
    output: {
      title,
      excerpt: '',
      content_html: '',
      tags: [],
      category: '',
      seo_meta_title: title,
      seo_meta_description: '',
      key_insights: [],
      content_blocks: assetImageBlocks,
    },
    source: 'asset_conversion',
    target_word_count: 1200,
    format_type: String(payload.prefill?.metadata?.format_type ?? ''),
    template_name: 'Asset starter',
  };

  const token = safeRandomToken(`${payload.targetType.replace(/[^a-z]/g, '_')}_from_assets`);

  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(token, JSON.stringify(stub));
    } catch {
      // Non-fatal — editor will fall back to its default template.
    }
  }

  return {
    token,
    target: {
      pathname: editorPath,
      query: { prefill: token },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export function launchAssetConversion(router: NextRouter, payload: AssetConversionPayload): void {
  if (!payload.sourceAssets || payload.sourceAssets.length === 0) {
    throw new Error('launchAssetConversion: sourceAssets is empty');
  }

  // 'ai-assisted' mode routes to the AI intelligence entry instead of the
  // editor. This phase does not invoke AI generation — the intelligence page
  // hosts the existing AI flow. Attachments are preserved via the same writer-
  // attached-assets localStorage path as 'manual' mode.
  if (payload.creationMode === 'ai-assisted') {
    if (typeof window !== 'undefined' && payload.targetType !== 'thread') {
      const sourceType: WriterSourceType = payload.targetType === 'post' ? 'post' : 'post';
      const sourceId = createWriterSourceId(sourceType, safeRandomToken('ai_assist'));
      const writerAssets = projectToWriterAttachedAssets(payload.sourceAssets);
      void bridgeConvertedAssetsToGraph(sourceType, sourceId, writerAssets);
    }
    const intelligencePath = payload.targetType === 'thread'
      ? '/threads/intelligence'
      : `/${payload.targetType === 'case-study' ? 'case-studies' : `${payload.targetType}s`}/intelligence`;
    void router.push({ pathname: intelligencePath });
    return;
  }

  // 'manual' mode: build prefill stub + navigate to editor/result page.
  if (payload.targetType === 'post') {
    const { target } = buildPostPrefillFromAssets(payload);
    void router.push(target);
    return;
  }

  if (payload.targetType === 'thread') {
    const { target } = buildThreadPrefillFromAssets(payload);
    void router.push(target);
    return;
  }

  const { target } = buildLongformPrefillFromAssets(payload);
  void router.push(target);
}
