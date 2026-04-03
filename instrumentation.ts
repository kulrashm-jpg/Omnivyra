/**
 * Next.js Instrumentation Hook — entry point
 *
 * All Node.js-specific startup logic (Redis, workers, cron) lives in
 * `instrumentation.node.ts`. We dynamically import it only when NOT in Edge
 * runtime, preventing the Edge bundler from analyzing the Node.js-only
 * import chain (Redis, fs, crypto, os, etc.).
 *
 * Note: NEXT_RUNTIME is 'edge' in Edge runtime, 'nodejs' or undefined in Node.
 * Guard against 'edge' rather than requiring 'nodejs' to handle both cases.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'edge') {
    const { register: nodeRegister } = await import('./instrumentation.node');
    await nodeRegister();
  }
}
