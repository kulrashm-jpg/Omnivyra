import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { isContentType } from '../../../content/core/contentTypes';
import { BlockRenderer } from '../../../content/render/renderer';
import { formatToBlocks } from '../../../content/engine/formatter';
import { sanitizeBlocks } from '../../../content/engine/sanitizer';
import { validateContentOrThrow } from '../../../content/core/contentValidator';
import type { ContentBlock } from '../../../lib/blog/blockTypes';

type ContentPost = {
  title: string;
  slug: string;
  excerpt?: string | null;
  content_html?: string | null;
  content_blocks?: unknown;
};

export default function ContentDetailPage() {
  const router = useRouter();
  const type = router.query.type;
  const slug = typeof router.query.slug === 'string' ? router.query.slug : '';
  const contentType = isContentType(type) ? type : null;
  const [post, setPost] = useState<ContentPost | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);

  useEffect(() => {
    if (!contentType || !slug) return;
    const endpoint = contentType === 'blog'
      ? `/api/blog/${encodeURIComponent(slug)}`
      : `/api/company/blogs/resolve?slug=${encodeURIComponent(slug)}&content_type=${encodeURIComponent(contentType)}`;

    fetch(endpoint, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const nextPost = payload?.post || payload;
        setPost(nextPost || null);
        if (Array.isArray(nextPost?.content_blocks)) {
          setBlocks(sanitizeBlocks(validateContentOrThrow({
            type: contentType,
            blocks: nextPost.content_blocks,
            state: 'validated',
          }).blocks));
        } else if (typeof nextPost?.content_html === 'string') {
          setBlocks(sanitizeBlocks(validateContentOrThrow({
            type: contentType,
            blocks: formatToBlocks(nextPost.content_html),
            state: 'validated',
          }).blocks));
        }
      })
      .catch(() => {
        setPost(null);
        setBlocks([]);
      });
  }, [contentType, slug]);

  if (!contentType) {
    return <ContentNotFound />;
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
  const canonical = `${siteUrl}/content/${contentType}/${encodeURIComponent(slug)}`;

  return (
    <>
      <Head>
        <title>{post?.title || 'Content'} | Omnivyra</title>
        <link rel="canonical" href={canonical} />
      </Head>
      <main className="min-h-screen bg-white px-6 py-12">
        <article className="mx-auto max-w-3xl">
          <Link href={`/content/${contentType}`} className="text-sm font-medium text-blue-700 hover:underline">
            Back
          </Link>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-950">{post?.title || 'Loading...'}</h1>
          {post?.excerpt && <p className="mt-4 text-lg leading-8 text-slate-600">{post.excerpt}</p>}
          <div className="mt-10">
            <BlockRenderer blocks={blocks} />
          </div>
        </article>
      </main>
    </>
  );
}

function ContentNotFound() {
  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-950">Content not found</h1>
      </div>
    </main>
  );
}
