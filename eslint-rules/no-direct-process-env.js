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
    
    // Whitelist: allow direct access only in config module directory
    const isInConfigDir = filename.includes('/config/') || filename.includes('/lib/config/');
    if (isInConfigDir) {
      return {}; // No checks in config directory
    }

    return {
      // Check: process.env.VARIABLE_NAME
      MemberExpression(node) {
        // Match: process.env.X
        if (
          node.object.name === 'process' &&
          node.property.name === 'env' &&
          node.parent.property &&
          node.parent.property.name
        ) {
          context.report({
            node,
            messageId: 'noDirect',
          });
        }
        
        // Match: process.env (accessing the object itself)
        if (
          node.object.name === 'process' &&
          node.property.name === 'env'
        ) {
          // Check parent to see if it's being accessed for a specific property
          const parent = node.parent;
          if (parent.type === 'MemberExpression' || parent.type === 'CallExpression') {
            context.report({
              node,
              messageId: 'noDirect',
            });
          }
        }
      },

      // Check: process.env['VARIABLE_NAME'] or process.env[dynamicKey]
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'MemberExpression' &&
          node.callee.object.object.name === 'process' &&
          node.callee.object.property.name === 'env'
        ) {
          context.report({
            node,
            messageId: 'noDirect',
          });
        }
      },

      // Check: const x = process.env.VAR
      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === 'MemberExpression' &&
          node.init.object.type === 'MemberExpression' &&
          node.init.object.object.name === 'process' &&
          node.init.object.property.name === 'env'
        ) {
          context.report({
            node,
            messageId: 'noDirect',
          });
        }
      },
    };
  },
};
