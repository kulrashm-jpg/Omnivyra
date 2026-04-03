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
});
