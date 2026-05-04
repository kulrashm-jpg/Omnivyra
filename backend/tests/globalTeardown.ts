/**
 * Global Jest teardown — stops all background timers started by module-level
 * side effects (usageProtection, instrumentation, queueInstrumentation, etc.)
 * so Jest doesn't log "Cannot log after tests are done" warnings.
 *
 * Registered as setupFilesAfterEnv in jest.config.js.
 */

afterAll(async () => {
  // Stop Redis usage-protection polling timer
  try {
    const { stopUsageProtection } = await import('../../lib/redis/usageProtection');
    stopUsageProtection();
  } catch { /* not imported in this test suite */ }

  // Stop Redis instrumentation flush + persist timers
  try {
    const { stopInstrumentation } = await import('../../lib/redis/instrumentation');
    stopInstrumentation();
  } catch { /* not imported in this test suite */ }

  try {
    const { closeConnections } = await import('../queue/bullmqClient');
    await closeConnections();
  } catch { /* not imported in this test suite */ }

  try {
    const { closeIntelligencePollingQueue } = await import('../queue/intelligencePollingQueue');
    await closeIntelligencePollingQueue();
  } catch { /* not imported in this test suite */ }

  try {
    const { closeIdempotencyService } = await import('../jobs/idempotencyService');
    await closeIdempotencyService();
  } catch { /* not imported in this test suite */ }

  try {
    const { closeJobLockService } = await import('../jobs/lockService');
    await closeJobLockService();
  } catch { /* not imported in this test suite */ }
});
