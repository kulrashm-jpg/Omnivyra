/**
 * Structured Logging with Correlation IDs
 *
 * Enables tracing requests through entire system:
 * - Every log entry has correlation ID
 * - Logs are JSON for easy parsing
 * - Context is preserved across async boundaries
 *
 * 🔍 TRACING:
 * Request → API → Redis → Cache → Response
 * All logs tagged with same correlationId
 *
 * 📋 LOG LEVELS:
 * - ERROR: Something failed (needs investigation)
 * - WARN: Something unexpected (may indicate future issue)
 * - INFO: Important event (service started, etc)
 * - DEBUG: Detailed info (retry attempt, latency reading)
 *
 * 🎯 USAGE:
 * const logger = getLogger('redis-client');
 * logger.info('Redis connected', { host, latency });
 * // Outputs: {"level":"info","time":"...","correlationId":"...", "host":"..."}
 *
 * PRODUCTION FIX: Uses AsyncLocalStorage for proper concurrency isolation
 * (Instead of global variable that leaks across requests)
 */

import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Log level
 */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

/**
 * Log entry (internal format)
 */
interface LogEntry {
  level: LogLevel;
  timestamp: number;
  isoTime: string;
  component: string;
  message: string;
  correlationId: string;
  context: Record<string, any>;
}

/**
 * PRODUCTION FIX: Use AsyncLocalStorage for request isolation
 * Each async context (request) has its own correlationId
 * Concurrent requests don't interfere with each other
 */
const correlationIdStorage = new AsyncLocalStorage<string>();
const logBuffer: LogEntry[] = [];
const maxLogBuffer = 10000;

/**
 * Set correlation ID for this request/operation
 * PRODUCTION FIX: Stored in AsyncLocalStorage, not global variable
 */
export function setCorrelationId(id?: string): string {
  const correlationId = id || randomUUID().substring(0, 8);
  correlationIdStorage.enterWith(correlationId);
  return correlationId;
}

/**
 * Get current correlation ID
 * PRODUCTION FIX: Retrieved from AsyncLocalStorage (request-isolated)
 */
export function getCorrelationId(): string {
  return correlationIdStorage.getStore() || randomUUID().substring(0, 8);
}

/**
 * Clear correlation ID
 */
export function clearCorrelationId() {
  const store = correlationIdStorage.getStore();
  if (store) {
    correlationIdStorage.enterWith('');
  }
}

/**
 * Logger for a specific component
 */
export class StructuredLogger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  /**
   * Log at ERROR level
   */
  error(message: string, context?: Record<string, any>) {
    this.log(LogLevel.ERROR, message, context);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, context?: Record<string, any>) {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log at INFO level
   */
  info(message: string, context?: Record<string, any>) {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, context?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, context?: Record<string, any>) {
    const now = Date.now();
    const entry: LogEntry = {
      level,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      component: this.component,
      message,
      correlationId: getCorrelationId(),
      context: context || {},
    };

    // Add to buffer
    logBuffer.push(entry);
    if (logBuffer.length > maxLogBuffer) {
      logBuffer.shift();
    }

    // Output as JSON
    this.outputLog(entry);
  }

  /**
   * Output log (can be extended for shipping to external services)
   */
  private outputLog(entry: LogEntry) {
    const output = {
      level: entry.level,
      time: entry.isoTime,
      correlationId: entry.correlationId,
      component: entry.component,
      message: entry.message,
      ...entry.context,
    };

    // Output based on level
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(JSON.stringify(output));
        break;
      case LogLevel.WARN:
        console.warn(JSON.stringify(output));
        break;
      case LogLevel.INFO:
        console.info(JSON.stringify(output));
        break;
      case LogLevel.DEBUG:
        console.debug(JSON.stringify(output));
        break;
    }
  }

  /**
   * Create child logger with additional context
   */
  child(context: Record<string, any>): StructuredLogger {
    const childLogger = new StructuredLogger(this.component);
    const originalLog = childLogger['log'].bind(childLogger);

    childLogger['log'] = (level: LogLevel, message: string, extraContext?: Record<string, any>) => {
      originalLog(level, message, { ...context, ...extraContext });
    };

    return childLogger;
  }
}

/**
 * Logger registry
 */
const loggers = new Map<string, StructuredLogger>();

/**
 * Get or create logger for a component
 */
export function getLogger(component: string): StructuredLogger {
  if (!loggers.has(component)) {
    loggers.set(component, new StructuredLogger(component));
  }
  return loggers.get(component)!;
}

/**
 * Get log buffer (for testing or log shipping)
 */
export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

/**
 * Clear log buffer
 */
export function clearLogBuffer() {
  logBuffer.length = 0;
}

/**
 * Search logs by correlation ID
 */
export function searchLogsByCorrelationId(correlationId: string): LogEntry[] {
  return logBuffer.filter(entry => entry.correlationId === correlationId);
}

/**
 * Search logs by component
 */
export function searchLogsByComponent(component: string): LogEntry[] {
  return logBuffer.filter(entry => entry.component === component);
}

/**
 * Search logs by level
 */
export function searchLogsByLevel(level: LogLevel): LogEntry[] {
  return logBuffer.filter(entry => entry.level === level);
}

/**
 * Export logs as JSON lines (for shipping to external log service)
 */
export function exportLogsAsJsonLines(): string {
  return logBuffer
    .map(entry => JSON.stringify({
      level: entry.level,
      time: entry.isoTime,
      correlationId: entry.correlationId,
      component: entry.component,
      message: entry.message,
      ...entry.context,
    }))
    .join('\n');
}

/**
 * Export logs as JSON array
 */
export function exportLogsAsJson(): any[] {
  return logBuffer.map(entry => ({
    level: entry.level,
    time: entry.isoTime,
    correlationId: entry.correlationId,
    component: entry.component,
    message: entry.message,
    ...entry.context,
  }));
}

/**
 * Holder for HTTP request context (in real app, use AsyncLocalStorage)
 */
export interface RequestContext {
  correlationId: string;
  startTime: number;
  userId?: string;
  method?: string;
  path?: string;
}

/**
 * Start request context
 * Call at beginning of HTTP request handler
 */
export function startRequestContext(context: Partial<RequestContext> = {}): RequestContext {
  const correlationId = context.correlationId || setCorrelationId();

  return {
    correlationId,
    startTime: Date.now(),
    ...context,
  };
}

/**
 * End request context and log duration
 */
export function endRequestContext(context: RequestContext) {
  const duration = Date.now() - context.startTime;
  const logger = getLogger('http');

  logger.info('Request completed', {
    correlationId: context.correlationId,
    method: context.method,
    path: context.path,
    userId: context.userId,
    durationMs: duration,
  });

  clearCorrelationId();
}

/**
 * Usage example:
 *
 * // In HTTP handler
 * const context = startRequestContext({ method: 'GET', path: '/api/users' });
 * const logger = getLogger('api');
 *
 * logger.info('Fetching user', { userId: 123 });
 * // Output: {"level":"info","correlationId":"abc123","message":"Fetching user","userId":123}
 *
 * // In Redis client
 * const redisLogger = getLogger('redis');
 * redisLogger.debug('Redis GET', { key, latencyMs: 5 });
 * // Output: {"level":"debug","correlationId":"abc123","component":"redis",...}
 *
 * // All logs have same correlationId, easy to trace through system
 */
