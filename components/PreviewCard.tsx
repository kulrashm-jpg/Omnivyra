import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Image as ImageIcon, PlaySquare } from "lucide-react";
import { PlatformConfig } from "../lib/platforms";
import { resolvePlatformCardConfig } from "./preview/platformCardPrimitives";
import PlatformPreview from "./preview/platforms";
import { buildPreviewPayloadFromPlatformPost } from "../lib/preview/normalizedPreviewPayload";

type PlatformKey = string;

interface PostPerPlatform {
  platform: PlatformKey;
  title: string;
  body: string;
  hashtags: string;
  mediaType: "none" | "image" | "video";
}

export default function PreviewCard({ cfg, post }: { cfg: PlatformConfig; post: PostPerPlatform }) {
  // G9.C — resolve visual chrome from the canonical platformCardPrimitives so
  // PreviewCard inherits the same per-platform colors that PostPreviewModal
  // and ThreadSequencePreview use. lib/platforms.ts still owns constraints
  // (hashtagsLimit / textLimit / image aspect ratios) — different concern.
  //
  // Phase 4 (rendering consolidation) — the body now routes through the
  // shared PlatformPreview dispatcher via a normalized payload. The
  // hashtag chip rail + media placeholder stay on this card because
  // they're PreviewCard-specific QA affordances, not part of the
  // platform-faithful body.
  const cardCfg = resolvePlatformCardConfig(cfg.key);
  const previewPayload = buildPreviewPayloadFromPlatformPost({
    platform: cfg.key,
    content: post.body,
    title: post.title,
    hashtags: post.hashtags ? post.hashtags.split(/\s+/).filter(Boolean) : [],
    mediaType: post.mediaType,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={`w-2 h-2 rounded-full ${cardCfg.avatarBg}`}></span>
          {cfg.name} Preview
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs">
          <PlaySquare className="h-3 w-3" />This is a visual approximation for quick QA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border bg-gray-50 overflow-hidden">
          <PlatformPreview payload={previewPayload} />
          {post.hashtags && (
            <div className="flex flex-wrap gap-1 px-4 pb-3">
              {post.hashtags
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, cfg.constraints.hashtagsLimit || 50)
                .map((tag, i) => (
                  <Badge key={i} variant="outline">{tag.startsWith("#") ? tag : `#${tag}`}</Badge>
                ))}
            </div>
          )}
          {post.mediaType !== "none" && (
            <div className="mx-4 mb-4 aspect-video rounded-lg bg-black/5 grid place-items-center text-xs text-gray-500">
              {post.mediaType === "image" ? (
                <>
                  <ImageIcon className="h-5 w-5" />
                  <span>Image placeholder</span>
                </>
              ) : (
                <>
                  <PlaySquare className="h-5 w-5" />
                  <span>Video placeholder</span>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
