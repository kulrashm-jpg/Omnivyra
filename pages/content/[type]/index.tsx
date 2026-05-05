import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { CONTENT_TYPES, isContentType } from '../../../content/core/contentTypes';

type ContentPost = {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  category?: string | null;
  published_at?: string | null;
};

export default function ContentTypeIndexPage() {
  const router = useRouter();
  const type = router.query.type;
  const contentType = isContentType(type) ? type : null;
  const [posts, setPosts] = useState<ContentPost[]>([]);

  useEffect(() => {
    if (!contentType) return;
    const endpoint = contentType === 'blog'
      ? '/api/blog?limit=24'
      : `/api/company/blogs?content_type=${encodeURIComponent(contentType)}`;

    fetch(endpoint, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : { posts: [] })
      .then((payload) => setPosts(Array.isArray(payload.posts) ? payload.posts : payload.blogs || []))
      .catch(() => setPosts([]));
  }, [contentType]);

  if (!contentType) {
    return <ContentNotFound />;
  }

  const label = CONTENT_TYPES[contentType].label;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
  const canonical = `${siteUrl}/content/${contentType}`;

  return (
    <>
      <Head>
        <title>{label} | Omnivyra</title>
        <link rel="canonical" href={canonical} />
      </Head>
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{label}</h1>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/content/${contentType}/${encodeURIComponent(post.slug)}`}
                className="rounded-lg border border-slate-200 p-5 transition-colors hover:border-blue-300"
              >
                <p className="text-lg font-semibold text-slate-950">{post.title}</p>
                {post.excerpt && <p className="mt-2 text-sm leading-6 text-slate-600">{post.excerpt}</p>}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function ContentNotFound() {
  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-950">Content type not found</h1>
      </div>
    </main>
  );
}
