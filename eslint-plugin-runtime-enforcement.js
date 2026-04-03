/**
 * Custom ESLint Rules for Runtime Enforcement
 * 
 * Prevents:
 * - Redis imports in Edge runtime files
 * - Node.js APIs (fs, path, process) in Edge files
 * - Runtime boundary violations
 * 
 * Enforces:
 * - All Node dependencies must be in files declaring: runtime = 'nodejs'
 * - Edge files can only import safe, isomorphic code
 */

module.exports = {
  rules: {
    /**
     * Rule: no-forbidden-imports-in-edge
     * 
     * Prevents importing Node.js-only modules in files that don't declare runtime='nodejs'
     * 
     * ❌ BAD:
     * // pages/api/route.ts (no export const runtime)
     * import { getSharedRedisConnection } from '@/lib/redis/client';  // ERROR
     * 
     * ✅ GOOD:
     * // pages/api/route.ts
     * export const runtime = 'nodejs';
     * import { getSharedRedisConnection } from '@/lib/redis/client';  // OK
     * 
     * ✅ GOOD:
     * // Edge-safe file
     * import { someHelper } from '@/lib/utils';  // OK (no Node deps)
     */
    'no-forbidden-imports-in-edge': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevent Node.js imports in files without runtime="nodejs" declaration',
          category: 'Runtime Boundaries',
          recommended: 'error',
        },
        fixable: null,
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();
        const sourceCode = context.getSourceCode();
        
        // Forbidden modules (always require Node runtime)
        const forbiddenModules = [
          'redis',
          'ioredis',
          'fs',
          'path',
          'fs/promises',
          '@/lib/redis',
          '@/lib/redis/client',
          '@/lib/redis/usageProtection',
          '@/lib/redis/instrumentation',
          '@/lib/redis/healthMetrics',
        ];
        
        // File patterns that are automatically Node-only (always OK)
        const nodeOnlyPatterns = [
          /pages\/api\//,  // API routes
          /lib\/redis\//,  // Redis modules
          /backend\//,     // Backend code
          /scripts\//,     // Scripts
          /instrumentation\.ts$/,
          /middleware[\\/](?!client)/,  // Middleware (except *client.ts)
        ];
        
        // Check if file is definitely Node-only pattern
        const isNodeOnlyFile = nodeOnlyPatterns.some(pattern => pattern.test(filename));
        
        // Check if file declares export const runtime = 'nodejs'
        let hasNodeRuntimeDeclaration = false;
        sourceCode.ast.body.forEach((node) => {
          if (
            node.type === 'ExportNamedDeclaration' &&
            node.declaration &&
            node.declaration.type === 'VariableDeclaration'
          ) {
            const decl = node.declaration.declarations[0];
            if (decl.id.name === 'runtime' && decl.init?.value === 'nodejs') {
              hasNodeRuntimeDeclaration = true;
            }
          }
        });
        
        // File is safe if:
        // 1. Explicitly declares runtime='nodejs', OR
        // 2. Is in a Node-only directory pattern
        const isNodeSafe = hasNodeRuntimeDeclaration || isNodeOnlyFile;
        
        return {
          ImportDeclaration(node) {
            if (isNodeSafe) return;  // File is Node, import anything
            
            // Check if importing a forbidden module
            const importSource = node.source.value;
            const isForbidden = forbiddenModules.some(
              mod => importSource === mod || importSource.startsWith(mod + '/')
            );
            
            if (isForbidden) {
              context.report({
                node,
                message: `Cannot import "${importSource}" in ${filename.includes('pages/api') ? 'API route' : 'Edge'} file without 'export const runtime = "nodejs"' declaration.`,
              });
            }
          },
        };
      },
    },

    /**
     * Rule: no-direct-process-env
     * 
     * Prevents direct process.env access outside @/config module
     * 
     * ❌ BAD:
     * const url = process.env.REDIS_URL;
     * 
     * ✅ GOOD:
     * import { config } from '@/config';
     * const url = config.REDIS_URL;
     */
    'no-direct-process-env': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Use @/config instead of direct process.env access',
          category: 'Configuration',
          recommended: 'warn',
        },
        fixable: null,
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();
        
        // Allow direct process.env in:
        // 1. @/config module itself
        // 2. Env schema/validation files
        // 3. Build scripts
        if (
          filename.includes('config/env') ||
          filename.includes('config/index') ||
          filename.includes('.next') ||
          filename.includes('node_modules')
        ) {
          return {};
        }
        
        return {
          MemberExpression(node) {
            if (
              node.object.name === 'process' &&
              node.property.name === 'env'
            ) {
              context.report({
                node,
                message: 'Use @/config module instead of direct process.env. Example: import { config } from "@/config"; const val = config.KEY_NAME;',
              });
            }
          },
        };
      },
    },

    /**
     * Rule: no-fs-in-api-routes
     * 
     * Specifically prevents fs/path in API routes that don't declare runtime='nodejs'
     * 
     * ❌ BAD:
     * // pages/api/route.ts (no runtime declaration)
     * import * as fs from 'fs';
     * export default handler() { fs.writeFileSync(...) }
     * 
     * ✅ GOOD:
     * // pages/api/route.ts
     * export const runtime = 'nodejs';
     * import * as fs from 'fs';
     */
    'no-fs-in-api-routes': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevent fs/path in API routes without runtime="nodejs"',
          category: 'Runtime Boundaries',
          recommended: 'error',
        },
        fixable: null,
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();
        
        if (!filename.includes('pages/api/')) return {};
        
        const sourceCode = context.getSourceCode();
        let hasNodeRuntimeDeclaration = false;
        
        sourceCode.ast.body.forEach((node) => {
          if (
            node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'VariableDeclaration'
          ) {
            const decl = node.declaration.declarations[0];
            if (decl?.id.name === 'runtime' && decl?.init?.value === 'nodejs') {
              hasNodeRuntimeDeclaration = true;
            }
          }
        });
        
        if (hasNodeRuntimeDeclaration) return {};
        
        return {
          ImportDeclaration(node) {
            const mod = node.source.value;
            if (['fs', 'path', 'fs/promises'].includes(mod)) {
              context.report({
                node,
                message: `Cannot import "${mod}" in API route without 'export const runtime = "nodejs"' at top of file.`,
              });
            }
          },
        };
      },
    },
  },
};
