// Simple Queue System for Background Processing
import { ScheduledPost } from '../types/scheduling';

interface QueueJob {
  id: string;
  post: ScheduledPost;
  scheduledFor: Date;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export class SimpleQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private processing = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startProcessor();
  }

  // Add a job to the queue
  addJob(post: ScheduledPost): void {
    const job: QueueJob = {
      id: post.id,
      post,
      scheduledFor: post.scheduledFor,
      attempts: 0,
      maxAttempts: post.maxRetries,
      status: 'pending',
    };

    this.jobs.set(post.id, job);
    console.log(`Job ${post.id} added to queue for ${post.scheduledFor.toISOString()}`);
  }

  // Remove a job from the queue
  removeJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  // Get all jobs
  getAllJobs(): QueueJob[] {
    return Array.from(this.jobs.values());
  }

  // Get jobs by status
  getJobsByStatus(status: QueueJob['status']): QueueJob[] {
    return Array.from(this.jobs.values()).filter(job => job.status === status);
  }

  // Get pending jobs ready to process
  getReadyJobs(): QueueJob[] {
    const now = new Date();
    return Array.from(this.jobs.values()).filter(job => 
      job.status === 'pending' && 
      job.scheduledFor <= now
    );
  }

  // Start the queue processor
  private startProcessor(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.processJobs();
    }, 10000); // Check every 10 seconds

    console.log('Queue processor started');
  }

  // Stop the queue processor
  stopProcessor(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Queue processor stopped');
    }
  }

  // Process ready jobs
  private async processJobs(): Promise<void> {
    if (this.processing) return;

    const readyJobs = this.getReadyJobs();
    if (readyJobs.length === 0) return;

    this.processing = true;
    console.log(`Processing ${readyJobs.length} ready jobs`);

    for (const job of readyJobs) {
      try {
        await this.processJob(job);
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
      }
    }

    this.processing = false;
  }

  // Process a single job
  private async processJob(job: QueueJob): Promise<void> {
    console.log(`Processing job ${job.id} (attempt ${job.attempts + 1})`);
    
    // Update job status
    job.status = 'processing';
    job.attempts++;

    try {
      // Simulate posting process
      await this.simulatePosting(job.post);
      
      // Mark as completed
      job.status = 'completed';
      console.log(`Job ${job.id} completed successfully`);
      
      // Remove from queue
      this.jobs.delete(job.id);
      
    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error.message);
      
      if (job.attempts < job.maxAttempts) {
        // Schedule retry with exponential backoff
        const retryDelay = Math.pow(2, job.attempts) * 60 * 1000; // 2^attempts minutes
        job.nextRetryAt = new Date(Date.now() + retryDelay);
        job.status = 'pending';
        console.log(`Job ${job.id} scheduled for retry at ${job.nextRetryAt.toISOString()}`);
      } else {
        // Max attempts reached, mark as failed
        job.status = 'failed';
        console.log(`Job ${job.id} failed after ${job.maxAttempts} attempts`);
      }
    }
  }

  // Simulate posting to social media platform
  private async simulatePosting(post: ScheduledPost): Promise<void> {
    // Simulate API call delay
    const delay = 1000 + Math.random() * 3000; // 1-4 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Simulate occasional failures (10% chance)
    if (Math.random() < 0.1) {
      throw new Error(`Simulated posting failure for ${post.platform}`);
    }
    
    console.log(`Successfully posted to ${post.platform}: ${post.content.substring(0, 50)}...`);
  }

  // Get queue statistics
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
    };
  }

  // Clear all jobs
  clearAll(): void {
    this.jobs.clear();
    console.log('All jobs cleared from queue');
  }

  // Clear completed jobs
  clearCompleted(): void {
    const completedJobs = this.getJobsByStatus('completed');
    completedJobs.forEach(job => this.jobs.delete(job.id));
    console.log(`Cleared ${completedJobs.length} completed jobs`);
  }
}

// Singleton queue instance
export const queue = new SimpleQueue();























