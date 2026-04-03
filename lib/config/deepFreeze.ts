/**
 * Deep Freeze Utility — Make nested objects immutable
 *
 * Prevents accidental (or malicious) mutations to config objects.
 * Config must never change at runtime.
 *
 * 🔒 IMMUTABILITY LEVELS:
 * Level 1: Object.freeze() — prevents property changes (shallow)
 * Level 2: deepFreeze() — prevents changes to nested objects (deep)
 * Level 3: readonlyProxy() — prevents any property access violations (proxy)
 *
 * Used by: config/index.ts to freeze the config object
 * Also useful for: freezing Redis client config, feature flag objects
 */

/**
 * Deep freeze recursively traverses and freezes all properties
 * Prevents any mutations at any depth
 *
 * Example:
 *   const obj = { a: { b: { c: 1 } } };
 *   deepFreeze(obj);
 *   obj.a.b.c = 2; // throws TypeError (strict mode) or silently fails
 */
export function deepFreeze<T extends object>(obj: T): T {
  // First freeze the object itself
  Object.freeze(obj);

  // Then recursively freeze all properties
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as any)[prop];

    // Skip non-objects and already frozen objects
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
      return;
    }

    // Recursively freeze nested objects
    deepFreeze(value);
  });

  return obj;
}

/**
 * Create a readonly proxy for an object
 * Provides stricter validation than Object.freeze()
 * - Prevents READ of non-existent properties (typo detection)
 * - Prevents WRITE of any property
 * - Prevents DELETE operations
 * - Logs all access attempts (optional)
 *
 * Example:
 *   const config = readonlyProxy({ HOST: 'localhost', PORT: 6379 });
 *   config.HOST           // ✅ works
 *   config.HOOST          // ❌ throws TypeError (typo detected!)
 *   config.PORT = 9999    // ❌ throws TypeError
 *   delete config.PORT    // ❌ throws TypeError
 */
export function readonlyProxy<T extends Record<string, any>>(
  obj: T,
  name?: string
): Readonly<T> {
  const allowedKeys = new Set(Object.keys(obj));

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop);
      }

      // Check if property exists (catch typos)
      if (!allowedKeys.has(prop)) {
        throw new TypeError(
          `[${name || 'object'}] Property not found: ${String(prop)} ` +
          `(available: ${Array.from(allowedKeys).join(', ')})`
        );
      }

      return Reflect.get(target, prop);
    },

    set(target, prop) {
      throw new TypeError(
        `[${name || 'object'}] Cannot assign to property: ${String(prop)} (readonly)`
      );
    },

    deleteProperty(target, prop) {
      throw new TypeError(
        `[${name || 'object'}] Cannot delete property: ${String(prop)} (readonly)`
      );
    },

    has(target, prop) {
      return allowedKeys.has(String(prop));
    },

    ownKeys(target) {
      return Array.from(allowedKeys);
    },

    getOwnPropertyDescriptor(target, prop) {
      if (allowedKeys.has(String(prop))) {
        return Object.getOwnPropertyDescriptor(target, prop);
      }
      return undefined;
    },

    defineProperty(target, prop) {
      throw new TypeError(
        `[${name || 'object'}] Cannot define property: ${String(prop)} (readonly)`
      );
    },

    preventExtensions(target) {
      return true;
    },

    getPrototypeOf(target) {
      return Object.getPrototypeOf(target);
    },

    setPrototypeOf(target, proto) {
      throw new TypeError(
        `[${name || 'object'}] Cannot set prototype (readonly)`
      );
    },
  };

  return new Proxy(obj, handler) as Readonly<T>;
}

/**
 * Verify that an object is deeply frozen
 */
export function isDeepFrozen(obj: any): boolean {
  if (!Object.isFrozen(obj)) return false;

  return Object.getOwnPropertyNames(obj).every((prop) => {
    const value = obj[prop];
    if (value === null || typeof value !== 'object') return true;
    if (!Object.isFrozen(value)) return false;
    return isDeepFrozen(value);
  });
}

/**
 * Clone and deep freeze an object (for testing)
 */
export function freezeClone<T extends object>(obj: T): T {
  const clone = JSON.parse(JSON.stringify(obj));
  return deepFreeze(clone) as T;
}

/**
 * Create a fully protected config object
 * - Deep frozen for no mutations
 * - Readonly proxy for typo detection
 * - Type-safe
 */
export function protectConfig<T extends Record<string, any>>(
  config: T,
  name: string = 'config'
): Readonly<T> {
  // First deep freeze
  deepFreeze(config);

  // Then wrap with readonly proxy for extra safety
  return readonlyProxy(config, name);
}
