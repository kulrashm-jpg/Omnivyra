/**
 * Re-export shim — keeps the canonical implementation in backend/lib/performance/
 * so that backend types (under backend/tsconfig.json rootDir) can import it,
 * while frontend components can still use this shorter path.
 */
export * from '../../backend/lib/performance/performanceAnalyzer';
