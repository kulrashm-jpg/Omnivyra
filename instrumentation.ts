/**
 * Next.js Instrumentation Hook - shared entry point.
 *
 * Node.js startup logic lives in `instrumentation.node.ts` and must not be
 * imported by the Edge instrumentation bundle. Keep this file free of static
 * Node.js imports so local dev and production builds do not pull Redis,
 * workers, fs, crypto, or zlib into Edge runtime analysis.
 */

export async function register() {
  // Keep production page builds and Edge instrumentation free of backend worker
  // graphs. Workers/cron remain available through the existing worker scripts.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
}
