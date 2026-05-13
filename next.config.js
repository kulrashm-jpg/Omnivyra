/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  experimental: {
    webpackBuildWorker: false,
  },
  turbopack: {},
  // Don't bundle server-only packages - they use Node built-ins or are API-route-only.
  serverExternalPackages: [
    'bullmq', 'ioredis',
    'pdfkit',       // PDF generation - API routes only
    'openai',       // AI provider SDK - API routes only
    'sharp',        // Image rendering - API routes only
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
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          'C:/DumpStack.log.tmp',
          'C:/hiberfil.sys',
          'C:/pagefile.sys',
          'C:/swapfile.sys',
          'C:/System Volume Information/**',
        ],
      };
    }

    if (dev && !isServer && config.cache && config.cache.type === 'filesystem') {
      // Avoid intermittent Windows rename failures under .next/dev/cache/webpack.
      config.cache = { type: 'memory' };
    }

    if (isServer) {
      if (!dev) {
        // The production build was timing out in webpack's `minify-js` phase
        // across the large Pages/API server graph. Server bundles are not sent
        // to browsers, so keep client assets minified while skipping server
        // minification to preserve runtime behavior and unblock release builds.
        config.optimization = config.optimization || {};
        config.optimization.minimize = false;
      }

      config.externals = config.externals || [];
      // Node built-ins (and node: prefixed) for bullmq, ioredis, tokenStore, etc.
      const nodeBuiltins = [
        'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
        'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'querystring', 'readline',
        'stream', 'string_decoder', 'timers', 'tls', 'url', 'util', 'worker_threads', 'zlib',
      ];
      // Built-ins that expose a `/promises` subpath (e.g. `import fs from 'fs/promises'`).
      const promisesSubpaths = ['fs', 'dns', 'stream', 'timers', 'readline'];
      nodeBuiltins.forEach((mod) => {
        if (!config.externals.includes(mod)) config.externals.push(mod);
        const nodePrefixed = `node:${mod}`;
        if (!config.externals.includes(nodePrefixed)) config.externals.push(nodePrefixed);
      });
      // Function-based external runs ahead of Next.js' default externals handling
      // and externalizes `*/promises` subpaths as commonjs requires.
      const promisesSubpathRe = new RegExp(`^(node:)?(${promisesSubpaths.join('|')})/promises$`);
      config.externals.unshift(({ request }, callback) => {
        if (request && promisesSubpathRe.test(request)) {
          const stripped = request.replace(/^node:/, '');
          return callback(null, `commonjs ${stripped}`);
        }
        callback();
      });
      // Resolve node: URIs to standard modules (for UnhandledSchemeError)
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      nodeBuiltins.forEach((mod) => {
        config.resolve.alias[`node:${mod}`] = mod;
      });
      promisesSubpaths.forEach((mod) => {
        config.resolve.alias[`node:${mod}/promises`] = `${mod}/promises`;
      });
    }
    return config;
  },
};

module.exports = nextConfig;
