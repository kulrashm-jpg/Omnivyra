/**
 * LI-4D/LI-4E — the lead ingestion surface.
 *
 * Registration is EXPLICIT, never a side effect of importing a module. A module
 * that registers itself when loaded makes the set of available sources depend on
 * import order, which is how a source ends up present in one process and absent
 * in another.
 */

export {
  INGESTION_CONTRACT_VERSION,
  SOURCE_CAPABILITIES,
  validateNormalizedRecord,
  type AdapterResult,
  type IngestionBatchResult,
  type IngestionEntityType,
  type IngestionRecordOutcome,
  type IngestionRejection,
  type LeadSourceAdapter,
  type NormalizedAccount,
  type NormalizedIngestionRecord,
  type NormalizedPerson,
  type SourceCapability,
} from './contracts';

export {
  registerLeadSourceAdapter,
  getLeadSourceAdapter,
  hasLeadSourceAdapter,
  listLeadSources,
  sourceSupports,
  AdapterRegistrationError,
  UnsupportedSourceError,
} from './registry';

export {
  ingestLeadBatch,
  ingestNormalizedRecord,
  isLeadIngestionEnabled,
  MAX_BATCH_SIZE,
  type IngestBatchInput,
} from './orchestrator';

export {
  MANUAL_SOURCE,
  ManualInputError,
  manualAdapter,
  manualExternalId,
  toNormalizedManualRecord,
  validateManualInput,
  type ManualLeadInput,
} from './adapters/manualAdapter';

export {
  CRM_SOURCE,
  crmAdapter,
  crmExternalId,
  toNormalizedCrmRecord,
  type CrmLeadInput,
} from './adapters/crmAdapter';

export {
  CSV_SOURCE,
  csvAdapter,
  csvExternalId,
  toNormalizedCsvRecord,
  type CsvLeadInput,
} from './adapters/csvAdapter';

import { hasLeadSourceAdapter, registerLeadSourceAdapter } from './registry';
import { manualAdapter } from './adapters/manualAdapter';
import { crmAdapter } from './adapters/crmAdapter';
import { csvAdapter } from './adapters/csvAdapter';

/**
 * Register the adapters that ship with the platform.
 *
 * Idempotent: registering twice is a no-op rather than the registry's
 * duplicate-registration error, so a second call from a different entry point
 * cannot crash a process.
 *
 * All three built-ins are operator-supplied entry adapters — `manual`, `crm`
 * and `csv`. None reaches a provider: `crm` is a NAMESPACE, not an integration,
 * and is unrelated to `crmIngestionService` and its scheduler, and `csv` receives
 * rows the client already parsed, never a file. No provider adapter exists, and
 * none is registered optimistically.
 */
export function registerBuiltInLeadSources(): void {
  if (!hasLeadSourceAdapter(manualAdapter.source)) {
    registerLeadSourceAdapter(manualAdapter);
  }
  if (!hasLeadSourceAdapter(crmAdapter.source)) {
    registerLeadSourceAdapter(crmAdapter);
  }
  if (!hasLeadSourceAdapter(csvAdapter.source)) {
    registerLeadSourceAdapter(csvAdapter);
  }
}
