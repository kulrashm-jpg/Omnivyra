// API Endpoint for Queue Statistics
import { NextApiRequest, NextApiResponse } from 'next';
import { queue } from '@/lib/services/queue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stats = queue.getStats();
    const allJobs = queue.getAllJobs();
    
    // Get jobs by status
    const pendingJobs = queue.getJobsByStatus('pending');
    const processingJobs = queue.getJobsByStatus('processing');
    const failedJobs = queue.getJobsByStatus('failed');
    
    // Get ready jobs (should be processed soon)
    const readyJobs = queue.getReadyJobs();
    
    res.status(200).json({
      success: true,
      data: {
        stats,
        jobs: {
          all: allJobs,
          pending: pendingJobs,
          processing: processingJobs,
          failed: failedJobs,
          ready: readyJobs,
        },
        queueHealth: {
          isProcessing: stats.processing > 0,
          hasFailedJobs: stats.failed > 0,
          hasReadyJobs: readyJobs.length > 0,
          totalJobs: stats.total,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}























