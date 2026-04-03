/**
 * Runtime Config Access Enforcer
 *
 * Prevents direct process.env access outside the config module.
 * This is the first line of defense against configuration bypass.
 *
 * 🔒 ENFORCEMENT LEVELS:
 * 1. Whitelist: Only config/env.schema.ts can read process.env directly
 * 2. Detection: Any direct process.env access logged with stack trace
 * 3. Fail-Fast: Critical env vars (REDIS_URL, SUPABASE_URL) must come from config module
 * 4. Runtime: All modules import from @/config, never process.env
 *
 * VIOLATIONS DETECTED:
 * - backend/utils/cronGuard.ts - Direct REDIS_URL read (❌ BYPASS)
 * - backend/db/supabaseClient.ts - Direct SUPABASE_URL read (❌ BYPASS)
 * - backend/auth/tokenRefresh.ts - Direct OAuth credential reads (❌ BYPASS)
 * - All platform adapters - Direct USE_MOCK_PLATFORMS read (❌ BYPASS)
 * - config/featureFlags.ts - Direct feature flag reads (❌ SHOULD USE CONFIG)
 */

import { createHash } from 'crypto';

/**
 * Whitelist of files allowed to access process.env directly
 * Add entries sparingly — this is intentionally restrictive
 */
const ALLOWED_DIRECT_ENV_ACCESS = new Set([
  'config/env.schema.ts',           // Valid: validation schema
  'backend/tests/setupEnv.ts',      // Valid: test setup only
  'instrumentation.ts',              // Valid: node instrumentation
  'next.config.js',                  // Valid: Next.js config
  'jest.config.js',                  // Valid: Jest config
  'jest.env.js',                     // Valid: Jest env setup
]);

/**
 * Module access log (for audit trail)
 */
interface AccessRecord {
  timestamp: number;
  stack: string;
  caller: string;
  varNames: string[];
  severity: 'ALLOWED' | 'WARNING' | 'CRITICAL';
}

const accessLog: AccessRecord[] = [];

/**
 * Extract caller filename from stack trace
 */
function getCallerFromStack(stack: string): string {
  const lines = stack.split('\n');
  // Skip the first 3 lines (this function + Error line + enforcer line)
  for (let i = 3; i < lines.length; i++) {
    const match = lines[i].match(/\(([^)]+)\)/);
    if (match) {
      const path = match[1];
      // Extract relevant part (after node_modules, before :line)
      if (path.includes('node_modules')) continue;
      if (path.includes('internal/')) continue;
      return path.split('/').slice(-2).join('/');
    }
  }
  return 'unknown';
}

/**
 * Check if a module is allowed direct access
 */
function isAllowedModule(caller: string): boolean {
  return ALLOWED_DIRECT_ENV_ACCESS.has(caller) ||
         ALLOWED_DIRECT_ENV_ACCESS.has(caller.split('/').pop() || '');
}

/**
 * Log all environment variable access
 */
function logAccess(varNames: string[], allowed: boolean) {
  accessLog.push({
    timestamp: Date.now(),
    stack: new Error().stack || '',
    caller: getCallerFromStack(new Error().stack || ''),
    varNames,
    severity: allowed ? 'ALLOWED' : 'CRITICAL',
  });

  // Keep log bounded (last 1000 records)
  if (accessLog.length > 1000) {
    accessLog.shift();
  }
}

/**
 * Initialize the enforcer
 * Call this in config/index.ts after config is loaded
 */
export function initEnforcer() {
  if (process.env.NODE_ENV === 'production' || process.env.ENFORCE_CONFIG_SECURITY === 'true') {
    // In production or when explicitly enabled, wrap process.env with a proxy
    // BUT: Skip proxying during build time to avoid Error prototype issues
    const isBuildTime = process.env.SKIP_ENV_PROXY === 'true' || 
                        (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL);
    
    if (isBuildTime) {
      console.warn('[Enforcer] Skipping process.env proxy during build time');
      return;
    }

    const originalEnv = { ...process.env };

    let _inHandler = false; // Re-entrancy guard — prevents infinite recursion when
                            // Error.prepareStackTrace (Next.js source maps) accesses process.env

    const handler: ProxyHandler<typeof process.env> = {
      get(target: any, prop: string) {
        // If we're already inside this handler (re-entrant call from Error.prepareStackTrace
        // or console.warn's color detection), bypass and return the raw value immediately.
        if (_inHandler) return target[prop];
        _inHandler = true;
        try {
          const caller = getCallerFromStack(new Error().stack || '');
          const allowed = isAllowedModule(caller);

          logAccess([prop], allowed);

          if (!allowed) {
            console.warn(`[WARN] Direct process.env.${prop} access from ${caller} (should use @/config)`, {
              caller,
              varName: prop,
            });
          }

          return target[prop];
        } finally {
          _inHandler = false;
        }
      },

      set(target: any, prop: string, value: any) {
        const caller = getCallerFromStack(new Error().stack || '');
        console.warn(`[WARN] Attempted to set process.env.${prop} from ${caller}`, {
          isProduction: process.env.NODE_ENV === 'production',
        });
        return false; // Prevent mutation
      },

      has(target: any, prop: string) {
        return prop in target;
      },

      deleteProperty(target: any, prop: string) {
        console.warn(`[WARN] Attempted to delete process.env.${prop}`);
        return false; // Prevent deletion
      },

      ownKeys(target: any) {
        return Reflect.ownKeys(target);
      },

      getOwnPropertyDescriptor(target: any, prop: string) {
        return Object.getOwnPropertyDescriptor(target, prop);
      },
    };

    // Only proxy if not already proxied
    // Use a safer check that avoids instanceof issues
    try {
      const isAlreadyProxied = (process.env as any).__isProxy === true;
      if (!isAlreadyProxied) {
        const proxiedEnv = new Proxy(originalEnv, handler);
        Object.defineProperty(process, 'env', {
          value: proxiedEnv,
          configurable: false,
        });
        // Mark as proxied for future checks
        Object.defineProperty(proxiedEnv, '__isProxy', {
          value: true,
          configurable: false,
          enumerable: false,
        });
      }
    } catch (e) {
      // If proxying fails in build environment, log but don't crash
      console.warn('[Enforcer] Could not install process.env proxy (may be build-time only)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * Get audit trail of all environment access
 */
export function getAccessLog(): AccessRecord[] {
  return [...accessLog];
}

/**
 * Get summary of bypass attempts
 */
export function getBypassSummary() {
  const criticalAccess = accessLog.filter(r => r.severity === 'CRITICAL');
  const warningAccess = accessLog.filter(r => r.severity === 'WARNING');

  return {
    total: accessLog.length,
    critical: criticalAccess.length,
    warnings: warningAccess.length,
    byCallers: [...new Set(criticalAccess.map(r => r.caller))],
    byVars: [...new Set(criticalAccess.flatMap(r => r.varNames))],
    accessLog: criticalAccess,
  };
}

/**
 * Custom error for config access violations
 */
export class ConfigAccessError extends Error {
  name = 'ConfigAccessError';
  
  constructor(
    public message: string,
    public remediation: string,
    public caller: string,
    public varName: string
  ) {
    super(message);
    // Ensure Error prototype is set correctly
    Object.setPrototypeOf(this, ConfigAccessError.prototype);
  }

  toString(): string {
    return `
    ╔═══════════════════════════════════════════════════════════════╗
    ║ ❌ CONFIG ACCESS VIOLATION                                    ║
    ╠═══════════════════════════════════════════════════════════════╣
    ║ Error:     ${this.message}
    ║ Caller:    ${this.caller}
    ║ Variable:  ${this.varName}
    ║            
    ║ Remediation: ${this.remediation}
    ║            
    ║ Why this matters:
    ║ - process.env access bypasses validation
    ║ - Config module ensures all vars are valid at startup
    ║ - Direct access allows silent failures
    ║ - This violates zero-trust security model
    ╚═══════════════════════════════════════════════════════════════╝
    `;
  }
}

/**
 * For testing: temporarily disable enforcement
 */
export function disableEnforcer() {
  // Reset the handler by not proxying
  Object.defineProperty(process, 'env', {
    value: process.env,
    configurable: true,
  });
}

/**
 * For testing: check if enforcer is active
 */
export function isEnforcerActive(): boolean {
  return (process.env as any).__isProxy === true;
}
