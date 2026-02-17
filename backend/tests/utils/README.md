# Test Utilities – Mock Stabilization

Standardized mocks for deterministic, infrastructure-free tests.

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
