/**
 * Content-type classification — single source of truth for "what can Omnivyra
 * build vs. what is a brief the user produces".
 *
 * Wraps the two existing registries (no new taxonomy):
 *  - BOLT Text formats        → boltTextContentConfig (post/tweet/short_story/article/poll)
 *  - BOLT Creator governance  → creatorGovernanceRegistry (Group A autonomous
 *                               vs Group B media-upload-required)
 *
 * Buckets:
 *  - bolt_text          → Omnivyra generates the text (master + variants)
 *  - creator_autonomous → Omnivyra renders the asset (Group A: image/carousel/…)
 *  - video_brief        → NOT built. Hand over theme + marketing package;
 *                         user produces & uploads (Group B: video/reel/short)
 *  - unsupported        → not offered as a buildable card
 */

import { isBoltTextContentType } from '../../backend/utils/boltTextContentConfig';
import {
  getCreatorGovernance,
  type CreatorCanonicalAssetFamily,
} from './creatorGovernanceRegistry';

export type ContentBuildMode =
  | 'bolt_text'
  | 'creator_autonomous'
  | 'video_brief'
  | 'unsupported';

export interface ContentTypeClass {
  mode: ContentBuildMode;
  /** true → Omnivyra generates/renders it in-app; false → handoff brief. */
  builtInOmnivyra: boolean;
  /** Group B: theme + marketing-package handoff, user produces & uploads. */
  isVideoBrief: boolean;
  assetFamily: CreatorCanonicalAssetFamily | null;
  /** Short UI label for cards. */
  label: string;
}

const UNSUPPORTED: ContentTypeClass = {
  mode: 'unsupported',
  builtInOmnivyra: false,
  isVideoBrief: false,
  assetFamily: null,
  label: 'Unsupported',
};

export function classifyContentType(contentType: string | null | undefined): ContentTypeClass {
  const ct = String(contentType ?? '').trim();
  if (!ct) return UNSUPPORTED;

  // BOLT Text wins first (post/tweet/short_story/article/poll + variants).
  if (isBoltTextContentType(ct)) {
    return {
      mode: 'bolt_text',
      builtInOmnivyra: true,
      isVideoBrief: false,
      assetFamily: 'text',
      label: 'Built in Omnivyra',
    };
  }

  const gov = getCreatorGovernance(ct);
  if (gov) {
    // Group B (video/reel/short) — must NOT be auto-built; it's a brief.
    if (gov.media_upload_required || gov.requires_human_production) {
      return {
        mode: 'video_brief',
        builtInOmnivyra: false,
        isVideoBrief: true,
        assetFamily: gov.canonical_asset_family,
        label: 'Brief — you produce & upload',
      };
    }
    // Group A (image/banner/infographic/carousel/pdf/slider) — Omnivyra renders.
    if (gov.autonomous_renderable) {
      return {
        mode: 'creator_autonomous',
        builtInOmnivyra: true,
        isVideoBrief: false,
        assetFamily: gov.canonical_asset_family,
        label: 'Built in Omnivyra',
      };
    }
    // Governed but neither autonomous nor upload-required → safest as a brief.
    return {
      mode: 'video_brief',
      builtInOmnivyra: false,
      isVideoBrief: true,
      assetFamily: gov.canonical_asset_family,
      label: 'Brief — you produce & upload',
    };
  }

  return UNSUPPORTED;
}

/** Convenience: is this content type something Omnivyra builds end-to-end? */
export function isBuiltInOmnivyra(contentType: string | null | undefined): boolean {
  return classifyContentType(contentType).builtInOmnivyra;
}

/** Convenience: is this a Group-B video/handoff brief? */
export function isVideoBriefContentType(contentType: string | null | undefined): boolean {
  return classifyContentType(contentType).isVideoBrief;
}

/**
 * SUPPORTED manual-upload set — the ONLY creator-required types Omnivyra
 * actually supports today: reel, short, video upload. Everything else
 * (image/carousel/text/text+image) is AI-generated and NEVER pending;
 * podcast/webinar/audiogram/teaser/trailer/long-form/vlog/igtv and other
 * generalized "creator" aliases are NOT supported → deliberately removed
 * from runtime creator routing (deactivation, not deletion: the
 * governance registry + DB enums are left intact for compatibility).
 *
 * Tight, anchored matching only — no broad substring creep (the broad
 * alias regex was the source of over-routing).
 */
const SUPPORTED_MANUAL_VIDEO_RE =
  /^(video|videos|video[\s_-]?upload|reel|reels|short|shorts|insta(gram)?[\s_-]?reel|ig[\s_-]?reel|fb[\s_-]?reel|facebook[\s_-]?reel|yt[\s_-]?short|youtube[\s_-]?short|tiktok[\s_-]?video)$/i;

/**
 * The single canonical predicate: is this a supported manual-upload
 * VIDEO type (reel/short/video)? This is the ONLY thing that may be
 * treated as creator-required / pending.
 */
export function isSupportedManualVideoUpload(
  contentType: string | null | undefined,
): boolean {
  const ct = String(contentType ?? '').trim();
  if (!ct) return false;
  return SUPPORTED_MANUAL_VIDEO_RE.test(ct);
}

/**
 * Creator-required detection — NARROWED to the supported manual-upload
 * video set only. Back-compat: same exported name/signature; behavior is
 * now restricted (no more long-form/vlog/webinar/podcast/clip aliases).
 * AI-creatable types (image/carousel/text+image) return false → they are
 * never pending and never counted as creator-required.
 */
export function isCreatorRequiredContentType(
  contentType: string | null | undefined,
): boolean {
  return isSupportedManualVideoUpload(contentType);
}
