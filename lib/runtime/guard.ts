/**
 * Runtime Guard — Enforce Node.js runtime constraints
 *
 * Prevents Edge-unsafe modules (Redis, filesystem, streams) from loading
 * in Edge runtime contexts. Fails fast to avoid runtime errors.
 *
 * Usage:
 *   At top of Redis/Node-only module:
 *   import { enforceNodeRuntime } from '@/lib/runtime/guard';
 *   enforceNodeRuntime('moduleName');
 */

/**
 * Error thrown when runtime boundary is violated
 */
export class RuntimeBoundaryError extends Error {
  constructor(module: string, runtime: string) {
    super(
      `❌ Module "${module}" requires Node.js runtime. ` +
      `Current runtime: "${runtime}". ` +
      `This module uses filesystem, streams, or persistent connections that ` +
      `are not available in Edge runtime. Move this import to a Node API route ` +
      `or worker process.`
    );
    this.name = 'RuntimeBoundaryError';
  }
}

/**
 * Enforce Node.js runtime for a module
 *
 * @param moduleName - Name of module (for error messages)
 * @throws RuntimeBoundaryError if not in Node.js runtime
 *
 * Usage:
 *   // At top of redis/client.ts
 *   enforceNodeRuntime('redis/client');
 *
 *   // At top of instrumentation.ts
 *   enforceNodeRuntime('instrumentation');
 */
export function enforceNodeRuntime(moduleName: string): void {
  // Check 1: Next.js NEXT_RUNTIME env var (set by Next.js framework)
  const nextRuntime = process.env.NEXT_RUNTIME;
  
  if (nextRuntime === 'edge') {
    throw new RuntimeBoundaryError(moduleName, 'edge');
  }

  // Check 2: Process check (Edge runtime doesn't have full process object)
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new RuntimeBoundaryError(moduleName, 'unknown/edge');
  }

  // SUCCESS: Running in Node.js
  if (process.env.DEBUG_RUNTIME) {
    console.log(`[runtime] ✅ ${moduleName} loaded in Node runtime`);
  }
}

/**
 * Get current runtime environment
 *
 * @returns 'nodejs' | 'edge' | 'unknown'
 */
export function getCurrentRuntime(): 'nodejs' | 'edge' | 'unknown' {
  const nextRuntime = process.env.NEXT_RUNTIME;
  
  if (nextRuntime === 'edge') return 'edge';
  if (nextRuntime === 'nodejs') return 'nodejs';
  if (typeof process !== 'undefined' && process.versions?.node) return 'nodejs';
  
  return 'unknown';
}

/**
 * Check if running in Node runtime (doesn't throw)
 *
 * @returns true if Node.js, false otherwise
 */
export function isNodeRuntime(): boolean {
  return getCurrentRuntime() === 'nodejs';
}

/**
 * Check if running in Edge runtime (doesn't throw)
 *
 * @returns true if Edge, false otherwise
 */
export function isEdgeRuntime(): boolean {
  return getCurrentRuntime() === 'edge';
}
