import type { ScheduleCommand, ScheduleResult } from '../contracts/ScheduleContracts';

export interface ScheduleRepository {
  createScheduledPost(command: ScheduleCommand): Promise<ScheduleResult>;
}
