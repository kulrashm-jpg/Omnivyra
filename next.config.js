/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  experimental: {
    webpackBuildWorker: true,
  },
  turbopack: {},
  // Don't bundle server-only packages - they use Node built-ins or are API-route-only.
  serverExternalPackages: [
    'bullmq', 'ioredis',
    'pdfkit',       // PDF generation - API routes only
    'axios',        // Used only in backend adapters / API routes
    'express',      // Extension worker server
    'firebase-admin', // Server-side Firebase (being phased out)
    'pg',           // Direct Postgres client
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  rewrites: async () => [
    { source: '/health', destination: '/api/health' },
    { source: '/blog/rss.xml', destination: '/api/blog/rss' },
    { source: '/blog/sitemap.xml', destination: '/api/blog/sitemap' },
  ],
  headers: async () => [
    {
      source: '/content-creation',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
    {
      source: '/command-center/bolt-text-strategy',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
    {
      source: '/content-studio/post',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
    {
      source: '/threads/:path(generate|template|suggestions)',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
    {
      source: '/blogs',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
  ],
  redirects: async () => [
    { source: '/blogs', destination: '/blogs/create', permanent: false },
    { source: '/content-creation', destination: '/posts/create', permanent: false },
    { source: '/content-studio/post', destination: '/posts/create', permanent: false },
    { source: '/threads/generate', destination: '/threads/intelligence', permanent: false },
    { source: '/threads/template', destination: '/threads/intelligence', permanent: false },
    { source: '/threads/suggestions', destination: '/threads/intelligence', permanent: false },
    { source: '/command-center/bolt-text-strategy', destination: '/command-center/bolt-text', permanent: false },
  ],
  webpack: (config, { isServer, dev }) => {
    if (dev && !isServer && config.cache && config.cache.type === 'filesystem') {
      // Avoid intermittent Windows rename failures under .next/dev/cache/webpack.
      config.cache = { type: 'memory' };
    }

    if (isServer) {
      config.externals = config.externals || [];
      // Node built-ins (and node: prefixed) for bullmq, ioredis, tokenStore, etc.
      const nodeBuiltins = [
        'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
        'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'querystring', 'stream',
        'string_decoder', 'timers', 'tls', 'url', 'util', 'worker_threads', 'zlib',
      ];
      nodeBuiltins.forEach((mod) => {
        if (!config.externals.includes(mod)) config.externals.push(mod);
        const nodePrefixed = `node:${mod}`;
        if (!config.externals.includes(nodePrefixed)) config.externals.push(nodePrefixed);
      });
      // Resolve node: URIs to standard modules (for UnhandledSchemeError)
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      nodeBuiltins.forEach((mod) => {
        config.resolve.alias[`node:${mod}`] = mod;
      });
    }
    return config;
  },
};

module.exports = nextConfig;
