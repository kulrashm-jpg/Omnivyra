import { createWordPressSetupSession, consumeWordPressSetupSession } from '../backend/services/wordpressPluginSetupService';
import { syncWordPressPluginEvent } from '../backend/services/wordpressPluginService';
import { createPublishingJob, runPublishingWorker } from '../backend/services/publishingJobService';
import { enqueuePublishedJobsForReconciliation, runPublishReconciliationWorker } from '../backend/services/publishReconciliationService';
import { aggregateFormPerformance } from '../backend/services/formIntelligenceService';
import { generateWebsiteIntelligenceSignals } from '../backend/services/websiteIntelligenceService';
import { getWebsiteIntelligenceDashboard } from '../backend/services/websiteDashboardService';

async function main() {
  const companyId = arg('--company-id');
  if (!companyId) throw new Error('--company-id is required');
  const siteUrl = arg('--site-url') || 'https://example.test';
  const dryRun = process.argv.includes('--dry-run');
  const assertions: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  if (dryRun) {
    assertions.push({ name: 'dry_run_configuration', ok: true, detail: { companyId, siteUrl } });
    print(assertions);
    return;
  }

  const setup = await createWordPressSetupSession({ companyId, expectedDomain: new URL(siteUrl).hostname, expiresInMinutes: 30 });
  assertions.push({ name: 'setup_session_created', ok: Boolean(setup.setupToken), detail: { expiresAt: setup.expiresAt } });

  const connection = await consumeWordPressSetupSession({
    setupToken: setup.setupToken,
    siteUrl,
    pluginSiteId: `e2e-${Date.now()}`,
    pluginVersion: '0.4.0',
    wpVersion: '6.5',
    phpVersion: '8.2',
    capabilities: { e2e: true },
    settings: { tracking_enabled: true },
  });
  assertions.push({ name: 'plugin_connected', ok: Boolean(connection.accessToken && connection.websiteId), detail: { websiteId: connection.websiteId } });

  const sync = await syncWordPressPluginEvent({
    accessToken: connection.accessToken,
    eventType: 'post.sync',
    idempotencyKey: `e2e-post-${Date.now()}`,
    payload: {
      items: [{
        id: 'e2e-post-1',
        title: 'E2E Post',
        slug: 'e2e-post',
        permalink: `${siteUrl}/e2e-post`,
        status: 'publish',
        modified_at: new Date().toISOString(),
      }],
      cursor: new Date().toISOString(),
    },
  });
  assertions.push({ name: 'reverse_sync_post', ok: sync.accepted });

  await aggregateFormPerformance({ companyId, websiteId: connection.websiteId });
  assertions.push({ name: 'form_aggregation_callable', ok: true });

  await enqueuePublishedJobsForReconciliation({ companyId, websiteId: connection.websiteId, limit: 5 });
  const reconciliation = await runPublishReconciliationWorker({ workerId: `e2e-reconcile-${Date.now()}`, limit: 5 });
  assertions.push({ name: 'reconciliation_worker_callable', ok: reconciliation.claimed >= 0, detail: reconciliation });

  const signals = await generateWebsiteIntelligenceSignals({ companyId, websiteId: connection.websiteId });
  assertions.push({ name: 'signals_generated', ok: Array.isArray(signals.generated), detail: { count: signals.generated.length } });

  const dashboard = await getWebsiteIntelligenceDashboard({ companyId, websiteId: connection.websiteId, useCache: false });
  assertions.push({ name: 'dashboard_render_payload', ok: Boolean(dashboard.overview && dashboard.cms_health), detail: { sections: Object.keys(dashboard) } });

  await maybeExercisePublishing(companyId, connection.websiteId, assertions);
  print(assertions);
}

async function maybeExercisePublishing(companyId: string, websiteId: string, assertions: Array<{ name: string; ok: boolean; detail?: unknown }>) {
  const blogId = arg('--blog-id');
  if (!blogId) {
    assertions.push({ name: 'publish_post_skipped', ok: true, detail: 'Pass --blog-id to exercise live publish queue.' });
    return;
  }
  const job = await createPublishingJob({
    companyId,
    websiteId,
    blogId,
    provider: 'wordpress',
    idempotencyKey: `e2e-publish:${blogId}:${Date.now()}`,
    requestPayload: { html_content: '<p>E2E validation publish.</p>', publish_status: 'draft' },
  });
  const result = await runPublishingWorker({ workerId: `e2e-publisher-${Date.now()}`, limit: 1 });
  assertions.push({ name: 'publish_worker_callable', ok: Boolean(job.id && result.claimed >= 0), detail: result });
}

function arg(name: string) {
  return process.argv.find((item) => item.startsWith(`${name}=`))?.split('=').slice(1).join('=');
}

function print(assertions: Array<{ name: string; ok: boolean; detail?: unknown }>) {
  const failed = assertions.filter((item) => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, assertions }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
