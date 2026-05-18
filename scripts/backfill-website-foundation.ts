import { ownedDbTable } from '../backend/db/writeOwner';
import { createWebsiteConnection, ensureDefaultWebsite } from '../backend/services/websiteService';
import { splitSecretConfig, upsertConnectionCredentials } from '../backend/services/integrationCredentialService';

async function main() {
  const { data: companies, error: companiesError } = await ownedDbTable('companies')
    .select('id, created_by');
  if (companiesError) throw new Error(companiesError.message);

  for (const company of companies || []) {
    const website = await ensureDefaultWebsite(String(company.id), company.created_by ? String(company.created_by) : null);

    await ownedDbTable('forms')
      .update({ website_id: website.id, updated_at: new Date().toISOString() })
      .eq('company_id', company.id)
      .is('website_id', null);

    await ownedDbTable('leads')
      .update({ website_id: website.id })
      .eq('company_id', company.id)
      .is('website_id', null);

    await ownedDbTable('blogs')
      .update({ website_id: website.id, updated_at: new Date().toISOString() })
      .eq('company_id', company.id)
      .is('website_id', null);

    const { data: integrations, error: integrationError } = await ownedDbTable('company_integrations')
      .select('*')
      .eq('company_id', company.id);
    if (integrationError) throw new Error(integrationError.message);

    for (const integration of integrations || []) {
      if (integration.website_connection_id && integration.credential_migration_status === 'encrypted') continue;

      const config = (integration.config || {}) as Record<string, string>;
      const { nonSecretConfig, credentials } = splitSecretConfig(config);
      const connection = await createWebsiteConnection({
        websiteId: integration.website_id || website.id,
        provider: String(integration.type),
        authType: integration.type === 'wordpress' ? 'basic' : 'api_key',
        nonSecretConfig,
        status: integration.status || 'pending',
      });

      await upsertConnectionCredentials(connection.id, credentials);
      await ownedDbTable('company_integrations')
        .update({
          website_id: integration.website_id || website.id,
          website_connection_id: connection.id,
          config: nonSecretConfig,
          non_secret_config: nonSecretConfig,
          credential_migration_status: 'encrypted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id);
    }
  }
}

main()
  .then(() => {
    console.log('Website foundation backfill completed.');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
