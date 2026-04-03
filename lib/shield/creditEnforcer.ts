/**
 * MULTI-TENANT SHIELD: CREDIT ENFORCER
 * 
 * Pre-request credit reservation and post-execution deduction.
 * Supports refunds on failure.
 */

export interface CreditReservation {
  userId: string;
  requestId: string;
  amount: number;
  timestamp: number;
  status: 'reserved' | 'deducted' | 'refunded';
}

export class CreditEnforcer {
  private reservations: Map<string, CreditReservation> = new Map();
  private ledger: any; // CreditLedger instance

  constructor(ledger: any) {
    this.ledger = ledger;
  }

  /**
   * Reserve credits before executing action
   */
  async reserveCredits(
    userId: string,
    requestId: string,
    costEstimate: number
  ): Promise<{ allowed: boolean; reason?: string; required?: number; balance?: number }> {
    // Check current balance
    const balance = await this.ledger.getBalance(userId);

    if (balance < costEstimate) {
      return {
        allowed: false,
        reason: 'insufficient_credits',
        required: costEstimate,
        balance: balance,
      };
    }

    // Create reservation
    const reservation: CreditReservation = {
      userId,
      requestId,
      amount: costEstimate,
      timestamp: Date.now(),
      status: 'reserved',
    };

    this.reservations.set(requestId, reservation);

    // Hold credits in ledger (temporary transaction)
    await this.ledger.reserve(userId, costEstimate);

    return { allowed: true };
  }

  /**
   * Deduct actual credits after execution
   */
  async deductCredits(
    userId: string,
    requestId: string,
    actualCost: number
  ): Promise<void> {
    const reservation = this.reservations.get(requestId);

    if (!reservation) {
      // No reservation, deduct directly
      await this.ledger.deduct(userId, actualCost);
      return;
    }

    const reserved = reservation.amount;

    if (actualCost < reserved) {
      // Actual cost less than reserved: refund difference
      const refundAmount = reserved - actualCost;
      await this.ledger.refund(userId, refundAmount);
      await this.ledger.deduct(userId, actualCost);
    } else if (actualCost > reserved) {
      // Actual cost more than reserved: charge additional
      const additional = actualCost - reserved;
      await this.ledger.deduct(userId, additional);
    } else {
      // Exact match: just deduct
      await this.ledger.deduct(userId, actualCost);
    }

    // Mark as deducted in ledger (for audit trail)
    reservation.status = 'deducted';
    this.reservations.set(requestId, reservation);
  }

  /**
   * Refund reserved credits (on error/cancellation)
   */
  async refund(userId: string, requestId: string): Promise<void> {
    const reservation = this.reservations.get(requestId);

    if (reservation) {
      await this.ledger.refund(userId, reservation.amount);
      reservation.status = 'refunded';
      this.reservations.set(requestId, reservation);
    }
  }

  /**
   * Get ledger balance
   */
  async getBalance(userId: string): Promise<number> {
    return this.ledger.getBalance(userId);
  }

  /**
   * Check reserved but not deducted (for monitoring)
   */
  getReservedAmount(userId: string): number {
    let reserved = 0;
    for (const [_, res] of this.reservations) {
      if (res.userId === userId && res.status === 'reserved') {
        reserved += res.amount;
      }
    }
    return reserved;
  }

  /**
   * Get effective balance (accounting for reservations)
   */
  async getEffectiveBalance(userId: string): Promise<number> {
    const balance = await this.getBalance(userId);
    const reserved = this.getReservedAmount(userId);
    return balance - reserved;
  }

  /**
   * Clean up old reservations (for memory management)
   */
  cleanupOldReservations(ageMinutes: number = 60): number {
    const cutoff = Date.now() - ageMinutes * 60000;
    let removed = 0;

    for (const [id, res] of this.reservations) {
      if (res.timestamp < cutoff) {
        this.reservations.delete(id);
        removed++;
      }
    }

    return removed;
  }
}

/**
 * Credit cost definitions
 */
export const CREDIT_COSTS = {
  // API calls
  api: {
    default: 1,
    search: 5,
    batch: (count: number) => Math.max(1, Math.floor(count * 0.5)),
    export: 50,
  },

  // Queue jobs
  queue: {
    background: 10,
    analytics: 5,
    export: 50,
    training: 500,
  },

  // AI operations
  ai: {
    simple: 50, // Simple prompt
    complex: 200, // Complex analysis
    training: 1000, // Model training
    batch: (count: number) => count * 30,
  },
};

/**
 * Helper to estimate cost for request
 */
export function estimateCost(actionType: 'api' | 'queue' | 'ai', subType: string): number {
  const costs = (CREDIT_COSTS[actionType] ?? {}) as Record<string, any>;
  const cost = costs[subType as keyof typeof costs];

  if (typeof cost === 'number') {
    return cost;
  } else if (typeof cost === 'function') {
    return cost(1); // Default to 1 unit
  } else {
    return costs.default || 1;
  }
}
