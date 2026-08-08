/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 5 — Contact production façade.
 *
 * THE single surface Platform will consume. Everything a future adopter needs is reachable from here:
 * the producer port, the consumer port, the dependency contract, readiness, activation validation and
 * parity — so adoption requires wiring, not another change inside Contact Intelligence.
 *
 * ─── PORTS, NOT IMPLEMENTATIONS ────────────────────────────────────────────────────────────────────
 * `ContactProducerPort` and `ContactConsumerPort` are the shapes Platform codes against. The façade
 * supplies the default implementations by delegating to the certified Phase 1–4 seams; it re-derives
 * nothing and duplicates nothing. A caller may substitute either port in a test without this module
 * knowing.
 *
 * ─── THE FAÇADE OWNS NO RUNTIME ────────────────────────────────────────────────────────────────────
 * Creating a façade starts nothing, registers nothing and connects to nothing. Persistence arrives
 * only as an injected dependency, and the one method that can write refuses unless the flag is on —
 * that guard lives in `runContactShadowPersist` and is not re-implemented here. A façade created with
 * no dependencies is a read-only object that can still produce, project, assess and validate.
 */

import type { ContactProjection, ContactUnderstanding } from '../types';
import type { ContactEvidenceInput } from '../fromEvidence';
import type { ContactShadowBundle } from '../shadowRuntime';
import type {
  ContactWriteInputs, CanonicalContactResult, CanonicalContactRecord, ContactRowLike,
} from './canonicalContactProducer';
import type { ContactShadowPersistDeps, ContactShadowPersistResult } from './contactShadowPersistence';
import type {
  ContactConsumerReadiness, ContactCapabilityReadiness, ContactActivationValidation, ContactRuntimeCompatibility,
} from '../readiness';

import { produceCanonicalContact, collectContactEvidence, writeInputsFromContactRow } from './canonicalContactProducer';
import { runContactShadowPersist } from './contactShadowPersistence';
import { assembleContactUnderstanding } from '../assembly';
import { computeContactUnderstandingShadow } from '../shadowRuntime';
import { projectContact } from '../projection';
import { validateContactContract, type ContactContractConformance } from '../contract';
import {
  assessContactConsumerReadiness, assessContactCapabilityReadiness,
  validateContactActivation, checkContactRuntimeCompatibility,
} from '../readiness';

// ── Ports Platform codes against ───────────────────────────────────────────────────────────────────
export interface ContactProducerPort {
  /** Build a canonical contact + persistable record from write-path inputs. Pure. */
  produce(input: ContactWriteInputs): CanonicalContactResult;
  /** Adapt a `contacts` row into write-path inputs. Pure. */
  fromRow(row: ContactRowLike, asOf: string, extra?: Pick<ContactWriteInputs, 'channels' | 'interactions' | 'sourceRefs' | 'source'>): ContactWriteInputs;
}

export interface ContactConsumerPort {
  /** The canonical projection for already-fetched evidence. Pure. */
  project(input: ContactEvidenceInput): ContactProjection;
  /** The flag-gated shadow bundle, or null when dark. */
  shadow(input: ContactEvidenceInput): ContactShadowBundle | null;
  /** Contract conformance for a produced understanding. */
  validate(u: ContactUnderstanding): ContactContractConformance;
}

/** Everything the façade may be given. All optional — a façade with none is read-only. */
export interface ContactRuntimeDeps {
  persist?: ContactShadowPersistDeps;
  /** Declared by the adopter when it has registered a producer in its own runtime. */
  producerRegistered?: boolean;
}

export interface ContactProductionFacade {
  readonly producer: ContactProducerPort;
  readonly consumer: ContactConsumerPort;
  /** Persist the canonical record through the injected store. Refuses when dark or unbound. */
  persist(input: ContactWriteInputs): Promise<ContactShadowPersistResult>;
  consumerReadiness(input: ContactEvidenceInput): ContactConsumerReadiness;
  capabilityReadiness(input: ContactEvidenceInput): ContactCapabilityReadiness;
  activation(): ContactActivationValidation;
  compatibility(expectedContractVersion: number, expectedModelVersion?: number): ContactRuntimeCompatibility;
}

const producerPort: ContactProducerPort = {
  produce: produceCanonicalContact,
  fromRow: writeInputsFromContactRow,
};

const consumerPort: ContactConsumerPort = {
  project: (input) => assembleContactUnderstanding(input).projection,
  shadow: computeContactUnderstandingShadow,
  validate: validateContactContract,
};

/**
 * Build the façade. Creating one has no side effect: no registration, no connection, no timer. The
 * ports are shared singletons because they are stateless pure delegations.
 */
export function createContactProductionFacade(deps: ContactRuntimeDeps = {}): ContactProductionFacade {
  return {
    producer: producerPort,
    consumer: consumerPort,

    async persist(input: ContactWriteInputs): Promise<ContactShadowPersistResult> {
      // Unbound store is reported in the SAME shape as a disabled flag, so an adopter handles one
      // "nothing happened" path rather than a result and an exception.
      if (!deps.persist) {
        return { companyId: input.companyId, contactId: input.contactId, executed: false, wrote: false, reason: 'DISABLED', parity: null, version: null, builtAt: null };
      }
      return runContactShadowPersist(input, deps.persist);
    },

    consumerReadiness: assessContactConsumerReadiness,
    capabilityReadiness: assessContactCapabilityReadiness,
    activation: () => validateContactActivation({ persist: deps.persist, producerRegistered: deps.producerRegistered }),
    compatibility: checkContactRuntimeCompatibility,
  };
}

// ── Production parity helpers ──────────────────────────────────────────────────────────────────────
export interface ContactParityCase { inputs: ContactWriteInputs; }
export interface ContactParityRow { companyId: string; contactId: string; parity: number; divergentFields: string[]; }
export interface ContactParityReport {
  rows: ContactParityRow[];
  overallParity: number;
  totalDivergences: number;
  /** true iff every case round-tripped without losing or inventing a field. */
  certifiable: boolean;
}

/**
 * Run the producer across representative contacts and report field parity. Offline / CI certification
 * only — consumed by nothing in production. Pure and deterministic.
 */
export function runContactProductionParity(cases: ContactParityCase[]): ContactParityReport {
  const rows: ContactParityRow[] = cases.map(({ inputs }) => {
    const { comparison } = produceCanonicalContact(inputs);
    return {
      companyId: inputs.companyId,
      contactId: inputs.contactId,
      parity: comparison.parity,
      divergentFields: comparison.divergences.filter((d) => !d.agree).map((d) => d.field),
    };
  });
  const totalDivergences = rows.reduce((s, r) => s + r.divergentFields.length, 0);
  return {
    rows,
    overallParity: rows.length ? Number((rows.reduce((s, r) => s + r.parity, 0) / rows.length).toFixed(4)) : 1,
    totalDivergences,
    certifiable: totalDivergences === 0,
  };
}

export { collectContactEvidence, projectContact };
export type { CanonicalContactRecord, ContactWriteInputs, ContactRowLike, ContactShadowPersistDeps, ContactShadowPersistResult };
