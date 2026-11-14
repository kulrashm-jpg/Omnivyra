/**
 * EXPLICIT column lists for external_api_sources responses (e9 2026-11-14: an explicit select list, never `*` plus
 * redaction). oauth_client_id_encrypted / oauth_client_secret_encrypted are in NO list - no browser ever needs them.
 */

/** Columns a TENANT may receive for a source: no headers, query params, key names or OAuth material. */
export const TENANT_SOURCE_COLUMNS = [
  'id', 'name', 'base_url', 'purpose', 'category', 'is_active', 'auth_type', 'created_at', 'platform_type',
  'supported_content_types', 'promotion_modes', 'required_metadata', 'posting_constraints', 'requires_admin', 'method',
  'is_preset', 'company_id', 'rate_limit_per_min', 'retry_count', 'timeout_ms', 'is_whitelisted',
].join(', ');

/** Columns a PLATFORM ADMIN (Super Admin catalog) may receive: the tenant list plus request configuration. */
export const PLATFORM_ADMIN_SOURCE_COLUMNS = [
  TENANT_SOURCE_COLUMNS, 'headers', 'query_params', 'api_key_env_name', 'api_key_name',
].join(', ');

/** Columns of a PLATFORM PRESET offered to tenants as a TEMPLATE (headers / query params are template values they
 * copy into their own source); never the platform's key-variable names. */
export const TENANT_PRESET_TEMPLATE_COLUMNS = [
  'id', 'name', 'category', 'purpose', 'base_url', 'method', 'headers', 'query_params', 'auth_type', 'is_preset', 'company_id', 'created_at',
].join(', ');
