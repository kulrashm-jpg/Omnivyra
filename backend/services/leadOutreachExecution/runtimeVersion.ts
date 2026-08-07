/**
 * WS-3 — version identity for the Lead Outreach Execution Runtime.
 *
 * Mirrors the WS-2 `engineVersion` pattern. These values are stamped onto a
 * task ONCE at materialisation and are immutable thereafter (enforced by a
 * database trigger), so an audit can answer "under which planner, translation
 * and rules was contact with this person authorised?" long after the code that
 * wrote them has changed.
 *
 * They are DESCRIPTIVE, not dispatch-controlling: governance is evaluated at
 * dispatch against the rules then in force, and each attempt separately records
 * the governance version in force at that attempt.
 *
 * Version history:
 *  - lor-1.0.0 / tr-1.0.0 / gov-1.0.0 — WS-3 M1: durable storage only. No
 *    translation, no governance execution, no dispatch exists yet. The
 *    translation and governance versions are declared here so the storage
 *    contract is complete; they advance when M2 and M4 introduce the logic
 *    they name.
 */

/** Version of the Lead Outreach Execution Runtime itself. */
export const EXECUTION_RUNTIME_VERSION = 'lor-1.0.0';

/** Version of the single AutomationTask → OutreachTask translation boundary (M2). */
export const TRANSLATION_VERSION = 'tr-1.0.0';

/** Version of the governance rule set (M4). */
export const GOVERNANCE_VERSION = 'gov-1.0.0';
