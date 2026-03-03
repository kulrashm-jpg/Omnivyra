import { getLatestProfile } from '../services/companyProfileService';

/** INTERNAL = company's own user (default). EXTERNAL = agency/external. Infrastructure only; no enforcement yet. */
export type MembershipType = 'INTERNAL' | 'EXTERNAL';

export type UserContext = {
  userId: string;
  role: 'admin' | 'user';
  companyIds: string[];
  defaultCompanyId: string;
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

export const resolveUserContext = async (): Promise<UserContext> => {
  const role = normalizeRole(process.env.DEV_ROLE || 'admin');
  let companyIds = parseCompanyIds(process.env.DEV_COMPANY_IDS);

  if (companyIds.length === 0) {
    const latest = await getLatestProfile();
    if (latest?.company_id) {
      companyIds = [latest.company_id];
    } else {
      companyIds = ['default'];
    }
  }

  const userContext: UserContext = {
    userId: process.env.DEV_USER_ID || 'dev-user',
    role,
    companyIds,
    defaultCompanyId: companyIds[0],
    membershipType: 'INTERNAL',
    membershipByCompany: companyIds.length ? Object.fromEntries(companyIds.map((c) => [c, 'INTERNAL'])) : undefined,
  };

  console.log('USER_CONTEXT_RESOLVED', userContext);
  return userContext;
};
