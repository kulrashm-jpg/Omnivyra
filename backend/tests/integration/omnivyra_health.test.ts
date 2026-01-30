import {
  getHealthReport,
  recordFailure,
  recordSuccess,
  resetOmniVyraHealth,
} from '../../services/omnivyraHealthService';

describe('OmniVyra health monitor', () => {
  beforeEach(() => {
    resetOmniVyraHealth();
  });

  it('tracks success and failure counts', () => {
    recordSuccess('/trends/relevance', 120);
    recordFailure('/trends/relevance', 'http_error', '500');
    const report = getHealthReport(true);
    expect(report.endpoints['/trends/relevance'].total_calls).toBe(2);
    expect(report.endpoints['/trends/relevance'].success_calls).toBe(1);
    expect(report.endpoints['/trends/relevance'].failure_calls).toBe(1);
  });

  it('computes status based on success rate', () => {
    recordFailure('/trends/relevance', 'timeout', 'timeout');
    recordFailure('/trends/relevance', 'timeout', 'timeout');
    const report = getHealthReport(true);
    expect(report.status).toBe('down');
  });

  it('returns disabled when flag off', () => {
    const report = getHealthReport(false);
    expect(report.status).toBe('disabled');
  });
});
