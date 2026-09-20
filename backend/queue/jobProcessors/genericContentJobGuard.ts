/**
 * Generic content job guard.
 *
 * processContentGenerationJob consumes ONLY the content-* queues — the
 * `generic-content` family in workerTopologyManifest. It runs this guard before
 * billing, admission and every model/provider call, and refuses a job that did not
 * come from one of those queues or whose payload is not a generic
 * content-generation payload. Dedicated payloads (analytics, WhatsApp, creator
 * rows) previously reached the model call and only then failed.
 *
 * The rejection is an ordinary, retryable Error on purpose: if a misrouted
 * consumer ever returns, a retry can still reach the queue's real consumer, and
 * an exhausted job is still recorded by deadLetterOnExhaustion (which only sees
 * jobs whose attempts are used up).
 */
import { genericContentQueueNames } from '../workerTopologyManifest';
import { isLongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import { isSupportedContentType } from '../../services/unifiedContentGenerationEngine';

export type GenericContentJobRejection =
  | 'non_generic_queue'
  | 'payload_not_object'
  | 'dedicated_payload'
  | 'missing_company_id'
  | 'bulk_without_items'
  | 'unsupported_content_type';

export class GenericContentJobRejectedError extends Error {
  readonly reason: GenericContentJobRejection;

  constructor(reason: GenericContentJobRejection, jobId: unknown, detail: string) {
    super(
      `[contentGenerationProcessor] Refused job ${String(jobId ?? 'unknown')} (${reason}): ${detail}. ` +
        'No model or provider call was made.',
    );
    this.name = 'GenericContentJobRejectedError';
    this.reason = reason;
  }
}

export interface GuardableJob {
  id?: string | number | null;
  queueName?: string;
  data?: unknown;
}

/** Throws GenericContentJobRejectedError unless `job` is a generic content job. */
export function assertGenericContentJob(job: GuardableJob): void {
  const genericQueues = genericContentQueueNames();
  if (typeof job.queueName !== 'string' || !genericQueues.includes(job.queueName)) {
    throw new GenericContentJobRejectedError(
      'non_generic_queue',
      job.id,
      `queue '${String(job.queueName)}' is not a generic content queue (${genericQueues.join(', ')})`,
    );
  }

  const data = job.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new GenericContentJobRejectedError('payload_not_object', job.id, 'payload is not an object');
  }
  const payload = data as Record<string, unknown>;

  if ('bolt_payload' in payload) {
    throw new GenericContentJobRejectedError(
      'dedicated_payload',
      job.id,
      'payload is a creator-row job (bolt_payload), owned by the creator-content consumer',
    );
  }
  if (typeof payload.company_id !== 'string' || payload.company_id.length === 0) {
    throw new GenericContentJobRejectedError('missing_company_id', job.id, 'payload has no company_id');
  }

  if (payload.bulk_mode) {
    if (!Array.isArray(payload.items)) {
      throw new GenericContentJobRejectedError('bulk_without_items', job.id, 'bulk payload has no items array');
    }
    return;
  }

  const contentType = payload.content_type;
  if (typeof contentType === 'string' && (isLongFormContentType(contentType) || isSupportedContentType(contentType))) {
    return;
  }
  throw new GenericContentJobRejectedError(
    'unsupported_content_type',
    job.id,
    `content_type '${String(contentType)}' is not a generic content type`,
  );
}
