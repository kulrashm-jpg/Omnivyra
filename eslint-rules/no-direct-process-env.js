/**
 * ESLint Custom Rule: no-direct-process-env
 *
 * Enforces use of `@/config` module instead of direct `process.env` access
 * outside of `lib/config/env.schema.ts` and `config/index.ts`.
 *
 * Rule: Warn/Error on:
 * - process.env.VAR_NAME (except in /config/ and /lib/config/)
 * - process.env[dynamicKey] (except in /config/ and /lib/config/)
 *
 * ALLOW:
 * - config/env.schema.ts - Central validation schema
 * - lib/config/enforcer.ts - Config module internals
 * - lib/config/verification.ts - Config module internals
 * - lib/config/deepFreeze.ts - Config module internals
 *
 * DISALLOW everywhere else:
 * - backend/workers/main.ts - USE: import { config } from '@/config'
 * - frontend code - USE: config.NEXT_PUBLIC_*
 *
 * Error Message:
 *   "Direct process.env access detected. Use 'import { config } from '@/config' instead.
 *    Allowed only in lib/config/ and config/ directories for implementation."
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of @/config module instead of direct process.env access',
      category: 'Best Practices',
      recommended: 'error',
    },
    messages: {
      noDirect: `Direct process.env access is not allowed. Use 'import { config } from "@/config"' instead. Exception: allowed only in lib/config/ and config/ directories.`,
    },
    fixable: null, // Cannot auto-fix (context-dependent)
  },

  create(context) {
    const filename = context.getFilename();
    const normalizedFilename = filename.replace(/\\/g, '/');
    
    // Whitelist: allow direct access only in config module directory
    const isInConfigDir = normalizedFilename.includes('/config/') || normalizedFilename.includes('/lib/config/');
    if (isInConfigDir) {
      return {}; // No checks in config directory
    }

    const allowedEnvNames = new Set([
      'NODE_ENV',
      'NEXT_RUNTIME',
      'JEST_WORKER_ID',
    ]);

    function getEnvName(node) {
      const parent = node.parent;
      if (!parent || parent.type !== 'MemberExpression' || parent.object !== node) {
        return null;
      }

      if (!parent.computed && parent.property.type === 'Identifier') {
        return parent.property.name;
      }

      if (parent.computed && parent.property.type === 'Literal') {
        return String(parent.property.value);
      }

      return null;
    }

    function isAllowedEnvName(name) {
      return Boolean(name && (allowedEnvNames.has(name) || name.startsWith('NEXT_PUBLIC_')));
    }

    function reportIfDisallowed(node) {
      const name = getEnvName(node);
      if (isAllowedEnvName(name)) {
        return;
      }

      context.report({
        node,
        messageId: 'noDirect',
      });
    }

    // One visitor on the inner `process.env` MemberExpression handles every
    // form: process.env.X, process.env['X'], destructuring, and direct passing
    // of process.env. Reporting once per `process.env` node avoids the
    // duplicate diagnostics the previous multi-visitor implementation produced.
    return {
      'MemberExpression[object.name="process"][property.name="env"]'(node) {
        reportIfDisallowed(node);
      },
    };
  },
};
