// VENDORED EXCERPTS of extension v1.4.0 core/commandProcessor.js (test fixture only; see README.md). Not runnable.
// ---- core/commandProcessor.js L270-304 md5=9291f7eb8c574c9fab343dae1ed9210b
    for (let attempt = 1; attempt <= CommandProcessor.MAX_RETRIES; attempt++) {
      // ── Lease renewal, BEFORE every attempt ───────────────────────────────
      //   Not once at loop entry: the 96s worst case accumulates ACROSS
      //   attempts (30s + 2s + 30s + 4s + 30s), so a single renewal at the top
      //   still expires mid-loop and the server re-offers the command to
      //   another session. Each attempt gets a fresh window.
      //
      //   A refused renewal means we no longer hold this command — another
      //   session may already own it. Performing the irreversible platform
      //   action anyway is precisely the duplicate-send we are eliminating, so
      //   we stop and report a controlled failure instead of executing.
      if (leaseId && typeof apiClient !== 'undefined' && apiClient.renewDispatchLease) {
        const renewal = await apiClient.renewDispatchLease(command.id, leaseId);
        if (!renewal.success) {
          console.warn(
            `[CommandProcessor] lease renewal refused (${renewal.errorCode}); aborting before attempt ${attempt}`,
          );
          lastResult = this.normalizeResult({
            success: false,
            error_code: 'LEASE_LOST',
            error_message:
              `Dispatch lease could not be renewed (${renewal.errorCode}); ` +
              'aborting before execution to avoid a duplicate platform action',
          });
          break;
        }
      }

      let rawResult;
      try {
        if (typeof omnivyraPersistentStore !== 'undefined') {
          await omnivyraPersistentStore.setStoreRecord(command, { attempts: attempt });
        }
        rawResult = await Promise.race([
          this.executeCommand(command),
