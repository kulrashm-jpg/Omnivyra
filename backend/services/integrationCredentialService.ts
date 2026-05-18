import { encryptCredential, decryptCredential } from '../auth/credentialEncryption';
import { ownedDbTable } from '../db/writeOwner';

export type CredentialMap = Record<string, string>;

export const SECRET_CONFIG_KEYS = new Set([
  'secret',
  'api_key',
  'app_password',
  'password',
  'access_token',
  'refresh_token',
  'client_secret',
  'webhook_secret',
]);

export function splitSecretConfig(config: Record<string, unknown> | null | undefined): {
  nonSecretConfig: Record<string, string>;
  credentials: CredentialMap;
} {
  const nonSecretConfig: Record<string, string> = {};
  const credentials: CredentialMap = {};

  for (const [key, rawValue] of Object.entries(config ?? {})) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue);
    if (SECRET_CONFIG_KEYS.has(key)) {
      if (value.trim()) credentials[key] = value;
    } else {
      nonSecretConfig[key] = value;
    }
  }

  return { nonSecretConfig, credentials };
}

export function maskCredentials(config: Record<string, string>): Record<string, string> {
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (SECRET_CONFIG_KEYS.has(key)) masked[key] = '********';
  }
  return masked;
}

export async function upsertConnectionCredentials(
  connectionId: string,
  credentials: CredentialMap,
): Promise<void> {
  const entries = Object.entries(credentials).filter(([, value]) => value?.trim());
  if (entries.length === 0) return;

  const rows = entries.map(([credential_key, value]) => ({
    connection_id: connectionId,
    credential_key,
    encrypted_value: encryptCredential(value),
    rotated_at: new Date().toISOString(),
  }));

  const { error } = await ownedDbTable('integration_credentials')
    .upsert(rows, { onConflict: 'connection_id,credential_key' });
  if (error) throw new Error(error.message);
}

export async function getConnectionCredentials(connectionId: string): Promise<CredentialMap> {
  const { data, error } = await ownedDbTable('integration_credentials')
    .select('credential_key, encrypted_value')
    .eq('connection_id', connectionId);
  if (error) throw new Error(error.message);

  const credentials: CredentialMap = {};
  for (const row of (data || []) as Array<{ credential_key: string; encrypted_value: string }>) {
    try {
      credentials[row.credential_key] = decryptCredential(row.encrypted_value);
    } catch {
      credentials[row.credential_key] = '';
    }
  }
  return credentials;
}

export async function mergeConnectionConfig(
  connectionId: string | null | undefined,
  nonSecretConfig: Record<string, string> | null | undefined,
  legacyConfig?: Record<string, string> | null,
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {
    ...(legacyConfig ?? {}),
    ...(nonSecretConfig ?? {}),
  };

  if (!connectionId) return merged;

  const credentials = await getConnectionCredentials(connectionId).catch(() => ({} as CredentialMap));
  return {
    ...merged,
    ...credentials,
  };
}
