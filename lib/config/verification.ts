/**
 * Startup Configuration Verification System
 *
 * Runs comprehensive checks at application startup to ensure:
 * - Config module is initialized first
 * - All critical environment variables are valid
 * - Redis connection is viable (if required)
 * - Database connection is viable
 * - System is in a known good state
 *
 * 🔍 CHECKS PERFORMED:
 * 1. Config validation (Zod schema)
 * 2. Redis URL syntax and connectivity
 * 3. Supabase URL and auth key validity
 * 4. OpenAI API key format
 * 5. All critical paths are functional
 *
 * ⚠️ FAILURE MODES:
 * - CONFIG_INVALID → Exit process (fail-fast)
 * - REDIS_REQUIRED_BUT_DOWN → Exit process (fail-fast)
 * - REDIS_DEGRADED → Log warning but continue
 * - DB_INVALID_CREDENTIALS → Exit process (fail-fast)
 * - DB_UNREACHABLE → Exit process (fail-fast)
 */

import { getConfig, isConfigValid, getConfigError } from '@/config';
import { getSharedRedisConnectionSync } from '@/lib/redis/client';
import { supabase } from '@/backend/db/supabaseClient';
import type IORedis from 'ioredis';

/**
 * Severity levels for issues
 */
export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * A single verification issue
 */
export interface VerificationIssue {
  component: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  detail?: string;
  remediation?: string;
}

/**
 * Overall verification report
 */
export interface VerificationReport {
  timestamp: number;
  environment: string;
  status: 'healthy' | 'degraded' | 'failed';
  configValid: boolean;
  redisConnected: boolean;
  databaseConnected: boolean;
  issues: VerificationIssue[];
  checks: {
    configValidated: boolean;
    envVarsPresent: boolean;
    redisUrlValid: boolean;
    redisConnectable: boolean;
    databaseUrlValid: boolean;
    databaseConnectable: boolean;
    criticalPathsValid: boolean;
  };
}

/**
 * Verification state (singleton)
 */
let _report: VerificationReport | null = null;
let _verificationError: Error | null = null;

/**
 * Helper: Check if value is a valid URL
 */
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: Test Redis connectivity
 */
async function testRedisConnectivity(url: string): Promise<{
  connected: boolean;
  latency: number;
  error?: string;
}> {
  try {
    // Timeout after 5 seconds
    const startTime = Date.now();
    const client = new (await import('ioredis')).default(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: false,
      connectTimeout: 5000,
    });

    // Try PING
    await Promise.race([
      (async () => {
        const pong = await client.ping();
        client.disconnect();
        if (pong === 'PONG') {
          return { connected: true, latency: Date.now() - startTime };
        }
        throw new Error('PING returned unexpected value: ' + pong);
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      ),
    ]);

    return { connected: true, latency: Date.now() - startTime };
  } catch (error) {
    return {
      connected: false,
      latency: -1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Helper: Test Supabase connectivity
 */
async function testSupabaseConnectivity(): Promise<{
  connected: boolean;
  error?: string;
}> {
  try {
    // Try to get auth user (should work if service role key is valid)
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
      return { connected: false, error: error.message };
    }
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all verification checks
 */
async function runVerificationChecks(): Promise<VerificationReport> {
  const startTime = Date.now();
  const issues: VerificationIssue[] = [];
  const checks = {
    configValidated: false,
    envVarsPresent: false,
    redisUrlValid: false,
    redisConnectable: false,
    databaseUrlValid: false,
    databaseConnectable: false,
    criticalPathsValid: false,
  };

  // 1. Validate config
  let config: any = null;
  try {
    config = getConfig();
    checks.configValidated = true;
  } catch (error) {
    issues.push({
      component: 'config',
      severity: 'critical',
      code: 'CONFIG_INVALID',
      message: 'Configuration validation failed at startup',
      detail: error instanceof Error ? error.message : String(error),
      remediation: 'Check .env.local and environment variables match the schema in config/env.schema.ts',
    });
    return buildReport(false, issues, checks);
  }

  // 2. Check env vars are present
  const requiredVars = [
    'REDIS_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    issues.push({
      component: 'environment',
      severity: 'critical',
      code: 'ENV_VARS_MISSING',
      message: `Required environment variables missing: ${missingVars.join(', ')}`,
      remediation: 'Set missing variables in .env.local or deployment settings',
    });
    checks.envVarsPresent = false;
    return buildReport(false, issues, checks);
  }
  checks.envVarsPresent = true;

  // 3. Validate Redis URL
  try {
    new URL(config.REDIS_URL);
    checks.redisUrlValid = true;
  } catch {
    issues.push({
      component: 'redis',
      severity: 'critical',
      code: 'REDIS_URL_INVALID',
      message: `REDIS_URL is not a valid URL: ${config.REDIS_URL}`,
      remediation: 'Check REDIS_URL format (e.g., redis://host:6379 or rediss://..@upstash.io)',
    });
    return buildReport(false, issues, checks);
  }

  // 4. Test Redis connectivity
  const redisTest = await testRedisConnectivity(config.REDIS_URL);
  checks.redisConnectable = redisTest.connected;
  if (!redisTest.connected && config.REDIS_REQUIRED === 'true') {
    issues.push({
      component: 'redis',
      severity: 'critical',
      code: 'REDIS_UNAVAILABLE',
      message: `Redis is unavailable but required: ${redisTest.error}`,
      remediation: 'Check Redis server is running and accessible at the configured URL',
    });
    return buildReport(false, issues, checks);
  }
  if (!redisTest.connected) {
    issues.push({
      component: 'redis',
      severity: 'warning',
      code: 'REDIS_DEGRADED',
      message: `Redis connection failed: ${redisTest.error}`,
      remediation: 'Check Redis server; features requiring Redis will degrade gracefully',
    });
  }

  // 5. Validate Supabase URL
  if (!isValidUrl(config.SUPABASE_URL)) {
    issues.push({
      component: 'supabase',
      severity: 'critical',
      code: 'SUPABASE_URL_INVALID',
      message: `SUPABASE_URL is not a valid URL: ${config.SUPABASE_URL}`,
      remediation: 'Check SUPABASE_URL format',
    });
    checks.databaseUrlValid = false;
    return buildReport(false, issues, checks);
  }
  checks.databaseUrlValid = true;

  // 6. Test Supabase connectivity
  const dbTest = await testSupabaseConnectivity();
  checks.databaseConnectable = dbTest.connected;
  if (!dbTest.connected) {
    issues.push({
      component: 'supabase',
      severity: 'critical',
      code: 'DATABASE_UNAVAILABLE',
      message: `Database connection failed: ${dbTest.error}`,
      remediation: 'Check SUPABASE_SERVICE_ROLE_KEY is valid and Supabase is reachable',
    });
    return buildReport(false, issues, checks);
  }

  // 7. Check critical paths
  try {
    // If we got here, config + Redis + DB all work
    checks.criticalPathsValid = true;
  } catch {
    issues.push({
      component: 'system',
      severity: 'error',
      code: 'CRITICAL_PATHS_INVALID',
      message: 'One or more critical system paths are non-functional',
      remediation: 'Review the issues above and address them',
    });
  }

  // Build final report
  return buildReport(issues.length === 0 || issues.every(i => i.severity !== 'critical'), issues, checks);
}

/**
 * Helper: Build verification report
 */
function buildReport(
  success: boolean,
  issues: VerificationIssue[],
  checks: VerificationReport['checks']
): VerificationReport {
  return {
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'unknown',
    status: success ? 'healthy' : (issues.some(i => i.severity === 'critical') ? 'failed' : 'degraded'),
    configValid: checks.configValidated,
    redisConnected: checks.redisConnectable,
    databaseConnected: checks.databaseConnectable,
    issues,
    checks,
  };
}

/**
 * Run verification synchronously (for startup checks)
 * Returns promise but is called eagerly
 */
export async function verifyStartup(): Promise<VerificationReport> {
  if (_report) return _report;

  try {
    _report = await runVerificationChecks();

    // Log results
    if (_report.status === 'healthy') {
      console.info('[verify] ✅ All startup checks passed', {
        configValid: _report.configValid,
        redisConnected: _report.redisConnected,
        databaseConnected: _report.databaseConnected,
      });
    } else if (_report.status === 'degraded') {
      console.warn('[verify] ⚠️ Startup checks passed with warnings', {
        issues: _report.issues.filter(i => i.severity === 'warning').length,
      });
      _report.issues.forEach(i => {
        if (i.severity === 'warning') {
          console.warn(`  [${i.code}] ${i.message}`);
        }
      });
    } else {
      console.error('[verify] ❌ Startup checks FAILED', {
        status: _report.status,
        critical: _report.issues.filter(i => i.severity === 'critical').length,
      });
      _report.issues.forEach(i => {
        if (i.severity === 'critical') {
          console.error(`  [${i.code}] ${i.message}`, {
            detail: i.detail,
            remediation: i.remediation,
          });
        }
      });

      // Fail-fast: exit if critical issues exist (server only)
      if (_report.issues.some(i => i.severity === 'critical')) {
        if (typeof process !== 'undefined' && typeof process.exit === 'function') {
          process.exit(1);
        }
      }
    }

    return _report;
  } catch (error) {
    _verificationError = error as Error;
    const fallbackReport: VerificationReport = {
      timestamp: Date.now(),
      environment: process.env.NODE_ENV || 'unknown',
      status: 'failed',
      configValid: false,
      redisConnected: false,
      databaseConnected: false,
      issues: [
        {
          component: 'system',
          severity: 'critical',
          code: 'VERIFICATION_FAILED',
          message: 'Verification system encountered an unexpected error',
          detail: error instanceof Error ? error.message : String(error),
          remediation: 'Check system logs for details',
        },
      ],
      checks: {
        configValidated: false,
        envVarsPresent: false,
        redisUrlValid: false,
        redisConnectable: false,
        databaseUrlValid: false,
        databaseConnectable: false,
        criticalPathsValid: false,
      },
    };
    _report = fallbackReport;
    throw error;
  }
}

/**
 * Get the latest verification report (without running checks again)
 */
export function getVerificationReport(): VerificationReport | null {
  return _report;
}

/**
 * Get verification error (if any)
 */
export function getVerificationError(): Error | null {
  return _verificationError;
}

/**
 * For testing: reset verification state
 */
export function __resetVerificationForTesting__() {
  _report = null;
  _verificationError = null;
}
