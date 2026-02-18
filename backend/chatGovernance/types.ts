/**
 * Chat Governance — types for global and domain-specific layers.
 */

export interface ChatMessage {
  type: 'user' | 'ai';
  message: string;
}

/** Global policy check result */
export interface GlobalPolicyResult {
  allowed: boolean;
  reason?: string;
  code?: 'abuse' | 'gibberish' | 'misleading' | 'off_topic' | 'spam' | 'empty' | 'too_long';
}

/** Domain-specific Q&A state (e.g. campaign planning) */
export interface QAState {
  /** Keys of questions that have been answered (or prefilled) */
  answeredKeys: string[];
  /** Key of the current/last question asked (if any) */
  currentQuestionKey: string | null;
  /** Whether the last AI message was a confirmation prompt */
  lastWasConfirmation: boolean;
  /** Whether the user's last message is a valid confirmation (yes/sure/ok) */
  userConfirmed: boolean;
  /** Next question to ask, or null if all done or should generate */
  nextQuestion: { key: string; question: string } | null;
  /** Whether we have enough to generate (all required answered or deferred) */
  readyToGenerate: boolean;
}
