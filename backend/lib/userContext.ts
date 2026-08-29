import { ownedDbTable } from '../db/writeOwner';
import { config } from '@/config';

/** INTERNAL = company's own user (default). EXTERNAL = agency/external. Infrastructure only; no enforcement yet. */
export type MembershipType = 'INTERNAL' | 'EXTERNAL';

// In-process cache: keyed by env vars, TTL 60 s. Avoids a DB hit on every request.
let _contextCache: { value: UserContext; expiresAt: number } | null = null;
const CONTEXT_CACHE_TTL_MS = 60_000;

export type UserContext = {
  userId: string;
  role: 'admin' | 'user';
  companyIds: string[];
  defaultCompanyId: string;
  /**
   * AUTH-CTX-001 — whether this context came from a PROVEN identity.
   *
   * `false` means authentication failed and no identity exists. Guards must
   * answer 401 for such a context and must not consult tenancy: a caller who
   * never authenticated is not a non-member, and reporting them as one sent
   * CP-STRUCT-005 diagnosis at the wrong subsystem for two rounds.
   *
   * Absent means "not stated" — only an explicit `false` triggers the 401
   * gate, so any other producer of a UserContext is unaffected.
   */
  authenticated?: boolean;
  /** Why authentication failed (MISSING_AUTH, INVALID_AUTH, SESSION_REVOKED,
   *  ACCOUNT_DELETED, ACCOUNT_SUSPENDED, ACCOUNT_INVITED). Never a tenancy
   *  reason — those stay with TenantGuard. */
  authError?: string | null;
  /** Default company's membership type. Present when resolved from DB. */
  membershipType?: MembershipType;
  /** Per-company membership. Used for future visibility filtering. */
  membershipByCompany?: Record<string, MembershipType>;
};

const normalizeRole = (value?: string | null): 'admin' | 'user' => {
  const lower = (value || '').toLowerCase();
  return lower === 'user' ? 'user' : 'admin';
};

const parseCompanyIds = (value?: string | string[] | null): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  const trimmed = String(value).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // fall through to delimiter parsing
    }
  }
  return trimmed
    .split(/[,;\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

async function getLatestCompanyId(): Promise<string | null> {
  const { data, error } = await ownedDbTable('company_profiles')
    .select('company_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch latest company id: ${error.message}`);
  const companyId = (data as { company_id?: string | null } | null)?.company_id;
  return companyId || null;
}

export const resolveUserContext = async (): Promise<UserContext> => {
  // Return cached value if still fresh
  if (_contextCache && Date.now() < _contextCache.expiresAt) {
    return _contextCache.value;
  }

  const role = normalizeRole(config.DEV_ROLE || 'admin');
  let companyIds = parseCompanyIds(config.DEV_COMPANY_IDS);

  if (companyIds.length === 0) {
    try {
      const latestCompanyId = await getLatestCompanyId();
      if (latestCompanyId) {
        companyIds = [latestCompanyId];
      } else {
        companyIds = ['default'];
      }
    } catch {
      companyIds = ['default'];
    }
  }

  const userContext: UserContext = {
    userId: config.DEV_USER_ID || 'dev-user',
    role,
    companyIds,
    defaultCompanyId: companyIds[0],
    membershipType: 'INTERNAL',
    membershipByCompany: companyIds.length ? Object.fromEntries(companyIds.map((c) => [c, 'INTERNAL'])) : undefined,
  };

  _contextCache = { value: userContext, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS };
  console.debug('[userContext] resolved', { userId: userContext.userId, defaultCompanyId: userContext.defaultCompanyId });
  return userContext;
};
