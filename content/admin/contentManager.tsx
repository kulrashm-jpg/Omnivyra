import Head from 'next/head';
import Link from 'next/link';
import { CONTENT_TYPES } from '../core/contentTypes';

export default function ContentManager() {
  return (
    <>
      <Head>
        <title>Content Manager | Omnivyra</title>
      </Head>
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Content Manager</h1>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(CONTENT_TYPES).map(([type, config]) => (
              <Link
                key={type}
                href={`/content/${type}`}
                className="rounded-lg border border-slate-200 p-5 transition-colors hover:border-blue-300"
              >
                <p className="text-lg font-semibold text-slate-950">{config.label}</p>
                <p className="mt-2 text-sm text-slate-600">{config.supports.join(', ')}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
