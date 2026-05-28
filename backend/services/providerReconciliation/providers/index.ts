/**
 * Provider barrel — importing this file activates all four provider
 * reconciliation stubs by triggering their `registerProviderReconciliationLookup`
 * module-side-effect.
 *
 * Foundation phase: all four lookups return `unverifiable`. Importing this
 * barrel from a future entry point (e.g. an admin reconciliation endpoint
 * or a sweeper cron) enables the registry without forcing every consumer
 * to know the file layout.
 */

import './linkedinReconciliation';
import './twitterReconciliation';
import './instagramReconciliation';
import './facebookReconciliation';
