# Test Utilities – Mock Stabilization

Standardized mocks for deterministic, infrastructure-free tests.

> **Reporting a test result? Run it through `scripts/run-tests-strict.sh <paths>`** - it fails if any suite failed
> to RUN, ran zero tests, or fewer suites ran than expected, and prints jest's `Test Suites:` / `Tests:` lines verbatim
> (a load error adds 0 tests, so a `Tests:` count alone can look green). Before trusting a run in a junctioned
> worktree, check `node scripts/testing/list-config-loading-suites.js`: those suites load the zod env config and
> cannot run against a `node_modules` whose zod differs from the branch's. Gate every heavy local run (jest suites, tsc,
> replays) on free memory: `bash scripts/testing/ramgate.sh && <command>` - it refuses below 2 GB (`MIN_GB` to
> change) and when memory cannot be measured; a printed free-RAM number is not a check. The floor is defined once, in
> `ramgate.sh` (`--print-floor` reads it): the shared typecheck lock (`C:/tmp/.omp-typecheck.lock`) is acquired only
> after `ramgate.sh` passes, never against a separately written number. `run-tests-strict.sh` exits 2 (INCONCLUSIVE,
> never PASS) when `jest --listTests` fails or lists fewer suites than one per path argument.

## 1. Request Mock – `createApiRequestMock`

**Use for ALL API handler tests.** No custom inline req objects.

```ts
import { createApiRequestMock } from '../utils';

const req = createApiRequestMock({
  method: 'POST',
  companyId: 'default',
  body: { name: 'Acme' },
});
```

Ensures: `headers`, `query`, `body`, `method` always exist. `companyId` auto-populates query/body for RBAC.

## 2. Response Mock – `createMockRes`

```ts
import { createMockRes } from '../utils';

const res = createMockRes();
await handler(req, res);
expect(res.statusCode).toBe(200);
expect(res.body?.profile).toBeDefined();
```

## 3. Supabase Mock – `createSupabaseMock`

Full chain: `.select()`, `.insert()`, `.update()`, `.delete()`, `.eq()`, `.in()`, `.or()`, `.gte()`, `.lte()`, `.order()`, `.limit()`, `.single()`, `.maybeSingle()`, `.then()`.

```ts
import { createSupabaseMock } from '../utils';

const mockResponses = (table: string) => {
  if (table === 'recommendation_policies') return { data: [policyRow], error: null };
  return { data: [], error: null };
};

const { from, rpc } = createSupabaseMock(mockResponses);
(supabase as any).from.mockImplementation(from);
```

## 4. RBAC – `getRbacMockImplementations`

```ts
jest.mock('../../services/rbacService', () => require('../utils/setupApiTest').getRbacMockImplementations());
```

Preserves `Role`, `PERMISSIONS`; overrides `getUserRole`, `hasPermission`, `isSuperAdmin`, `isPlatformSuperAdmin`.

## 5. Auth – `authMockImplementations`

```ts
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
```
