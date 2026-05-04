import type { NextApiRequest } from 'next';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertNoCampaignStateBypass } from '../services/campaignStateWriteGuard';

let _serverEnvLoaded = false;
let _serviceRoleClient: SupabaseClient | null = null;

function ensureServerEnvLoaded(): void {
  if (_serverEnvLoaded) return;
  _serverEnvLoaded = true;

  // Keep dotenv on the runtime path only so Next build doesn't need to analyze it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({ path: `${process.cwd()}/.env.local` });
  dotenv.config();
}

function requireConfig(name: string, value: string | undefined): string {
  ensureServerEnvLoaded();
  if (!value) throw new Error(`${name} is missing in environment variables.`);
  return value;
}

function getSupabaseUrl(): string {
  return requireConfig(
    'SUPABASE_URL',
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

function getSupabaseAnonKey(): string {
  return requireConfig(
    'SUPABASE_ANON_KEY',
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getServiceRoleClient(): SupabaseClient {
  if (_serviceRoleClient) return _serviceRoleClient;

  /**
   * WARNING:
   * Service-role bypasses RLS.
   * Use ONLY via runWithServiceRole with justification.
   */
  _serviceRoleClient = createClient(
    getSupabaseUrl(),
    requireConfig('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  return _serviceRoleClient;
}

export function getUserClient(req: NextApiRequest): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: {
      headers: {
        Authorization: req.headers.authorization || '',
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function runWithServiceRole<T>(
  reasonOrFn: string | ((client: SupabaseClient) => PromiseLike<T> | T),
  maybeFn?: (client: SupabaseClient) => PromiseLike<T> | T,
): Promise<Awaited<T>> {
  const reason = typeof reasonOrFn === 'string' ? reasonOrFn : 'Service role operation';
  const fn = typeof reasonOrFn === 'function' ? reasonOrFn : maybeFn;

  if (!reason.trim()) {
    throw new Error('Service role usage requires explicit reason');
  }
  if (!fn) {
    throw new Error('Service role callback is required');
  }

  return await fn(getServiceRoleClient());
}

type SupabaseOperation = {
  prop: PropertyKey;
  args: unknown[];
};

function createServiceRoleChain(reason: string, operations: SupabaseOperation[] = []): any {
  const run = () => runWithServiceRole(reason, async (client) => {
    let target: any = client;
    for (const operation of operations) {
      const value = target[operation.prop];
      target = typeof value === 'function'
        ? value.apply(target, operation.args)
        : value;
    }
    return await target;
  });

  return new Proxy(() => undefined, {
    apply(_target, _thisArg, args) {
      const previous = operations[operations.length - 1];
      if (!previous) {
        throw new Error('Service role migration proxy called without a property.');
      }
      return createServiceRoleChain(reason, [
        ...operations.slice(0, -1),
        { prop: previous.prop, args },
      ]);
    },
    get(_target, prop) {
      if (prop === 'then') return run().then.bind(run());
      if (prop === 'catch') return run().catch.bind(run());
      if (prop === 'finally') return run().finally.bind(run());
      return createServiceRoleChain(reason, [...operations, { prop, args: [] }]);
    },
  });
}

export function createServiceRoleMigrationProxy(reason: string): SupabaseClient {
  if (!reason.trim()) {
    throw new Error('Service role usage requires explicit reason');
  }
  return createServiceRoleChain(reason) as SupabaseClient;
}

function guardCampaignBuilder(table: unknown, builder: any): any {
  if (table !== 'campaigns' || !builder || typeof builder.update !== 'function') {
    return builder;
  }
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop !== 'update') return Reflect.get(target, prop, receiver);
      return (payload: unknown, ...args: unknown[]) => {
        assertNoCampaignStateBypass(payload);
        return target.update(payload, ...args);
      };
    },
  });
}

export const supabase = new Proxy({} as SupabaseClient, {
  get() {
    throw new Error('Direct supabase usage is prohibited. Use getUserClient or runWithServiceRole.');
  },
});
