export const supabasePasswordLoginSuccess = {
  data: {
    session: {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_at: 1893456000,
      user: {
        id: 'supabase-user-id',
        email: 'user@example.com',
        app_metadata: {},
        user_metadata: {},
      },
    },
    user: {
      id: 'supabase-user-id',
      email: 'user@example.com',
    },
  },
  error: null,
};

export const authSessionContract = {
  authenticated: true,
  via: 'supabase',
  user: {
    id: 'public-user-id',
    supabaseUid: 'supabase-user-id',
    email: 'user@example.com',
    emailVerified: true,
  },
  session: {
    id: 'session-id',
    ageSeconds: 12,
    staleSeconds: 0,
  },
  activeOrgId: 'company-id',
  organizations: [
    {
      organizationId: 'company-id',
      role: 'admin',
      status: 'active',
    },
  ],
  mfa: {
    enrolled: false,
    factors: [],
    lastVerifiedAt: null,
    phishingResistant: false,
  },
  stepUp: {
    active: false,
    expiresAt: null,
    factor: null,
  },
  device: {
    trusted: false,
  },
  legacyCookieSuperAdmin: false,
};

export const billingLedgerRowContract = {
  id: 'credit-tx-id',
  execution_phase: 'confirm',
  credits_delta: -1,
  balance_after: 99,
  usd_equivalent: 0.01,
  reference_type: 'content_generation',
  reference_id: 'activity-id',
  note: 'contract fixture',
  idempotency_key: 'idem-key',
  parent_transaction_id: null,
  category: 'usage',
  created_at: '2026-01-01T00:00:00.000Z',
  immutable: true,
};
