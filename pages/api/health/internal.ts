
/**
 * Internal System Health Endpoint
 * 
 * GET /api/health/internal
 * 
 * Exposes:
 * - Redis connection health (uptime, reconnects, status)
 * - Polling reliability (success rate, consecutive failures)
 * - Monitoring freshness (is polling data current?)
 * - Monitoring failure signals (what's wrong?)
 * 
 * 🔴 NODE RUNTIME ONLY
 * Used by SRE dashboards and alerting systems
 */

export const runtime = 'nodejs';

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSharedRedisSyncOrNull, getClientRecreationCount } from '@/lib/redis/client';
import { getConnectionHealthMetrics, detectMonitoringFailure, getTerminalStateMetrics } from '@/lib/redis/healthMetrics';
import { getPollingHealthMetrics } from '@/lib/redis/usageProtection';

interface InternalHealthResponse {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  
  redis: {
    status: string;
    connectedSince: string;
    uptimeSeconds: number;
    reconnectCount: number;
    lastReconnectAt: string | null;
    clientRecreations: number;
    terminalStateDetections: number;
    lastTerminalStateDetectedAt: string | null;
    isMonitoringFresh: boolean;
    timeSinceLastPollMs: number;
  };
  
  polling: {
    successRate: number;
    pollsSucceeded: number;
    pollsFailed: number;
    consecutiveFailures: number;
    totalPolls: number;
    lastSuccessfulPoll: string;
    lastErrorMessage: string;
  };
  
  monitoring: {
    degraded: boolean;
    reason: string | null;
    failedSignals: string[];
    severity: 'warning' | 'critical';
  };
  
  diagnostics: {
    metrics_freshness_ms: number;
    expected_max_ms: number;
    is_fresh: boolean;
    monitoring_ready: boolean;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InternalHealthResponse>
) {
  const timestamp = new Date().toISOString();
  
  try {
    // Get Redis connection state
    const redis = getSharedRedisSyncOrNull();
    const connectionHealth = getConnectionHealthMetrics();
    const terminalStateMetrics = getTerminalStateMetrics();
    const pollingMetrics = getPollingHealthMetrics();
    const clientRecreationCount = getClientRecreationCount();
    
    // Detect monitoring failures
    const monitoringFailure = detectMonitoringFailure({
      successRate: pollingMetrics.successRate,
      pollsFailed: pollingMetrics.pollsFailed,
      consecutiveFailures: pollingMetrics.consecutiveFailures,
    });
    
    // Determine overall health status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (monitoringFailure.severity === 'critical') {
      overallStatus = 'unhealthy';
    } else if (monitoringFailure.degraded) {
      overallStatus = 'degraded';
    }
    
    const response: InternalHealthResponse = {
      timestamp,
      status: overallStatus,
      
      redis: {
        status: connectionHealth.status,
        connectedSince: connectionHealth.connectedSince,
        uptimeSeconds: connectionHealth.uptimeSeconds,
        reconnectCount: connectionHealth.reconnectCount,
        lastReconnectAt: connectionHealth.lastReconnectAt,
        clientRecreations: clientRecreationCount,
        terminalStateDetections: terminalStateMetrics.detectionCount,
        lastTerminalStateDetectedAt: terminalStateMetrics.lastDetectedAt,
        isMonitoringFresh: connectionHealth.isMonitoringFresh,
        timeSinceLastPollMs: connectionHealth.timeSinceLastPollMs,
      },
      
      polling: {
        successRate: pollingMetrics.successRate,
        pollsSucceeded: pollingMetrics.pollsSucceeded,
        pollsFailed: pollingMetrics.pollsFailed,
        consecutiveFailures: pollingMetrics.consecutiveFailures,
        totalPolls: pollingMetrics.totalPolls,
        lastSuccessfulPoll: pollingMetrics.lastSuccessfulPoll,
        lastErrorMessage: pollingMetrics.lastErrorMessage,
      },
      
      monitoring: {
        degraded: monitoringFailure.degraded,
        reason: monitoringFailure.reason,
        failedSignals: monitoringFailure.failedSignals,
        severity: monitoringFailure.severity,
      },
      
      diagnostics: {
        metrics_freshness_ms: connectionHealth.timeSinceLastPollMs,
        expected_max_ms: 30_000,
        is_fresh: connectionHealth.isMonitoringFresh,
        monitoring_ready: !monitoringFailure.degraded,
      },
    };
    
    // Set HTTP status code based on health
    const statusCode = 
      overallStatus === 'healthy' ? 200 :
      overallStatus === 'degraded' ? 200 :
      503;  // unhealthy → service unavailable
    
    // Add structured logging
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'internal_health_check',
      timestamp,
      status: overallStatus,
      redis_status: connectionHealth.status,
      redis_uptime_seconds: connectionHealth.uptimeSeconds,
      polling_success_rate: pollingMetrics.successRate,
      monitoring_fresh: connectionHealth.isMonitoringFresh,
      monitoring_failures: monitoringFailure.failedSignals,
    }));
    
    res.status(statusCode).json(response);
  } catch (error) {
    console.error('[api/health/internal] Error:', {
      error: (error as Error)?.message,
      timestamp,
    });
    
    res.status(503).json({
      timestamp,
      status: 'unhealthy',
      
      redis: {
        status: 'unknown',
        connectedSince: new Date(0).toISOString(),
        uptimeSeconds: 0,
        reconnectCount: 0,
        lastReconnectAt: null,
        clientRecreations: 0,
        terminalStateDetections: 0,
        lastTerminalStateDetectedAt: null,
        isMonitoringFresh: false,
        timeSinceLastPollMs: -1,
      },
      
      polling: {
        successRate: 0,
        pollsSucceeded: 0,
        pollsFailed: 0,
        consecutiveFailures: 0,
        totalPolls: 0,
        lastSuccessfulPoll: new Date(0).toISOString(),
        lastErrorMessage: (error as Error)?.message || 'Unknown error',
      },
      
      monitoring: {
        degraded: true,
        reason: 'Failed to fetch health metrics: ' + ((error as Error)?.message || 'unknown error'),
        failedSignals: ['health_endpoint_error'],
        severity: 'critical',
      },
      
      diagnostics: {
        metrics_freshness_ms: -1,
        expected_max_ms: 30_000,
        is_fresh: false,
        monitoring_ready: false,
      },
    });
  }
}
