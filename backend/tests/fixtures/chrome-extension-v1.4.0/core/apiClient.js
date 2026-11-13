// VENDORED EXCERPTS of extension v1.4.0 core/apiClient.js (test fixture only; see README.md). Not runnable.
// ---- core/apiClient.js L225-225 md5=a6aff357ae0a0c056623b032abcff045
      options.headers['X-Omnivyra-Dispatch-Renewal'] = '1';
// ---- core/apiClient.js L451-480 md5=3efa83baa992d2836266515363a2560e
  async renewDispatchLease(commandId, leaseId) {
    if (!commandId || !leaseId) {
      return { success: false, errorCode: 'MISSING_LEASE_CONTEXT' };
    }
    try {
      const response = await this.makeRequest('/api/extension/dispatch/renew', {
        method: 'POST',
        body: JSON.stringify({ commandId, leaseId }),
      });

      if (!response.ok) {
        let errorData = null;
        try { errorData = await response.json(); } catch (_) { errorData = null; }
        const errorCode = errorData?.error || `HTTP_${response.status}`;
        console.warn(`[ApiClient] lease renewal refused for ${commandId}: ${errorCode}`);
        return { success: false, errorCode };
      }

      const data = await response.json();
      return { success: true, expiresAt: data?.lease?.expires_at || null };
    } catch (error) {
      // A network failure is NOT a renewal. Report it as one more reason to
      // stop rather than proceed on an assumption.
      console.warn(`[ApiClient] lease renewal error for ${commandId}:`, error?.message);
      return { success: false, errorCode: 'RENEWAL_REQUEST_FAILED' };
    }
  }

  /**
   * Submit command execution result to backend
// ---- core/apiClient.js L493-493 md5=a444e698f792cbe2fe774504590bb3fd
      const response = await this.makeRequest('/api/extension/action-result', {
