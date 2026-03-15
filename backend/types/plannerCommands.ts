/**
 * Planner Command Schema
 * Structured commands for AI chat to add/modify/delete skeleton activities
 * without regenerating the entire plan.
 */

export type PlannerCommand =
  | {
      action: 'add_activity';
      platform: string;
      content_type: string;
      day?: string;
      frequency?: number;
    }
  | {
      action: 'remove_platform';
      platform: string;
    }
  | {
      action: 'change_frequency';
      platform: string;
      content_type: string;
      frequency: number;
    }
  | {
      action: 'move_activity';
      platform: string;
      content_type: string;
      day: string;
    }
  | {
      action: 'delete_activity';
      execution_id: string;
    };

export type PlannerCommandResponse = {
  planner_commands: PlannerCommand[];
};
