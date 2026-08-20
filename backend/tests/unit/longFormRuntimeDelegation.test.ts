/**
 * WS-1c-4 (Zone A1) — long-form runtime delegation seam.
 *
 * Proves the flag-gated dispatch used by the unified long-form funnel:
 *   - default / OFF  ⇒ the legacy engine fn is called DIRECTLY (byte-identical).
 *   - ON             ⇒ the SAME request routes through the runtime long-form
 *                      adapter, returning the SAME result.
 * The adapter is mocked as a black box here; its own byte-identity/transparency
 * is proven in longFormRuntimeAdapter.test.ts.
 */

jest.mock('../../services/content/runtime/longFormRuntimeAdapter', () => ({
  longFormRuntimeAdapter: { runBlog: jest.fn() },
}));

import {
  dispatchLongFormCompatibilityCore,
  isLongFormRuntimeDelegationEnabled,
} from '../../../lib/content/longFormRuntimeDelegation';
import { longFormRuntimeAdapter } from '../../services/content/runtime/longFormRuntimeAdapter';

/** The legacy fn's tuple, taken from the dispatcher's own parameter. */
type LegacyArgs = Parameters<Parameters<typeof dispatchLongFormCompatibilityCore>[1]>;

const mockAdapterRunBlog = longFormRuntimeAdapter.runBlog as jest.Mock;

const SENTINEL: any = { needs_clarification: false, mode: 'full', result: { content_html: '<p>x</p>' } };
const REQ: any = { company_id: 'org1', topic: 'Launch', contentType: 'blog' };

const ORIGINAL_FLAG = process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED;

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED;
  else process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED = ORIGINAL_FLAG;
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED;
});

describe('isLongFormRuntimeDelegationEnabled', () => {
  test.each(['1', 'true', 'on', 'yes', 'TRUE', 'On', 'YES'])('truthy for %p', (v) => {
    process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED = v;
    expect(isLongFormRuntimeDelegationEnabled()).toBe(true);
  });

  test.each(['', '0', 'false', 'off', 'no', 'nope', undefined])('falsy for %p', (v) => {
    if (v === undefined) delete process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED;
    else process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED = v;
    expect(isLongFormRuntimeDelegationEnabled()).toBe(false);
  });
});

describe('dispatchLongFormCompatibilityCore', () => {
  test('flag OFF (default): calls the legacy fn directly, adapter untouched', async () => {
    const legacy = jest.fn(async () => SENTINEL);
    const out = await dispatchLongFormCompatibilityCore(REQ, legacy);

    expect(out).toBe(SENTINEL); // exact same object — byte-identical
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith(REQ);
    expect(mockAdapterRunBlog).not.toHaveBeenCalled();
  });

  test('flag ON: routes through the adapter with the SAME request, legacy untouched', async () => {
    process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED = '1';
    mockAdapterRunBlog.mockResolvedValue(SENTINEL);
    const legacy = jest.fn(async () => ({ served: 'legacy' } as any));

    const out = await dispatchLongFormCompatibilityCore(REQ, legacy);

    expect(out).toBe(SENTINEL); // exact same object returned by the adapter
    expect(mockAdapterRunBlog).toHaveBeenCalledTimes(1);
    expect(mockAdapterRunBlog).toHaveBeenCalledWith(REQ);
    expect(legacy).not.toHaveBeenCalled();
  });

  test('byte-identity: OFF and ON return the identical value for the same request', async () => {
    // OFF
    const legacy = jest.fn(async (..._a: LegacyArgs) => SENTINEL);
    const off = await dispatchLongFormCompatibilityCore(REQ, legacy);
    // ON — adapter is a transparent envelope over the same legacy fn
    process.env.LONGFORM_RUNTIME_DELEGATION_ENABLED = 'true';
    mockAdapterRunBlog.mockImplementation((r: any) => legacy(r));
    const on = await dispatchLongFormCompatibilityCore(REQ, legacy);

    expect(on).toBe(off);
    expect(on).toEqual(off);
  });
});
