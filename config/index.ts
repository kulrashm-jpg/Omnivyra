/**
 * Central Configuration Module — HARDENED
 * 
 * Single source of truth for all application configuration.
 * 
 * 🔐 ZERO-TRUST APPROACH:
 * - All env vars validated at Zod schema at startup
 * - Returns deeply immutable config object (Object.freeze + readonlyProxy)
 * - No module can read process.env directly (runtime enforcer)
 * - Fails fast on invalid config (process.exit on validation error)
 * - Startup verification checks critical paths
 * - Runtime access logging for audit trail
 * 
 * 🛡️ HARDENING LAYERS:
 * Layer 1: Zod validation (config/env.schema.ts)
 * Layer 2: Runtime enforcer (lib/config/enforcer.ts)
 * Layer 3: Deep freeze + readonly proxy (lib/config/deepFreeze.ts)
 * Layer 4: Startup verification (lib/config/verification.ts)
 * Layer 5: Health check endpoint (pages/api/health/config.ts)
 * 
 * Usage:
 *   import { config } from '@/config';
 *   const redisUrl = config.REDIS_URL; // guaranteed valid + immutable
 */

import { validateEnv, type EnvConfig } from './env.schema';
import { maskRedisUrl } from '@/lib/redis/sanitizer';
import { protectConfig } from '@/lib/config/deepFreeze';
import { initEnforcer } from '@/lib/config/enforcer';

/**
 * Module-level singleton
 * Validated once at import time, never mutated
 */
let _config: Readonly<EnvConfig> | null = null;
let _validationError: Error | null = null;
let _isInitialized = false;

/**
 * Initialize config (called automatically on first import)
 * This is the earliest possible validation point
 */
function initConfig(): Readonly<EnvConfig> {
  if (_config) return _config;
  
  try {
    // 1. Validate environment variables (Zod schema)
    const rawConfig = validateEnv();
    
    // 2. Protect with deep freeze + readonly proxy
    _config = protectConfig(rawConfig, 'EnvConfig');
    
    // 3. Mark as initialized
    _isInitialized = true;
    
    // 4. Log startup (mask secrets)
    console.info('[config] ✅ Startup configuration validated and hardened', {
      NODE_ENV: _config.NODE_ENV,
      redisUrl: maskRedisUrl(_config.REDIS_URL),
      supabaseUrl: new URL(_config.SUPABASE_URL).hostname,
      appUrl: _config.NEXT_PUBLIC_APP_URL,
      hardened: 'deep-frozen + readonly proxy + runtime enforcer',
    });
    
    return _config;
  } catch (error) {
    // Safely extract error message
    let errorMessage = 'Unknown error';
    try {
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null && 'message' in error) {
        errorMessage = String((error as any).message);
      } else {
        errorMessage = String(error);
      }
    } catch {
      errorMessage = '[Error extracting error message]';
    }
    
    _validationError = error as Error;
    
    // Log and fail fast
    console.error('[config] ❌ Configuration validation FAILED at startup', {
      error: errorMessage,
    });
    
    // Exit process on server (fail-fast); throw in browser (process.exit unavailable)
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
    throw new Error(`[config] Configuration validation failed: ${errorMessage}`);
  }
}

/**
 * Get validated and protected configuration
 * Safe to call multiple times (uses cached value)
 * Will never be null after first successful call
 */
export function getConfig(): Readonly<EnvConfig> {
  if (_validationError) throw _validationError;
  if (!_config) return initConfig();
  return _config;
}

/**
 * Export config singleton (lazy initialized)
 * This is the PRIMARY way to access config
 */
export const config = new Proxy({} as Readonly<EnvConfig>, {
  get(_, prop) {
    return getConfig()[prop as keyof EnvConfig];
  },
  
  set() {
    throw new TypeError('[config] Config object is read-only');
  },
  
  deleteProperty() {
    throw new TypeError('[config] Config object is read-only');
  },
});

/**
 * Type-safe config object for passing around
 * Returns the same immutable singleton
 */
export function getValidatedConfig(): Readonly<EnvConfig> {
  return getConfig();
}

/**
 * Check if config is valid and initialized
 * Used for health checks and startup verification
 */
export function isConfigValid(): boolean {
  return _isInitialized && _config !== null && _validationError === null;
}

/**
 * Check if config has been initialized (even if invalid)
 */
export function isConfigInitialized(): boolean {
  return _isInitialized || _config !== null;
}

/**
 * Get config validation error (if any)
 * Returns null if config is valid
 */
export function getConfigError(): Error | null {
  try {
    getConfig();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Check if runtime enforcer is active
 * Useful for testing and debugging
 */
export function isEnforcerActive(): boolean {
  try {
    const enforcer = require('@/lib/config/enforcer');
    return enforcer.isEnforcerActive();
  } catch {
    return false;
  }
}

/**
 * Get config initialization state for debugging
 */
export function getConfigState() {
  return {
    initialized: _isInitialized,
    hasConfig: _config !== null,
    hasError: _validationError !== null,
    error: _validationError?.message || null,
    isReadonly: _config ? Object.isFrozen(_config) : false,
  };
}

// ─── STARTUP INITIALIZATION ───────────────────────────────────────────────────

// Eagerly initialize on module load
// This ensures validation happens at startup, BEFORE any other module loads
// Fail-fast: if validation fails, process exits immediately
(() => {
  const startTime = Date.now();
  try {
    initConfig();
    const duration = Date.now() - startTime;
    
    // Initialize runtime enforcer to prevent future bypasses
    initEnforcer();
    
    console.info(`[config] Configuration system ready in ${duration}ms`, {
      security: 'deep-frozen + readonly proxy + runtime enforcer',
    });
  } catch (error) {
    // Error already logged and process exited in initConfig()
    // This code is just a safety net
    const duration = Date.now() - startTime;
    
    // Safely extract error message avoiding instanceof issues
    let errorMessage = 'Unknown error';
    try {
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null && 'message' in error) {
        errorMessage = String((error as any).message);
      } else {
        errorMessage = String(error);
      }
    } catch {
      errorMessage = '[Error extracting error message]';
    }
    
    console.error(`[config] Fatal: Configuration initialization failed after ${duration}ms`, {
      error: errorMessage,
    });
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
  }
})();

/**
 * For testing: reset config state
 */
export function __resetConfigForTesting__() {
  _config = null;
  _validationError = null;
  _isInitialized = false;
}
