/**
 * PMF-003 §8/§10 — runManagedContentGeneration flag wiring: legacy path unchanged
 * (calls the engine directly), platform path routes through the platform runtime.
 */

jest.mock('../../../lib/content/unifiedLongFormEngine', () => ({ runUnifiedLongFormGeneration: jest.fn(async () => ({ served: 'legacy-engine' })) }));
jest.mock('../../services/longFormCapability/longFormMigrationFlag', () => ({ shouldRunPlatform: jest.fn() }));
jest.mock('../../services/longFormCapability/longFormPlatformRuntime', () => ({ runLongFormCapability: jest.fn(async () => ({ served: 'platform' })) }));

import { runManagedContentGeneration } from '../../../lib/content/runManagedContentGeneration';
import { runUnifiedLongFormGeneration } from '../../../lib/content/unifiedLongFormEngine';
import { shouldRunPlatform } from '../../services/longFormCapability/longFormMigrationFlag';
import { runLongFormCapability } from '../../services/longFormCapability/longFormPlatformRuntime';

const mockEngine = runUnifiedLongFormGeneration as jest.Mock;
const mockFlag = shouldRunPlatform as jest.Mock;
const mockPlatform = runLongFormCapability as jest.Mock;

const REQUEST: any = { company_id: 'org1', topic: 'Launch', target_words: 1200, formatType: 'thought-leadership' };

beforeEach(() => jest.clearAllMocks());

describe('PMF-003 — managed wrapper wiring', () => {
  test('legacy (default) calls the engine directly with the transformed request', async () => {
    mockFlag.mockReturnValue(false);
    const out = await runManagedContentGeneration(REQUEST, 'article');
    expect(out).toEqual({ served: 'legacy-engine' });
    expect(mockEngine).toHaveBeenCalledTimes(1);
    const engineReq = mockEngine.mock.calls[0][0];
    expect(engineReq.contentType).toBe('article');
    expect(engineReq.targetWordCount).toBe(1200);
    expect(mockPlatform).not.toHaveBeenCalled();
  });

  test('platform routes through the platform runtime with the same engine request + companyId', async () => {
    mockFlag.mockReturnValue(true);
    const out = await runManagedContentGeneration(REQUEST, 'guide');
    expect(out).toEqual({ served: 'platform' });
    expect(mockPlatform).toHaveBeenCalledTimes(1);
    const arg = mockPlatform.mock.calls[0][0];
    expect(arg.engineContentType).toBe('guide');
    expect(arg.companyId).toBe('org1');
    expect(arg.engineRequest.contentType).toBe('guide');
    expect(mockEngine).not.toHaveBeenCalled(); // engine invoked inside the platform runtime, not here
  });
});
