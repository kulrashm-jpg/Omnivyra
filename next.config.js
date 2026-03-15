/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  // Don't bundle bullmq/ioredis - they use Node built-ins. Let Node provide at runtime.
  serverExternalPackages: ['bullmq', 'ioredis'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
  rewrites: async () => [
    { source: '/blog/rss.xml', destination: '/api/blog/rss' },
    { source: '/blog/sitemap.xml', destination: '/api/blog/sitemap' },
  ],
  webpack: (config, { isServer }) => {
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
