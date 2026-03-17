import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Image as ImageIcon, PlaySquare } from "lucide-react";
import { PlatformConfig } from "../lib/platforms";
import ContentRenderer from "./ContentRenderer";

type PlatformKey = string;

interface PostPerPlatform {
  platform: PlatformKey;
  title: string;
  body: string;
  hashtags: string;
  mediaType: "none" | "image" | "video";
}

function badgeBg(color: string) {
  return `bg-${color}`;
}

export default function PreviewCard({ cfg, post }: { cfg: PlatformConfig; post: PostPerPlatform }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={`w-2 h-2 rounded-full ${badgeBg(cfg.color)}`}></span>
          {cfg.name} Preview
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs">
          <PlaySquare className="h-3 w-3" />This is a visual approximation for quick QA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border p-4 space-y-2 bg-gray-50">
          {post.title && <p className="font-semibold">{post.title}</p>}
          {post.body && (
            <ContentRenderer
              content={post.body}
              platform={post.platform}
              renderMode="social"
            />
          )}
          {post.hashtags && (
            <div className="flex flex-wrap gap-1 mt-2">
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
            <div className="mt-3 aspect-video w-full rounded-lg bg-black/5 grid place-items-center text-xs text-gray-500">
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