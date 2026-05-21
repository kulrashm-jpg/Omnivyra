import { getInstrumentedStandaloneRedisClient } from './standaloneRedisClient';

export const redis = getInstrumentedStandaloneRedisClient('metrics');
